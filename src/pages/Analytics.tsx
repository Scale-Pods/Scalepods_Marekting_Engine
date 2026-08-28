import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  BarChart3, RefreshCw, Sparkles, Heart, MessageCircle, Eye, Zap, Clock, Gauge, Quote, Users, Star, Download, UserCheck,
} from 'lucide-react'
import { useProfile } from '../lib/queries'
import {
  listPostAnalytics, getAnalyticsState, triggerAnalyticsRefresh,
  getLatestInsights, triggerInsights, type PostAnalytics, type AnalyticsState, type AiInsight,
} from '../lib/analytics'
import { listInstagramLeads, triggerCommentSync, leadsToCsv, type InstagramLead } from '../lib/leads'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel } from '../components/ui'
import { PlatformBadge } from '../components/mediaUi'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function humanize(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Scores in this app's real ai_insights data come back on a 0-10 scale (confirmed against
// live rows), not 0-100 like a percentage.
function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value * 10))
  const color = value >= 7 ? 'var(--accent-green)' : value >= 4 ? 'var(--accent-orange)' : 'var(--text-muted)'
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-secondary capitalize">{humanize(label)}</span>
        <span className="font-medium" style={{ color }}>{value}/10</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--fill-tertiary)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function ContentScoresPanel({ value }: { value: unknown }) {
  if (!isRecord(value) || Object.keys(value).length === 0) return null
  return (
    <Panel>
      <div className="font-medium mb-3 flex items-center gap-2"><Gauge size={16} className="text-sage" /> Content Scores</div>
      {Object.entries(value).map(([k, v]) => (typeof v === 'number' ? <ScoreBar key={k} label={k} value={v} /> : null))}
    </Panel>
  )
}

function WinningHooksPanel({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null
  return (
    <Panel>
      <div className="font-medium mb-3 flex items-center gap-2"><Quote size={16} className="text-sage" /> Winning Hooks</div>
      <ul className="space-y-2.5">
        {value.map((h, i) => (
          <li key={i} className="text-sm text-secondary flex gap-2">
            <Quote size={12} className="text-sage shrink-0 mt-1" />
            <span>{String(h)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function AudienceBehaviourPanel({ value }: { value: unknown }) {
  if (!isRecord(value) || Object.keys(value).length === 0) return null
  return (
    <Panel>
      <div className="font-medium mb-3 flex items-center gap-2"><Users size={16} className="text-sage" /> Audience Behaviour</div>
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="mb-2.5 last:mb-0">
          <div className="text-xs font-semibold text-secondary mb-0.5">{humanize(k)}</div>
          <div className="text-sm text-secondary">{String(v)}</div>
        </div>
      ))}
    </Panel>
  )
}

function BestPostingTimePanel({ value }: { value: unknown }) {
  if (!isRecord(value) || Object.keys(value).length === 0) return null
  return (
    <Panel>
      <div className="font-medium mb-3 flex items-center gap-2"><Clock size={16} className="text-sage" /> Best Posting Time</div>
      <div className="space-y-2.5">
        {Object.entries(value).map(([platform, iso]) => {
          const date = new Date(String(iso))
          const valid = !isNaN(date.getTime())
          return (
            <div key={platform} className="flex items-center justify-between gap-2">
              <PlatformBadge platform={platform} size="sm" />
              <span className="text-sm text-secondary text-right">
                {valid ? date.toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) : String(iso)}
              </span>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function TopCreativesPanel({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null
  return (
    <Panel className="sm:col-span-2">
      <div className="font-medium mb-3 flex items-center gap-2"><Star size={16} className="text-sage" /> Top Creatives to Reuse</div>
      <div className="grid sm:grid-cols-3 gap-3">
        {value.map((c, i) => {
          const item = isRecord(c) ? c : {}
          const title = typeof item.title === 'string' ? item.title : null
          const caption = typeof item.caption === 'string' ? item.caption : null
          const imageUrl = typeof item.image_url === 'string' ? item.image_url : null
          return (
            <div key={i} className="panel !p-2">
              {imageUrl && <img src={imageUrl} alt={title ?? ''} className="w-full h-24 object-cover rounded mb-2" />}
              {title && <div className="text-xs font-semibold mb-1">{title}</div>}
              {caption && <div className="text-xs text-muted line-clamp-2">{caption}</div>}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function Tile({ icon: Icon, label, value, accent = 'var(--accent-green)' }: { icon: typeof Heart; label: string; value: number | string; accent?: string }) {
  return (
    <div className="card metric-tile p-4 flex items-center gap-3" style={{ '--tile-accent': accent } as CSSProperties}>
      <div className="h-9 w-9 rounded-lg panel flex items-center justify-center shrink-0" style={{ position: 'relative', zIndex: 1 }}>
        <Icon size={16} style={{ color: accent }} />
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div className="text-lg font-light tabular-nums tracking-tightest">{value}</div>
        <div className="text-muted text-xs">{label}</div>
      </div>
    </div>
  )
}

export default function Analytics() {
  const { data: profile } = useProfile()
  const [posts, setPosts] = useState<PostAnalytics[]>([])
  const [state, setState] = useState<AnalyticsState | null>(null)
  const [insights, setInsights] = useState<AiInsight | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [generatingInsights, setGeneratingInsights] = useState(false)
  const [leads, setLeads] = useState<InstagramLead[]>([])
  const [syncingLeads, setSyncingLeads] = useState(false)
  const [leadsPostFilter, setLeadsPostFilter] = useState('all')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (profileId: string) => {
    const [p, s, i, l] = await Promise.all([listPostAnalytics(profileId), getAnalyticsState(), getLatestInsights(profileId), listInstagramLeads()])
    setPosts(p)
    setState(s)
    setInsights(i)
    setLeads(l)
    return { state: s, insights: i }
  }, [])

  async function onSyncLeads() {
    setSyncingLeads(true)
    try {
      await triggerCommentSync()
      // Same fixed-delay-then-reload shape as onGenerateInsights below — the sync webhook
      // responds only once every tracked post's comments have actually been fetched and
      // upserted (it's not fire-and-forget), so a single reload after a short buffer is enough.
      await new Promise((r) => setTimeout(r, 1500))
      setLeads(await listInstagramLeads())
    } finally {
      setSyncingLeads(false)
    }
  }

  function onExportLeadsCsv() {
    const csv = leadsToCsv(leadsPostFilter === 'all' ? leads : leads.filter((l) => (l.content_item_id ?? l.media_id) === leadsPostFilter))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `instagram-leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (profile) load(profile.id)
  }, [profile, load])

  async function onRefresh() {
    if (!profile) return
    setRefreshing(true)
    const before = state?.last_refreshed_at ?? null
    await triggerAnalyticsRefresh()
    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts += 1
      const { state: s } = await load(profile.id)
      if ((s?.last_refreshed_at && s.last_refreshed_at !== before) || attempts >= 10) {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        setRefreshing(false)
      }
    }, 3000)
  }

  async function onGenerateInsights() {
    if (!profile) return
    setGeneratingInsights(true)
    const before = insights?.id ?? null
    await triggerInsights(profile.id)
    // Same shape as onRefresh above (and the Trends/Strategy fix) - triggerInsights only fires
    // the webhook, the actual GPT synthesis happens async afterward with no interim row to
    // poll. The old single setTimeout(...,6000) checked exactly once and often ran before the
    // new insights row existed, so generation worked but the page just kept showing "No
    // insights yet". Poll for a genuinely NEW insights row instead.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const { insights: fresh } = await load(profile.id)
      if (fresh && fresh.id !== before) break
    }
    setGeneratingInsights(false)
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
        <PageHeader accent={<Badge><BarChart3 size={12} /> Analytics</Badge>} title="Analytics" />
        <EmptyState icon={<BarChart3 size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  const totals = posts.reduce(
    (acc, p) => ({
      likes: acc.likes + p.likes,
      comments: acc.comments + p.comments,
      engagement: acc.engagement + p.engagement,
      views: acc.views + (p.video_views || p.impressions || p.reach),
    }),
    { likes: 0, comments: 0, engagement: 0, views: 0 },
  )

  const byPlatform = posts.reduce<Record<string, number>>((acc, p) => {
    acc[p.platform] = (acc[p.platform] ?? 0) + p.engagement
    return acc
  }, {})
  const chartData = Object.entries(byPlatform).map(([platform, engagement]) => ({ platform, engagement }))
  const topPosts = [...posts].sort((a, b) => b.engagement - a.engagement).slice(0, 5)

  // Distinct posts represented in the leads list, keyed by content_item_id (falls back to the
  // raw media_id for comments on posts no longer tracked in Growth OS) — powers the Post filter.
  const leadPostOptions = Array.from(
    leads.reduce((acc, l) => {
      const key = l.content_item_id ?? l.media_id
      if (!acc.has(key)) acc.set(key, l.content_items?.title ?? l.media_id)
      return acc
    }, new Map<string, string>()),
  )
  const filteredLeads = leadsPostFilter === 'all' ? leads : leads.filter((l) => (l.content_item_id ?? l.media_id) === leadsPostFilter)

  return (
    <div>
      <PageHeader
        accent={<Badge><BarChart3 size={12} /> Analytics</Badge>}
        title={`Analytics — ${profile.business_name}`}
        subtitle={state?.last_refreshed_at ? `Last refreshed ${new Date(state.last_refreshed_at).toLocaleString()}` : 'Not refreshed yet'}
        actions={
          <Button variant="ghost" onClick={onRefresh} loading={refreshing}>
            <RefreshCw size={15} /> Refresh now
          </Button>
        }
      />

      {posts.length === 0 ? (
        <EmptyState icon={<BarChart3 size={28} />} title="No analytics yet" hint="Click Refresh now once you have published posts — metrics pull from Meta, LinkedIn, and YouTube." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <Tile icon={Zap} label="Total engagement" value={totals.engagement} accent="var(--accent-green)" />
            <Tile icon={Heart} label="Likes" value={totals.likes} accent="var(--accent-blue)" />
            <Tile icon={MessageCircle} label="Comments" value={totals.comments} accent="var(--accent-blue)" />
            <Tile icon={Eye} label="Views / reach" value={totals.views} accent="var(--accent-orange)" />
          </div>

          {chartData.length > 0 && (
            <Panel className="mb-6">
              <div className="font-medium mb-3">Engagement by platform</div>
              <ResponsiveContainer width="100%" height={220} className="chart-clean">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 6" stroke="var(--border-subtle)" strokeWidth={0.5} vertical={false} />
                  <XAxis dataKey="platform" axisLine={false} tickLine={false} stroke="var(--text-muted)" fontSize={12} />
                  <YAxis axisLine={false} tickLine={false} stroke="var(--text-muted)" fontSize={12} />
                  <Tooltip
                    cursor={{ fill: 'var(--fill-tertiary)' }}
                    contentStyle={{
                      background: 'var(--glass-fill)', backdropFilter: 'blur(20px)',
                      border: 'none', outline: '1px solid var(--glass-border)', borderRadius: 12,
                    }}
                  />
                  <Bar dataKey="engagement" fill="var(--accent-green)" radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          )}

          <div className="font-medium mb-3">Top posts</div>
          <div className="space-y-2 mb-8">
            {topPosts.map((p) => (
              <Panel key={p.id} className="!p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <PlatformBadge platform={p.platform} />
                  <span className="text-sm text-secondary truncate">{p.post_url || p.platform_post_id}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted shrink-0">
                  <span>{p.likes} likes</span>
                  <span>{p.comments} comments</span>
                  <span className="text-sage font-medium">{p.engagement} engagement</span>
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}

      <PageHeader
        accent={<Badge tone="blue"><UserCheck size={12} /> Leads</Badge>}
        title="Instagram comments"
        subtitle="Every real comment on a tracked post — this is the lead list. Likes/shares only ever expose aggregate counts (Meta, LinkedIn, and YouTube all restrict this) — comments are the one place real usernames are available."
        actions={
          <div className="flex items-center gap-2">
            {leadPostOptions.length > 0 && (
              <select
                className="input !w-auto !py-1.5 text-xs max-w-[200px]"
                value={leadsPostFilter}
                onChange={(e) => setLeadsPostFilter(e.target.value)}
              >
                <option value="all">All posts</option>
                {leadPostOptions.map(([id, title]) => (
                  <option key={id} value={id}>{title}</option>
                ))}
              </select>
            )}
            <Button variant="ghost" onClick={onExportLeadsCsv} disabled={filteredLeads.length === 0}>
              <Download size={15} /> Export CSV
            </Button>
            <Button variant="ghost" onClick={onSyncLeads} loading={syncingLeads}>
              <RefreshCw size={15} /> Sync now
            </Button>
          </div>
        }
      />

      {leads.length === 0 ? (
        <EmptyState icon={<MessageCircle size={24} />} title="No comments captured yet" hint="Click Sync now to pull comment history for every tracked Instagram post." />
      ) : filteredLeads.length === 0 ? (
        <EmptyState icon={<MessageCircle size={24} />} title="No comments on this post" hint="Pick a different post from the filter, or choose All posts." />
      ) : (
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-muted text-xs uppercase tracking-wide">
                <th className="pb-2 pr-3 font-medium">Username</th>
                <th className="pb-2 pr-3 font-medium">Comment</th>
                <th className="pb-2 pr-3 font-medium">Post</th>
                <th className="pb-2 pr-3 font-medium">When</th>
                <th className="pb-2 pr-3 font-medium">Keyword</th>
                <th className="pb-2 pr-3 font-medium">DM</th>
                <th className="pb-2 font-medium">Follower</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">@{l.commenter_username || l.commenter_id}</td>
                  <td className="py-2 pr-3 text-secondary max-w-xs truncate" title={l.comment_text ?? ''}>{l.comment_text}</td>
                  <td className="py-2 pr-3 text-muted max-w-[160px] truncate" title={l.content_items?.title ?? l.media_id}>
                    {l.content_items?.title ?? l.media_id}
                  </td>
                  <td className="py-2 pr-3 text-muted whitespace-nowrap tabular-nums">
                    {l.commented_at ? new Date(l.commented_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-2 pr-3">{l.matched_keyword && <Badge tone="green">{l.matched_keyword}</Badge>}</td>
                  <td className="py-2 pr-3">{l.dm_sent && <Badge tone="blue">Sent</Badge>}</td>
                  <td className="py-2 text-muted tabular-nums">{l.follower_count ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PageHeader
        accent={<Badge tone="blue"><Sparkles size={12} /> AI Insights</Badge>}
        title="Learning engine"
        subtitle="Feeds back into scheduling (best-time) and copy (winning hooks) automatically."
        actions={
          <Button variant="ghost" onClick={onGenerateInsights} loading={generatingInsights}>
            <RefreshCw size={15} /> {insights ? 'Regenerate' : 'Generate insights'}
          </Button>
        }
      />

      {!insights ? (
        <EmptyState icon={<Clock size={24} />} title="No insights yet" hint="Generate insights once you have analytics data — needs at least a few published, measured posts." />
      ) : (
        <>
          {insights.overall_summary && (
            <div className="card p-5 mb-6">
              <div className="text-xs font-medium text-sage uppercase tracking-wide mb-1">Summary</div>
              <div className="text-secondary text-sm">{insights.overall_summary}</div>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <BestPostingTimePanel value={insights.best_posting_time} />
            <WinningHooksPanel value={insights.winning_hooks} />
            <ContentScoresPanel value={insights.content_scores} />
            <AudienceBehaviourPanel value={insights.audience_behaviour} />
            <TopCreativesPanel value={insights.top_creatives} />
          </div>
        </>
      )}
    </div>
  )
}
