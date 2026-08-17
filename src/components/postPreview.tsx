import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Eye, X, ChevronLeft, ChevronRight, CheckCircle2, Clock, Loader2, XCircle, Pencil, Ban, Check, ExternalLink, Send } from 'lucide-react'
import { PlatformBadge } from './mediaUi'
import { Badge, Button } from './ui'
import { useToast, toastMessage } from './Toast'
import { cancelScheduledPost, editScheduledPost, triggerPublish, type ScheduledPost } from '../lib/publishing'
import { PUBLISHING_ENABLED, type ContentItem } from '../lib/content'

// Shared building blocks for every "grid of posts -> click through to a native-looking
// preview" surface in the app (Publishing's Ready to publish / Recent activity, Content
// Factory, Creative Review). One visual language, one interaction model, assembled
// per-page with page-specific footer actions/body content.

// Per-type badge tint — ScalePods' own accent tokens rotated across the generic types, plus
// LinkedIn's real brand blue for the one type actually tied to that platform (already used
// this same way in mediaUi.tsx's PlatformBadge — not a new invented color).
export const CONTENT_TYPE_COLOR: Record<string, string> = {
  static_image: 'var(--accent-green)',
  carousel: 'var(--accent-blue)',
  social_caption: 'var(--accent-orange)',
  linkedin_article: '#0A66C2',
  story: 'var(--accent-green)',
  ugc_video: 'var(--accent-orange)',
  motion_graphics: 'var(--accent-blue)',
  product_video: 'var(--accent-green)',
}

export function typeColor(type: string) {
  return CONTENT_TYPE_COLOR[type] ?? 'var(--fill-tertiary)'
}

// Shared status styling for anything backed by a scheduled_posts row — Publishing's "Recent
// activity" and Calendar's post chips both need the exact same label/tone/icon per status, so
// it lives here once rather than drifting between two copies.
export const STATUS_META: Record<string, { label: string; tone: 'green' | 'blue' | 'orange'; icon: typeof CheckCircle2 }> = {
  published: { label: 'Published', tone: 'green', icon: CheckCircle2 },
  scheduled: { label: 'Scheduled', tone: 'blue', icon: Clock },
  publishing: { label: 'Publishing…', tone: 'blue', icon: Loader2 },
  pending: { label: 'Pending', tone: 'blue', icon: Loader2 },
  failed: { label: 'Failed', tone: 'orange', icon: XCircle },
}

export function ContentTypeChip({ type }: { type: string }) {
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white capitalize"
      style={{ background: typeColor(type) }}
    >
      {type.replace(/_/g, ' ')}
    </span>
  )
}

// Renders caption text with #hashtags picked out in accent-blue, the way every real platform
// styles them — small touch that makes the preview read as a native post rather than a form.
export function CaptionText({ text }: { text?: string | null }) {
  if (!text) return null
  const parts = text.split(/(#\w+)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('#') ? (
          <span key={i} style={{ color: 'var(--accent-blue)' }}>{part}</span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

// Square Instagram-grid-style tile — thumbnail-first, minimal chrome. Platform badge sits
// top-left; callers can add a status/type chip top-right and a selection control bottom-left.
// `busyNote` replaces the image entirely (e.g. "Generating image…") and suppresses the
// click-through hover state, since there's nothing to preview yet.
export function PostTile({
  img, placeholder, platform, topRight, bottomLeft, busyNote, onClick,
}: {
  img: string | null
  placeholder?: ReactNode
  platform: string
  topRight?: ReactNode
  bottomLeft?: ReactNode
  busyNote?: ReactNode
  onClick: () => void
}) {
  return (
    <div className="relative aspect-square rounded-lg overflow-hidden group" style={{ background: 'var(--fill-tertiary)' }}>
      <button onClick={onClick} className="absolute inset-0 w-full h-full text-left" disabled={Boolean(busyNote)}>
        {img ? (
          <img src={img} alt="" className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" />
        ) : busyNote ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">{busyNote}</div>
        ) : (
          <div className="w-full h-full flex items-center justify-center p-3 text-center text-xs text-secondary line-clamp-4">
            {placeholder}
          </div>
        )}
        {!busyNote && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-semibold flex items-center gap-1.5">
              <Eye size={14} /> View post
            </span>
          </div>
        )}
      </button>
      <div className="absolute top-1.5 left-1.5 pointer-events-none"><PlatformBadge platform={platform} size="sm" /></div>
      {topRight && <div className="absolute top-1.5 right-1.5 pointer-events-none">{topRight}</div>}
      {bottomLeft && <div className="absolute bottom-1.5 left-1.5">{bottomLeft}</div>}
    </div>
  )
}

// Native post-detail layout — image full-bleed on one side, account/caption/actions panel on
// the other, prev/next between grid items and a floating close — modeled on how Instagram/
// LinkedIn themselves show a single post when you click into it from a grid. Portaled straight
// onto <body> (same reason as the shared Modal: avoids getting scoped by an ancestor's
// backdrop-filter, which would otherwise trap a position:fixed overlay inside a card/panel).
export function PostPreviewModal({
  img, platform, caption, headerExtra, body, footer, mediaFallback,
  onClose, hasPrev, hasNext, onPrev, onNext,
}: {
  img: string | null
  platform: string
  caption?: string | null
  headerExtra?: ReactNode
  body?: ReactNode
  footer?: ReactNode
  mediaFallback?: ReactNode
  onClose: () => void
  hasPrev?: boolean
  hasNext?: boolean
  onPrev?: () => void
  onNext?: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasPrev && onPrev) onPrev()
      else if (e.key === 'ArrowRight' && hasNext && onNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasPrev, hasNext, onClose, onPrev, onNext])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(0,0,0,0.88)' }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-5 right-5 h-10 w-10 rounded-full flex items-center justify-center text-white/80 hover:text-white transition-colors"
        style={{ background: 'rgba(255,255,255,0.1)' }}
        aria-label="Close"
      >
        <X size={20} />
      </button>
      {onPrev && hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev() }}
          className="absolute left-5 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full flex items-center justify-center text-white/80 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.1)' }}
          aria-label="Previous post"
        >
          <ChevronLeft size={22} />
        </button>
      )}
      {onNext && hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext() }}
          className="absolute right-5 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full flex items-center justify-center text-white/80 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.1)' }}
          aria-label="Next post"
        >
          <ChevronRight size={22} />
        </button>
      )}

      <div
        className="flex flex-col md:flex-row w-full max-w-4xl max-h-[85vh] rounded-xl overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Media side */}
        <div className="flex-1 min-w-0 flex items-center justify-center" style={{ background: '#000' }}>
          {img ? (
            <img src={img} alt="" className="max-h-[45vh] md:max-h-[85vh] w-full object-contain" />
          ) : (
            mediaFallback ?? <div className="text-white/60 text-sm p-10 text-center max-w-xs">No image</div>
          )}
        </div>

        {/* Account / caption / actions panel */}
        <div className="w-full md:w-[340px] shrink-0 flex flex-col min-h-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2.5 px-4 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="h-8 w-8 rounded-full shrink-0" style={{ background: 'var(--accent-green)' }} />
            <div className="text-sm font-semibold">scalepods</div>
            <div className="ml-auto flex items-center gap-1.5">
              <PlatformBadge platform={platform} size="sm" />
              {headerExtra}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3.5 max-h-[220px] md:max-h-none space-y-3">
            {caption && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                <span className="font-semibold mr-1.5">scalepods</span>
                <CaptionText text={caption} />
              </p>
            )}
            {body}
          </div>
          {footer && (
            <div className="px-4 py-3.5 space-y-2.5 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Footer actions for a "Ready to publish" preview (an approved content_item with no
// scheduled_posts row yet) — Post now / Schedule, same real pipeline call Publishing has always
// used. Shared with Calendar so a not-yet-scheduled item sitting on a day cell can be scheduled
// right there instead of only from Publishing.
export function ReadyPreviewActions({ item, onDone }: { item: ContentItem; onDone: () => void }) {
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

// Full preview + Edit/Cancel for a scheduled_posts-backed item — shared by Publishing's "Recent
// activity" and Calendar's post chips, so editing/cancelling a schedule behaves identically
// everywhere it can be reached from. Owns its own `editing` state, so it has to be a real
// component instantiated only while a post is selected — a plain helper function called
// conditionally would call useState conditionally too, breaking React's Rules of Hooks the
// moment the modal opens/closes.
export function ActivityPreviewModal({
  post, onClose, onChanged, hasPrev, hasNext, onPrev, onNext,
}: {
  post: ScheduledPost
  onClose: () => void
  onChanged: () => void
  hasPrev?: boolean
  hasNext?: boolean
  onPrev?: () => void
  onNext?: () => void
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
