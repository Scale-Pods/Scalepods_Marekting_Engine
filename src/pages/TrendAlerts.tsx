import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BellRing, Plus, ArrowLeft, Play, Pause, Pencil, Trash2, ExternalLink, Zap, Radio, Wallet, Clock,
  AlertTriangle, Send, ChevronDown, ChevronUp, TrendingUp,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { PageHeader, Badge, Button, EmptyState, Spinner, Modal, Panel } from '../components/ui'
import { useToast, toastMessage } from '../components/Toast'
import { useAuth } from '../lib/auth'
import { useProfile } from '../lib/queries'
import { useTeam } from '../lib/team'
import { relativeTime } from '../lib/time'
import {
  SOURCE_OPTIONS, SOURCE_LABEL, FREQUENCY_OPTIONS, DEFAULT_FREQUENCY, REGION_OPTIONS, ALL_REGIONS,
  LOOKBACK_OPTIONS, DEFAULT_LOOKBACK_DAYS, STRICTNESS_OPTIONS,
  IMPORTANCE_OPTIONS, DELIVERY_OPTIONS,
  frequencyLabel, estimateCheckCost, estimateMonthlyCost, formatUsd, splitList,
  listWatches, createWatch, updateWatch, deleteWatch, runWatchNow,
  listEvents, listStats, listRuns, listRules, createRule, updateRule, deleteRule, testRule,
  monthSpendByWatch, recentEventCounts,
  type TrendAlertWatch, type TrendAlertEvent, type TrendAlertRule, type WatchSource, type WatchInput,
  type Importance, type Sentiment, type Delivery, type Channel, type RuleInput,
} from '../lib/trendAlerts'

const KEY = ['trendAlerts'] as const

// ─── small shared bits ───────────────────────────────────────────────────────

function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all disabled:opacity-40"
      style={active
        ? { background: 'rgba(177,217,151,0.14)', border: '1px solid var(--accent-green)', color: 'var(--text-primary)' }
        : { background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
    >
      {children}
    </button>
  )
}

const IMPORTANCE_TONE: Record<Importance, 'orange' | 'green' | 'blue' | 'grey'> = {
  critical: 'orange', high: 'green', medium: 'blue', low: 'grey',
}
const SENTIMENT_TONE: Record<Sentiment, 'orange' | 'green' | 'blue' | 'grey'> = {
  positive: 'green', negative: 'orange', mixed: 'blue', neutral: 'grey',
}

function untilTime(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (mins <= 0) return 'due now'
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  return `in ${Math.round(hrs / 24)}d`
}

function statusInfo(w: TrendAlertWatch): { label: string; tone: 'green' | 'blue' | 'orange' | 'grey' } {
  if (w.last_run_status === 'queued' || w.last_run_status === 'running') return { label: 'Checking now', tone: 'blue' }
  if (w.status === 'paused') return { label: 'Paused', tone: 'grey' }
  if (w.last_run_status === 'budget_reached') return { label: 'Monthly budget reached', tone: 'orange' }
  if (w.last_run_status === 'failed') return { label: 'Last check failed', tone: 'orange' }
  return { label: 'Active', tone: 'green' }
}

function isChecking(w?: TrendAlertWatch | null) {
  return !!w && (w.last_run_status === 'queued' || w.last_run_status === 'running')
}

function Tile({ icon, label, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-muted text-xs mb-1.5">{icon}{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-muted text-xs mt-0.5">{hint}</div>}
    </div>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function TrendAlerts() {
  const { id } = useParams()
  return id ? <WatchDetail id={id} /> : <WatchList />
}

function useWatches(poll = false) {
  return useQuery({
    queryKey: [...KEY, 'watches'],
    queryFn: listWatches,
    refetchInterval: (q) => (poll || (q.state.data ?? []).some(isChecking) ? 4000 : false),
  })
}

function WatchList() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const watches = useWatches()
  const spend = useQuery({ queryKey: [...KEY, 'spend'], queryFn: monthSpendByWatch })
  const counts = useQuery({ queryKey: [...KEY, 'counts'], queryFn: recentEventCounts })
  const [creating, setCreating] = useState(false)
  const canEdit = can('trend_alerts', 'edit')

  return (
    <div>
      <PageHeader
        accent={<Badge><BellRing size={12} /> Trend Alerts</Badge>}
        title="Trend Alerts"
        subtitle="Watch any topic, brand or product across news, Reddit, the web and YouTube. AI keeps only what genuinely matters, groups duplicate coverage, spots unusual spikes, and alerts you the way you choose."
        actions={canEdit && (
          <Button onClick={() => setCreating(true)}><Plus size={15} /> New watch item</Button>
        )}
      />

      {watches.isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !watches.data?.length ? (
        <EmptyState
          icon={<BellRing size={28} />}
          title="No watch items yet"
          hint="Create a watch item for a topic you care about, for example a competitor, an AI model, or your own brand. Checks run every hour by default."
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {watches.data.map((w) => {
            const s = statusInfo(w)
            const spent = spend.data?.[w.id] ?? 0
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => navigate(`/trend-alerts/${w.id}`)}
                className="card p-5 text-left hover:opacity-95 transition-opacity"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="font-semibold text-base">{w.name}</div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </div>
                <p className="text-muted text-sm mb-3 line-clamp-2">{w.description}</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {w.sources.map((src) => <Badge key={src} tone="grey">{SOURCE_LABEL[src] ?? src}</Badge>)}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-secondary">
                  <div className="flex items-center gap-1.5"><Clock size={12} /> {frequencyLabel(w.frequency_minutes)}</div>
                  <div className="flex items-center gap-1.5"><Zap size={12} /> {counts.data?.[w.id] ?? 0} relevant in 24h</div>
                  <div>Last check: {w.last_run_at ? relativeTime(w.last_run_at) : 'not yet'}</div>
                  <div>Next: {w.status === 'paused' ? 'paused' : untilTime(w.next_run_at)}</div>
                  <div className="col-span-2 flex items-center gap-1.5">
                    <Wallet size={12} /> ${spent.toFixed(2)} this month
                    {w.monthly_budget_usd != null && <span className="text-muted">of ${Number(w.monthly_budget_usd).toFixed(2)} budget</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {creating && (
        <WatchFormModal
          onClose={() => setCreating(false)}
          onSaved={(w) => { setCreating(false); navigate(`/trend-alerts/${w.id}`) }}
        />
      )}
    </div>
  )
}

// ─── create / edit watch ─────────────────────────────────────────────────────

function WatchFormModal({ initial, onClose, onSaved }: { initial?: TrendAlertWatch; onClose: () => void; onSaved: (w: TrendAlertWatch) => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: profile } = useProfile()
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join(', '))
  const [exclude, setExclude] = useState((initial?.exclude_keywords ?? []).join(', '))
  const [sources, setSources] = useState<WatchSource[]>(initial?.sources ?? ['google_news', 'reddit', 'web'])
  const [rssUrls, setRssUrls] = useState((initial?.rss_urls ?? []).join('\n'))
  const presetRegions = new Set([...REGION_OPTIONS.map((r) => r.value), ALL_REGIONS])
  const initialRegion = initial?.region ?? 'US'
  const [regionChoice, setRegionChoice] = useState(presetRegions.has(initialRegion) ? initialRegion : '__custom__')
  const [customRegion, setCustomRegion] = useState(presetRegions.has(initialRegion) ? '' : initialRegion)
  const region = regionChoice === '__custom__' ? customRegion.trim().toUpperCase() : regionChoice
  const [resultsPerSource, setResultsPerSource] = useState(initial?.results_per_source ?? 10)
  const [lookbackChoice, setLookbackChoice] = useState<number | '__custom__'>(
    LOOKBACK_OPTIONS.some((o) => o.value === (initial?.lookback_days ?? DEFAULT_LOOKBACK_DAYS))
      ? (initial?.lookback_days ?? DEFAULT_LOOKBACK_DAYS)
      : '__custom__'
  )
  const [customLookback, setCustomLookback] = useState(String(initial?.lookback_days ?? DEFAULT_LOOKBACK_DAYS))
  const lookbackDays = lookbackChoice === '__custom__' ? Math.max(1, Math.min(365, Number(customLookback) || DEFAULT_LOOKBACK_DAYS)) : lookbackChoice
  const [frequency, setFrequency] = useState(initial?.frequency_minutes ?? DEFAULT_FREQUENCY)
  const [threshold, setThreshold] = useState(initial ? Number(initial.relevance_threshold) : 0.6)
  const [budget, setBudget] = useState(initial ? (initial.monthly_budget_usd == null ? '' : String(initial.monthly_budget_usd)) : '25')
  const [saving, setSaving] = useState(false)

  const kwList = splitList(keywords)
  const rssList = splitList(rssUrls)
  const perCheck = estimateCheckCost(sources, resultsPerSource)
  const perMonth = estimateMonthlyCost(sources, resultsPerSource, frequency)
  const budgetNum = budget.trim() === '' ? null : Number(budget)
  const budgetInvalid = budgetNum !== null && (!Number.isFinite(budgetNum) || budgetNum < 0)
  const rssInvalid = sources.includes('rss') && (rssList.length === 0 || rssList.some((u) => !/^https?:\/\//i.test(u)))
  const regionInvalid = regionChoice === '__custom__' && !/^[A-Za-z]{2,4}$/.test(customRegion.trim())
  const canSave = name.trim() && description.trim().length >= 15 && kwList.length > 0 && sources.length > 0 && !rssInvalid && !budgetInvalid && !regionInvalid

  function toggleSource(s: WatchSource) {
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function onSave() {
    setSaving(true)
    const input: WatchInput = {
      name: name.trim(),
      description: description.trim(),
      keywords: kwList.slice(0, 6),
      exclude_keywords: splitList(exclude).slice(0, 10),
      sources,
      rss_urls: sources.includes('rss') ? rssList.slice(0, 10) : [],
      region,
      results_per_source: resultsPerSource,
      frequency_minutes: frequency,
      lookback_days: lookbackDays,
      relevance_threshold: threshold,
      monthly_budget_usd: budgetNum,
    }
    try {
      if (initial) {
        await updateWatch(initial.id, input)
        await qc.invalidateQueries({ queryKey: KEY })
        toast.success('Watch item updated')
        onSaved({ ...initial, ...input })
      } else {
        const w = await createWatch(input, profile?.id ?? null)
        await qc.invalidateQueries({ queryKey: KEY })
        toast.success('Watch item created. The first check runs within 5 minutes.')
        onSaved(w)
      }
    } catch (err) {
      toast.error(toastMessage(err, 'Could not save this watch item'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={initial ? 'Edit watch item' : 'New watch item'} onClose={onClose} size="2xl" aspectVideo>
      <div className="grid lg:grid-cols-3 gap-x-7 gap-y-4">
        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input className="input mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="OpenAI image models" maxLength={80} />
          </div>
          <div>
            <label className="label">What counts, and what doesn't</label>
            <textarea
              className="input mt-1.5"
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Real developments in OpenAI's image generation: launches, quality improvements or problems, pricing changes, and how people rate the output. Not general company news like funding, offices or hiring."
            />
            <p className="text-muted text-xs mt-1">This is what the AI judges relevance against, so be specific. Keywords only decide what gets collected.</p>
          </div>
          <div>
            <label className="label">Keywords to search for</label>
            <input className="input mt-1.5" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="gpt-image, ChatGPT images, OpenAI image generation" />
            <p className="text-muted text-xs mt-1">Comma separated, up to 6. Searched as "any of these".</p>
          </div>
          <div>
            <label className="label">Exclude words (optional)</label>
            <input className="input mt-1.5" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="stock, lawsuit" />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Sources</label>
            <div className="space-y-1 mt-1.5">
              {SOURCE_OPTIONS.map((s) => (
                <label key={s.value} className="flex items-start gap-2 cursor-pointer text-sm">
                  <input type="checkbox" className="mt-1" checked={sources.includes(s.value)} onChange={() => toggleSource(s.value)} />
                  <span>
                    <span className="font-medium">{s.label}</span>
                    <span className="text-muted text-xs block">{s.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {sources.includes('rss') && (
              <div className="mt-2">
                <textarea className="input" rows={2} value={rssUrls} onChange={(e) => setRssUrls(e.target.value)} placeholder={'https://openai.com/news/rss.xml\nhttps://example.com/feed'} />
                <p className="text-muted text-xs mt-1">One feed URL per line, up to 10. Only items mentioning a keyword are kept.</p>
              </div>
            )}
          </div>

          <div>
            <label className="label">How strict should relevance be?</label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {STRICTNESS_OPTIONS.map((o) => (
                <Chip key={o.value} active={Math.abs(threshold - o.value) < 0.01} onClick={() => setThreshold(o.value)}>
                  {o.label}
                </Chip>
              ))}
            </div>
            <p className="text-muted text-xs mt-1">{STRICTNESS_OPTIONS.find((o) => Math.abs(threshold - o.value) < 0.01)?.hint ?? ''}</p>
          </div>

          <div>
            <label className="label">Monthly budget (USD)</label>
            <input className="input mt-1.5" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No limit" inputMode="decimal" />
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">How often to check</label>
                <select className="input mt-1.5" value={frequency} onChange={(e) => setFrequency(Number(e.target.value))}>
                  {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">How far back to search</label>
                <select
                  className="input mt-1.5"
                  value={lookbackChoice}
                  onChange={(e) => setLookbackChoice(e.target.value === '__custom__' ? '__custom__' : Number(e.target.value))}
                >
                  {LOOKBACK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  <option value="__custom__">Custom…</option>
                </select>
                {lookbackChoice === '__custom__' && (
                  <input
                    className="input mt-1.5" type="number" min={1} max={365} value={customLookback}
                    onChange={(e) => setCustomLookback(e.target.value)} placeholder="Days, 1-365"
                  />
                )}
              </div>
            </div>
            <p className="text-muted text-xs mt-1">Google News and RSS honor the lookback exactly. Reddit, web search and YouTube stay at the last week for now.</p>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Region</label>
                <select className="input mt-1.5" value={regionChoice} onChange={(e) => setRegionChoice(e.target.value)}>
                  {REGION_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  <option value={ALL_REGIONS}>Worldwide (all regions)</option>
                  <option value="__custom__">Custom code…</option>
                </select>
                {regionChoice === '__custom__' && (
                  <input
                    className="input mt-1.5" value={customRegion} onChange={(e) => setCustomRegion(e.target.value)}
                    placeholder="2-letter code, e.g. DE" maxLength={4}
                  />
                )}
              </div>
              <div>
                <label className="label">Results per source</label>
                <select className="input mt-1.5" value={resultsPerSource} onChange={(e) => setResultsPerSource(Number(e.target.value))}>
                  {[5, 10, 15, 20, 25].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <p className="text-muted text-xs mt-1">Region applies to Google News and web search only. Worldwide and custom codes are best-effort.</p>
          </div>

          <div className="panel p-3 text-sm">
            <div className="flex items-center gap-2 font-medium mb-1"><Wallet size={14} /> Estimated cost</div>
            <div className="text-secondary">About {formatUsd(perCheck, 3)} per check</div>
            <div className="text-secondary">About {formatUsd(perMonth)} per month at this schedule</div>
            <p className="text-muted text-xs mt-1">
              An estimate. Checks that find nothing new cost only the collection. Checks stop for the rest of the month once the budget is used.
            </p>
            {budgetNum !== null && !budgetInvalid && perMonth > budgetNum && (
              <p className="text-xs mt-1" style={{ color: 'var(--accent-orange)' }}>
                At this schedule the budget may run out before the month ends.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={onSave} loading={saving} disabled={!canSave}>{initial ? 'Save changes' : 'Create watch item'}</Button>
      </div>
    </Modal>
  )
}

// ─── detail ──────────────────────────────────────────────────────────────────

type Tab = 'feed' | 'trend' | 'rules' | 'history'

function WatchDetail({ id }: { id: string }) {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const watches = useWatches()
  const watch = watches.data?.find((w) => w.id === id)
  const checking = isChecking(watch)
  const runs = useQuery({ queryKey: [...KEY, 'runs', id], queryFn: () => listRuns(id), refetchInterval: checking ? 4000 : false })
  const spend = useQuery({ queryKey: [...KEY, 'spend'], queryFn: monthSpendByWatch, refetchInterval: checking ? 4000 : false })
  const [tab, setTab] = useState<Tab>('feed')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const canEdit = can('trend_alerts', 'edit')
  const canDelete = can('trend_alerts', 'full')

  if (watches.isLoading) return <div className="flex justify-center py-16"><Spinner /></div>
  if (!watch) {
    return (
      <div>
        <Link to="/trend-alerts" className="text-sm text-secondary flex items-center gap-1 mb-4"><ArrowLeft size={14} /> Trend Alerts</Link>
        <EmptyState icon={<BellRing size={28} />} title="Watch item not found" hint="It may have been deleted." />
      </div>
    )
  }
  const w = watch
  const s = statusInfo(w)
  const spent = spend.data?.[w.id] ?? 0
  const weekAgo = Date.now() - 7 * 86_400_000
  const weekRuns = (runs.data ?? []).filter((r) => new Date(r.started_at).getTime() >= weekAgo)
  const alertsWeek = weekRuns.reduce((n, r) => n + r.alerts_immediate + r.alerts_digest, 0)
  const relevantWeek = weekRuns.reduce((n, r) => n + r.events_created, 0)

  async function refreshAll() {
    await qc.invalidateQueries({ queryKey: KEY })
  }

  async function onRunNow() {
    setBusy('run')
    try {
      await runWatchNow(w.id)
      toast.success('Check started. Results show up here in about a minute.')
      await refreshAll()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not start a check'))
    } finally {
      setBusy(null)
    }
  }

  async function onToggle() {
    setBusy('toggle')
    try {
      await updateWatch(w.id, w.status === 'active'
        ? { status: 'paused' }
        : { status: 'active' })
      await refreshAll()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not update this watch item'))
    } finally {
      setBusy(null)
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete "${w.name}"? Its alerts, history and rules are deleted too. This cannot be undone.`)) return
    setBusy('delete')
    try {
      await deleteWatch(w.id)
      await refreshAll()
      toast.success('Watch item deleted')
      navigate('/trend-alerts')
    } catch (err) {
      toast.error(toastMessage(err, 'Could not delete this watch item'))
      setBusy(null)
    }
  }

  return (
    <div>
      <Link to="/trend-alerts" className="text-sm text-secondary flex items-center gap-1 mb-4 hover:text-sage"><ArrowLeft size={14} /> Trend Alerts</Link>
      <PageHeader
        accent={<Badge tone={s.tone}>{s.label}</Badge>}
        title={w.name}
        subtitle={w.description}
        actions={
          <>
            {canEdit && <Button onClick={onRunNow} loading={busy === 'run'} disabled={checking}><Play size={15} /> {checking ? 'Checking…' : 'Run now'}</Button>}
            {canEdit && (
              <Button variant="ghost" onClick={onToggle} loading={busy === 'toggle'}>
                {w.status === 'active' ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Resume</>}
              </Button>
            )}
            {canEdit && <Button variant="ghost" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button>}
            {canDelete && <Button variant="ghost" onClick={onDelete} loading={busy === 'delete'}><Trash2 size={15} /></Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Tile icon={<Zap size={13} />} label="New relevant stories (7 days)" value={relevantWeek} />
        <Tile icon={<Send size={13} />} label="Alerts queued or sent (7 days)" value={alertsWeek} />
        <Tile
          icon={<Wallet size={13} />}
          label="Spend this month"
          value={`$${spent.toFixed(2)}`}
          hint={w.monthly_budget_usd != null ? `of $${Number(w.monthly_budget_usd).toFixed(2)} budget` : 'No budget limit'}
        />
        <Tile
          icon={<Clock size={13} />}
          label={frequencyLabel(w.frequency_minutes)}
          value={w.last_run_at ? relativeTime(w.last_run_at) : 'Not checked yet'}
          hint={w.status === 'paused' ? 'Paused' : `Next check ${untilTime(w.next_run_at)}`}
        />
      </div>

      {w.last_run_status === 'failed' && w.last_error && (
        <div className="panel p-3 mb-5 text-sm flex items-start gap-2" style={{ borderColor: 'var(--accent-orange)' }}>
          <AlertTriangle size={15} style={{ color: 'var(--accent-orange)' }} className="shrink-0 mt-0.5" />
          <span>The last check failed: {w.last_error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <Chip active={tab === 'feed'} onClick={() => setTab('feed')}>Feed</Chip>
        <Chip active={tab === 'trend'} onClick={() => setTab('trend')}>Trend</Chip>
        <Chip active={tab === 'rules'} onClick={() => setTab('rules')}>Alert rules</Chip>
        <Chip active={tab === 'history'} onClick={() => setTab('history')}>Check history</Chip>
      </div>

      {tab === 'feed' && <FeedTab watchId={w.id} checking={checking} />}
      {tab === 'trend' && <TrendTab watchId={w.id} />}
      {tab === 'rules' && <RulesTab watch={w} canEdit={canEdit} />}
      {tab === 'history' && <HistoryTab runs={runs.data ?? []} loading={runs.isLoading} />}

      {editing && <WatchFormModal initial={w} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </div>
  )
}

// ─── feed ────────────────────────────────────────────────────────────────────

type FeedView = 'relevant' | 'important' | 'spikes' | 'discarded'

function FeedTab({ watchId, checking }: { watchId: string; checking: boolean }) {
  const [view, setView] = useState<FeedView>('relevant')
  const [sentiment, setSentiment] = useState<Sentiment | 'any'>('any')
  const events = useQuery({
    queryKey: [...KEY, 'events', watchId, view === 'discarded'],
    queryFn: () => listEvents(watchId, view === 'discarded'),
    refetchInterval: checking ? 4000 : false,
  })

  const shown = useMemo(() => (events.data ?? []).filter((e) => {
    if (view === 'discarded' && e.status !== 'discarded') return false
    if (view !== 'discarded' && e.status !== 'active') return false
    if (view === 'important' && !(e.importance === 'high' || e.importance === 'critical' || e.kind === 'spike')) return false
    if (view === 'spikes' && e.kind !== 'spike') return false
    if (sentiment !== 'any' && e.sentiment !== sentiment) return false
    return true
  }), [events.data, view, sentiment])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Chip active={view === 'relevant'} onClick={() => setView('relevant')}>All relevant</Chip>
        <Chip active={view === 'important'} onClick={() => setView('important')}>High & critical</Chip>
        <Chip active={view === 'spikes'} onClick={() => setView('spikes')}>Spikes</Chip>
        <Chip active={view === 'discarded'} onClick={() => setView('discarded')}>Filtered out</Chip>
        <span className="text-muted text-xs ml-2">Sentiment</span>
        <select className="input !w-auto !py-1 text-xs" value={sentiment} onChange={(e) => setSentiment(e.target.value as Sentiment | 'any')}>
          <option value="any">Any</option>
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
          <option value="mixed">Mixed</option>
          <option value="neutral">Neutral</option>
        </select>
      </div>

      {events.isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Radio size={24} />}
          title={checking ? 'Checking sources now…' : view === 'discarded' ? 'Nothing filtered out' : 'Nothing here yet'}
          hint={view === 'discarded'
            ? 'Stories the AI judged off-topic or not meaningful show up here, so you can check its judgment.'
            : 'Relevant stories appear after the next check. Use "Run now" to check straight away.'}
        />
      ) : (
        <div className="space-y-3">
          {shown.map((e) => <EventCard key={e.id} event={e} />)}
        </div>
      )}
    </div>
  )
}

function EventCard({ event: e }: { event: TrendAlertEvent }) {
  const [open, setOpen] = useState(false)
  return (
    <Panel className="!p-4">
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {e.kind === 'spike' && <Badge tone="orange"><TrendingUp size={11} /> Spike</Badge>}
        {e.importance && <Badge tone={IMPORTANCE_TONE[e.importance]}>{e.importance[0].toUpperCase() + e.importance.slice(1)}</Badge>}
        {e.sentiment && <Badge tone={SENTIMENT_TONE[e.sentiment]}>{e.sentiment}</Badge>}
        {e.kind === 'story' && <Badge tone="grey">{e.source_count} {e.source_count === 1 ? 'source' : 'sources'}</Badge>}
        {e.topic && <span className="text-muted text-xs">{e.topic}</span>}
        <span className="text-muted text-xs ml-auto" title={new Date(e.first_seen_at).toLocaleString()}>
          {relativeTime(e.first_seen_at)}
        </span>
      </div>
      <div className="font-semibold mb-1">
        {e.primary_url
          ? <a href={e.primary_url} target="_blank" rel="noreferrer" className="hover:text-sage">{e.title} <ExternalLink size={12} className="inline -mt-0.5" /></a>
          : e.title}
      </div>
      {(e.explanation || e.summary) && <p className="text-secondary text-sm">{e.explanation || e.summary}</p>}
      {e.sentiment === 'mixed' && (e.positive_aspects || e.negative_aspects) && (
        <div className="grid sm:grid-cols-2 gap-2 mt-2 text-xs">
          {e.positive_aspects && <div><span className="text-sage font-medium">Praised: </span><span className="text-secondary">{e.positive_aspects}</span></div>}
          {e.negative_aspects && <div><span className="font-medium" style={{ color: 'var(--accent-orange)' }}>Criticised: </span><span className="text-secondary">{e.negative_aspects}</span></div>}
        </div>
      )}
      {e.sources.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-xs text-muted flex items-center gap-1 hover:text-sage" onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {e.kind === 'spike' ? 'Top stories today' : `Coverage (${e.sources.length})`}
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1">
              {e.sources.map((src, i) => (
                <li key={i} className="text-xs flex items-start gap-1.5">
                  <Badge tone="grey" className="shrink-0">{SOURCE_LABEL[src.source] ?? src.source}</Badge>
                  <a href={src.url} target="_blank" rel="noreferrer" className="text-secondary hover:text-sage">
                    {src.publisher ? <span className="text-muted">{src.publisher}: </span> : null}{src.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {e.status === 'discarded' && (
        <p className="text-muted text-xs mt-2">
          Filtered out: relevance {e.relevance != null ? Math.round(Number(e.relevance) * 100) : 0}%, below this watch item's bar or not a real development.
        </p>
      )}
    </Panel>
  )
}

// ─── trend ───────────────────────────────────────────────────────────────────

function TrendTab({ watchId }: { watchId: string }) {
  const stats = useQuery({ queryKey: [...KEY, 'stats', watchId], queryFn: () => listStats(watchId, 30) })
  const data = useMemo(() => {
    const byDay = new Map((stats.data ?? []).map((s) => [s.day, s]))
    const out = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() + 330 * 60_000 - i * 86_400_000).toISOString().slice(0, 10)
      const s = byDay.get(d)
      out.push({
        day: d.slice(5),
        mentions: s?.mention_count ?? 0,
        positive: s?.positive ?? 0,
        negative: s?.negative ?? 0,
        mixed: s?.mixed ?? 0,
        neutral: s?.neutral ?? 0,
      })
    }
    return out
  }, [stats.data])

  const tooltipStyle = {
    background: 'var(--glass-fill)', backdropFilter: 'blur(20px)',
    border: 'none', outline: '1px solid var(--glass-border)', borderRadius: 12,
  }

  if (stats.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>
  if (!stats.data?.length) {
    return <EmptyState icon={<TrendingUp size={24} />} title="No trend data yet" hint="Daily mention counts and sentiment build up as checks run. A spike alert needs at least 3 days of history to compare against." />
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="font-medium mb-1">Mentions per day</div>
        <p className="text-muted text-xs mb-3">Coverage of relevant stories over the last 30 days (IST). A day far above the usual level triggers a spike alert.</p>
        <ResponsiveContainer width="100%" height={220} className="chart-clean">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 6" stroke="var(--border-subtle)" strokeWidth={0.5} vertical={false} />
            <XAxis dataKey="day" axisLine={false} tickLine={false} stroke="var(--text-muted)" fontSize={11} interval={4} />
            <YAxis axisLine={false} tickLine={false} stroke="var(--text-muted)" fontSize={11} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'var(--fill-tertiary)' }} contentStyle={tooltipStyle} />
            <Bar dataKey="mentions" name="Mentions" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel>
        <div className="font-medium mb-1">Sentiment of new stories</div>
        <p className="text-muted text-xs mb-3">New relevant stories per day, by sentiment toward what you're watching.</p>
        <ResponsiveContainer width="100%" height={220} className="chart-clean">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 6" stroke="var(--border-subtle)" strokeWidth={0.5} vertical={false} />
            <XAxis dataKey="day" axisLine={false} tickLine={false} stroke="var(--text-muted)" fontSize={11} interval={4} />
            <YAxis axisLine={false} tickLine={false} stroke="var(--text-muted)" fontSize={11} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'var(--fill-tertiary)' }} contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="positive" name="Positive" stackId="s" fill="var(--accent-green)" />
            <Bar dataKey="mixed" name="Mixed" stackId="s" fill="var(--accent-blue)" />
            <Bar dataKey="neutral" name="Neutral" stackId="s" fill="var(--text-muted)" />
            <Bar dataKey="negative" name="Negative" stackId="s" fill="var(--accent-orange)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  )
}

// ─── rules ───────────────────────────────────────────────────────────────────

function RulesTab({ watch, canEdit }: { watch: TrendAlertWatch; canEdit: boolean }) {
  const toast = useToast()
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: [...KEY, 'rules', watch.id], queryFn: () => listRules(watch.id) })
  const team = useTeam()
  const [editing, setEditing] = useState<TrendAlertRule | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const nameOf = (id: string) => team.data?.find((u) => u.id === id)?.full_name || 'Unknown'

  async function onTest(r: TrendAlertRule) {
    setBusy(r.id)
    try {
      await testRule(r.id)
      toast.success('Test message sent through this rule\'s channels')
    } catch (err) {
      toast.error(toastMessage(err, 'Could not send a test message'))
    } finally {
      setBusy(null)
    }
  }

  async function onDelete(r: TrendAlertRule) {
    if (!window.confirm(`Delete the rule "${r.name}"?`)) return
    try {
      await deleteRule(r.id)
      await qc.invalidateQueries({ queryKey: [...KEY, 'rules', watch.id] })
    } catch (err) {
      toast.error(toastMessage(err, 'Could not delete this rule'))
    }
  }

  async function onToggle(r: TrendAlertRule) {
    try {
      await updateRule(r.id, { enabled: !r.enabled })
      await qc.invalidateQueries({ queryKey: [...KEY, 'rules', watch.id] })
    } catch (err) {
      toast.error(toastMessage(err, 'Could not update this rule'))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-muted text-sm max-w-2xl">
          Rules decide which stories reach you and how. Every relevant story is always kept in the feed; rules only control notifications.
        </p>
        {canEdit && <Button onClick={() => setEditing('new')}><Plus size={15} /> Add rule</Button>}
      </div>

      {rules.isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : !rules.data?.length ? (
        <EmptyState icon={<BellRing size={24} />} title="No alert rules" hint="Without a rule, stories still appear in the feed but nobody gets notified." />
      ) : (
        <div className="space-y-3">
          {rules.data.map((r) => (
            <Panel key={r.id} className="!p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {r.name}
                    {!r.enabled && <Badge tone="grey">Off</Badge>}
                  </div>
                  <div className="text-secondary text-sm mt-1">
                    {DELIVERY_OPTIONS.find((d) => d.value === r.delivery)?.label} · relevance ≥ {Math.round(Number(r.min_relevance) * 100)}% ·{' '}
                    {IMPORTANCE_OPTIONS.find((i) => i.value === r.min_importance)?.label.toLowerCase()}
                    {r.sentiments.length > 0 && <> · {r.sentiments.join(' or ')} sentiment</>}
                    {r.min_source_count > 1 && <> · {r.min_source_count}+ sources</>}
                    {Number(r.min_credibility) > 0 && <> · credibility ≥ {Math.round(Number(r.min_credibility) * 100)}%</>}
                    {r.include_spikes && <> · includes spikes</>}
                  </div>
                  <div className="text-muted text-xs mt-1">
                    Sends to:{' '}
                    {[
                      r.channels.includes('app') && `In-app & email (${r.recipient_user_ids.length ? r.recipient_user_ids.map(nameOf).join(', ') : 'watch item creator'})`,
                      r.channels.includes('slack') && 'Slack',
                      r.channels.includes('webhook') && 'Webhook',
                    ].filter(Boolean).join(' · ') || 'no channels'}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" onClick={() => onTest(r)} loading={busy === r.id}>Send test</Button>
                    <Button variant="ghost" onClick={() => onToggle(r)}>{r.enabled ? 'Turn off' : 'Turn on'}</Button>
                    <Button variant="ghost" onClick={() => setEditing(r)}><Pencil size={14} /></Button>
                    <Button variant="ghost" onClick={() => onDelete(r)}><Trash2 size={14} /></Button>
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {editing && (
        <RuleFormModal
          watch={watch}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RuleFormModal({ watch, initial, onClose }: { watch: TrendAlertWatch; initial?: TrendAlertRule; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const team = useTeam()
  const [name, setName] = useState(initial?.name ?? 'New alert rule')
  const [delivery, setDelivery] = useState<Delivery>(initial?.delivery ?? 'immediate')
  const [minRelevance, setMinRelevance] = useState(initial ? Number(initial.min_relevance) : 0.7)
  const [minImportance, setMinImportance] = useState<Importance>(initial?.min_importance ?? 'high')
  const [sentiments, setSentiments] = useState<Sentiment[]>(initial?.sentiments ?? [])
  const [minSources, setMinSources] = useState(initial?.min_source_count ?? 1)
  const [minCredibility, setMinCredibility] = useState(initial ? Number(initial.min_credibility) : 0)
  const [includeSpikes, setIncludeSpikes] = useState(initial?.include_spikes ?? true)
  const [channels, setChannels] = useState<Channel[]>(initial?.channels ?? ['app'])
  const [recipients, setRecipients] = useState<string[]>(initial?.recipient_user_ids ?? [])
  const [slackUrl, setSlackUrl] = useState(initial?.slack_webhook_url ?? '')
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhook_url ?? '')
  const [saving, setSaving] = useState(false)

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const slackInvalid = channels.includes('slack') && !/^https:\/\//i.test(slackUrl.trim())
  const webhookInvalid = channels.includes('webhook') && !/^https:\/\//i.test(webhookUrl.trim())
  const canSave = name.trim() && channels.length > 0 && !slackInvalid && !webhookInvalid
  const activeTeam = (team.data ?? []).filter((u) => u.status === 'active')

  async function onSave() {
    setSaving(true)
    const input: RuleInput = {
      name: name.trim(),
      enabled: initial?.enabled ?? true,
      delivery,
      min_relevance: minRelevance,
      min_importance: minImportance,
      sentiments,
      min_source_count: minSources,
      min_credibility: minCredibility,
      include_spikes: includeSpikes,
      channels,
      recipient_user_ids: recipients,
      slack_webhook_url: channels.includes('slack') ? slackUrl.trim() : null,
      webhook_url: channels.includes('webhook') ? webhookUrl.trim() : null,
    }
    try {
      if (initial) await updateRule(initial.id, input)
      else await createRule(watch.id, input)
      await qc.invalidateQueries({ queryKey: [...KEY, 'rules', watch.id] })
      toast.success('Rule saved')
      onClose()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not save this rule'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={initial ? 'Edit alert rule' : 'New alert rule'} onClose={onClose} size="xl">
      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-4">
          <div>
            <label className="label">Rule name</label>
            <input className="input mt-1.5" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div>
            <label className="label">When to send</label>
            <select className="input mt-1.5" value={delivery} onChange={(e) => setDelivery(e.target.value as Delivery)}>
              {DELIVERY_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Minimum relevance</label>
              <select className="input mt-1.5" value={minRelevance} onChange={(e) => setMinRelevance(Number(e.target.value))}>
                {[0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
              </select>
            </div>
            <div>
              <label className="label">Importance</label>
              <select className="input mt-1.5" value={minImportance} onChange={(e) => setMinImportance(e.target.value as Importance)}>
                {IMPORTANCE_OPTIONS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Reported by at least</label>
              <select className="input mt-1.5" value={minSources} onChange={(e) => setMinSources(Number(e.target.value))}>
                {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'source' : 'sources'}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Source credibility</label>
              <select className="input mt-1.5" value={minCredibility} onChange={(e) => setMinCredibility(Number(e.target.value))}>
                <option value={0}>Any</option>
                <option value={0.5}>Medium or higher</option>
                <option value={0.75}>High only</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Sentiment</label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              <Chip active={sentiments.length === 0} onClick={() => setSentiments([])}>Any</Chip>
              {(['positive', 'negative', 'mixed', 'neutral'] as Sentiment[]).map((s) => (
                <Chip key={s} active={sentiments.includes(s)} onClick={() => setSentiments((prev) => toggle(prev, s))}>
                  {s[0].toUpperCase() + s.slice(1)}
                </Chip>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={includeSpikes} onChange={(e) => setIncludeSpikes(e.target.checked)} />
            Also alert on unusual spikes in mentions
          </label>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Send to</label>
            <div className="space-y-2 mt-1.5">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={channels.includes('app')} onChange={() => setChannels((c) => toggle(c, 'app'))} />
                In-app notification & email
              </label>
              {channels.includes('app') && (
                <div className="pl-6">
                  <p className="text-muted text-xs mb-1.5">
                    Who gets it. Leave everyone unticked to send to whoever created this watch item. Email follows each person's own setting.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {activeTeam.map((u) => (
                      <Chip key={u.id} active={recipients.includes(u.id)} onClick={() => setRecipients((r) => toggle(r, u.id))}>
                        {u.full_name || u.email}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={channels.includes('slack')} onChange={() => setChannels((c) => toggle(c, 'slack'))} />
                Slack
              </label>
              {channels.includes('slack') && (
                <div className="pl-6">
                  <input className="input" value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder="https://hooks.slack.com/services/..." />
                  <p className="text-muted text-xs mt-1">A Slack incoming webhook URL for the channel you want alerts in.</p>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={channels.includes('webhook')} onChange={() => setChannels((c) => toggle(c, 'webhook'))} />
                Webhook (for Zapier, Make, your own system)
              </label>
              {channels.includes('webhook') && (
                <div className="pl-6">
                  <input className="input" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://..." />
                  <p className="text-muted text-xs mt-1">Receives a JSON POST with the full event.</p>
                </div>
              )}
            </div>
          </div>
          <p className="text-muted text-xs">
            Use "Send test" on the rule after saving to check that Slack or webhook messages arrive.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={onSave} loading={saving} disabled={!canSave}>Save rule</Button>
      </div>
    </Modal>
  )
}

// ─── history ─────────────────────────────────────────────────────────────────

function HistoryTab({ runs, loading }: { runs: import('../lib/trendAlerts').TrendAlertRun[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>
  if (!runs.length) return <EmptyState icon={<Clock size={24} />} title="No checks yet" hint="Every scheduled or manual check is listed here with what it found and what it cost." />

  const tone = (s: string) => (s === 'completed' ? 'green' : s === 'failed' ? 'orange' : 'blue') as 'green' | 'orange' | 'blue'
  return (
    <Panel className="!p-0 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted text-xs">
            <th className="py-2.5 px-4 font-medium">When</th>
            <th className="py-2.5 pr-3 font-medium">Status</th>
            <th className="py-2.5 pr-3 font-medium">Collected</th>
            <th className="py-2.5 pr-3 font-medium">New</th>
            <th className="py-2.5 pr-3 font-medium">New stories</th>
            <th className="py-2.5 pr-3 font-medium">Alerts</th>
            <th className="py-2.5 pr-4 font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <td className="py-2 px-4 whitespace-nowrap" title={new Date(r.started_at).toLocaleString()}>
                {relativeTime(r.started_at)} <span className="text-muted text-xs">{r.trigger === 'manual' ? 'manual' : ''}</span>
              </td>
              <td className="py-2 pr-3">
                <Badge tone={tone(r.status)}>{r.status}</Badge>
                {r.error && <div className="text-xs mt-1 max-w-xs" style={{ color: 'var(--accent-orange)' }}>{r.error}</div>}
              </td>
              <td className="py-2 pr-3" title={Object.entries(r.source_stats || {}).map(([k, v]) => `${SOURCE_LABEL[k] ?? k}: ${v}`).join('\n')}>{r.raw_count}</td>
              <td className="py-2 pr-3">{r.new_count}</td>
              <td className="py-2 pr-3">{r.events_created}</td>
              <td className="py-2 pr-3">{r.alerts_immediate + r.alerts_digest}</td>
              <td className="py-2 pr-4 whitespace-nowrap">${Number(r.est_cost_usd).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
