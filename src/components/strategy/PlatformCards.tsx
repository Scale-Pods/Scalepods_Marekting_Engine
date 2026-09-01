import { useEffect, useState } from 'react'
import { RefreshCw, Pencil, Check } from 'lucide-react'
import { Panel, Button, Spinner } from '../ui'
import { PlatformBadge } from '../mediaUi'
import { ACTIVE_PLATFORMS } from '../../lib/content'
import { SectionField } from './SectionEditor'

type FieldValue = string | string[] | Record<string, string>
type PlatformsValue = Record<string, Record<string, FieldValue>>

function clonePlatforms(value: unknown): PlatformsValue {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.parse(JSON.stringify(value))
  }
  return {}
}

// Replaces the old generic "Platform Strategy" tab (one big Object.entries dump) with a card
// per platform, matching how every other per-platform surface in this app (Publishing,
// Calendar, Analytics) already presents things. Still edits/regenerates as one JSON column —
// per-card independent regenerate is out of scope for this pass.
export function PlatformCards({
  value, onSave, onRegenerate,
}: {
  value: unknown
  onSave: (v: Record<string, unknown>) => Promise<void>
  onRegenerate: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PlatformsValue>(() => clonePlatforms(value))
  const [saving, setSaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(clonePlatforms(value))
  }, [value, editing])

  function setField(platform: string, key: string, v: FieldValue) {
    setDraft((d) => ({ ...d, [platform]: { ...d[platform], [key]: v } }))
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

  const displayValue = editing ? draft : clonePlatforms(value)
  const platforms = ACTIVE_PLATFORMS.filter((p) => displayValue[p])

  return (
    <Panel className="mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium">Platform Strategy</div>
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
      {platforms.length === 0 ? (
        <div className="text-muted text-sm">No data yet.</div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {platforms.map((p) => (
            <div key={p} className="panel p-3">
              <div className="mb-2">
                <PlatformBadge platform={p} />
              </div>
              {Object.entries(displayValue[p] || {}).map(([subKey, subVal]) => (
                <SectionField
                  key={subKey}
                  fieldKey={subKey}
                  value={subVal}
                  editable={editing}
                  onChange={(nv) => setField(p, subKey, nv)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
