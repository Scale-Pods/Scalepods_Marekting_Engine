import { useCallback, useEffect, useRef, useState } from 'react'
import { Target, RefreshCw, CheckCircle2, CalendarDays } from 'lucide-react'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import { getLatestStrategy, triggerStrategy, approveStrategy, type MarketingStrategy } from '../lib/strategy'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel } from '../components/ui'
import JsonBlock from '../components/JsonBlock'

const COMPONENTS: { key: keyof MarketingStrategy; label: string }[] = [
  { key: 'campaign_planning', label: 'Campaign Planning' },
  { key: 'weekly_content_strategy', label: 'Weekly Content Strategy' },
  { key: 'content_pillars', label: 'Content Pillars' },
  { key: 'platform_strategy', label: 'Platform Strategy' },
  { key: 'lead_generation_strategy', label: 'Lead-Gen Strategy' },
  { key: 'cta_strategy', label: 'CTA Strategy' },
]

const PLATFORM_TONE: Record<string, 'green' | 'blue' | 'orange'> = {
  linkedin: 'blue', instagram: 'green', facebook: 'blue', youtube: 'orange',
}

export default function Strategy() {
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [strategy, setStrategy] = useState<MarketingStrategy | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [approving, setApproving] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (profileId: string) => {
    const s = await getLatestStrategy(profileId)
    setStrategy(s)
    return s
  }, [])

  useEffect(() => {
    listProfiles().then(async (profiles) => {
      const p = profiles[0] ?? null
      setProfile(p)
      if (p) await load(p.id)
    })
  }, [load])

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
        subtitle="7 components generated from the BI report + trend signals. Approve before content generation can begin."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onRegenerate} loading={refreshing || isActive}>
              <RefreshCw size={15} /> Regenerate
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
        <EmptyState icon={<Target size={28} />} title="No strategy yet" hint="Click Regenerate to generate the first strategy from the BI report + trends." />
      ) : isActive ? (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <Spinner size={22} />
          <div className="text-sm text-secondary">Building campaign plan, calendar, and platform strategy…</div>
        </div>
      ) : strategy.status === 'failed' ? (
        <EmptyState title="Strategy generation failed" hint="Click Regenerate to try again." />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-6">
            <Badge tone={isApproved ? 'green' : 'blue'}>{isApproved ? 'Approved' : 'Awaiting approval'}</Badge>
            {strategy.ai_summary && <span className="text-secondary text-sm">{strategy.ai_summary}</span>}
          </div>

          <Panel className="mb-4">
            <div className="flex items-center gap-2 mb-4 font-medium">
              <CalendarDays size={16} className="text-sage" /> Content Calendar
            </div>
            {Array.isArray(strategy.content_calendar) && strategy.content_calendar.length > 0 ? (
              <div className="space-y-2">
                {strategy.content_calendar.map((item, i) => (
                  <div key={i} className="card p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{item.title}</div>
                      {item.hook && <div className="text-muted text-xs mt-0.5">{item.hook}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.scheduled_date && <span className="text-muted text-xs">{item.scheduled_date}</span>}
                      <Badge tone={PLATFORM_TONE[item.platform?.toLowerCase()] ?? 'blue'}>{item.platform}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted text-sm">No calendar items.</div>
            )}
          </Panel>

          <div className="grid sm:grid-cols-2 gap-4">
            {COMPONENTS.map((c) => (
              <Panel key={c.key}>
                <div className="font-medium mb-3">{c.label}</div>
                <JsonBlock value={strategy[c.key]} />
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
