import { Fragment } from 'react'

// Minimal markdown renderer for GPT-generated reports: headings, bold, bullet/numbered
// lists, tables, paragraphs. Builds React elements directly (no HTML parsing) so it's safe
// by construction — no dangerouslySetInnerHTML.
function renderInline(text: string, key: number | string) {
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

// Detects a markdown table starting at line `i` (a `| ... |` row followed by a
// `|---|---|` divider row). Returns [element, linesConsumed] or null if line i isn't one.
function tryRenderTable(lines: string[], i: number) {
  const isRow = (l: string) => l.trim().startsWith('|') && l.trim().endsWith('|')
  const isDivider = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-')
  if (!isRow(lines[i]) || i + 1 >= lines.length || !isDivider(lines[i + 1])) return null

  const splitCells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const header = splitCells(lines[i])
  let j = i + 2
  const rows: string[][] = []
  while (j < lines.length && isRow(lines[j]) && !isDivider(lines[j])) {
    rows.push(splitCells(lines[j]))
    j++
  }

  const el = (
    <div key={`tbl-${i}`} className="overflow-x-auto my-3 panel !p-0">
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {header.map((h, hi) => (
              <th
                key={hi}
                className="text-left font-semibold whitespace-nowrap"
                style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                {renderInline(h, `th${i}-${hi}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className="text-secondary align-top"
                  style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}
                >
                  {renderInline(c, `td${i}-${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return [el, j - i] as const
}

export default function Markdown({ text }: { text: string }) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: JSX.Element[] = []
  let list: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushList = (key: number | string) => {
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      flushList(i)
      continue
    }

    const table = tryRenderTable(lines, i)
    if (table) {
      flushList(i)
      blocks.push(table[0])
      i += table[1] - 1
      continue
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
      continue
    }
    if (ol) {
      if (listType !== 'ol') flushList(i)
      listType = 'ol'
      list.push(ol[1])
      continue
    }
    if (ul) {
      if (listType !== 'ul') flushList(i)
      listType = 'ul'
      list.push(ul[1])
      continue
    }
    flushList(i)
    blocks.push(
      <p key={i} className="text-secondary leading-relaxed my-2">
        {renderInline(trimmed, i)}
      </p>,
    )
  }
  flushList(lines.length)

  return <div className="text-sm">{blocks}</div>
}
