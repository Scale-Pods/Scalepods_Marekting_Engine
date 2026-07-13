import { useCallback, useEffect, useRef, useState } from 'react'
import { TrendingUp, RefreshCw, ExternalLink } from 'lucide-react'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import { getLatestRun, listSignals, triggerTrends, type TrendRun, type TrendSignal } from '../lib/trends'
import { PageHeader, Badge, Button, EmptyState, Spinner } from '../components/ui'

export default function Trends() {
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [run, setRun] = useState<TrendRun | null>(null)
  const [signals, setSignals] = useState<TrendSignal[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (profileId: string) => {
    const r = await getLatestRun(profileId)
    setRun(r)
    setSignals(r ? await listSignals(r.id) : [])
    return r
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
    const isActive = run?.status === 'processing'
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
  }, [profile, run?.status, load])

  async function onRefresh() {
    if (!profile) return
    setRefreshing(true)
    await triggerTrends(profile.id)
    await load(profile.id)
    setRefreshing(false)
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
        <PageHeader accent={<Badge tone="blue"><TrendingUp size={12} /> Trends</Badge>} title="Trend Intelligence" />
        <EmptyState icon={<TrendingUp size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  const sources = Array.from(new Set(signals.map((s) => s.source))).sort()
  const visible = sourceFilter ? signals.filter((s) => s.source === sourceFilter) : signals
  const isActive = run?.status === 'processing'

  return (
    <div>
      <PageHeader
        accent={<Badge tone="blue"><TrendingUp size={12} /> Trends</Badge>}
        title={`Trend Intelligence — ${profile.business_name}`}
        subtitle="8 sources ranked for ScalePods relevance: Google Trends, Google News, Reddit, Instagram, YouTube, LinkedIn, SEO keywords, Competitor campaigns."
        actions={
          <Button variant="ghost" onClick={onRefresh} loading={refreshing || isActive}>
            <RefreshCw size={15} /> Refresh trends
          </Button>
        }
      />

      {!run ? (
        <EmptyState icon={<TrendingUp size={28} />} title="No trend scan yet" hint="Click Refresh trends to run the first scan." />
      ) : isActive ? (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <Spinner size={22} />
          <div className="text-sm text-secondary">Scanning 8 sources and ranking signals…</div>
        </div>
      ) : (
        <>
          {run.ai_summary && (
            <div className="card p-5 mb-6">
              <div className="text-xs font-medium text-sage uppercase tracking-wide mb-1">Summary</div>
              <div className="text-secondary text-sm">{run.ai_summary}</div>
            </div>
          )}

          {sources.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-5">
              <button onClick={() => setSourceFilter(null)} className={!sourceFilter ? 'badge badge-blue' : 'badge badge-blue opacity-40'}>
                All ({signals.length})
              </button>
              {sources.map((s) => (
                <button
                  key={s}
                  onClick={() => setSourceFilter(s)}
                  className={sourceFilter === s ? 'badge badge-blue' : 'badge badge-blue opacity-40'}
                >
                  {s} ({signals.filter((x) => x.source === s).length})
                </button>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {visible.map((s) => (
              <div key={s.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge tone="blue">{s.source}</Badge>
                      <span className="text-muted text-xs">Relevance {s.relevance_score}</span>
                    </div>
                    <div className="font-medium">{s.topic}</div>
                    {s.relevance_reason && <div className="text-secondary text-sm mt-1">{s.relevance_reason}</div>}
                  </div>
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-muted hover:text-sage shrink-0">
                      <ExternalLink size={16} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
