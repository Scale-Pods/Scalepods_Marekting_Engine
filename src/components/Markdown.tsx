import { Fragment } from 'react'

// Minimal markdown renderer for GPT-generated reports: headings, bold, bullet/numbered
// lists, paragraphs. Builds React elements directly (no HTML parsing) so it's safe by
// construction — no dangerouslySetInnerHTML.
function renderInline(text: string, key: number) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <Fragment key={key}>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </Fragment>
  )
}

export default function Markdown({ text }: { text: string }) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: JSX.Element[] = []
  let list: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushList = (key: number) => {
    if (!list.length) return
    const items = list.map((li, i) => <li key={i}>{renderInline(li, i)}</li>)
    blocks.push(
      listType === 'ol' ? (
        <ol key={key} className="list-decimal ml-5 space-y-1 my-2">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc ml-5 space-y-1 my-2">
          {items}
        </ul>
      ),
    )
    list = []
    listType = null
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList(i)
      return
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)/)
    const ol = trimmed.match(/^\d+[.)]\s+(.*)/)
    const ul = trimmed.match(/^[-*]\s+(.*)/)

    if (heading) {
      flushList(i)
      const level = heading[1].length
      const content = heading[2]
      if (level === 1) blocks.push(<h2 key={i} className="text-xl mt-5 mb-2">{renderInline(content, i)}</h2>)
      else if (level === 2) blocks.push(<h3 key={i} className="text-lg mt-4 mb-2 text-sage">{renderInline(content, i)}</h3>)
      else blocks.push(<h4 key={i} className="text-base mt-3 mb-1 font-semibold">{renderInline(content, i)}</h4>)
      return
    }
    if (ol) {
      if (listType !== 'ol') flushList(i)
      listType = 'ol'
      list.push(ol[1])
      return
    }
    if (ul) {
      if (listType !== 'ul') flushList(i)
      listType = 'ul'
      list.push(ul[1])
      return
    }
    flushList(i)
    blocks.push(
      <p key={i} className="text-secondary leading-relaxed my-2">
        {renderInline(trimmed, i)}
      </p>,
    )
  })
  flushList(lines.length)

  return <div className="text-sm">{blocks}</div>
}
