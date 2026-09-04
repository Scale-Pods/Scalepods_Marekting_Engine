import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target, X, Calendar } from 'lucide-react'
import { Button, Modal } from '../ui'
import { useToast, toastMessage } from '../Toast'
import { listSignalsSince, sourceColor, type TrendSignal } from '../../lib/trends'
import { triggerStrategyGeneration, type GenerationScope } from '../../lib/strategy'

type PickerRange = '7d' | '30d' | 'all' | 'custom'
const PICKER_RANGE_OPTIONS: { value: PickerRange; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

// "2 hours ago" while it's fresh, a plain date once it's a day+ old — same idea as any feed's
// timestamp, just not worth pulling in a date library for one function.
function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMs / 3_600_000)
  if (diffMin < 1) return 'just now'
  if (diffHr < 1) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

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
 *  lets you check them off inline). Always creates a new `strategy_generations` row via
 *  `triggerStrategyGeneration` — the single source of truth for every strategy; it shows up in
 *  the Strategy page's list and can be approved from there like any other. */
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
  const [pickerRange, setPickerRange] = useState<PickerRange>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [scope, setScope] = useState<GenerationScope>('month')
  const [platform, setPlatform] = useState('')
  const [contentType, setContentType] = useState('')
  const [generating, setGenerating] = useState(false)

  // Same range-filter idea as Trends.tsx's own date filter, scoped to just this picker — "30 days"
  // was a fixed, unadjustable window before; a trend worth building a strategy around might be
  // older than that, or you might want to narrow to just this week.
  useEffect(() => {
    if (!allowPicker) return
    if (pickerRange === 'custom') {
      if (!customStart) {
        setPickerSignals([])
        return
      }
      const since = new Date(customStart).toISOString()
      const until = customEnd ? new Date(new Date(customEnd).getTime() + 86_399_000).toISOString() : undefined
      listSignalsSince(profileId, since, until).then(setPickerSignals).catch(() => setPickerSignals([]))
      return
    }
    const since = pickerRange === 'all' ? undefined : new Date(Date.now() - (pickerRange === '7d' ? 7 : 30) * 86_400_000).toISOString()
    listSignalsSince(profileId, since).then(setPickerSignals).catch(() => setPickerSignals([]))
  }, [allowPicker, profileId, pickerRange, customStart, customEnd])

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
    <Modal title="Generate Strategy" onClose={onClose} size="2xl" aspectVideo>
      <div className="space-y-3">
        <div>
          <div className="label mb-2">From these trends</div>
          {selected.size === 0 ? (
            <p className="text-muted text-xs">
              {allowPicker ? "No trends picked — this will be a general strategy, not anchored on any particular trend." : 'No trends selected.'}
            </p>
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
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="label !mb-0">Pick trends</div>
              <div className="flex items-center gap-1.5">
                <Calendar size={12} className="text-muted shrink-0" />
                {PICKER_RANGE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setPickerRange(o.value)}
                    className="px-2 py-1 rounded-full text-[10.5px] font-semibold transition-all"
                    style={{
                      background: pickerRange === o.value ? 'var(--accent-green)' : 'var(--fill-secondary)',
                      color: pickerRange === o.value ? 'var(--bg-primary)' : 'var(--text-primary)',
                      border: `1.5px solid ${pickerRange === o.value ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {pickerRange === 'custom' && (
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <label className="text-xs text-muted flex items-center gap-2">
                  From
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="input !py-1 !px-2 text-xs" />
                </label>
                <label className="text-xs text-muted flex items-center gap-2">
                  To
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="input !py-1 !px-2 text-xs" />
                </label>
                {!customStart && <span className="text-xs text-muted">Pick a start date to see trends</span>}
              </div>
            )}
            {pickerSignals.length === 0 ? (
              <p className="text-muted text-xs">
                {pickerRange === 'custom' && !customStart ? 'Pick a start date above.' : 'No trend signals in this range — try a wider range, or run a scan on the Trends page first.'}
              </p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
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
                      <span className="text-muted text-[10.5px] shrink-0">{formatRelative(sig.created_at)}</span>
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
          <Button onClick={onGenerate} loading={generating}>
            <Target size={15} /> Generate
          </Button>
        </div>
      </div>
    </Modal>
  )
}
