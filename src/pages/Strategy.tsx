import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Target, CheckCircle2, CalendarDays, ListChecks, LayoutGrid, Magnet, MousePointerClick, Sparkles,
  ArrowRight, ArrowLeft, Wand2,
} from 'lucide-react'
import {
  approveStrategy, updateStrategySection, regenerateStrategySection,
  listStrategyGenerations, getStrategyGeneration,
  type StrategyGeneration, type StrategySection, type CalendarItem,
} from '../lib/strategy'
import { PageHeader, Badge, Button, EmptyState, Spinner, Modal } from '../components/ui'
import { SectionEditor } from '../components/strategy/SectionEditor'
import { InsightHeaderStrip } from '../components/strategy/InsightHeaderStrip'
import { PillarBalanceChart } from '../components/strategy/PillarBalanceChart'
import { PlatformCards } from '../components/strategy/PlatformCards'
import { StrategyCalendarView } from '../components/strategy/StrategyCalendarView'
import { GenerateStrategyModal } from '../components/strategy/GenerateStrategyModal'
import { useProfile } from '../lib/queries'

const GEN_SCOPE_LABEL: Record<string, string> = { day: 'Day', week: 'Week', month: 'Month' }
const STATUS_TONE: Record<string, 'green' | 'blue' | 'orange' | 'grey'> = {
  approved: 'green', completed: 'blue', processing: 'grey', failed: 'orange',
}

// AI Studio only generates images for these three — video generation stays manual project-wide.
const STUDIO_SUPPORTED_PLATFORMS = new Set(['instagram', 'linkedin', 'facebook'])

// platform_strategy renders via PlatformCards below the header, not as one of these tabs.
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
  const location = useLocation()
  const navigate = useNavigate()

  // Every strategy ever generated for this profile — day/week/month scope, trend-anchored or
  // general, approved or not. `strategy_generations` is the single source of truth now (see the
  // note at the top of lib/strategy.ts for how the old single "active strategy" got here).
  const [generations, setGenerations] = useState<StrategyGeneration[]>([])
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeStrategy, setActiveStrategy] = useState<StrategyGeneration | null>(null)
  const [approving, setApproving] = useState(false)
  const [detailItem, setDetailItem] = useState<CalendarItem | null>(null)
  const [activeTab, setActiveTab] = useState<StrategySection | 'calendar'>('campaign_planning')
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [createPostModalOpen, setCreatePostModalOpen] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadList = useCallback(async (profileId: string) => {
    const list = await listStrategyGenerations(profileId)
    setGenerations(list)
    return list
  }, [])

  const loadActive = useCallback(async (id: string) => {
    const s = await getStrategyGeneration(id)
    setActiveStrategy(s)
    return s
  }, [])

  function openDetail(id: string) {
    setActiveId(id)
    setActiveTab('campaign_planning')
    setView('detail')
  }

  function backToList() {
    setView('list')
    setActiveId(null)
    setActiveStrategy(null)
  }

  // Poll for a genuinely NEW row (a different id than `beforeId`), not just any row — an old one
  // would otherwise pass instantly. The webhook returns before the placeholder row necessarily
  // exists, so a single load right after triggering can still race ahead of it.
  const waitForNewGeneration = useCallback((profileId: string, beforeId: string | null) => {
    let tries = 0
    const poll = setInterval(() => {
      tries += 1
      loadList(profileId).then((fresh) => {
        const found = fresh.find((g) => g.id !== beforeId)
        if (found && (found.status !== 'processing' || tries >= 20)) {
          clearInterval(poll)
          openDetail(found.id)
        } else if (tries >= 20) {
          clearInterval(poll)
        }
      })
    }, 3000)
  }, [loadList])

  useEffect(() => {
    if (!profile) return
    loadList(profile.id).then((list) => {
      // Arrived here right after firing a generation from Trends.tsx's "Generate Strategy" bar —
      // a real cross-page navigation, so this mount effect actually runs. (The same-page case —
      // this page's own "Generate Strategy" button — is handled directly by that button's
      // onGenerated below, since navigating to the page you're already on doesn't remount it.)
      if (location.state?.justTriggeredGeneration) {
        waitForNewGeneration(profile.id, list[0]?.id ?? null)
      }
    })
    // Only ever meant to fire once per landing on this page — re-running on every `profile`
    // identity change (react-query can hand back a new object each fetch) would replay
    // `justTriggeredGeneration` handling after it already navigated away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  useEffect(() => {
    if (!activeId) return
    loadActive(activeId)
  }, [activeId, loadActive])

  // Keep the open detail view live while its own generation is still running.
  useEffect(() => {
    const isProcessing = activeStrategy?.status === 'processing'
    if (isProcessing && activeId && !pollRef.current) {
      pollRef.current = setInterval(() => loadActive(activeId), 4000)
    } else if (!isProcessing && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [activeId, activeStrategy?.status, loadActive])

  async function onApprove() {
    if (!activeStrategy || !profile) return
    setApproving(true)
    await approveStrategy(activeStrategy.id, profile.id)
    await loadActive(activeStrategy.id)
    await loadList(profile.id)
    setApproving(false)
  }

  async function onSaveSection(section: StrategySection, value: unknown) {
    if (!activeStrategy) return
    await updateStrategySection(activeStrategy.id, section, value)
    await loadActive(activeStrategy.id)
  }

  async function onRegenerateSection(section: StrategySection) {
    if (!activeStrategy || !profile) return
    await regenerateStrategySection(activeStrategy.id, profile.id, section)
    // Section regenerate doesn't touch `status`, so poll this one column directly for a fresh
    // updated_at instead of relying on the status-based poller above.
    const before = activeStrategy.updated_at
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      const fresh = await loadActive(activeStrategy.id)
      if (fresh && fresh.updated_at !== before) break
    }
  }

  function onCreatePost(item: CalendarItem) {
    navigate('/studio', {
      state: {
        topic: item.hook ? `${item.title}: ${item.hook}` : item.title,
        platform: STUDIO_SUPPORTED_PLATFORMS.has(item.platform?.toLowerCase()) ? item.platform.toLowerCase() : undefined,
      },
    })
  }

  // Header-level entry point — the per-item "Create Post" (inside the calendar-item detail modal
  // below) was the only way in before this, and a first-time visitor had no reason to know
  // clicking into a specific calendar row got them there. A "Day"-scope strategy only ever has
  // one calendar item, so there's nothing to actually choose — skip the picker and go straight
  // to AI Studio with it; anything with more than one opens the picker.
  function onCreatePostClick() {
    const items = activeStrategy && Array.isArray(activeStrategy.content_calendar) ? activeStrategy.content_calendar : []
    if (items.length === 0) return
    if (items.length === 1) {
      onCreatePost(items[0])
      return
    }
    setCreatePostModalOpen(true)
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

  const isDetailActive = activeStrategy?.status === 'processing'
  const isApproved = activeStrategy?.status === 'approved'

  return (
    <div>
      <PageHeader
        accent={<Badge><Target size={12} /> Strategy</Badge>}
        title={`Marketing Strategy — ${profile.business_name}`}
        subtitle={
          view === 'list'
            ? 'Every strategy generated for this business — pick a scope and (optionally) some trends, generate, and approve whichever one should drive content generation.'
            : 'Generated from the BI report + trend signals + your real past post performance. Edit any section manually, regenerate it with AI, or approve it.'
        }
        actions={
          <div className="flex gap-2">
            {view === 'detail' && (
              <Button variant="ghost" onClick={backToList}>
                <ArrowLeft size={15} /> Back to list
              </Button>
            )}
            {view === 'detail' && activeStrategy && activeStrategy.status !== 'processing' && activeStrategy.status !== 'failed' && (
              <Button
                variant="ghost"
                onClick={onCreatePostClick}
                style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}
              >
                <Wand2 size={15} /> Create Post
              </Button>
            )}
            <Button variant="ghost" onClick={() => setGenerateModalOpen(true)}>
              <Target size={15} /> Generate Strategy <ArrowRight size={15} />
            </Button>
            {view === 'detail' && activeStrategy && activeStrategy.status !== 'processing' && !isApproved && (
              <Button onClick={onApprove} loading={approving}>
                <CheckCircle2 size={15} /> Approve
              </Button>
            )}
          </div>
        }
      />

      {view === 'list' ? (
        generations.length === 0 ? (
          <EmptyState icon={<Target size={28} />} title="No strategies yet" hint="Use Generate Strategy above to build your first plan." />
        ) : (
          <div className="space-y-2">
            {generations.map((g, i) => {
              const topics = g.source_signals_snapshot.map((s) => s.topic).join(', ')
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => openDetail(g.id)}
                  className="card w-full text-left p-4 flex items-center gap-4 transition-colors hover:bg-[var(--fill-secondary)]"
                >
                  <span className="text-muted text-sm font-semibold w-7 shrink-0 text-center">#{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <Badge tone="blue">{GEN_SCOPE_LABEL[g.scope] ?? g.scope}</Badge>
                      {g.platform && <Badge tone="green">{g.platform}</Badge>}
                      {g.content_type && <Badge tone="orange">{g.content_type.replace(/_/g, ' ')}</Badge>}
                      <Badge tone={STATUS_TONE[g.status] ?? 'grey'}>{g.status}</Badge>
                    </div>
                    <div className="text-sm font-medium truncate">{topics || 'General strategy'}</div>
                    {g.ai_summary && <div className="text-muted text-xs truncate mt-0.5">{g.ai_summary}</div>}
                  </div>
                  <span className="text-muted text-xs shrink-0">{new Date(g.created_at).toLocaleString()}</span>
                </button>
              )
            })}
          </div>
        )
      ) : !activeStrategy ? (
        <div className="flex justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : isDetailActive ? (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <Spinner size={22} />
          <div className="text-sm text-secondary">Building campaign plan, calendar, and platform strategy…</div>
        </div>
      ) : activeStrategy.status === 'failed' ? (
        <EmptyState title="Strategy generation failed" hint={activeStrategy.error_detail || 'This generation did not complete.'} />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge tone={STATUS_TONE[activeStrategy.status] ?? 'grey'}>{isApproved ? 'Approved' : 'Awaiting approval'}</Badge>
            <Badge tone="blue">{GEN_SCOPE_LABEL[activeStrategy.scope] ?? activeStrategy.scope}</Badge>
            {activeStrategy.platform && <Badge tone="green">{activeStrategy.platform}</Badge>}
            {activeStrategy.content_type && <Badge tone="orange">{activeStrategy.content_type.replace(/_/g, ' ')}</Badge>}
            {activeStrategy.source_signals_snapshot.map((s) => (
              <Badge key={s.id} tone="orange">
                <Sparkles size={11} /> {s.source} — {s.topic}
              </Badge>
            ))}
          </div>
          <div className="mb-5">
            {activeStrategy.ai_summary && <span className="text-secondary text-sm">{activeStrategy.ai_summary}</span>}
          </div>

          <InsightHeaderStrip insights={activeStrategy.header_insights} />
          <PillarBalanceChart balance={activeStrategy.pillar_balance} />
          <PlatformCards
            value={activeStrategy.platform_strategy}
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
              items={Array.isArray(activeStrategy.content_calendar) ? activeStrategy.content_calendar : []}
              onSelect={setDetailItem}
            />
          ) : (
            (() => {
              const c = COMPONENTS.find((comp) => comp.key === activeTab)!
              return (
                <SectionEditor
                  label={c.label}
                  sectionKey={c.key}
                  value={activeStrategy[c.key]}
                  onSave={(v) => onSaveSection(c.key, v)}
                  onRegenerate={() => onRegenerateSection(c.key)}
                />
              )
            })()
          )}
        </>
      )}

      {generateModalOpen && profile && (
        <GenerateStrategyModal
          profileId={profile.id}
          allowPicker
          onClose={() => setGenerateModalOpen(false)}
          onGenerated={() => {
            setGenerateModalOpen(false)
            waitForNewGeneration(profile.id, generations[0]?.id ?? null)
          }}
        />
      )}

      {createPostModalOpen && activeStrategy && (
        <Modal title="Create Post" onClose={() => setCreatePostModalOpen(false)}>
          <p className="text-muted text-xs mb-3">Pick which planned post to build in AI Studio.</p>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {(Array.isArray(activeStrategy.content_calendar) ? activeStrategy.content_calendar : []).map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setCreatePostModalOpen(false)
                  onCreatePost(item)
                }}
                className="w-full text-left p-3 rounded-lg flex items-center gap-3 transition-colors hover:bg-[var(--fill-secondary)]"
                style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
              >
                <Badge tone={PLATFORM_TONE[item.platform?.toLowerCase()] ?? 'blue'}>{item.platform}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{item.title}</div>
                  {item.hook && <div className="text-muted text-xs truncate">{item.hook}</div>}
                </div>
                {item.scheduled_date && <span className="text-muted text-xs shrink-0">{item.scheduled_date}</span>}
                <Wand2 size={14} className="text-muted shrink-0" />
              </button>
            ))}
          </div>
        </Modal>
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
            <div className="flex justify-end pt-1">
              <Button onClick={() => onCreatePost(detailItem)}>
                <Wand2 size={15} /> Create Post
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
