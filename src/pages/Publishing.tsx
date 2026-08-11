import { useEffect, useState } from 'react'
import { Send, Clock, ExternalLink, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import { listApprovedItems, listScheduledPosts, triggerPublish, type ScheduledPost } from '../lib/publishing'
import { PUBLISHING_ENABLED, type ContentItem } from '../lib/content'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel } from '../components/ui'
import { PlatformBadge } from '../components/mediaUi'

const STATUS_META: Record<string, { label: string; tone: 'green' | 'blue' | 'orange'; icon: typeof CheckCircle2 }> = {
  published: { label: 'Published', tone: 'green', icon: CheckCircle2 },
  scheduled: { label: 'Scheduled', tone: 'blue', icon: Clock },
  publishing: { label: 'Publishing…', tone: 'blue', icon: Loader2 },
  pending: { label: 'Pending', tone: 'blue', icon: Loader2 },
  failed: { label: 'Failed', tone: 'orange', icon: XCircle },
}

const ACTIVITY_FILTERS = ['all', 'published', 'scheduled', 'failed'] as const
type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]

function ActivityFilterPills({
  value, onChange, counts,
}: {
  value: ActivityFilter
  onChange: (v: ActivityFilter) => void
  counts: Record<ActivityFilter, number>
}) {
  return (
    <div className="flex gap-2 flex-wrap mb-3">
      {ACTIVITY_FILTERS.map((f) => {
        const active = value === f
        return (
          <button
            key={f}
            onClick={() => onChange(f)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-all"
            style={{
              background: active ? 'var(--accent-blue)' : 'var(--fill-secondary)',
              color: active ? '#fff' : 'var(--text-primary)',
              border: `1.5px solid ${active ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
            }}
          >
            {f}
            <span
              className="text-[10px] px-1.5 rounded-full"
              style={{ background: active ? 'rgba(255,255,255,0.25)' : 'var(--fill-tertiary)' }}
            >
              {counts[f]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PublishCard({ item, onDone }: { item: ContentItem; onDone: () => void }) {
  const [busy, setBusy] = useState<'now' | 'schedule' | null>(null)

  async function onPostNow() {
    if (!window.confirm(`Post "${item.title}" live to ${item.platform} right now? This is public and cannot be undone.`)) return
    setBusy('now')
    try {
      await triggerPublish(item.id, true)
      onDone()
    } finally {
      setBusy(null)
    }
  }

  async function onSchedule() {
    setBusy('schedule')
    try {
      await triggerPublish(item.id, false)
      onDone()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <PlatformBadge platform={item.platform} />
        <Badge tone="orange">{item.content_type.replace(/_/g, ' ')}</Badge>
        {item.scheduled_date && <span className="text-muted text-xs">{item.scheduled_date}</span>}
      </div>
      {item.media_url && <img src={item.media_url} alt={item.title ?? ''} className="w-full h-40 object-cover rounded-lg mb-3" />}
      <div className="font-medium text-sm">{item.title}</div>
      <div className="text-secondary text-sm line-clamp-2 mt-1">{item.body}</div>
      <div className="flex gap-2 mt-4">
        <Button className="!py-1.5 !px-3 text-xs" loading={busy === 'now'} onClick={onPostNow} disabled={!PUBLISHING_ENABLED}>
          <Send size={13} /> Post now
        </Button>
        <Button variant="ghost" className="!py-1.5 !px-3 text-xs" loading={busy === 'schedule'} onClick={onSchedule} disabled={!PUBLISHING_ENABLED}>
          <Clock size={13} /> Schedule (AI best time)
        </Button>
      </div>
    </div>
  )
}

export default function Publishing() {
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [items, setItems] = useState<ContentItem[]>([])
  const [posts, setPosts] = useState<ScheduledPost[]>([])
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')

  async function load(profileId: string) {
    const [i, p] = await Promise.all([listApprovedItems(profileId), listScheduledPosts(profileId)])
    setItems(i)
    setPosts(p)
  }

  useEffect(() => {
    listProfiles().then(async (profiles) => {
      const p = profiles[0] ?? null
      setProfile(p)
      if (p) await load(p.id)
    })
  }, [])

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
        <PageHeader accent={<Badge><Send size={12} /> Publishing</Badge>} title="Publishing" />
        <EmptyState icon={<Send size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        accent={<Badge><Send size={12} /> Publishing</Badge>}
        title={`Publishing — ${profile.business_name}`}
        subtitle="Post now or schedule at the AI-predicted best time. Publishes to Instagram, Facebook, LinkedIn (YouTube video is manual-only)."
      />

      <div className="font-medium mb-3">Ready to publish</div>
      {items.length === 0 ? (
        <EmptyState icon={<Send size={28} />} title="Nothing approved yet" hint="Approve items in Creative Review — they land here once approved." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 mb-8">
          {items.map((item) => (
            <PublishCard key={item.id} item={item} onDone={() => load(profile.id)} />
          ))}
        </div>
      )}

      <div className="font-medium mb-3">Recent activity</div>
      {posts.length === 0 ? (
        <EmptyState icon={<Clock size={24} />} title="No publish activity yet" />
      ) : (
        <>
          <ActivityFilterPills
            value={activityFilter}
            onChange={setActivityFilter}
            counts={{
              all: posts.length,
              published: posts.filter((p) => p.status === 'published').length,
              scheduled: posts.filter((p) => p.status === 'scheduled').length,
              failed: posts.filter((p) => p.status === 'failed').length,
            }}
          />
          {(() => {
            const filteredPosts = activityFilter === 'all' ? posts : posts.filter((p) => p.status === activityFilter)
            return filteredPosts.length === 0 ? (
              <EmptyState icon={<Clock size={24} />} title="No activity matches this filter" />
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                {filteredPosts.map((p) => {
                  const meta = STATUS_META[p.status] ?? STATUS_META.pending
                  const Icon = meta.icon
                  const when = p.published_at ? new Date(p.published_at).toLocaleString() : p.scheduled_time ? new Date(p.scheduled_time).toLocaleString() : ''
                  return (
                    <Panel key={p.id} className="!p-4">
                      {p.media_url && (
                        <img src={p.media_url} alt={p.title ?? ''} className="w-full h-32 object-cover rounded-lg mb-3" />
                      )}
                      <div className="flex items-center gap-2 mb-2.5">
                        <Icon size={15} className={p.status === 'publishing' || p.status === 'pending' ? 'animate-spin text-electric shrink-0' : meta.tone === 'orange' ? 'text-terracotta shrink-0' : 'text-sage shrink-0'} />
                        <PlatformBadge platform={p.platform} />
                        <Badge tone={meta.tone} className="ml-auto">{meta.label}</Badge>
                      </div>
                      <div className="text-sm line-clamp-2 min-h-[2.5em]">{p.title || p.caption?.slice(0, 80)}</div>
                      {p.error && <div className="text-terracotta text-xs mt-2 line-clamp-2">{p.error}</div>}
                      <div className="flex items-center justify-between gap-2 mt-3">
                        <span className="text-muted text-xs truncate">{when}</span>
                        {p.post_url && (
                          <a href={p.post_url} target="_blank" rel="noreferrer" className="text-muted hover:text-sage shrink-0">
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </Panel>
                  )
                })}
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}
