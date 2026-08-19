import { useCallback, useEffect, useRef, useState } from 'react'
import { TrendingUp, RefreshCw, ExternalLink } from 'lucide-react'
import { getLatestRun, listSignals, triggerTrends, type TrendRun, type TrendSignal } from '../lib/trends'
import { PageHeader, Badge, Button, EmptyState, Spinner } from '../components/ui'
import { useProfile } from '../lib/queries'

// Real-world brand colors for the platform sources; ScalePods' own accent tokens for the two
// non-platform categories (SEO Keywords, Competitor campaigns) — no invented colors either way.
const SOURCE_COLOR: Record<string, string> = {
  'Google Trends': '#4285F4',
  'Google News': '#EA4335',
  Reddit: '#FF4500',
  Instagram: '#E1306C',
  YouTube: '#FF0000',
  LinkedIn: '#0A66C2',
  Facebook: '#1877F2',
  'SEO Keywords': 'var(--accent-green)',
  'Competitor campaigns': 'var(--accent-blue)',
}

function sourceColor(source: string) {
  return SOURCE_COLOR[source] ?? 'var(--fill-tertiary)'
}

function relevanceColor(score: number) {
  return score >= 70 ? 'var(--accent-green)' : score >= 40 ? 'var(--accent-orange)' : 'var(--text-muted)'
}

function SignalCard({ sig, businessName }: { sig: TrendSignal; businessName: string }) {
  const rel = sig.relevance_score ?? 0
  const relColor = relevanceColor(rel)
  const isKeywordPhrase = sig.source === 'SEO Keywords' && !sig.url
  const href = sig.url || (isKeywordPhrase ? `https://www.google.com/search?q=${encodeURIComponent(sig.topic)}` : null)

  return (
    <div className="card p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white"
          style={{ background: sourceColor(sig.source) }}
        >
          {sig.source}
        </span>
        <span
          className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
          style={{ color: relColor, border: `1px solid ${relColor}` }}
          title={`AI relevance score (0-100) — how relevant this trend is to ${businessName}`}
        >
          <TrendingUp size={11} /> {rel} relevance
        </span>
      </div>

      <div className="font-semibold text-[15px] leading-snug mb-2">{sig.topic}</div>

      {sig.relevance_reason && (
        <div className="text-xs text-muted italic panel !p-2.5 mb-3 leading-relaxed">
          &ldquo;{sig.relevance_reason}&rdquo;
        </div>
      )}

      <div className="mt-auto">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost w-full !py-2 text-xs justify-center"
          >
            {isKeywordPhrase ? 'Search this keyword' : 'View source'} <ExternalLink size={12} />
          </a>
        ) : (
          <div className="text-muted text-xs text-center py-2">No source link for this signal</div>
        )}
      </div>
    </div>
  )
}

export default function Trends() {
  const { data: profile } = useProfile()
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
    if (profile) load(profile.id)
  }, [profile, load])

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
    const before = run?.id ?? null
    await triggerTrends(profile.id)
    // triggerTrends only fires the webhook — it responds immediately, but the actual 8-source
    // scan + AI ranking happens async in n8n afterward and never writes an interim "processing"
    // row (it inserts once, at the end). Checking once right after triggering almost always ran
    // before that row existed, so the button did fire it correctly but the page just kept
    // showing "No trend scan yet" until you happened to reload. Poll for a genuinely NEW run
    // (not just any run — an old completed one would otherwise pass instantly) instead.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const fresh = await load(profile.id)
      if (fresh && fresh.id !== before) break
    }
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
        subtitle={`8 sources ranked for ${profile.business_name} relevance: Google Trends, Google News, Reddit, Instagram, YouTube, LinkedIn, SEO keywords, Competitor campaigns.`}
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
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium text-sage uppercase tracking-wide">Summary</div>
                <div className="text-muted text-xs">Generated {new Date(run.created_at).toLocaleString()}</div>
              </div>
              <div className="text-secondary text-sm">{run.ai_summary}</div>
            </div>
          )}

          {sources.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-5">
              <button
                onClick={() => setSourceFilter(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: !sourceFilter ? 'var(--accent-blue)' : 'var(--fill-secondary)',
                  color: !sourceFilter ? '#fff' : 'var(--text-primary)',
                  border: `1.5px solid ${!sourceFilter ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                }}
              >
                All
                <span
                  className="text-[10px] px-1.5 rounded-full"
                  style={{ background: !sourceFilter ? 'rgba(255,255,255,0.25)' : 'var(--fill-tertiary)' }}
                >
                  {signals.length}
                </span>
              </button>
              {sources.map((s) => {
                const active = sourceFilter === s
                const color = sourceColor(s)
                return (
                  <button
                    key={s}
                    onClick={() => setSourceFilter(s)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                    style={{
                      background: active ? color : 'var(--fill-secondary)',
                      color: active ? '#fff' : 'var(--text-primary)',
                      border: `1.5px solid ${active ? color : 'var(--border-subtle)'}`,
                    }}
                  >
                    {s}
                    <span
                      className="text-[10px] px-1.5 rounded-full"
                      style={{ background: active ? 'rgba(255,255,255,0.25)' : 'var(--fill-tertiary)' }}
                    >
                      {signals.filter((x) => x.source === s).length}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState icon={<TrendingUp size={28} />} title="No signals for this source" />
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {visible.map((s) => (
                <SignalCard key={s.id} sig={s} businessName={profile.business_name || 'this business'} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
