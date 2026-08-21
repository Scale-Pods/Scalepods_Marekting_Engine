import { useEffect, useState } from 'react'
import { Send, Clock, Loader2, Link2 } from 'lucide-react'
import { useProfile, useApprovedItems, useScheduledPosts } from '../lib/queries'
import { PageHeader, Badge, EmptyState, Spinner } from '../components/ui'
import { PostTile, PostPreviewModal, ActivityPreviewModal, ReadyPreviewActions, ContentTypeChip, STATUS_META } from '../components/postPreview'

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
          {items.map((item, i) => {
            // Cross-posted from one composer save (e.g. Instagram + LinkedIn at once) share a
            // group id — count siblings still sitting in this same list so the tile can show
            // "posted together" instead of looking like an unrelated duplicate.
            const groupId = item.metadata?.crosspost_group_id
            const groupSize = groupId ? items.filter((x) => x.metadata?.crosspost_group_id === groupId).length : 1
            return (
              <PostTile
                key={item.id}
                img={item.media_url}
                platform={item.platform}
                placeholder={item.title || item.body?.slice(0, 80)}
                topRight={<ContentTypeChip type={item.content_type} />}
                bottomLeft={
                  groupSize > 1 ? (
                    <span
                      className="flex items-center gap-1 text-[10px] font-semibold text-white rounded-full px-1.5 py-0.5"
                      style={{ background: 'rgba(0,0,0,0.6)' }}
                      title={`Posted together with ${groupSize - 1} other platform${groupSize > 2 ? 's' : ''}`}
                    >
                      <Link2 size={10} /> {groupSize}
                    </span>
                  ) : undefined
                }
                onClick={() => setReadyPreviewIndex(i)}
              />
            )
          })}
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
          img={readyItem.media_url || readyItem.metadata?.slides?.[0]?.url || null}
          slides={readyItem.metadata?.slides}
          hashtags={readyItem.metadata?.hashtags}
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
