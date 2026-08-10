import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, BrainCircuit, TrendingUp, Target, Sparkles, Send, BarChart3, ArrowRight,
  CheckCircle2, Clock, Zap, FileCheck,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import { PageHeader, Badge, Panel } from '../components/ui'
import { PlatformBadge } from '../components/mediaUi'

const PIPELINE = [
  { to: '/clients', label: 'Business Profile', icon: Building2, desc: 'Brand knowledge base' },
  { to: '/intelligence', label: 'Intelligence', icon: BrainCircuit, desc: 'AI business analysis' },
  { to: '/trends', label: 'Trends', icon: TrendingUp, desc: '8-source signal scan' },
  { to: '/strategy', label: 'Strategy', icon: Target, desc: '7-part plan + approve' },
  { to: '/content', label: 'Content Factory', icon: Sparkles, desc: 'Copy + image + brand' },
  { to: '/publishing', label: 'Publishing', icon: Send, desc: 'IG · YT · FB · LinkedIn' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, desc: 'Insights + learning loop' },
]

const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube'] as const

interface DayBucket {
  key: string
  label: string
  items: { title: string | null; platform: string }[]
}
interface ActivityRow {
  id: string
  title: string | null
  platform: string
  status: string
  updated_at: string
}
interface DashboardData {
  approvedCount: number
  publishedThisMonth: number
  totalEngagement: number
  pendingReviewCount: number
  week: DayBucket[]
  recent: ActivityRow[]
  live: Record<(typeof PLATFORMS)[number], boolean>
}

async function loadDashboardData(profile: BusinessProfile): Promise<DashboardData> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()
  const weekEnd = new Date(today.getTime() + 6 * 86400000)
  const todayStr = today.toISOString().slice(0, 10)
  const weekEndStr = weekEnd.toISOString().slice(0, 10)

  const [approvedRes, publishedRes, engagementRes, pendingRes, weekRes, recentRes] = await Promise.all([
    supabase.from('content_items').select('id', { count: 'exact', head: true }).eq('profile_id', profile.id).eq('status', 'approved'),
    supabase.from('scheduled_posts').select('id', { count: 'exact', head: true }).eq('profile_id', profile.id).eq('status', 'published').gte('published_at', monthStart),
    supabase.from('post_analytics').select('engagement').eq('profile_id', profile.id),
    supabase.from('content_items').select('id', { count: 'exact', head: true }).eq('profile_id', profile.id).in('status', ['ready', 'revision']),
    supabase.from('content_items').select('title,platform,scheduled_date').eq('profile_id', profile.id).gte('scheduled_date', todayStr).lte('scheduled_date', weekEndStr),
    supabase.from('content_items').select('id,title,platform,status,updated_at').eq('profile_id', profile.id).order('updated_at', { ascending: false }).limit(4),
  ])

  const week: DayBucket[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getTime() + i * 86400000)
    const key = d.toISOString().slice(0, 10)
    return { key, label: d.toLocaleDateString(undefined, { weekday: 'short' }), items: [] as { title: string | null; platform: string }[] }
  })
  for (const row of weekRes.data ?? []) {
    const bucket = week.find((d) => d.key === row.scheduled_date)
    if (bucket) bucket.items.push({ title: row.title, platform: row.platform })
  }

  const social = (profile.social_media_urls ?? {}) as Record<string, string>
  return {
    approvedCount: approvedRes.count ?? 0,
    publishedThisMonth: publishedRes.count ?? 0,
    totalEngagement: (engagementRes.data ?? []).reduce((sum, r) => sum + (r.engagement ?? 0), 0),
    pendingReviewCount: pendingRes.count ?? 0,
    week,
    recent: (recentRes.data ?? []) as ActivityRow[],
    live: {
      instagram: !!social.ig_user_id,
      facebook: !!profile.fb_page_id,
      linkedin: !!social.li_org_urn,
      youtube: false,
    },
  }
}

function Tile({ icon: Icon, label, value, accent }: { icon: typeof Zap; label: string; value: number; accent: string }) {
  return (
    <div className="card metric-tile p-4" style={{ ['--tile-accent' as string]: accent }}>
      <div className="flex items-center gap-2 mb-2" style={{ position: 'relative', zIndex: 1 }}>
        <Icon size={15} style={{ color: accent }} />
        <span className="text-muted text-xs">{label}</span>
      </div>
      <div className="text-2xl font-light tabular-nums tracking-tightest" style={{ position: 'relative', zIndex: 1 }}>{value}</div>
    </div>
  )
}

export default function Dashboard() {
  const { role } = useAuth()
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    listProfiles().then(async (profiles) => {
      const p = profiles[0] ?? null
      setProfile(p)
      if (p) setData(await loadDashboardData(p))
    })
  }, [])

  return (
    <div>
      <PageHeader
        accent={<Badge><Sparkles size={12} /> Growth OS</Badge>}
        title={
          <>
            Welcome back to <span className="accent-serif">Growth OS</span>
          </>
        }
        subtitle="ScalePods running its own marketing on the exact system it sells — end to end, one screen at a time."
      />

      {profile === null && role === 'admin' && (
        <div className="card p-5 mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">Start here — create the ScalePods business profile.</div>
            <div className="text-muted text-sm">It seeds every downstream engine.</div>
          </div>
          <Link to="/clients" className="btn-primary shrink-0">
            Set up profile <ArrowRight size={16} />
          </Link>
        </div>
      )}

      {profile && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Tile icon={FileCheck} label="Approved & ready" value={data.approvedCount} accent="var(--accent-green)" />
            <Tile icon={Send} label="Published this month" value={data.publishedThisMonth} accent="var(--accent-blue)" />
            <Tile icon={Zap} label="Total engagement" value={data.totalEngagement} accent="var(--accent-blue)" />
            <Tile icon={Clock} label="Pending review" value={data.pendingReviewCount} accent="var(--accent-orange)" />
          </div>

          <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4 mb-6">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="font-medium">This week</div>
                <Link to="/calendar" className="text-xs text-sage hover:underline">Full calendar →</Link>
              </div>
              <div className="grid grid-cols-7 gap-2">
                {data.week.map((d) => (
                  <div key={d.key} className="min-h-[96px]">
                    <div className="text-muted text-[10px] font-semibold uppercase tracking-wide text-center mb-1.5">{d.label}</div>
                    <div className="space-y-1">
                      {d.items.slice(0, 3).map((it, i) => (
                        <div key={i} className="panel !p-1.5 text-[10px] leading-tight truncate" title={it.title ?? ''}>
                          {it.title}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <Panel>
                <div className="font-medium mb-3">Recent activity</div>
                {data.recent.length === 0 ? (
                  <div className="text-muted text-xs">Nothing yet.</div>
                ) : (
                  <div className="space-y-2.5">
                    {data.recent.map((r) => (
                      <div key={r.id} className="flex items-center gap-2.5">
                        <PlatformBadge platform={r.platform} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{r.title}</div>
                        </div>
                        <span className="text-muted text-[10px] shrink-0 capitalize">{r.status.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel>
                <div className="font-medium mb-3">Connected platforms</div>
                <div className="space-y-2.5">
                  {PLATFORMS.map((p) => (
                    <div key={p} className="flex items-center justify-between">
                      <PlatformBadge platform={p} size="sm" />
                      {data.live[p] ? (
                        <span className="badge">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-green)' }} />
                          Live
                        </span>
                      ) : (
                        <span className="text-muted text-[10px]">Off</span>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PIPELINE.map((s) => {
          const Icon = s.icon
          return (
            <Link key={s.to} to={s.to} className="card p-5 group">
              <div className="flex items-center justify-between mb-3">
                <div className="h-10 w-10 rounded-lg panel flex items-center justify-center">
                  <Icon size={20} className="text-sage" />
                </div>
                <ArrowRight size={16} className="text-muted group-hover:text-sage transition-colors" />
              </div>
              <div className="font-medium">{s.label}</div>
              <div className="text-muted text-sm">{s.desc}</div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
