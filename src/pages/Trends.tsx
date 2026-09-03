import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, PlayCircle, ExternalLink, Calendar, ChevronDown, ChevronUp, Clock, Sparkles, Wand2 } from 'lucide-react'
import {
  listRuns, listSignals, listSignalsSince, triggerTrends, SCAN_PLATFORMS,
  type TrendRun, type TrendSignal, type ScanPlatform,
} from '../lib/trends'
import { triggerStrategy } from '../lib/strategy'
import { PageHeader, Badge, Button, EmptyState, Spinner, Modal } from '../components/ui'
import { useProfile } from '../lib/queries'
import { useToast, toastMessage } from '../components/Toast'

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
  'Google Search': 'var(--accent-blue)',
  'SEO Keywords': 'var(--accent-green)',
  'Competitor campaigns': 'var(--accent-blue)',
}

function sourceColor(source: string) {
  return SOURCE_COLOR[source] ?? 'var(--fill-tertiary)'
}

function relevanceColor(score: number) {
  return score >= 70 ? 'var(--accent-green)' : score >= 40 ? 'var(--accent-orange)' : 'var(--text-muted)'
}

function SignalCard({ sig, businessName, showDate, profileId }: { sig: TrendSignal; businessName: string; showDate?: boolean; profileId: string }) {
  const rel = sig.relevance_score ?? 0
  const relColor = relevanceColor(rel)
  // Numeric signals (search-volume/growth %, live trending leaderboards) never carry a URL —
  // there's no article or post to link to, only a number. Falls back to a search link for any
  // urlless signal.
  const isKeywordPhrase = !sig.url
  const href = sig.url || (isKeywordPhrase ? `https://www.google.com/search?q=${encodeURIComponent(sig.topic)}` : null)

  const navigate = useNavigate()
  const toast = useToast()
  const [generating, setGenerating] = useState(false)

  async function onGenerateStrategy() {
    setGenerating(true)
    try {
      // Anchors a fresh marketing strategy around THIS trend specifically (plus the business's
      // own real past post performance — see the n8n workflow), rather than the broad
      // all-trends synthesis "Regenerate all" on the Strategy page produces.
      await triggerStrategy(profileId, sig.id)
      navigate('/strategy', { state: { justTriggered: true } })
    } catch (err) {
      toast.error(toastMessage(err, 'Failed to start strategy generation'))
      setGenerating(false)
    }
  }

  return (
    <div className="card p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span
          className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white"
          style={{ background: sourceColor(sig.source) }}
        >
          {sig.source}
        </span>
        {/* Only shown when multiple days are mixed in one view (a date-range filter or a History
            entry) — in the single-scan view every card shares the same date, shown once above. */}
        {showDate && (
          <span className="text-[11px] text-muted">{new Date(sig.created_at).toLocaleDateString()}</span>
        )}
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

      <div className="mt-auto space-y-1.5">
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
        <button
          type="button"
          onClick={onGenerateStrategy}
          disabled={generating}
          className="btn-ghost w-full !py-2 text-xs justify-center"
          style={{ borderColor: 'var(--accent-green)', color: 'var(--accent-green)' }}
          title="Generate a marketing strategy anchored on this trend + your real past post performance"
        >
          {generating ? <Spinner size={12} /> : <Sparkles size={12} />} General Strategy
        </button>
        <button
          type="button"
          onClick={() => navigate('/studio', { state: { signalId: sig.id, topic: sig.topic } })}
          className="btn-ghost w-full !py-2 text-xs justify-center"
          style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}
          title="Build a post from this trend in the AI Studio — pick a look, review the prompt, choose from several options"
        >
          <Wand2 size={12} /> Create Post
        </button>
      </div>
    </div>
  )
}

/** A signal grid with its own platform-filter chips — used both for the main view and for a
 *  History entry expanded inline, so both look and behave identically rather than one being a
 *  cut-down version of the other. */
function SignalGrid({ signals, businessName, showDate, profileId }: { signals: TrendSignal[]; businessName: string; showDate: boolean; profileId: string }) {
  const [filter, setFilter] = useState<string | null>(null)
  const sources = useMemo(() => Array.from(new Set(signals.map((s) => s.source))).sort(), [signals])
  const visible = filter ? signals.filter((s) => s.source === filter) : signals

  return (
    <>
      {sources.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <button
            onClick={() => setFilter(null)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
            style={{
              background: !filter ? 'var(--accent-blue)' : 'var(--fill-secondary)',
              color: !filter ? '#fff' : 'var(--text-primary)',
              border: `1.5px solid ${!filter ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
            }}
          >
            All <span className="opacity-80">({signals.length})</span>
          </button>
          {sources.map((s) => {
            const active = filter === s
            const color = sourceColor(s)
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
                style={{
                  background: active ? color : 'var(--fill-secondary)',
                  color: active ? '#fff' : 'var(--text-primary)',
                  border: `1.5px solid ${active ? color : 'var(--border-subtle)'}`,
                }}
              >
                {s} <span className="opacity-80">({signals.filter((x) => x.source === s).length})</span>
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
            <SignalCard key={s.id} sig={s} businessName={businessName} showDate={showDate} profileId={profileId} />
          ))}
        </div>
      )}
    </>
  )
}

/** One History row — collapsed shows real counts computed from its own signals (not the
 *  n8n-written sources_completed column, which this pipeline never populated and always read as
 *  "0 sources"); expanded reveals the exact same grid used everywhere else on this page. */
function HistoryRow({ run, signals, businessName, profileId }: { run: TrendRun; signals: TrendSignal[]; businessName: string; profileId: string }) {
  const [open, setOpen] = useState(false)
  const sourceCount = new Set(signals.map((s) => s.source)).size

  return (
    <div className="card !p-0 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-3 flex items-center justify-between w-full text-left hover:bg-[var(--fill-secondary)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm text-secondary">{new Date(run.created_at).toLocaleString()}</span>
          {run.status === 'failed' && <Badge tone="orange">Failed</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="grey">{signals.length} signal{signals.length === 1 ? '' : 's'} · {sourceCount} source{sourceCount === 1 ? '' : 's'}</Badge>
          {open ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
        </div>
      </button>
      {open && (
        <div className="p-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          {run.ai_summary && <div className="text-xs text-secondary mb-4">{run.ai_summary}</div>}
          {signals.length === 0 ? (
            <EmptyState icon={<TrendingUp size={24} />} title="No signals from this run" />
          ) : (
            <SignalGrid signals={signals} businessName={businessName} showDate={false} profileId={profileId} />
          )}
        </div>
      )}
    </div>
  )
}

type DateRange = 'latest' | '7d' | '30d' | 'all' | 'custom'

export default function Trends() {
  const { data: profile } = useProfile()
  // Every scan (manual or the daily automated one) writes a brand-new trend_runs row rather than
  // overwriting the last one — runs holds the full history (newest first).
  const [runs, setRuns] = useState<TrendRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [signals, setSignals] = useState<TrendSignal[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Manual-scan config modal: which sources to run, and how many results to pull from each
  // (Google Trends has no count knob — it's a fixed live leaderboard + one growth reading per
  // keyword, not a paged list). Defaults to every source, 8 results each, matching what the
  // scan always did before this was configurable.
  const [scanModalOpen, setScanModalOpen] = useState(false)
  const [scanPlatforms, setScanPlatforms] = useState<Set<ScanPlatform>>(new Set(SCAN_PLATFORMS))
  const [scanCounts, setScanCounts] = useState<Record<ScanPlatform, number>>(
    () => Object.fromEntries(SCAN_PLATFORMS.map((p) => [p, 8])) as Record<ScanPlatform, number>,
  )

  // Date-range filter: 'latest' is the single-scan view unchanged; the others pool signals
  // across every run in that window, meaningful now that scans run daily via the scheduler.
  const [dateRange, setDateRange] = useState<DateRange>('latest')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [aggregateSignals, setAggregateSignals] = useState<TrendSignal[]>([])
  const [aggregateLoading, setAggregateLoading] = useState(false)

  // All-time signals, fetched once and grouped client-side by run — powers the History
  // accordion's real per-run counts and its inline grids, independent of the top date filter
  // (History is a complete browsable archive, not itself filtered by the current range).
  const [allSignals, setAllSignals] = useState<TrendSignal[]>([])

  const loadRuns = useCallback(async (profileId: string) => {
    const list = await listRuns(profileId)
    setRuns(list)
    return list
  }, [])

  useEffect(() => {
    if (profile) {
      loadRuns(profile.id)
      listSignalsSince(profile.id).then(setAllSignals)
    }
  }, [profile, loadRuns])

  // Jump to the newest run whenever it changes (a fresh run just landed) — but leave the
  // selection alone otherwise, so browsing History isn't yanked out from under you by a poll.
  const newestId = runs[0]?.id ?? null
  useEffect(() => {
    if (newestId) setSelectedRunId((cur) => cur ?? newestId)
  }, [newestId])

  useEffect(() => {
    if (!selectedRunId) {
      setSignals([])
      return
    }
    listSignals(selectedRunId).then(setSignals)
  }, [selectedRunId])

  // Fetches once per dateRange/custom-range change. 'latest' needs no fetch — `signals` already
  // has what it needs.
  useEffect(() => {
    if (dateRange === 'latest' || !profile) return
    if (dateRange === 'custom') {
      if (!customStart) return
      const since = new Date(customStart).toISOString()
      const until = customEnd ? new Date(new Date(customEnd).getTime() + 86_399_000).toISOString() : undefined
      setAggregateLoading(true)
      listSignalsSince(profile.id, since, until).then(setAggregateSignals).finally(() => setAggregateLoading(false))
      return
    }
    const since = dateRange === 'all' ? undefined
      : new Date(Date.now() - (dateRange === '7d' ? 7 : 30) * 86400_000).toISOString()
    setAggregateLoading(true)
    listSignalsSince(profile.id, since).then(setAggregateSignals).finally(() => setAggregateLoading(false))
  }, [dateRange, customStart, customEnd, profile])

  const run = runs.find((r) => r.id === selectedRunId) ?? null

  // Poll while a scan is active (manual click, or the daily scheduler firing unattended) — also
  // refreshes allSignals so History picks up a just-finished run without a manual reload.
  useEffect(() => {
    if (!profile) return
    const isActive = runs[0]?.status === 'processing'
    if (isActive && !pollRef.current) {
      pollRef.current = setInterval(() => {
        loadRuns(profile.id)
        listSignalsSince(profile.id).then(setAllSignals)
      }, 4000)
    } else if (!isActive && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [profile, runs, loadRuns])

  async function onManualScan() {
    if (!profile || scanPlatforms.size === 0) return
    setScanModalOpen(false)
    setRefreshing(true)
    const before = runs[0]?.id ?? null
    await triggerTrends(profile.id, { platforms: Array.from(scanPlatforms), counts: scanCounts })
    // triggerTrends only fires the webhook — it responds immediately, but the actual scan runs
    // async in n8n and never writes an interim "processing" row (it inserts once, at the end).
    // Poll for a genuinely NEW run rather than any run, since an old completed one would
    // otherwise pass instantly.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const fresh = await loadRuns(profile.id)
      if (fresh[0] && fresh[0].id !== before) {
        setSelectedRunId(fresh[0].id)
        listSignalsSince(profile.id).then(setAllSignals)
        break
      }
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

  // Hoisted out of nested closures below so TS keeps the `profile` non-null narrowing from the
  // early-return guards above.
  const businessName = profile.business_name || 'this business'
  const isRangeView = dateRange !== 'latest'
  const activeSignals = isRangeView ? aggregateSignals : signals
  const isActive = run?.status === 'processing'
  // Every OTHER run, newest first, each with its own real signals sliced out of the one all-time
  // fetch above — no per-row query needed.
  const history = runs
    .filter((r) => r.id !== selectedRunId)
    .map((r) => ({ run: r, signals: allSignals.filter((s) => s.run_id === r.id) }))

  const RANGE_OPTIONS: { key: DateRange; label: string }[] = [
    { key: 'latest', label: 'Latest scan' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: 'all', label: 'All time' },
    { key: 'custom', label: 'Custom range' },
  ]

  return (
    <div>
      <PageHeader
        accent={<Badge tone="blue"><TrendingUp size={12} /> Trends</Badge>}
        title={`Trend Intelligence — ${profile.business_name}`}
        subtitle="Ranked by relevance, sourced from real Reddit, Instagram, YouTube, Google Search, and Google Trends data. Scans automatically every 24 hours, or run one now."
        actions={
          <Button variant="ghost" onClick={() => setScanModalOpen(true)} loading={refreshing || isActive}>
            <PlayCircle size={15} /> Run manual scan
          </Button>
        }
      />

      {scanModalOpen && (
        <Modal title="Run manual scan" onClose={() => setScanModalOpen(false)}>
          <div className="text-secondary text-sm mb-4">
            Choose which sources to scan and how many results to pull from each before AI ranks them for relevance.
          </div>
          <div className="space-y-2">
            {SCAN_PLATFORMS.map((p) => {
              const checked = scanPlatforms.has(p)
              return (
                <div key={p} className="panel p-3 flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2.5 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setScanPlatforms((s) => {
                        const next = new Set(s)
                        if (e.target.checked) next.add(p); else next.delete(p)
                        return next
                      })}
                    />
                    <span
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white"
                      style={{ background: sourceColor(p), opacity: checked ? 1 : 0.5 }}
                    >
                      {p}
                    </span>
                  </label>
                  {p !== 'Google Trends' ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted">Results</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        className="input !py-1 text-sm text-center"
                        style={{ width: 60 }}
                        value={scanCounts[p]}
                        disabled={!checked}
                        onChange={(e) => {
                          const n = Math.max(1, Math.min(20, Number(e.target.value) || 1))
                          setScanCounts((c) => ({ ...c, [p]: n }))
                        }}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-muted shrink-0">Live leaderboard + growth — no count</span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={() => setScanModalOpen(false)}>Cancel</Button>
            <Button onClick={onManualScan} loading={refreshing} disabled={scanPlatforms.size === 0}>
              <PlayCircle size={15} /> Start scan
            </Button>
          </div>
        </Modal>
      )}

      {/* One filter area: date range (with a custom start/end option) — daily auto-scans mean
          there's real history to pool signals from, not just one run at a time. */}
      <div className="card p-4 mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar size={14} className="text-muted shrink-0" />
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setDateRange(opt.key)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={{
                background: dateRange === opt.key ? 'var(--accent-green)' : 'var(--fill-secondary)',
                color: dateRange === opt.key ? 'var(--bg-primary)' : 'var(--text-primary)',
                border: `1.5px solid ${dateRange === opt.key ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
              }}
            >
              {opt.label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted">
            <Clock size={12} /> Auto-scans every 24h
          </span>
        </div>
        {dateRange === 'custom' && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t flex-wrap" style={{ borderColor: 'var(--border-subtle)' }}>
            <label className="text-xs text-muted flex items-center gap-2">
              From
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input !py-1 !px-2 text-xs"
              />
            </label>
            <label className="text-xs text-muted flex items-center gap-2">
              To
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input !py-1 !px-2 text-xs"
              />
            </label>
            {!customStart && <span className="text-xs text-muted">Pick a start date to see signals</span>}
          </div>
        )}
      </div>

      {isRangeView ? (
        aggregateLoading ? (
          <div className="card p-8 flex flex-col items-center gap-3 text-center">
            <Spinner size={22} />
            <div className="text-sm text-secondary">Loading signals from this period…</div>
          </div>
        ) : activeSignals.length === 0 ? (
          <EmptyState icon={<TrendingUp size={28} />} title="No signals in this period" hint="Signals accumulate as scans run — check back later, or widen the range." />
        ) : (
          <SignalGrid signals={activeSignals} businessName={businessName} showDate profileId={profile.id} />
        )
      ) : !run ? (
        <EmptyState icon={<TrendingUp size={28} />} title="No trend scan yet" hint="Click Run manual scan to run the first one." />
      ) : isActive ? (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <Spinner size={22} />
          <div className="text-sm text-secondary">Scanning sources and ranking signals…</div>
        </div>
      ) : (
        <>
          {signals.length === 0 ? (
            <EmptyState icon={<TrendingUp size={28} />} title="No signals from this scan" />
          ) : (
            <SignalGrid signals={signals} businessName={businessName} showDate={false} profileId={profile.id} />
          )}

          {history.length > 0 && (
            <>
              <div className="text-sm font-medium text-secondary mb-3 mt-8">History</div>
              <div className="space-y-2">
                {history.map(({ run: r, signals: sigs }) => (
                  <HistoryRow key={r.id} run={r} signals={sigs} businessName={businessName} profileId={profile.id} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
