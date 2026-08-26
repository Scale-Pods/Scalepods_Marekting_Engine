// Theme + role helpers. Both persist to localStorage (single-account, three role
// views — mirrors the Victory Growth OS pattern).

export type Theme = 'dark' | 'light'
export type Role = 'admin' | 'client' | 'designer'

const THEME_KEY = 'sp-theme'
const ROLE_KEY = 'sp-role'

// Theme used to persist across visits (saved to localStorage, read back here). Every fresh
// load/reload/login now always starts dark regardless of what was chosen before — getTheme()
// is the boot-time default (called once in main.tsx before React even renders, so this is what
// decides the very first paint), so it no longer consults localStorage at all.
export function getTheme(): Theme {
  return 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

// Reads the *live* DOM state rather than getTheme()'s fixed boot default. Login/AppShell/
// Settings each mount their own theme state independently, and signing in navigates from
// Login to AppShell client-side (no full reload) — if a component seeded itself from getTheme()
// after a mid-session toggle, it'd show the wrong Sun/Moon icon even though the page itself
// stayed on whatever the user actually picked. This is what those components should read
// instead, so toggling stays consistent across that navigation within one visit.
export function getCurrentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export function toggleTheme(): Theme {
  const next: Theme = getCurrentTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

export function getRole(): Role {
  const r = localStorage.getItem(ROLE_KEY)
  return r === 'client' || r === 'designer' ? r : 'admin'
}

export function setRole(role: Role) {
  localStorage.setItem(ROLE_KEY, role)
}

// --- Composer draft ---------------------------------------------------------
// The Create post modal closes on any backdrop click or X with no dirty check, which used to
// throw away everything typed (and orphan an uploaded image). Persist it so an accidental
// dismiss is recoverable. localStorage, not a server cache: this is a per-browser,
// per-in-progress-edit concern that has to survive a full page navigation.

const DRAFT_KEY = 'sp-composer-draft'

export interface ComposerDraft {
  /** One post is created per selected platform, all sharing the same media — cross-posting an
   *  image/carousel/video to multiple platforms at once (e.g. Instagram + LinkedIn) instead of
   *  building each one separately. PDF and Story stay single-platform (no cross-platform
   *  equivalent for either), so this only ever has >1 entry for image/carousel/video posts. */
  platforms: string[]
  linkedinAccount: string
  /** Off by default: the same caption/hashtags go to every selected platform. On: each platform
   *  gets its own editable caption+hashtags, seeded from the shared one when first switched on. */
  perPlatformCaption: boolean
  captionOverrides: Record<string, { caption: string; hashtagsInput: string }>
  /** One or more uploaded image URLs, in order. >1 on linkedin/instagram means a carousel — see
   *  CreatePostModal. Superseded the old single `mediaUrl` field; drafts saved before that
   *  change are migrated on restore (see CreatePostModal). */
  images: string[]
  /** 'video' switches the composer to a single uploaded video instead of the image(s) above —
   *  Facebook only today (a plain video post; Reels come later). Older drafts have no value here
   *  and default to 'image' on restore. 'pdf' is LinkedIn-only: a single PDF posted as a native
   *  LinkedIn Document post (the actual API mechanism behind what people call "LinkedIn PDF
   *  carousels" — a swipeable page-by-page viewer, distinct from the multi-image carousel above). */
  mediaKind: 'image' | 'video' | 'pdf'
  videoUrl: string | null
  pdfUrl: string | null
  /** 'story' posts as a Story instead of a feed post — Instagram only today, and only for a
   *  single image (carousels/video aren't story-eligible in this composer yet). Older drafts
   *  default to 'feed' on restore. */
  postFormat: 'feed' | 'story'
  caption: string
  hashtagsInput: string
  cta: string
  /** Per-post comment-to-DM automation (Instagram only) — see CommentAutomation in content.ts.
   *  Older drafts have no value here and default to disabled/empty on restore. */
  commentAutomationEnabled: boolean
  commentKeyword: string
  commentDmMessage: string
  commentAssetUrl: string
  /** Follow-gate sub-config, nested under comment automation — see FollowGate in content.ts.
   *  Older drafts have no value here and default to disabled/blank on restore. */
  followGateEnabled: boolean
  followGateMessage: string
  followGateButtonText: string
  followGateNotFollowingMessage: string
  when: 'now' | 'date'
  scheduledDate: string
  scheduledTime: string
  savedAt: string
}

/** Pre-carousel draft shape, kept only to migrate anything already sitting in localStorage. */
interface LegacyComposerDraft extends Omit<ComposerDraft, 'images' | 'platforms' | 'perPlatformCaption' | 'captionOverrides' | 'commentAutomationEnabled' | 'commentKeyword' | 'commentDmMessage' | 'commentAssetUrl' | 'followGateEnabled' | 'followGateMessage' | 'followGateButtonText' | 'followGateNotFollowingMessage'> {
  mediaUrl: string | null
  /** Pre-multi-platform drafts had a single `platform` string instead of `platforms: string[]`. */
  platform?: string
}

export function getComposerDraft(): ComposerDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as (ComposerDraft & { platform?: string }) | LegacyComposerDraft
    const images = 'images' in d ? d.images : d.mediaUrl ? [d.mediaUrl] : []
    const platforms = 'platforms' in d && Array.isArray(d.platforms) && d.platforms.length ? d.platforms : d.platform ? [d.platform] : ['instagram']
    // Only offer to restore something with actual content in it.
    if (!(d.caption || images.length || d.hashtagsInput || d.cta)) return null
    return {
      ...d,
      images,
      platforms,
      perPlatformCaption: 'perPlatformCaption' in d ? d.perPlatformCaption : false,
      captionOverrides: 'captionOverrides' in d ? d.captionOverrides : {},
      commentAutomationEnabled: 'commentAutomationEnabled' in d ? d.commentAutomationEnabled : false,
      commentKeyword: 'commentKeyword' in d ? d.commentKeyword : '',
      commentDmMessage: 'commentDmMessage' in d ? d.commentDmMessage : '',
      commentAssetUrl: 'commentAssetUrl' in d ? d.commentAssetUrl : '',
      followGateEnabled: 'followGateEnabled' in d ? d.followGateEnabled : false,
      followGateMessage: 'followGateMessage' in d ? d.followGateMessage : '',
      followGateButtonText: 'followGateButtonText' in d ? d.followGateButtonText : '',
      followGateNotFollowingMessage: 'followGateNotFollowingMessage' in d ? d.followGateNotFollowingMessage : '',
    }
  } catch {
    return null
  }
}

export function saveComposerDraft(draft: Omit<ComposerDraft, 'savedAt'>) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: new Date().toISOString() }))
  } catch {
    // Storage full or blocked (private mode) — a lost draft is not worth breaking the composer.
  }
}

export function clearComposerDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // ignore
  }
}

export const ROLE_ACCENT: Record<Role, string> = {
  admin: 'var(--accent-green)',
  client: 'var(--accent-blue)',
  designer: 'var(--accent-orange)',
}
