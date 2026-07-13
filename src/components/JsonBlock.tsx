function humanize(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Renders arbitrary GPT-generated JSON (objects/arrays/primitives) as readable nested
// blocks. Used for strategy components whose exact shape isn't fixed by the schema.
export default function JsonBlock({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined || value === '') return null

  if (Array.isArray(value)) {
    const primitives = value.every((v) => typeof v !== 'object' || v === null)
    if (primitives) {
      return (
        <ul className="list-disc ml-5 space-y-1">
          {value.map((v, i) => (
            <li key={i} className="text-secondary text-sm">{String(v)}</li>
          ))}
        </ul>
      )
    }
    return (
      <div className="space-y-3">
        {value.map((v, i) => (
          <div key={i} className={depth === 0 ? 'panel p-3' : 'pl-3 border-l border-line'}>
            <JsonBlock value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return (
      <div className="space-y-2">
        {entries.map(([k, v]) => (
          <div key={k}>
            <div className="text-xs font-medium text-sage uppercase tracking-wide">{humanize(k)}</div>
            <div className="mt-0.5">
              {typeof v === 'object' && v !== null ? (
                <JsonBlock value={v} depth={depth + 1} />
              ) : (
                <div className="text-secondary text-sm">{String(v)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return <div className="text-secondary text-sm">{String(value)}</div>
}
