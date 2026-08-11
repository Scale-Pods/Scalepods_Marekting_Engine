import { useEffect, useState } from 'react'
import { Send, Clock, ExternalLink, CheckCircle2, XCircle, Loader2, Eye } from 'lucide-react'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import { listApprovedItems, listScheduledPosts, triggerPublish, type ScheduledPost } from '../lib/publishing'
import { PUBLISHING_ENABLED, type ContentItem } from '../lib/content'
import { PageHeader, Badge, Button, EmptyState, Spinner, Modal } from '../components/ui'
import { PlatformBadge, PlatformMockup, PLATFORM_ASPECT } from '../components/mediaUi'

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

// Square Instagram-grid-style tile — thumbnail-first, minimal chrome. Platform badge and a
// status icon sit as overlays in the corners (like an IG grid's like-count overlay), full
// details only show once you click through to ActivityPreviewModal.
function ActivityTile({ post, onClick }: { post: ScheduledPost; onClick: () => void }) {
  const meta = STATUS_META[post.status] ?? STATUS_META.pending
  const Icon = meta.icon
  return (
    <button
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden group text-left"
      style={{ background: 'var(--fill-tertiary)' }}
    >
      {post.media_url ? (
        <img
          src={post.media_url}
          alt={post.title ?? ''}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center p-3 text-center text-xs text-secondary line-clamp-4">
          {post.title || post.caption?.slice(0, 80)}
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-semibold flex items-center gap-1.5">
          <Eye size={14} /> View post
        </span>
      </div>
      <div className="absolute top-1.5 left-1.5"><PlatformBadge platform={post.platform} size="sm" /></div>
      <Icon
        size={14}
        className={`absolute top-1.5 right-1.5 text-white ${post.status === 'publishing' || post.status === 'pending' ? 'animate-spin' : ''}`}
        style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}
      />
    </button>
  )
}

// Click-through preview — reuses the same PlatformMockup used in the Create post composer and
// MediaEditor, so "how it looked" is rendered identically everywhere in the app.
function ActivityPreviewModal({ post, onClose }: { post: ScheduledPost; onClose: () => void }) {
  const meta = STATUS_META[post.status] ?? STATUS_META.pending
  const when = post.published_at
    ? new Date(post.published_at).toLocaleString()
    : post.scheduled_time
      ? new Date(post.scheduled_time).toLocaleString()
      : ''
  return (
    <Modal title={`How it looked on ${post.platform}`} onClose={onClose}>
      <PlatformMockup
        platform={post.platform}
        img={post.media_url}
        aspect={PLATFORM_ASPECT[post.platform?.toLowerCase()] ?? 1}
        caption={post.caption || post.title}
      />
      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <span className="text-muted text-xs">{when}</span>
        {post.post_url && (
          <a href={post.post_url} target="_blank" rel="noreferrer" className="ml-auto text-sage hover:underline text-xs inline-flex items-center gap-1">
            View live <ExternalLink size={12} />
          </a>
        )}
      </div>
      {post.error && <div className="text-terracotta text-xs mt-2">{post.error}</div>}
    </Modal>
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
  const [previewPost, setPreviewPost] = useState<ScheduledPost | null>(null)

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
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-1.5">
                {filteredPosts.map((p) => (
                  <ActivityTile key={p.id} post={p} onClick={() => setPreviewPost(p)} />
                ))}
              </div>
            )
          })()}
        </>
      )}

      {previewPost && <ActivityPreviewModal post={previewPost} onClose={() => setPreviewPost(null)} />}
    </div>
  )
}
