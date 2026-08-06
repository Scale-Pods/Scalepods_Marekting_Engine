import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { BarChart3, RefreshCw, Sparkles, Heart, MessageCircle, Eye, Zap, Clock } from 'lucide-react'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import {
  listPostAnalytics, getAnalyticsState, triggerAnalyticsRefresh,
  getLatestInsights, triggerInsights, type PostAnalytics, type AnalyticsState, type AiInsight,
} from '../lib/analytics'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel } from '../components/ui'
import { PlatformBadge } from '../components/mediaUi'
import JsonBlock from '../components/JsonBlock'

const INSIGHT_SECTIONS: { key: keyof AiInsight; label: string }[] = [
  { key: 'content_scores', label: 'Content Scores' },
  { key: 'winning_hooks', label: 'Winning Hooks' },
  { key: 'audience_behaviour', label: 'Audience Behaviour' },
  { key: 'best_posting_time', label: 'Best Posting Time' },
  { key: 'top_creatives', label: 'Top Creatives' },
]

function Tile({ icon: Icon, label, value }: { icon: typeof Heart; label: string; value: number | string }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="h-9 w-9 rounded-lg panel flex items-center justify-center shrink-0">
        <Icon size={16} className="text-sage" />
      </div>
      <div>
        <div className="text-lg font-semibold">{value}</div>
        <div className="text-muted text-xs">{label}</div>
      </div>
    </div>
  )
}

export default function Analytics() {
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [posts, setPosts] = useState<PostAnalytics[]>([])
  const [state, setState] = useState<AnalyticsState | null>(null)
  const [insights, setInsights] = useState<AiInsight | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [generatingInsights, setGeneratingInsights] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (profileId: string) => {
    const [p, s, i] = await Promise.all([listPostAnalytics(profileId), getAnalyticsState(), getLatestInsights(profileId)])
    setPosts(p)
    setState(s)
    setInsights(i)
    return s
  }, [])

  useEffect(() => {
    listProfiles().then(async (profiles) => {
      const p = profiles[0] ?? null
      setProfile(p)
      if (p) await load(p.id)
    })
  }, [load])

  async function onRefresh() {
    if (!profile) return
    setRefreshing(true)
    const before = state?.last_refreshed_at ?? null
    await triggerAnalyticsRefresh()
    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts += 1
      const s = await load(profile.id)
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
    await triggerInsights(profile.id)
    setTimeout(() => load(profile.id), 6000)
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
            <Tile icon={Zap} label="Total engagement" value={totals.engagement} />
            <Tile icon={Heart} label="Likes" value={totals.likes} />
            <Tile icon={MessageCircle} label="Comments" value={totals.comments} />
            <Tile icon={Eye} label="Views / reach" value={totals.views} />
          </div>

          {chartData.length > 0 && (
            <Panel className="mb-6">
              <div className="font-medium mb-3">Engagement by platform</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="platform" stroke="var(--text-muted)" fontSize={12} />
                  <YAxis stroke="var(--text-muted)" fontSize={12} />
                  <Tooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: 8 }} />
                  <Bar dataKey="engagement" fill="#B1D997" radius={[6, 6, 0, 0]} />
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
            {INSIGHT_SECTIONS.map((s) => (
              <Panel key={s.key}>
                <div className="font-medium mb-3">{s.label}</div>
                <JsonBlock value={insights[s.key]} />
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
