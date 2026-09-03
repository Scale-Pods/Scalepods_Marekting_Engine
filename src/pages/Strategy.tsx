import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Target, CheckCircle2, CalendarDays, ListChecks, LayoutGrid, Magnet, MousePointerClick, Sparkles,
  TrendingUp, ArrowRight,
} from 'lucide-react'
import {
  getLatestStrategy, approveStrategy, updateStrategySection, regenerateStrategySection,
  getSourceSignal, listStrategyGenerations, type MarketingStrategy, type StrategySection, type CalendarItem,
  type StrategyGeneration,
} from '../lib/strategy'
import { PageHeader, Badge, Button, EmptyState, Spinner, Modal, Panel } from '../components/ui'
import { SectionEditor } from '../components/strategy/SectionEditor'
import { InsightHeaderStrip } from '../components/strategy/InsightHeaderStrip'
import { PillarBalanceChart } from '../components/strategy/PillarBalanceChart'
import { PlatformCards } from '../components/strategy/PlatformCards'
import { StrategyCalendarView } from '../components/strategy/StrategyCalendarView'
import { StrategyGenerationModal } from '../components/strategy/StrategyGenerationModal'
import { GenerateStrategyModal } from '../components/strategy/GenerateStrategyModal'
import { useProfile } from '../lib/queries'

const GEN_SCOPE_LABEL: Record<string, string> = { day: 'Day', week: 'Week', month: 'Month' }

// platform_strategy now renders via PlatformCards below the tabs, not as one of these tabs.
const COMPONENTS: { key: StrategySection; label: string; icon: typeof Target; color: string }[] = [
  { key: 'campaign_planning', label: 'Campaign Planning', icon: Target, color: 'var(--accent-green)' },
  { key: 'weekly_content_strategy', label: 'Weekly Content', icon: ListChecks, color: 'var(--accent-blue)' },
  { key: 'content_pillars', label: 'Content Pillars', icon: LayoutGrid, color: 'var(--accent-orange)' },
  { key: 'lead_generation_strategy', label: 'Lead-Gen', icon: Magnet, color: 'var(--accent-green)' },
  { key: 'cta_strategy', label: 'CTA Strategy', icon: MousePointerClick, color: 'var(--accent-orange)' },
]
const CALENDAR_TAB = { key: 'calendar' as const, label: 'Content Calendar', icon: CalendarDays, color: 'var(--accent-green)' }

const PLATFORM_TONE: Record<string, 'green' | 'blue' | 'orange'> = {
  linkedin: 'blue', instagram: 'green', facebook: 'blue', youtube: 'orange',
}

export default function Strategy() {
  const { data: profile } = useProfile()
  const [strategy, setStrategy] = useState<MarketingStrategy | null>(null)
  const [approving, setApproving] = useState(false)
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [detailItem, setDetailItem] = useState<CalendarItem | null>(null)
  const [activeTab, setActiveTab] = useState<StrategySection | 'calendar'>('campaign_planning')
  const [sourceSignal, setSourceSignal] = useState<{ id: string; source: string; topic: string } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Scoped, trend-anchored generations from the Trends page — always separate from `strategy`
  // above, never overwrite it. Loaded alongside the main strategy; "Recent" below renders them.
  const [generations, setGenerations] = useState<StrategyGeneration[]>([])
  const [openGeneration, setOpenGeneration] = useState<StrategyGeneration | null>(null)
  const genPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadGenerations = useCallback(async (profileId: string) => {
    const list = await listStrategyGenerations(profileId)
    setGenerations(list)
    return list
  }, [])

  // "Generated from" credit when this strategy came from a trend card's "General Strategy"
  // button rather than the broad "Regenerate all". The signal may since have been pruned by a
  // later scan, in which case this just stays null and the credit line doesn't render.
  useEffect(() => {
    if (!strategy?.source_signal_id) {
      setSourceSignal(null)
      return
    }
    let cancelled = false
    getSourceSignal(strategy.source_signal_id).then((s) => {
      if (!cancelled) setSourceSignal(s)
    })
    return () => {
      cancelled = true
    }
  }, [strategy?.source_signal_id])

  const location = useLocation()

  const load = useCallback(async (profileId: string) => {
    const s = await getLatestStrategy(profileId)
    setStrategy(s)
    return s
  }, [])

  useEffect(() => {
    if (!profile) return
    load(profile.id)
    loadGenerations(profile.id).then((list) => {
      // Same race, but for a scoped generation fired from Trends.tsx's "Generate Strategy" bar:
      // the webhook returns before the placeholder row necessarily exists, so poll for a
      // genuinely new row rather than trusting the first load.
      if (location.state?.justTriggeredGeneration) {
        const beforeId = list[0]?.id ?? null
        let tries = 0
        const poll = setInterval(() => {
          tries += 1
          loadGenerations(profile.id).then((fresh) => {
            const found = fresh.find((g) => g.id !== beforeId)
            if (found && (found.status !== 'processing' || tries >= 20)) {
              clearInterval(poll)
              setOpenGeneration(found)
            } else if (tries >= 20) {
              clearInterval(poll)
            }
          })
        }, 3000)
      }
    })
    // Only ever meant to fire once per landing on this page — re-running on every `profile`
    // identity change (react-query can hand back a new object each fetch) would replay
    // `justTriggeredGeneration` handling after it already navigated away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Keep the Recent grid's status badges live while any generation is still processing —
  // separate from the auto-open poll above, which only cares about the just-triggered one.
  useEffect(() => {
    if (!profile) return
    const anyProcessing = generations.some((g) => g.status === 'processing')
    if (anyProcessing && !genPollRef.current) {
      genPollRef.current = setInterval(() => loadGenerations(profile.id), 4000)
    } else if (!anyProcessing && genPollRef.current) {
      clearInterval(genPollRef.current)
      genPollRef.current = null
    }
    return () => {
      if (genPollRef.current) clearInterval(genPollRef.current)
      genPollRef.current = null
    }
  }, [profile, generations, loadGenerations])

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

  async function onApprove() {
    if (!strategy) return
    setApproving(true)
    await approveStrategy(strategy.id)
    await load(strategy.profile_id)
    setApproving(false)
  }

  async function onSaveSection(section: StrategySection, value: unknown) {
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
        subtitle="Generated from the BI report + trend signals + your real past post performance. Edit any section manually, regenerate it with AI, or approve before content generation can begin."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setGenerateModalOpen(true)}>
              <Target size={15} /> Generate Strategy <ArrowRight size={15} />
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
        <EmptyState icon={<Target size={28} />} title="No active strategy" hint="This page shows the plan you're actively working from. Use Generate Strategy above to build a scoped plan anchored on your trends — it lands under Recent below." />
      ) : isActive ? (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <Spinner size={22} />
          <div className="text-sm text-secondary">Building campaign plan, calendar, and platform strategy…</div>
        </div>
      ) : strategy.status === 'failed' ? (
        <EmptyState title="Strategy generation failed" hint="This was the active strategy's last generation attempt — it did not complete." />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge tone={isApproved ? 'green' : 'blue'}>{isApproved ? 'Approved' : 'Awaiting approval'}</Badge>
            {sourceSignal && (
              <Badge tone="orange">
                <Sparkles size={11} /> Generated from: {sourceSignal.source} — {sourceSignal.topic}
              </Badge>
            )}
          </div>
          <div className="mb-5">
            {strategy.ai_summary && <span className="text-secondary text-sm">{strategy.ai_summary}</span>}
          </div>

          <InsightHeaderStrip insights={strategy.header_insights} />
          <PillarBalanceChart balance={strategy.pillar_balance} />
          <PlatformCards
            value={strategy.platform_strategy}
            onSave={(v) => onSaveSection('platform_strategy', v)}
            onRegenerate={() => onRegenerateSection('platform_strategy')}
          />

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
            <StrategyCalendarView
              items={Array.isArray(strategy.content_calendar) ? strategy.content_calendar : []}
              onSelect={setDetailItem}
            />
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

      {/* Scoped, trend-anchored generations from the Trends page — always separate from the
          strategy above, per the user's explicit choice: this list is a browsable archive, not
          a way to change what's currently active. */}
      {generations.length > 0 && (
        <Panel className="mt-6">
          <div className="label mb-3">Recent</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {generations.slice(0, 12).map((g) => {
              const topics = g.source_signals_snapshot.map((s) => s.topic).join(', ')
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setOpenGeneration(g)}
                  className="text-left rounded-lg p-3"
                  style={{ border: '1px solid var(--border-subtle)', background: 'var(--fill-tertiary)' }}
                >
                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    <Badge tone="blue">{GEN_SCOPE_LABEL[g.scope] ?? g.scope}</Badge>
                    {g.platform && <Badge tone="green">{g.platform}</Badge>}
                    {g.content_type && <Badge tone="orange">{g.content_type.replace(/_/g, ' ')}</Badge>}
                    <Badge tone={g.status === 'completed' ? 'green' : g.status === 'failed' ? 'orange' : 'grey'}>{g.status}</Badge>
                  </div>
                  <div className="text-xs font-medium leading-snug mb-1.5 line-clamp-2">
                    {topics || 'Generated strategy'}
                  </div>
                  <div className="text-muted text-[10.5px] flex items-center gap-1">
                    <TrendingUp size={10} /> {new Date(g.created_at).toLocaleString()}
                  </div>
                </button>
              )
            })}
          </div>
        </Panel>
      )}

      {openGeneration && (
        <StrategyGenerationModal generation={openGeneration} onClose={() => setOpenGeneration(null)} />
      )}

      {generateModalOpen && profile && (
        <GenerateStrategyModal
          profileId={profile.id}
          allowPicker
          onClose={() => setGenerateModalOpen(false)}
          onGenerated={() => setGenerateModalOpen(false)}
        />
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
