import { useEffect, useState } from 'react'
import { Send, Clock, ExternalLink, CheckCircle2, XCircle, Loader2, Pencil, Ban, Check, X } from 'lucide-react'
import { useToast, toastMessage } from '../components/Toast'
import { useProfile, useApprovedItems, useScheduledPosts } from '../lib/queries'
import { triggerPublish, cancelScheduledPost, editScheduledPost, type ScheduledPost } from '../lib/publishing'
import { PUBLISHING_ENABLED, type ContentItem } from '../lib/content'
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

// Full modal for a "Recent activity" item — owns its own `editing` state, so it has to be a
// real component instantiated only while a post is selected (not a plain helper function called
// conditionally inside Publishing's render, which would call useState conditionally and break
// React's Rules of Hooks the moment the modal opens/closes).
function ActivityPreviewModal({
  post, onClose, onChanged, hasPrev, hasNext, onPrev, onNext,
}: {
  post: ScheduledPost
  onClose: () => void
  onChanged: () => void
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(post.title ?? '')
  const [body, setBody] = useState(post.caption ?? '')
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  function startEdit() {
    setTitle(post.title ?? '')
    setBody(post.caption ?? '')
    setEditing(true)
  }

  async function onSave() {
    if (!body.trim()) return toast.error("Caption can't be empty.")
    setSaving(true)
    try {
      await editScheduledPost(post, { title: title.trim() || null, body: body.trim() })
      toast.success('Post updated')
      setEditing(false)
      onChanged()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not save changes'))
    } finally {
      setSaving(false)
    }
  }

  async function onCancelSchedule() {
    if (!window.confirm('Cancel this scheduled post? It will move back to "Ready to publish" instead of firing automatically — nothing is deleted.')) return
    setCancelling(true)
    try {
      await cancelScheduledPost(post)
      toast.success('Schedule cancelled — back in Ready to publish')
      onChanged()
      onClose()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not cancel this schedule'))
      setCancelling(false)
    }
  }

  const meta = STATUS_META[post.status] ?? STATUS_META.pending

  return (
    <PostPreviewModal
      img={post.media_url}
      platform={post.platform}
      caption={editing ? undefined : post.caption || post.title}
      headerExtra={<Badge tone={meta.tone}>{meta.label}</Badge>}
      body={
        editing ? (
          <div className="space-y-2.5 w-full">
            <input
              className="input !py-1.5 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
            />
            <textarea
              className="input text-sm"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Caption — hashtags can go right in the text"
            />
          </div>
        ) : (
          <>
            <div className="text-muted text-xs">
              {post.published_at
                ? new Date(post.published_at).toLocaleString()
                : post.scheduled_time
                  ? new Date(post.scheduled_time).toLocaleString()
                  : ''}
            </div>
            {post.error && <div className="text-terracotta text-xs">{post.error}</div>}
          </>
        )
      }
      footer={
        editing ? (
          <div className="flex gap-2 w-full">
            <Button className="flex-1 justify-center !py-2 text-xs" loading={saving} onClick={onSave}>
              <Check size={13} /> Save
            </Button>
            <Button variant="ghost" className="flex-1 justify-center !py-2 text-xs" disabled={saving} onClick={() => setEditing(false)}>
              <X size={13} /> Discard
            </Button>
          </div>
        ) : post.status === 'scheduled' ? (
          <div className="flex gap-2 w-full">
            <Button variant="ghost" className="flex-1 justify-center !py-2 text-xs" onClick={startEdit}>
              <Pencil size={13} /> Edit
            </Button>
            <Button
              variant="ghost"
              className="flex-1 justify-center !py-2 text-xs"
              style={{ color: 'var(--accent-orange)' }}
              loading={cancelling}
              onClick={onCancelSchedule}
            >
              <Ban size={13} /> Cancel schedule
            </Button>
          </div>
        ) : post.post_url ? (
          <a href={post.post_url} target="_blank" rel="noreferrer" className="btn-primary w-full !py-2 text-xs justify-center">
            View live <ExternalLink size={13} />
          </a>
        ) : undefined
      }
      onClose={onClose}
      hasPrev={hasPrev}
      hasNext={hasNext}
      onPrev={onPrev}
      onNext={onNext}
    />
  )
}

export default function Publishing() {
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')
  const [readyPreviewIndex, setReadyPreviewIndex] = useState<number | null>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  // n8n answers the webhook immediately and does the real work asynchronously, so there is a
  // gap between "fired" and "row exists". Realtime closes it on its own now; this flag only
  // tells the user something is in flight during that gap.
  const [awaitingSync, setAwaitingSync] = useState(false)

  const { data: profile, isLoading: profileLoading } = useProfile()
  const { data: items = [] } = useApprovedItems(profile?.id)
  const { data: posts = [] } = useScheduledPosts(profile?.id)

  // Clear the in-flight flag as soon as Realtime delivers a change (the lists are re-rendered
  // from freshly invalidated cache at that point).
  useEffect(() => {
    if (!awaitingSync) return
    const t = setTimeout(() => setAwaitingSync(false), 15_000) // safety net if nothing arrives
    return () => clearTimeout(t)
  }, [awaitingSync])
  useEffect(() => { setAwaitingSync(false) }, [posts, items])

  if (profileLoading) {
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
        {awaitingSync && (
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
          footer={<ReadyPreviewActions item={readyItem} onDone={() => { setReadyPreviewIndex(null); setAwaitingSync(true) }} />}
          onClose={() => setReadyPreviewIndex(null)}
          hasPrev={(readyPreviewIndex ?? 0) > 0}
          hasNext={(readyPreviewIndex ?? 0) < items.length - 1}
          onPrev={() => setReadyPreviewIndex((i) => (i !== null ? i - 1 : i))}
          onNext={() => setReadyPreviewIndex((i) => (i !== null ? i + 1 : i))}
        />
      )}

      {activePost && (
        <ActivityPreviewModal
          post={activePost}
          onClose={() => setPreviewIndex(null)}
          onChanged={() => setAwaitingSync(true)}
          hasPrev={(previewIndex ?? 0) > 0}
          hasNext={(previewIndex ?? 0) < filteredPosts.length - 1}
          onPrev={() => setPreviewIndex((i) => (i !== null ? i - 1 : i))}
          onNext={() => setPreviewIndex((i) => (i !== null ? i + 1 : i))}
        />
      )}
    </div>
  )
}
