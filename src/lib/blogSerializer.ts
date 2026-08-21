import type { JSONContent } from '@tiptap/react'
import type { BlogSection } from './blog'

// Converts between Tiptap's document JSON and the exact BlogSection[] shape scalepods.co
// expects (docs/blog-module.md). The site's renderer (BlogBodyClient.tsx: parseMarkdownInline)
// supports only two inline markers — **bold** and [text](url) — split with a single
// non-overlapping regex, so a run that is both bold AND linked can't be represented; link wins
// (see toMarkdownRun below). Everything here stays inside that same subset on purpose: writing
// richer Tiptap marks the site can't render would look right in the editor and wrong live.

const INLINE_SPLIT = /(\[.*?\]\(.*?\)|\*\*.*?\*\*)/g

// Ported verbatim from the site's BlogBodyClient.tsx (its own accordionItems render path,
// ~line 3397) so the composer's preview shows the exact same "STEP 01"/"STAGE 02"/etc. tag the
// live site will actually generate — first keyword match wins, empty string (no visible tag) if
// none match. Keep this in sync if the site's list ever changes.
export function tagPrefixForHeading(heading: string): string {
  const h = heading.toLowerCase()
  if (h.includes('building blocks')) return 'FOUNDATION'
  if (h.includes('evolution')) return 'EVOLUTION'
  if (h.includes('implement') || h.includes('step') || h.includes('framework')) return 'STEP'
  if (h.includes('modern sales workflow') || h.includes('stage')) return 'STAGE'
  if (h.includes('process')) return 'PROCESS'
  if (h.includes('mistake')) return 'MISTAKE'
  if (h.includes('use case')) return 'USE CASE'
  return ''
}

/** Resolves what tag word (if any) a section's cards actually show, honoring the explicit
 *  accordionTagPrefix override (undefined = old auto-from-heading behavior, null = none, string =
 *  that literal word) before falling back to tagPrefixForHeading. Shared by the composer's own
 *  preview and (mirrored, not shared — separate repo) the site's real renderer. */
export function resolveTagPrefix(section: BlogSection): string {
  if (section.accordionTagPrefix === undefined) return tagPrefixForHeading(section.heading)
  return section.accordionTagPrefix ?? ''
}

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
 *  section, so the caller can warn — the site schema holds exactly one image per section.
 *  `droppedCardBlocks` is the same idea for a 2nd Cards block under one heading. */
export function tiptapDocToSections(doc: JSONContent): { sections: BlogSection[]; droppedImages: number; droppedCardBlocks: number } {
  const sections: BlogSection[] = []
  let current: BlogSection = { heading: '', body: '' }
  let started = false
  let droppedImages = 0
  let droppedCardBlocks = 0

  function pushLine(line: string) {
    if (!line.trim()) return
    current.body = current.body ? `${current.body}\n${line}` : line
  }
  function flush() {
    if (current.heading || current.body.trim() || current.image || current.imageDark || current.accordionItems) sections.push(current)
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
      if (current.image || current.imageDark) {
        droppedImages += 1
      } else {
        const dark: string | undefined = node.attrs?.srcDark || undefined
        const light: string | undefined = node.attrs?.srcLight || undefined
        // Matches the site's own section.image || (dark ? imageDark : imageLight) check — only
        // emit the dark/light pair when BOTH exist, otherwise fall back to the single `image`
        // field so a one-variant section still renders (theme-swap needs both to pick from).
        if (dark && light) {
          current.imageDark = dark
          current.imageLight = light
        } else {
          current.image = dark ?? light
        }
        current.imageCaption = node.attrs?.caption || undefined
      }
      continue
    }
    if (node.type === 'sectionCards') {
      if (current.accordionItems) {
        droppedCardBlocks += 1
      } else {
        const items = ((node.attrs?.items ?? []) as { title: string; content: string }[])
          .filter((it) => it.title.trim() || it.content.trim())
        if (items.length > 0) {
          current.accordionItems = items
          const tagMode = node.attrs?.tagMode ?? 'auto'
          const tagText = (node.attrs?.tagText ?? '').trim()
          if (tagMode === 'none') current.accordionTagPrefix = null
          else if (tagMode === 'custom') current.accordionTagPrefix = tagText ? tagText.toUpperCase() : null
          // tagMode === 'auto' -> leave accordionTagPrefix unset, the old fallback behavior.
        }
      }
      continue
    }
  }
  flush()

  return { sections, droppedImages, droppedCardBlocks }
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
    if (s.imageDark && s.imageLight) {
      content.push({ type: 'sectionImage', attrs: { srcDark: s.imageDark, srcLight: s.imageLight, caption: s.imageCaption ?? '' } })
    } else if (s.image) {
      // Legacy/single-variant form (existing already-imported posts, e.g. AI Employees) — shows
      // up in the dark slot; add a light variant and it becomes a real theme-swap on next save.
      content.push({ type: 'sectionImage', attrs: { srcDark: s.image, srcLight: null, caption: s.imageCaption ?? '' } })
    }
    if (s.accordionItems && s.accordionItems.length > 0) {
      const tagMode = s.accordionTagPrefix === undefined ? 'auto' : s.accordionTagPrefix === null ? 'none' : 'custom'
      const tagText = typeof s.accordionTagPrefix === 'string' ? s.accordionTagPrefix : ''
      content.push({ type: 'sectionCards', attrs: { items: s.accordionItems, tagMode, tagText } })
    }
  }
  if (content.length === 0) content.push({ type: 'paragraph' })
  return { type: 'doc', content }
}
