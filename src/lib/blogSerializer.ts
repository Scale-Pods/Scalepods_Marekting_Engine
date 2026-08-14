import type { JSONContent } from '@tiptap/react'
import type { BlogSection } from './blog'

// Converts between Tiptap's document JSON and the exact BlogSection[] shape scalepods.co
// expects (docs/blog-module.md). The site's renderer (BlogBodyClient.tsx: parseMarkdownInline)
// supports only two inline markers — **bold** and [text](url) — split with a single
// non-overlapping regex, so a run that is both bold AND linked can't be represented; link wins
// (see toMarkdownRun below). Everything here stays inside that same subset on purpose: writing
// richer Tiptap marks the site can't render would look right in the editor and wrong live.

const INLINE_SPLIT = /(\[.*?\]\(.*?\)|\*\*.*?\*\*)/g

function toMarkdownRun(text: string, marks: JSONContent['marks']): string {
  const link = marks?.find((m) => m.type === 'link')
  if (link?.attrs?.href) return `[${text}](${link.attrs.href})`
  const bold = marks?.some((m) => m.type === 'bold')
  return bold ? `**${text}**` : text
}

function inlineToMarkdown(content: JSONContent[] | undefined): string {
  if (!content) return ''
  return content.map((n) => (n.type === 'text' ? toMarkdownRun(n.text ?? '', n.marks) : '')).join('')
}

/** Tiptap doc -> BlogSection[]. `droppedImages` counts extra images beyond the first found in a
 *  section, so the caller can warn — the site schema holds exactly one image per section. */
export function tiptapDocToSections(doc: JSONContent): { sections: BlogSection[]; droppedImages: number } {
  const sections: BlogSection[] = []
  let current: BlogSection = { heading: '', body: '' }
  let started = false
  let droppedImages = 0

  function pushLine(line: string) {
    if (!line.trim()) return
    current.body = current.body ? `${current.body}\n${line}` : line
  }
  function flush() {
    if (current.heading || current.body.trim() || current.image) sections.push(current)
  }

  for (const node of doc.content ?? []) {
    if (node.type === 'heading') {
      if (started) flush()
      current = { heading: inlineToMarkdown(node.content), body: '' }
      started = true
      continue
    }
    if (node.type === 'paragraph') {
      pushLine(inlineToMarkdown(node.content))
      continue
    }
    if (node.type === 'bulletList') {
      for (const item of node.content ?? []) {
        const text = (item.content ?? []).map((p) => inlineToMarkdown(p.content)).join(' ')
        pushLine(`• ${text}`)
      }
      continue
    }
    if (node.type === 'sectionImage') {
      if (current.image) {
        droppedImages += 1
      } else {
        current.image = node.attrs?.src
        current.imageCaption = node.attrs?.caption || undefined
      }
      continue
    }
  }
  flush()

  return { sections, droppedImages }
}

function parseInlineMarkdown(line: string): JSONContent[] {
  const parts = line.split(INLINE_SPLIT).filter((p) => p !== '')
  return parts.map((part): JSONContent => {
    const linkMatch = part.match(/^\[(.*)\]\((.*)\)$/)
    if (linkMatch) {
      return { type: 'text', text: linkMatch[1], marks: [{ type: 'link', attrs: { href: linkMatch[2] } }] }
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return { type: 'text', text: part.slice(2, -2), marks: [{ type: 'bold' }] }
    }
    return { type: 'text', text: part }
  })
}

/** BlogSection[] -> Tiptap doc, for opening an existing post back in the editor. */
export function sectionsToTiptapDoc(sections: BlogSection[]): JSONContent {
  const content: JSONContent[] = []
  for (const s of sections) {
    if (s.heading) content.push({ type: 'heading', attrs: { level: 2 }, content: parseInlineMarkdown(s.heading) })
    const lines = s.body.split('\n').map((l) => l.trim()).filter(Boolean)
    let bulletBuf: JSONContent[] = []
    const flushBullets = () => {
      if (bulletBuf.length) {
        content.push({ type: 'bulletList', content: bulletBuf })
        bulletBuf = []
      }
    }
    for (const line of lines) {
      if (line.startsWith('• ')) {
        bulletBuf.push({ type: 'listItem', content: [{ type: 'paragraph', content: parseInlineMarkdown(line.slice(2)) }] })
      } else {
        flushBullets()
        content.push({ type: 'paragraph', content: parseInlineMarkdown(line) })
      }
    }
    flushBullets()
    if (s.image) content.push({ type: 'sectionImage', attrs: { src: s.image, caption: s.imageCaption ?? '' } })
  }
  if (content.length === 0) content.push({ type: 'paragraph' })
  return { type: 'doc', content }
}
