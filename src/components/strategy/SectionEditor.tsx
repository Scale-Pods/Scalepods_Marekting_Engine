import { useEffect, useState } from 'react'
import { RefreshCw, Pencil, Check, X } from 'lucide-react'
import { Panel, Button, Spinner } from '../ui'
import type { StrategySection } from '../../lib/strategy'

// The free-form strategy sections (everything except pillar_balance/header_insights, which are
// strictly-shaped) all come back as plain objects whose values are either a string, an array of
// strings, or a nested { focus, engagement }-style object of strings. This one editor handles
// all three shapes without needing a per-section schema. Hoisted out of Strategy.tsx so
// PlatformCards can reuse SectionField for each per-platform card body.
export type SectionValue = Record<string, string | string[] | Record<string, string>>

export function cloneSection(value: unknown): SectionValue {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.parse(JSON.stringify(value))
  }
  // GPT's free-form output isn't schema-enforced — a section can land as a plain string (or, in
  // principle, a top-level array) instead of the usual {field: value} object. Without this
  // guard, Object.entries("some sentence") silently turns each CHARACTER into its own numbered
  // field ("0": "T", "1": "h", …) — a real bug hit live once the prompt started producing a
  // narrative campaign_planning string instead of its usual {theme, focus, …} shape.
  if (value === null || value === undefined) return {}
  return { summary: typeof value === 'string' ? value : JSON.stringify(value) }
}

export function humanize(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function SectionField({
  fieldKey, value, editable, onChange,
}: {
  fieldKey: string
  value: string | string[] | Record<string, string>
  editable: boolean
  onChange: (v: string | string[] | Record<string, string>) => void
}) {
  if (Array.isArray(value)) {
    return (
      <div className="mb-3">
        <div className="text-xs font-semibold text-secondary mb-1.5">{humanize(fieldKey)}</div>
        {editable ? (
          <div className="space-y-1.5">
            {value.map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  className="input !py-1.5 text-sm"
                  value={item}
                  onChange={(e) => onChange(value.map((v, vi) => (vi === i ? e.target.value : v)))}
                />
                <button type="button" onClick={() => onChange(value.filter((_, vi) => vi !== i))} className="text-muted hover:text-terracotta shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => onChange([...value, ''])} className="text-xs text-sage hover:underline">
              + Add item
            </button>
          </div>
        ) : (
          <ul className="list-disc ml-5 space-y-1">
            {value.map((item, i) => (
              <li key={i} className="text-sm text-secondary">{item}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (typeof value === 'object' && value !== null) {
    return (
      <div className="mb-3 panel p-3">
        <div className="text-xs font-semibold text-secondary mb-2 capitalize">{humanize(fieldKey)}</div>
        {Object.entries(value).map(([subKey, subVal]) => (
          <div key={subKey} className="mb-2 last:mb-0">
            <div className="text-muted text-[11px] uppercase tracking-wide mb-1">{humanize(subKey)}</div>
            {editable ? (
              <textarea
                className="input !py-1.5 text-sm"
                rows={2}
                value={subVal}
                onChange={(e) => onChange({ ...value, [subKey]: e.target.value })}
              />
            ) : (
              <div className="text-sm text-secondary">{subVal}</div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-secondary mb-1.5">{humanize(fieldKey)}</div>
      {editable ? (
        <textarea className="input !py-1.5 text-sm" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="text-sm text-secondary">{value}</div>
      )}
    </div>
  )
}

export function SectionEditor({
  label, sectionKey, value, onSave, onRegenerate,
}: {
  label: string
  sectionKey: StrategySection
  value: unknown
  onSave: (v: SectionValue) => Promise<void>
  onRegenerate: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<SectionValue>(() => cloneSection(value))
  const [saving, setSaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(cloneSection(value))
  }, [value, editing])

  function setField(key: string, v: string | string[] | Record<string, string>) {
    setDraft((d) => ({ ...d, [key]: v }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleRegenerate() {
    setRegenerating(true)
    try {
      await onRegenerate()
    } finally {
      setRegenerating(false)
    }
  }

  const displayValue = editing ? draft : cloneSection(value)

  return (
    <Panel key={sectionKey}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium">{label}</div>
        <div className="flex items-center gap-1.5">
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} className="btn-ghost !py-1 !px-2 text-xs" disabled={saving}>
                Cancel
              </button>
              <Button onClick={handleSave} loading={saving} className="!py-1 !px-2 text-xs">
                <Check size={12} /> Save
              </Button>
            </>
          ) : (
            <>
              <button onClick={handleRegenerate} className="btn-ghost !py-1 !px-2 text-xs" disabled={regenerating} title="Regenerate with AI">
                {regenerating ? <Spinner size={12} /> : <RefreshCw size={12} />}
              </button>
              <button onClick={() => setEditing(true)} className="btn-ghost !py-1 !px-2 text-xs" title="Edit manually">
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>
      </div>
      {Object.entries(displayValue).map(([key, v]) => (
        <SectionField key={key} fieldKey={key} value={v} editable={editing} onChange={(nv) => setField(key, nv)} />
      ))}
      {Object.keys(displayValue).length === 0 && <div className="text-muted text-sm">No data yet.</div>}
    </Panel>
  )
}
