import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Target, RefreshCw, CheckCircle2, CalendarDays, Pencil, Check, X,
  ListChecks, LayoutGrid, Share2, Magnet, MousePointerClick,
} from 'lucide-react'
import {
  getLatestStrategy, triggerStrategy, approveStrategy, updateStrategySection, regenerateStrategySection,
  type MarketingStrategy, type StrategySection, type CalendarItem,
} from '../lib/strategy'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel, Modal } from '../components/ui'
import { useProfile } from '../lib/queries'

const COMPONENTS: { key: StrategySection; label: string; icon: typeof Target; color: string }[] = [
  { key: 'campaign_planning', label: 'Campaign Planning', icon: Target, color: 'var(--accent-green)' },
  { key: 'weekly_content_strategy', label: 'Weekly Content', icon: ListChecks, color: 'var(--accent-blue)' },
  { key: 'content_pillars', label: 'Content Pillars', icon: LayoutGrid, color: 'var(--accent-orange)' },
  { key: 'platform_strategy', label: 'Platform Strategy', icon: Share2, color: 'var(--accent-blue)' },
  { key: 'lead_generation_strategy', label: 'Lead-Gen', icon: Magnet, color: 'var(--accent-green)' },
  { key: 'cta_strategy', label: 'CTA Strategy', icon: MousePointerClick, color: 'var(--accent-orange)' },
]
const CALENDAR_TAB = { key: 'calendar' as const, label: 'Content Calendar', icon: CalendarDays, color: 'var(--accent-green)' }

const PLATFORM_TONE: Record<string, 'green' | 'blue' | 'orange'> = {
  linkedin: 'blue', instagram: 'green', facebook: 'blue', youtube: 'orange',
}

// The 6 non-calendar sections all come back as plain objects whose values are either a
// string, an array of strings, or a nested { focus, engagement }-style object of strings.
// This one editor handles all three shapes without needing a per-section schema.
type SectionValue = Record<string, string | string[] | Record<string, string>>

function cloneSection(value: unknown): SectionValue {
  return JSON.parse(JSON.stringify(value ?? {}))
}

function humanize(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function SectionField({
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

function SectionEditor({
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

export default function Strategy() {
  const { data: profile } = useProfile()
  const [strategy, setStrategy] = useState<MarketingStrategy | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [approving, setApproving] = useState(false)
  const [detailItem, setDetailItem] = useState<CalendarItem | null>(null)
  const [activeTab, setActiveTab] = useState<StrategySection | 'calendar'>('campaign_planning')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (profileId: string) => {
    const s = await getLatestStrategy(profileId)
    setStrategy(s)
    return s
  }, [])

  useEffect(() => {
    if (profile) load(profile.id)
  }, [profile, load])

  useEffect(() => {
    if (!profile) return
    const isActive = strategy?.status === 'processing'
    if (isActive && !pollRef.current) {
      pollRef.current = setInterval(() => load(profile.id), 4000)
    } else if (!isActive && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [profile, strategy?.status, load])

  async function onRegenerate() {
    if (!profile) return
    setRefreshing(true)
    await triggerStrategy(profile.id)
    await load(profile.id)
    setRefreshing(false)
  }

  async function onApprove() {
    if (!strategy) return
    setApproving(true)
    await approveStrategy(strategy.id)
    await load(strategy.profile_id)
    setApproving(false)
  }

  async function onSaveSection(section: StrategySection, value: SectionValue) {
    if (!strategy) return
    await updateStrategySection(strategy.id, section, value)
    await load(strategy.profile_id)
  }

  async function onRegenerateSection(section: StrategySection) {
    if (!strategy || !profile) return
    await regenerateStrategySection(strategy.id, profile.id, section)
    // Section regenerate doesn't touch `status`, so poll this one column directly for a
    // fresh updated_at instead of relying on the status-based poller above.
    const before = strategy.updated_at
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      const fresh = await load(profile.id)
      if (fresh && fresh.updated_at !== before) break
    }
  }

  if (profile === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    )
  }

  if (!profile) {
    return (
      <div>
        <PageHeader accent={<Badge><Target size={12} /> Strategy</Badge>} title="Marketing Strategy" />
        <EmptyState icon={<Target size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  const isActive = strategy?.status === 'processing'
  const isApproved = strategy?.status === 'approved'

  return (
    <div>
      <PageHeader
        accent={<Badge><Target size={12} /> Strategy</Badge>}
        title={`Marketing Strategy — ${profile.business_name}`}
        subtitle="7 components generated from the BI report + trend signals. Edit any section manually, regenerate it with AI, or approve before content generation can begin."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onRegenerate} loading={refreshing || isActive}>
              <RefreshCw size={15} /> Regenerate all
            </Button>
            {strategy && strategy.status === 'completed' && (
              <Button onClick={onApprove} loading={approving}>
                <CheckCircle2 size={15} /> Approve
              </Button>
            )}
          </div>
        }
      />

      {!strategy ? (
        <EmptyState icon={<Target size={28} />} title="No strategy yet" hint="Click Regenerate all to generate the first strategy from the BI report + trends." />
      ) : isActive ? (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <Spinner size={22} />
          <div className="text-sm text-secondary">Building campaign plan, calendar, and platform strategy…</div>
        </div>
      ) : strategy.status === 'failed' ? (
        <EmptyState title="Strategy generation failed" hint="Click Regenerate all to try again." />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-6">
            <Badge tone={isApproved ? 'green' : 'blue'}>{isApproved ? 'Approved' : 'Awaiting approval'}</Badge>
            {strategy.ai_summary && <span className="text-secondary text-sm">{strategy.ai_summary}</span>}
          </div>

          <div className="flex gap-2 flex-wrap mb-5">
            {[...COMPONENTS, CALENDAR_TAB].map((tab) => {
              const active = activeTab === tab.key
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                  style={{
                    background: active ? tab.color : 'var(--fill-secondary)',
                    color: active ? '#fff' : 'var(--text-primary)',
                    border: `1.5px solid ${active ? tab.color : 'var(--border-subtle)'}`,
                  }}
                >
                  <Icon size={13} /> {tab.label}
                </button>
              )
            })}
          </div>

          {activeTab === 'calendar' ? (
            <Panel>
              <div className="flex items-center gap-2 mb-4 font-medium">
                <CalendarDays size={16} className="text-sage" /> Content Calendar
              </div>
              {Array.isArray(strategy.content_calendar) && strategy.content_calendar.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {['Date', 'Platform', 'Topic', 'Hook'].map((h) => (
                          <th key={h} className="text-left text-xs font-semibold text-muted uppercase tracking-wide py-2 px-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {strategy.content_calendar.map((item, i) => (
                        <tr
                          key={i}
                          onClick={() => setDetailItem(item)}
                          className="cursor-pointer hover:bg-[var(--fill-tertiary)] transition-colors"
                          style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        >
                          <td className="py-2.5 px-2 text-muted text-xs whitespace-nowrap">{item.scheduled_date || '—'}</td>
                          <td className="py-2.5 px-2">
                            <Badge tone={PLATFORM_TONE[item.platform?.toLowerCase()] ?? 'blue'}>{item.platform}</Badge>
                          </td>
                          <td className="py-2.5 px-2 font-medium">{item.title}</td>
                          <td className="py-2.5 px-2 text-secondary text-xs truncate max-w-xs">{item.hook || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-muted text-sm">No calendar items.</div>
              )}
            </Panel>
          ) : (
            (() => {
              const c = COMPONENTS.find((comp) => comp.key === activeTab)!
              return (
                <SectionEditor
                  label={c.label}
                  sectionKey={c.key}
                  value={strategy[c.key]}
                  onSave={(v) => onSaveSection(c.key, v)}
                  onRegenerate={() => onRegenerateSection(c.key)}
                />
              )
            })()
          )}
        </>
      )}

      {detailItem && (
        <Modal title={detailItem.title} onClose={() => setDetailItem(null)}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={PLATFORM_TONE[detailItem.platform?.toLowerCase()] ?? 'blue'}>{detailItem.platform}</Badge>
              <Badge tone="orange">{detailItem.content_type?.replace(/_/g, ' ')}</Badge>
              {detailItem.scheduled_date && <span className="text-muted text-xs">{detailItem.scheduled_date}</span>}
            </div>
            {detailItem.pillar && (
              <div>
                <div className="label mb-1">Pillar</div>
                <div className="text-sm text-secondary">{detailItem.pillar}</div>
              </div>
            )}
            {detailItem.hook && (
              <div>
                <div className="label mb-1">Hook</div>
                <div className="text-sm text-secondary">{detailItem.hook}</div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
