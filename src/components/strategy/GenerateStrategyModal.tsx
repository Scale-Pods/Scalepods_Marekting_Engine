import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target, X } from 'lucide-react'
import { Button, Modal } from '../ui'
import { useToast, toastMessage } from '../Toast'
import { listSignalsSince, sourceColor, type TrendSignal } from '../../lib/trends'
import { triggerStrategyGeneration, type GenerationScope } from '../../lib/strategy'

// Scope/platform/content type are all optional narrowing — the n8n workflow treats an unset
// platform/content_type as "any", and 'month' is the default scope (the same calendar length
// the old "Regenerate all" always produced).
const SCOPE_OPTIONS: { value: GenerationScope; label: string; hint: string }[] = [
  { value: 'month', label: 'Month', hint: 'Full calendar, 12-16 posts across 4 weeks' },
  { value: 'week', label: 'Week', hint: '3-7 posts across the next 7 days' },
  { value: 'day', label: 'Day', hint: 'Just one post' },
]
const GEN_PLATFORMS = [
  { value: '', label: 'Any' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'youtube', label: 'YouTube' },
]
const GEN_CONTENT_TYPES = [
  { value: '', label: 'Any' },
  { value: 'static_image', label: 'Static image' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'social_caption', label: 'Caption' },
  { value: 'linkedin_article', label: 'LinkedIn article' },
  { value: 'story', label: 'Story' },
  { value: 'ugc_video', label: 'Video' },
]

/** Shared by Trends.tsx (trends already picked from its grid — pass `initialSelected`) and the
 *  Strategy page (no grid there — pass `allowPicker` so this modal fetches recent signals and
 *  lets you check them off inline). Always writes a standalone `strategy_generations` row via
 *  `triggerStrategyGeneration` — never the active `marketing_strategies` row, regardless of
 *  where it was opened from. */
export function GenerateStrategyModal({
  profileId, initialSelected, allowPicker, onClose, onGenerated,
}: {
  profileId: string
  initialSelected?: Map<string, { source: string; topic: string }>
  allowPicker?: boolean
  onClose: () => void
  onGenerated: () => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const [selected, setSelected] = useState<Map<string, { source: string; topic: string }>>(initialSelected ?? new Map())
  const [pickerSignals, setPickerSignals] = useState<TrendSignal[]>([])
  const [scope, setScope] = useState<GenerationScope>('month')
  const [platform, setPlatform] = useState('')
  const [contentType, setContentType] = useState('')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (!allowPicker) return
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    listSignalsSince(profileId, since).then(setPickerSignals).catch(() => setPickerSignals([]))
  }, [allowPicker, profileId])

  function onRemove(id: string) {
    setSelected((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  function onToggle(sig: TrendSignal) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(sig.id)) next.delete(sig.id)
      else next.set(sig.id, { source: sig.source, topic: sig.topic })
      return next
    })
  }

  async function onGenerate() {
    if (selected.size === 0) return
    setGenerating(true)
    try {
      await triggerStrategyGeneration(profileId, Array.from(selected.keys()), scope, platform, contentType)
      toast.info('Generating — this shows up under Recent in a moment.')
      onGenerated()
      navigate('/strategy', { state: { justTriggeredGeneration: true } })
    } catch (err) {
      toast.error(toastMessage(err, 'Could not start generation'))
      setGenerating(false)
    }
  }

  return (
    <Modal title="Generate Strategy" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="label mb-2">From these trends</div>
          {selected.size === 0 ? (
            <p className="text-muted text-xs">{allowPicker ? 'Pick one or more trends below.' : 'No trends selected.'}</p>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              {Array.from(selected.entries()).map(([id, s]) => (
                <span key={id} className="flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full" style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}>
                  {s.topic.slice(0, 40)}
                  <button type="button" onClick={() => onRemove(id)} className="text-muted hover:text-terracotta" aria-label={`Remove ${s.topic}`}>
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {allowPicker && (
          <div>
            <div className="label mb-2">Pick trends</div>
            {pickerSignals.length === 0 ? (
              <p className="text-muted text-xs">No trend signals in the last 30 days — run a scan on the Trends page first.</p>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {pickerSignals.map((sig) => {
                  const checked = selected.has(sig.id)
                  return (
                    <label
                      key={sig.id}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-sm"
                      style={{ background: checked ? 'var(--fill-secondary)' : 'var(--fill-tertiary)', border: `1px solid ${checked ? 'var(--accent-green)' : 'var(--border-subtle)'}` }}
                    >
                      <input type="checkbox" checked={checked} onChange={() => onToggle(sig)} />
                      <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full text-white shrink-0" style={{ background: sourceColor(sig.source) }}>
                        {sig.source}
                      </span>
                      <span className="flex-1 truncate">{sig.topic}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="label mb-2">Scope</div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {SCOPE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setScope(o.value)}
                className="text-left px-3 py-2 rounded-lg transition-all"
                style={{ border: `1.5px solid ${scope === o.value ? 'var(--accent-green)' : 'var(--border-subtle)'}`, background: scope === o.value ? 'var(--fill-secondary)' : 'var(--fill-tertiary)' }}
              >
                <div className="text-xs font-semibold">{o.label}</div>
                <div className="text-muted text-[10.5px] leading-snug mt-0.5">{o.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="label mb-2">Platform</div>
          <div className="flex gap-2 flex-wrap">
            {GEN_PLATFORMS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setPlatform(o.value)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{ background: platform === o.value ? 'var(--accent-blue)' : 'var(--fill-secondary)', color: platform === o.value ? '#fff' : 'var(--text-primary)', border: `1.5px solid ${platform === o.value ? 'var(--accent-blue)' : 'var(--border-subtle)'}` }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="label mb-2">Content type</div>
          <div className="flex gap-2 flex-wrap">
            {GEN_CONTENT_TYPES.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setContentType(o.value)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{ background: contentType === o.value ? 'var(--accent-orange)' : 'var(--fill-secondary)', color: contentType === o.value ? '#fff' : 'var(--text-primary)', border: `1.5px solid ${contentType === o.value ? 'var(--accent-orange)' : 'var(--border-subtle)'}` }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <p className="text-muted text-[10.5px]">
          This is always a separate, standalone generation — it never replaces the current strategy on the Strategy page.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={generating}>Cancel</Button>
          <Button onClick={onGenerate} loading={generating} disabled={selected.size === 0}>
            <Target size={15} /> Generate
          </Button>
        </div>
      </div>
    </Modal>
  )
}
