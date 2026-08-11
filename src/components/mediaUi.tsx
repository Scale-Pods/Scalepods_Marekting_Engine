import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ContentSlide } from '../lib/content'

// ── Platform badge — real brand glyphs + brand colors (ScalePods' 4 platforms only) ──

const IG_GRADIENT = 'linear-gradient(45deg,#feda75 0%,#fa7e1e 25%,#d62976 50%,#962fbf 75%,#4f5bd5 100%)'

function IgGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="6" stroke="#fff" strokeWidth="2" />
      <circle cx="12" cy="12" r="4.4" stroke="#fff" strokeWidth="2" />
      <circle cx="17.6" cy="6.4" r="1.4" fill="#fff" />
    </svg>
  )
}
function FbGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <path d="M13.5 21v-7.9h2.7l.4-3.1h-3.1V8c0-.9.25-1.5 1.55-1.5H17V3.7c-.3 0-1.3-.12-2.45-.12-2.42 0-4.05 1.48-4.05 4.2v2.32H8v3.1h2.5V21z" />
    </svg>
  )
}
function LiGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <path d="M6.94 5a1.94 1.94 0 11-3.88 0 1.94 1.94 0 013.88 0zM3.4 8.4h3.1V21H3.4zM9.1 8.4h2.97v1.72h.04c.41-.78 1.42-1.6 2.93-1.6 3.13 0 3.71 2.06 3.71 4.74V21h-3.1v-5.4c0-1.29-.02-2.95-1.8-2.95-1.8 0-2.07 1.4-2.07 2.85V21H9.1z" />
    </svg>
  )
}
function YtGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <path d="M21.6 7.2s-.2-1.4-.8-2c-.75-.8-1.6-.8-2-.85C16 4.2 12 4.2 12 4.2h0s-4 0-6.8.15c-.4.05-1.25.05-2 .85-.6.6-.8 2-.8 2S2.2 8.8 2.2 10.5v1.6c0 1.7.2 3.3.2 3.3s.2 1.4.8 2c.75.8 1.75.75 2.2.85 1.6.15 6.6.15 6.6.15s4 0 6.8-.15c.4-.05 1.25-.05 2-.85.6-.6.8-2 .8-2s.2-1.6.2-3.3v-1.6c0-1.7-.2-3.3-.2-3.3zM9.9 14.4V8.9l5.15 2.75z" />
    </svg>
  )
}

type PlatformStyle = { bg: string; label: string; glyph?: JSX.Element }
function platformStyle(platform?: string | null): PlatformStyle {
  const p = (platform || '').toLowerCase()
  if (p.includes('instagram') || p === 'ig') return { bg: IG_GRADIENT, label: 'Instagram', glyph: <IgGlyph /> }
  if (p.includes('facebook') || p === 'fb') return { bg: '#1877F2', label: 'Facebook', glyph: <FbGlyph /> }
  if (p.includes('linkedin')) return { bg: '#0A66C2', label: 'LinkedIn', glyph: <LiGlyph /> }
  if (p.includes('youtube')) return { bg: '#FF0000', label: 'YouTube', glyph: <YtGlyph /> }
  return { bg: 'var(--fill-tertiary)', label: platform || '—' }
}

// Instagram + LinkedIn only — matches ACTIVE_PLATFORMS in lib/content.ts. Facebook/YouTube
// generate no content right now, so they're not offered as filter/composer options; their
// PlatformBadge glyphs and Meta Graph publish nodes stay in place for when that changes.
export const PLATFORM_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
]

// Feed-card aspect ratio per platform — shared by CreatePostModal's live preview and
// Publishing's activity-preview modal so "how it looked" always renders consistently.
export const PLATFORM_ASPECT: Record<string, number> = {
  instagram: 1,
  facebook: 1.91,
  linkedin: 1.91,
  youtube: 16 / 9,
}

export function PlatformBadge({ platform, size = 'md' }: { platform?: string | null; size?: 'sm' | 'md' }) {
  const s = platformStyle(platform)
  const neutral = s.bg.startsWith('var(')
  const pad = size === 'sm' ? '2px 8px' : '3px 9px'
  const fs = size === 'sm' ? 10.5 : 11.5
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: pad, borderRadius: 20,
        background: s.bg, color: neutral ? 'var(--text-secondary)' : '#fff',
        fontSize: fs, fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap',
      }}
    >
      {s.glyph}{s.label}
    </span>
  )
}

// Platform-styled post-card preview — shows exactly how a piece of content will look once
// published. IG/FB/LinkedIn get a feed-card treatment; YouTube gets a video-frame treatment
// with a caption overlay. (TikTok/blog intentionally not ported — out of scope per CLAUDE.md.)
// Shared by MediaEditor's crop/filter preview tab and CreatePostModal's composer preview.
//
// `fit` controls how the image fills the frame:
//  - "cover" (default): crops to the platform aspect ratio — right for MediaEditor/composer,
//    where you're actively deciding the crop and the box IS the real output shape.
//  - "contain": shows the whole image at its own natural ratio, letterboxed if needed — right
//    for reviewing an already-published post, where cropping to a guessed aspect can hide part
//    of the real image (e.g. a tall LinkedIn document graphic inside a 1.91:1 box).
export function PlatformMockup({
  platform, img, aspect, caption, fit = 'cover',
}: { platform: string; img: string | null; aspect: number; caption?: string | null; fit?: 'cover' | 'contain' }) {
  const isVideoFrame = platform.toLowerCase() === 'youtube'
  const maxW = fit === 'cover' && aspect < 1 ? Math.round(300 * aspect) : undefined
  return (
    <div
      className="rounded-panel overflow-hidden mx-auto"
      style={{ border: '1px solid var(--border-subtle)', background: isVideoFrame ? '#000' : 'var(--fill-tertiary)', maxWidth: maxW }}
    >
      {!isVideoFrame && (
        <div className="flex items-center gap-2 px-2.5 py-2">
          <div className="h-6 w-6 rounded-full shrink-0" style={{ background: 'var(--accent-green)' }} />
          <div className="text-xs font-semibold">scalepods</div>
          <div className="ml-auto"><PlatformBadge platform={platform} size="sm" /></div>
        </div>
      )}
      <div
        className="relative w-full"
        style={fit === 'cover' ? { aspectRatio: String(aspect), background: 'var(--fill-tertiary)' } : { background: 'var(--fill-tertiary)' }}
      >
        {img ? (
          fit === 'cover' ? (
            <img src={img} alt="preview" className="w-full h-full object-cover block" />
          ) : (
            <img src={img} alt="preview" className="w-full h-auto max-h-[65vh] object-contain block" />
          )
        ) : fit === 'cover' ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted text-xs">Adjust the crop →</div>
        ) : (
          <div className="flex items-center justify-center text-muted text-xs py-16">No image</div>
        )}
        {isVideoFrame && (
          <div className="absolute bottom-2.5 left-2.5 right-2.5 text-white">
            <div className="text-xs font-bold mb-0.5">@scalepods</div>
            {caption && <div className="text-[11px] opacity-90 line-clamp-2">{caption}</div>}
          </div>
        )}
      </div>
      {!isVideoFrame && caption && (
        <div className="px-2.5 py-2">
          <div className="text-secondary text-[11.5px] leading-snug line-clamp-3">{caption}</div>
        </div>
      )}
    </div>
  )
}

export function CarouselViewer({ slides }: { slides: ContentSlide[] }) {
  const [index, setIndex] = useState(0)
  if (!slides || slides.length === 0) return null
  const slide = slides[index]

  return (
    <div className="relative">
      <img src={slide.url} alt={slide.title} className="w-full h-56 object-cover rounded-lg" />
      {slides.length > 1 && (
        <>
          <button
            onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5 text-white hover:bg-black/70"
            aria-label="Previous slide"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setIndex((i) => (i + 1) % slides.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 rounded-full p-1.5 text-white hover:bg-black/70"
            aria-label="Next slide"
          >
            <ChevronRight size={16} />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className="h-1.5 rounded-full transition-all"
                style={{ width: i === index ? 16 : 6, background: i === index ? 'var(--accent-green)' : 'rgba(255,255,255,0.5)' }}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
      {slide.caption && <div className="text-muted text-xs mt-2">{slide.caption}</div>}
    </div>
  )
}
