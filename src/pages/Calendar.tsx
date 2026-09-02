import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Wand2 } from 'lucide-react'
import { useProfile, useCalendarItems, useScheduledPosts } from '../lib/queries'
import type { ContentItem, ContentStatus } from '../lib/content'
import { PageHeader, Badge, Button, EmptyState, Spinner, Modal } from '../components/ui'
import { PlatformBadge } from '../components/mediaUi'
import {
  PostTile, PostPreviewModal, ActivityPreviewModal, ReadyPreviewActions, ContentTypeChip, STATUS_META,
} from '../components/postPreview'
import type { ScheduledPost } from '../lib/publishing'
import CreatePostModal from '../components/CreatePostModal'

// Tone for content_items that haven't reached scheduled_posts yet — the pipeline stages, not
// the publish outcome (that's STATUS_META, imported above, once a scheduled_posts row exists).
const ITEM_STATUS_TONE: Record<ContentStatus, 'green' | 'blue' | 'orange' | 'grey'> = {
  pending: 'grey', generating: 'grey', ready: 'blue', in_review: 'blue',
  approved: 'blue', revision: 'orange', failed: 'orange',
  published: 'green', scheduled: 'green', publishing: 'blue',
}

const TONE_DOT: Record<'green' | 'blue' | 'orange' | 'grey', string> = {
  green: 'var(--accent-green)',
  blue: 'var(--accent-blue)',
  orange: 'var(--accent-orange)',
  grey: 'var(--text-muted)',
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toDateKey(d: Date) {
  // Local calendar date, not UTC — a post scheduled for 11pm local shouldn't jump to the next
  // day's cell just because toISOString() converts to UTC first.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  return toDateKey(new Date(iso))
}

/** One entry on a day cell — either a real scheduled_posts row (accurate status/time) or a
 *  content_item that hasn't been scheduled yet (still just carrying a target date). */
type DayEntry =
  | { kind: 'post'; key: string; dateKey: string; post: ScheduledPost }
  | { kind: 'item'; key: string; dateKey: string; item: ContentItem }

function buildEntries(items: ContentItem[], posts: ScheduledPost[]): Map<string, DayEntry[]> {
  const byDate = new Map<string, DayEntry[]>()
  const scheduledItemIds = new Set<string>()

  for (const post of posts) {
    const dateKey = dateKeyOf(post.scheduled_time) ?? dateKeyOf(post.published_at) ?? dateKeyOf(post.created_at)
    if (!dateKey) continue
    scheduledItemIds.add(post.content_item_id)
    const entry: DayEntry = { kind: 'post', key: `p-${post.id}`, dateKey, post }
    byDate.set(dateKey, [...(byDate.get(dateKey) ?? []), entry])
  }

  for (const item of items) {
    // Already represented above via its scheduled_posts row (with the more accurate date) —
    // showing it again here from content_items' possibly-stale scheduled_date would duplicate it.
    if (scheduledItemIds.has(item.id)) continue
    if (!item.scheduled_date) continue
    const dateKey = item.scheduled_date.slice(0, 10)
    const entry: DayEntry = { kind: 'item', key: `i-${item.id}`, dateKey, item }
    byDate.set(dateKey, [...(byDate.get(dateKey) ?? []), entry])
  }

  return byDate
}

// Compact one-line row — what actually fits inside a ~104px day cell in the month grid.
function DayChip({ entry, onClick }: { entry: DayEntry; onClick: () => void }) {
  const platform = entry.kind === 'post' ? entry.post.platform : entry.item.platform
  const tone = entry.kind === 'post' ? (STATUS_META[entry.post.status] ?? STATUS_META.pending).tone : ITEM_STATUS_TONE[entry.item.status]
  const label = entry.kind === 'post'
    ? entry.post.title || entry.post.caption || `${entry.post.platform} post`
    : entry.item.title || entry.item.body || `${entry.item.platform} post`

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-1.5 rounded px-1.5 py-1 text-left transition-colors hover:brightness-110"
      style={{ background: 'var(--fill-secondary)', borderLeft: `2.5px solid ${TONE_DOT[tone]}` }}
    >
      <span className="shrink-0 leading-none" style={{ fontSize: 11 }}>
        <PlatformBadge platform={platform} size="sm" />
      </span>
      <span className="truncate text-[11px] text-secondary leading-none">{label}</span>
    </button>
  )
}

// Full image tile — the same square thumbnail grid Creative Review/Publishing use, for the
// "view this whole day" modal where there's room to actually show the creative instead of just
// a line of text.
function DayTile({ entry, onClick }: { entry: DayEntry; onClick: () => void }) {
  if (entry.kind === 'post') {
    const meta = STATUS_META[entry.post.status] ?? STATUS_META.pending
    const Icon = meta.icon
    return (
      <PostTile
        img={entry.post.media_url}
        platform={entry.post.platform}
        placeholder={entry.post.title || entry.post.caption?.slice(0, 80)}
        topRight={
          <Icon
            size={14}
            className={`text-white ${entry.post.status === 'publishing' || entry.post.status === 'pending' ? 'animate-spin' : ''}`}
            style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.7))' }}
          />
        }
        onClick={onClick}
      />
    )
  }
  return (
    <PostTile
      img={entry.item.media_url}
      platform={entry.item.platform}
      placeholder={entry.item.title || entry.item.body?.slice(0, 80)}
      topRight={<ContentTypeChip type={entry.item.content_type} />}
      onClick={onClick}
    />
  )
}

export default function Calendar() {
  const { data: profile, isLoading: profileLoading } = useProfile()
  const { data: items = [] } = useCalendarItems(profile?.id)
  const { data: posts = [] } = useScheduledPosts(profile?.id)

  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [createDate, setCreateDate] = useState<string | undefined>(undefined)
  const [dayListKey, setDayListKey] = useState<string | null>(null)
  const [activePost, setActivePost] = useState<ScheduledPost | null>(null)
  const [activeItem, setActiveItem] = useState<ContentItem | null>(null)

  const entriesByDate = useMemo(() => buildEntries(items, posts), [items, posts])

  const todayKey = toDateKey(new Date())

  // Sunday-start 6-week grid, padded with the trailing days of the previous month and the
  // leading days of the next — the standard month-calendar layout, and it means real posts
  // scheduled in the first/last week of a month are never cut off from view.
  const gridDays = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const startOffset = first.getDay()
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - startOffset)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      return d
    })
  }, [cursor])

  function openCreate(dateKey?: string) {
    setCreateDate(dateKey)
    setCreateOpen(true)
  }

  function onEntryClick(entry: DayEntry) {
    if (entry.kind === 'post') setActivePost(entry.post)
    else setActiveItem(entry.item)
  }

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
        <PageHeader accent={<Badge><CalendarDays size={12} /> Calendar</Badge>} title="Calendar" />
        <EmptyState icon={<CalendarDays size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const dayListEntries = dayListKey ? (entriesByDate.get(dayListKey) ?? []) : []

  return (
    <div>
      <PageHeader
        accent={<Badge><CalendarDays size={12} /> Calendar</Badge>}
        title={`Calendar — ${profile.business_name}`}
        subtitle="Every post with a target date — draft, ready, scheduled, or published. Click a day to add one, click a post to view or schedule it."
        actions={
          <div className="flex items-center gap-2">
            <Link to="/studio" className="btn-ghost">
              <Wand2 size={15} /> Create Post
            </Link>
            <Button onClick={() => openCreate()}>
              <Plus size={15} /> Publish Now
            </Button>
          </div>
        }
      />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" className="!px-0 w-8 h-8 !py-0" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))} aria-label="Previous month">
            <ChevronLeft size={16} />
          </Button>
          <Button variant="ghost" className="!px-0 w-8 h-8 !py-0" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))} aria-label="Next month">
            <ChevronRight size={16} />
          </Button>
          <Button variant="ghost" className="ml-1 !py-1.5 text-xs" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d) }}>
            Today
          </Button>
        </div>
        <div className="font-medium">{monthLabel}</div>
      </div>

      {/* One frosted glass slab for the whole month — the same `.card` liquid-glass material
          used everywhere else in the app, with the day grid drawn on top via hairline dividers
          instead of the old opaque-per-cell trick (which needed solid backgrounds to fake grid
          lines and so covered the blur). A single backdrop-filter here instead of 42 tiny ones
          per cell is also what keeps this cheap to render. */}
      <div className="card overflow-hidden !p-0">
        <div className="grid grid-cols-7">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-center text-[11px] font-semibold text-muted py-2"
              style={{ borderBottom: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)' }}
            >
              {w}
            </div>
          ))}
          {gridDays.map((d) => {
            const dateKey = toDateKey(d)
            const inMonth = d.getMonth() === cursor.getMonth()
            const isToday = dateKey === todayKey
            const dayEntries = entriesByDate.get(dateKey) ?? []
            const visible = dayEntries.slice(0, 3)
            const overflow = dayEntries.length - visible.length

            return (
              <div
                key={dateKey}
                className="group relative flex flex-col gap-1 p-1.5 min-h-[104px] transition-colors hover:bg-white/[0.02]"
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  borderRight: '1px solid var(--border-subtle)',
                  opacity: inMonth ? 1 : 0.4,
                }}
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setDayListKey(dateKey)}
                    className="text-xs font-semibold h-5 w-5 flex items-center justify-center rounded-full transition-colors hover:brightness-110"
                    style={isToday ? { background: 'var(--accent-green)', color: 'var(--cta-text)' } : { color: 'var(--text-secondary)' }}
                    aria-label={`View ${dateKey}`}
                    title="View this day"
                  >
                    {d.getDate()}
                  </button>
                  <button
                    onClick={() => openCreate(dateKey)}
                    className="h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'var(--fill-secondary)' }}
                    aria-label={`Create post for ${dateKey}`}
                    title="Create post for this day"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {visible.map((entry) => (
                    <DayChip key={entry.key} entry={entry} onClick={() => onEntryClick(entry)} />
                  ))}
                  {overflow > 0 && (
                    <button
                      onClick={() => setDayListKey(dateKey)}
                      className="text-[11px] text-muted text-left px-1.5 hover:text-sage transition-colors"
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {createOpen && (
        <CreatePostModal
          profileId={profile.id}
          initialDate={createDate}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setCreateOpen(false)}
        />
      )}

      {dayListKey && (
        <Modal
          title={new Date(`${dayListKey}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          onClose={() => setDayListKey(null)}
          size="lg"
        >
          {dayListEntries.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-3 py-6">
              <CalendarDays size={26} className="text-muted" />
              <div className="text-secondary text-sm">Nothing scheduled for this day yet.</div>
              <Button onClick={() => { setDayListKey(null); openCreate(dayListKey) }}>
                <Plus size={15} /> Create post for this day
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {dayListEntries.map((entry) => (
                <DayTile key={entry.key} entry={entry} onClick={() => { setDayListKey(null); onEntryClick(entry) }} />
              ))}
            </div>
          )}
        </Modal>
      )}

      {activePost && (
        <ActivityPreviewModal
          post={activePost}
          onClose={() => setActivePost(null)}
          onChanged={() => setActivePost(null)}
        />
      )}

      {activeItem && (
        <PostPreviewModal
          img={activeItem.media_url || activeItem.metadata?.slides?.[0]?.url || null}
          slides={activeItem.metadata?.slides}
          hashtags={activeItem.metadata?.hashtags}
          platform={activeItem.platform}
          caption={activeItem.body}
          headerExtra={
            <>
              <Badge tone={ITEM_STATUS_TONE[activeItem.status]} className="capitalize">{activeItem.status.replace(/_/g, ' ')}</Badge>
              <ContentTypeChip type={activeItem.content_type} />
            </>
          }
          footer={
            activeItem.status === 'approved' ? (
              <ReadyPreviewActions item={activeItem} onDone={() => setActiveItem(null)} />
            ) : (
              <Link
                to={['ready', 'in_review', 'revision'].includes(activeItem.status) ? '/review' : '/publishing'}
                onClick={() => setActiveItem(null)}
                className="btn-ghost w-full !py-2 text-xs justify-center"
              >
                {['ready', 'in_review', 'revision'].includes(activeItem.status) ? 'Open in Creative Review' : 'Open in Publishing'}
              </Link>
            )
          }
          onClose={() => setActiveItem(null)}
        />
      )}
    </div>
  )
}
