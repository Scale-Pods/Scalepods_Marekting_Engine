import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, Clock, ExternalLink, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useToast, toastMessage } from '../components/Toast'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import { listApprovedItems, listScheduledPosts, triggerPublish, type ScheduledPost } from '../lib/publishing'
import { PUBLISHING_ENABLED, isActivePlatform, type ContentItem } from '../lib/content'
import { PageHeader, Badge, Button, EmptyState, Spinner } from '../components/ui'
import { PostTile, PostPreviewModal, ContentTypeChip } from '../components/postPreview'

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

// Footer actions for a "Ready to publish" preview — same Post now / Schedule logic PublishCard
// used to run inline, now triggered from inside the click-through preview instead.
function ReadyPreviewActions({ item, onDone }: { item: ContentItem; onDone: () => void }) {
  const [busy, setBusy] = useState<'now' | 'schedule' | null>(null)
  const toast = useToast()

  async function onPostNow() {
    // Call out an existing target date explicitly — "Post now" sits right next to Schedule and
    // publishing immediately silently throws that target away, which testing ran into.
    const at = item.metadata?.scheduled_at
    const pending = at && new Date(at).getTime() > Date.now()
      ? `\n\nThis post is scheduled for ${new Date(at).toLocaleString()} — posting now publishes it immediately instead and cancels that.`
      : ''
    if (!window.confirm(`Post "${item.title}" live to ${item.platform} right now? This is public and cannot be undone.${pending}`)) return
    setBusy('now')
    try {
      await triggerPublish(item.id, true)
      toast.info('Publishing… this can take a few seconds.')
      onDone()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not publish this post'))
    } finally {
      setBusy(null)
    }
  }

  async function onSchedule() {
    setBusy('schedule')
    try {
      await triggerPublish(item.id, false)
      toast.success('Scheduling… the post will appear under Scheduled shortly.')
      onDone()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not schedule this post'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex gap-2">
      <Button className="flex-1 justify-center !py-2 text-xs" loading={busy === 'now'} onClick={onPostNow} disabled={!PUBLISHING_ENABLED}>
        <Send size={13} /> Post now
      </Button>
      <Button variant="ghost" className="flex-1 justify-center !py-2 text-xs" loading={busy === 'schedule'} onClick={onSchedule} disabled={!PUBLISHING_ENABLED}>
        <Clock size={13} /> Schedule
      </Button>
    </div>
  )
}

export default function Publishing() {
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [items, setItems] = useState<ContentItem[]>([])
  const [posts, setPosts] = useState<ScheduledPost[]>([])
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')
  const [readyPreviewIndex, setReadyPreviewIndex] = useState<number | null>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async (profileId: string) => {
    const [i, p] = await Promise.all([listApprovedItems(profileId), listScheduledPosts(profileId)])
    setItems(i.filter((x) => isActivePlatform(x.platform)))
    setPosts(p.filter((x) => isActivePlatform(x.platform)))
    return { items: i, posts: p }
  }, [])

  useEffect(() => {
    listProfiles().then(async (profiles) => {
      const p = profiles[0] ?? null
      setProfile(p)
      if (p) await load(p.id)
    })
  }, [load])

  // n8n answers the webhook immediately and does the real work asynchronously, so refetching
  // the instant triggerPublish() resolves always read stale data — that's why a published post
  // only showed up after a manual browser reload. Poll briefly until the row count actually
  // changes instead. (Phase 2 replaces this with a Supabase Realtime subscription.)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const refreshUntilChanged = useCallback((profileId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    const before = posts.length
    let tries = 0
    setSyncing(true)
    pollRef.current = setInterval(async () => {
      tries += 1
      const next = await load(profileId)
      if (next.posts.length !== before || tries >= 10) {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        setSyncing(false)
      }
    }, 2000)
  }, [load, posts.length])

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

  const filteredPosts = activityFilter === 'all' ? posts : posts.filter((p) => p.status === activityFilter)
  const readyItem = readyPreviewIndex !== null ? items[readyPreviewIndex] : null
  const activePost = previewIndex !== null ? filteredPosts[previewIndex] : null

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
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-1.5 mb-8">
          {items.map((item, i) => (
            <PostTile
              key={item.id}
              img={item.media_url}
              platform={item.platform}
              placeholder={item.title || item.body?.slice(0, 80)}
              topRight={<ContentTypeChip type={item.content_type} />}
              onClick={() => setReadyPreviewIndex(i)}
            />
          ))}
        </div>
      )}

      <div className="font-medium mb-3 flex items-center gap-2">
        Recent activity
        {syncing && (
          <span className="text-muted text-xs font-normal inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> syncing…
          </span>
        )}
      </div>
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
          {filteredPosts.length === 0 ? (
            <EmptyState icon={<Clock size={24} />} title="No activity matches this filter" />
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-1.5">
              {filteredPosts.map((p, i) => {
                const meta = STATUS_META[p.status] ?? STATUS_META.pending
                const Icon = meta.icon
                return (
                  <PostTile
                    key={p.id}
                    img={p.media_url}
                    platform={p.platform}
                    placeholder={p.title || p.caption?.slice(0, 80)}
                    topRight={
                      <Icon
                        size={14}
                        className={`text-white ${p.status === 'publishing' || p.status === 'pending' ? 'animate-spin' : ''}`}
                        style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}
                      />
                    }
                    onClick={() => setPreviewIndex(i)}
                  />
                )
              })}
            </div>
          )}
        </>
      )}

      {readyItem && (
        <PostPreviewModal
          img={readyItem.media_url}
          platform={readyItem.platform}
          caption={readyItem.body}
          headerExtra={<ContentTypeChip type={readyItem.content_type} />}
          footer={<ReadyPreviewActions item={readyItem} onDone={() => { setReadyPreviewIndex(null); refreshUntilChanged(profile.id) }} />}
          onClose={() => setReadyPreviewIndex(null)}
          hasPrev={(readyPreviewIndex ?? 0) > 0}
          hasNext={(readyPreviewIndex ?? 0) < items.length - 1}
          onPrev={() => setReadyPreviewIndex((i) => (i !== null ? i - 1 : i))}
          onNext={() => setReadyPreviewIndex((i) => (i !== null ? i + 1 : i))}
        />
      )}

      {activePost && (
        <PostPreviewModal
          img={activePost.media_url}
          platform={activePost.platform}
          caption={activePost.caption || activePost.title}
          headerExtra={<Badge tone={(STATUS_META[activePost.status] ?? STATUS_META.pending).tone}>{(STATUS_META[activePost.status] ?? STATUS_META.pending).label}</Badge>}
          body={
            <>
              <div className="text-muted text-xs">
                {activePost.published_at
                  ? new Date(activePost.published_at).toLocaleString()
                  : activePost.scheduled_time
                    ? new Date(activePost.scheduled_time).toLocaleString()
                    : ''}
              </div>
              {activePost.error && <div className="text-terracotta text-xs">{activePost.error}</div>}
            </>
          }
          footer={
            activePost.post_url ? (
              <a href={activePost.post_url} target="_blank" rel="noreferrer" className="btn-primary w-full !py-2 text-xs justify-center">
                View live <ExternalLink size={13} />
              </a>
            ) : undefined
          }
          onClose={() => setPreviewIndex(null)}
          hasPrev={(previewIndex ?? 0) > 0}
          hasNext={(previewIndex ?? 0) < filteredPosts.length - 1}
          onPrev={() => setPreviewIndex((i) => (i !== null ? i - 1 : i))}
          onNext={() => setPreviewIndex((i) => (i !== null ? i + 1 : i))}
        />
      )}
    </div>
  )
}
