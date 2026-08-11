import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Eye, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { PlatformBadge } from './mediaUi'

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
