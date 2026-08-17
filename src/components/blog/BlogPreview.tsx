import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, Sun, Moon } from 'lucide-react'
import type { BlogSection } from '../../lib/blog'

// Faithful visual clone of the live scalepods.co article page (src/app/blog/[slug]/page.tsx +
// components/ui/BlogBodyClient.tsx in the site repo, read-only reference — see
// docs/blog-module.md). Colors are hardcoded from that repo's src/app/globals.css because this
// is a different app with its own design system (CLAUDE.md brand-kit); the site's tokens don't
// exist here. Keep this in sync if the site's palette or body-markdown rules change.
const SITE_THEME = {
  dark: {
    bgPage: '#04070D', bgCard: '#080A0E', bgCardAlt: '#10131C',
    textBright: '#E4E9F2', textBody: '#B8C7D9', textMuted: '#D5DBE6',
    border: '#222222', blueMid: '#6DB6FF',
  },
  light: {
    bgPage: '#F8FAF7', bgCard: '#FFFFFF', bgCardAlt: '#F1F5F9',
    textBright: '#0B1020', textBody: '#475467', textMuted: '#667085',
    border: '#E2E8F0', blueMid: '#0080FF',
  },
} as const
interface SiteColors {
  bgPage: string; bgCard: string; bgCardAlt: string
  textBright: string; textBody: string; textMuted: string
  border: string; blueMid: string
}

const FONT = "'Inter', 'Satoshi', ui-sans-serif, system-ui, sans-serif"

// Same **bold** / [text](url) split as the site's parseMarkdownInline — anything outside that
// subset (which the composer can't produce anyway, per blogSerializer.ts) won't render specially.
function parseInline(text: string, c: SiteColors): ReactNode[] {
  const parts = text.split(/(\[.*?\]\(.*?\)|\*\*.*?\*\*)/g).filter(Boolean)
  return parts.map((part, i) => {
    const link = part.match(/^\[(.*)\]\((.*)\)$/)
    if (link) {
      // Site-relative links (e.g. cross-links to other posts) resolve against scalepods.co on
      // the live page, not wherever this preview happens to be hosted — qualify them so the
      // preview's links actually go where they'll really go, and open in a new tab so clicking
      // one doesn't navigate away from the editor.
      const href = link[2].startsWith('/') ? `https://www.scalepods.co${link[2]}` : link[2]
      return <a key={i} href={href} target="_blank" rel="noreferrer" style={{ color: c.blueMid, textDecoration: 'underline', fontWeight: 600 }}>{link[1]}</a>
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} style={{ fontWeight: 700, color: c.textBright }}>{part.slice(2, -2)}</strong>
    return part
  })
}

// Line-by-line rules ported from the site's renderBodyContent (BlogBodyClient.tsx) — bullets,
// "Step N"/numbered sub-headers, ✅/💡 highlight callouts, everything else a plain paragraph.
function renderBody(body: string, c: SiteColors) {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.map((line, idx) => {
    const isH3 = line.startsWith('### ') || line.startsWith('## ') || (line.startsWith('**') && line.endsWith('**') && line.length < 90)
    const isBullet = line.startsWith('•') || line.startsWith('- ') || (line.startsWith('* ') && !line.startsWith('**'))
    const isStep = line.startsWith('Step ') || /^\d+\.\s/.test(line) || line.startsWith('💡 Example:') || line.startsWith('✅ Result:')
    const isHighlight = line.startsWith('✅') || line.startsWith('💡')

    if (isH3) {
      const clean = line.replace(/^#{2,3}\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '')
      return <h3 key={idx} style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, color: c.textBright, lineHeight: 1.4, marginTop: 24, marginBottom: 8 }}>{parseInline(clean, c)}</h3>
    }
    if (isBullet) {
      const bulletText = line.replace(/^[•\-*]\s*/, '')
      const colonIdx = bulletText.indexOf(':')
      const headingPart = colonIdx !== -1 ? bulletText.slice(0, colonIdx) : null
      const rest = colonIdx !== -1 ? bulletText.slice(colonIdx + 1) : bulletText
      return (
        <div key={idx} style={{ fontFamily: FONT, fontSize: 16, color: c.textBody, lineHeight: 1.8, paddingLeft: 16, display: 'flex', gap: 8 }}>
          <span style={{ color: c.blueMid }}>•</span>
          <span>{headingPart && <strong style={{ color: c.textBright, fontWeight: 700 }}>{headingPart}:</strong>}{parseInline(rest, c)}</span>
        </div>
      )
    }
    if (isHighlight) {
      return (
        <div key={idx} style={{
          display: 'flex', justifyContent: 'center', textAlign: 'center', margin: '24px auto', maxWidth: 680,
          background: `rgba(109,182,255,0.04)`, borderWidth: '1px 1px 1px 4px', borderStyle: 'solid',
          borderColor: `rgba(109,182,255,0.15) rgba(109,182,255,0.15) rgba(109,182,255,0.15) ${c.blueMid}`,
          borderRadius: 12, padding: '20px 28px', fontFamily: FONT, fontSize: 15, color: c.textBright, fontStyle: 'italic', lineHeight: 1.7,
        }}>{parseInline(line, c)}</div>
      )
    }
    if (isStep) {
      return <h3 key={idx} style={{ fontFamily: FONT, fontSize: 18, fontWeight: 600, color: c.textBright, lineHeight: 1.4, marginTop: 16, marginBottom: 4 }}>{parseInline(line, c)}</h3>
    }
    return <p key={idx} style={{ fontFamily: FONT, fontSize: 16, color: c.textBody, lineHeight: 1.8, margin: 0, textAlign: 'justify' }}>{parseInline(line, c)}</p>
  })
}

export function BlogPreviewModal({
  title, category, excerpt, bannerUrlDark, bannerUrlLight, sections, onClose,
}: {
  title: string
  category: string
  excerpt: string
  bannerUrlDark: string | null
  bannerUrlLight: string | null
  sections: BlogSection[]
  onClose: () => void
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const c = SITE_THEME[theme]
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  // Same fallback rule as blog.ts's resolveFallbackBanner — show whichever variant exists for
  // the toggled theme, or the other one if only one was uploaded.
  const bannerUrl = theme === 'dark' ? (bannerUrlDark ?? bannerUrlLight) : (bannerUrlLight ?? bannerUrlDark)

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ background: '#000' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-white text-sm">
          <span className="font-medium">Preview</span>
          <span className="opacity-60 text-xs">— how this looks on scalepods.co (post-level CTA fields aren't rendered by the live site today)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            className="h-8 w-8 rounded-full flex items-center justify-center text-white"
            style={{ background: 'rgba(255,255,255,0.12)' }}
            aria-label="Toggle preview theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.12)' }} aria-label="Close preview">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ background: c.bgPage }} onClick={(e) => e.stopPropagation()}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '64px 24px 96px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <span style={{ fontFamily: FONT, fontSize: 13, color: c.textMuted }}>{today}</span>
            <span style={{
              fontFamily: FONT, fontSize: 11, fontWeight: 600, color: c.textBright, padding: '4px 12px',
              borderRadius: 6, background: c.bgCardAlt, border: `1px solid ${c.border}`, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>{category || 'Article'}</span>
          </div>

          <h1 style={{ fontFamily: FONT, fontSize: 'clamp(32px, 4vw, 56px)', fontWeight: 700, color: c.textBright, lineHeight: 1.1, marginBottom: 24, letterSpacing: '-0.02em' }}>
            {title || 'Untitled post'}
          </h1>

          {excerpt && <p style={{ fontFamily: FONT, fontSize: 18, color: c.textMuted, lineHeight: 1.6, marginBottom: 40 }}>{excerpt}</p>}

          <div style={{ height: 1, background: c.border, marginBottom: 40 }} />

          {bannerUrl && (
            <div style={{ width: '100%', borderRadius: 16, overflow: 'hidden', marginBottom: 64, border: `1px solid ${c.border}` }}>
              <img src={bannerUrl} alt={title} style={{ width: '100%', height: 'auto', display: 'block' }} />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 56 }}>
            {sections.length === 0 && (
              <p style={{ fontFamily: FONT, color: c.textMuted, fontStyle: 'italic' }}>Nothing written yet.</p>
            )}
            {sections.map((s, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                {s.heading && (
                  <h2 style={{ fontFamily: FONT, fontSize: 24, fontWeight: 700, color: c.textBright, marginBottom: 18, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                    {s.heading}
                  </h2>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {renderBody(s.body, c)}
                </div>
                {(() => {
                  // Same rule as the site's own section image render: an explicit `image`
                  // always wins; otherwise pick by theme when both variants exist.
                  const sectionImg = s.image ?? (theme === 'dark' ? s.imageDark : s.imageLight)
                  if (!sectionImg) return null
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', marginTop: 12, marginBottom: 24 }}>
                      <div style={{ width: '100%', borderRadius: 12, overflow: 'hidden', border: `1px solid ${c.border}` }}>
                        <img src={sectionImg} alt={s.imageCaption || s.heading} style={{ width: '100%', height: 'auto', objectFit: 'cover', display: 'block' }} />
                      </div>
                      {s.imageCaption && (
                        <span style={{ fontFamily: FONT, fontSize: 13, color: c.textMuted, textAlign: 'center', fontStyle: 'italic' }}>{s.imageCaption}</span>
                      )}
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
