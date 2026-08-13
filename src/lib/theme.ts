// Theme + role helpers. Both persist to localStorage (single-account, three role
// views — mirrors the Victory Growth OS pattern).

export type Theme = 'dark' | 'light'
export type Role = 'admin' | 'client' | 'designer'

const THEME_KEY = 'sp-theme'
const ROLE_KEY = 'sp-role'

export function getTheme(): Theme {
  const t = localStorage.getItem(THEME_KEY)
  return t === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(THEME_KEY, theme)
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
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
  platform: string
  linkedinAccount: string
  mediaUrl: string | null
  caption: string
  hashtagsInput: string
  cta: string
  when: 'now' | 'date'
  scheduledDate: string
  scheduledTime: string
  savedAt: string
}

export function getComposerDraft(): ComposerDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as ComposerDraft
    // Only offer to restore something with actual content in it.
    return d.caption || d.mediaUrl || d.hashtagsInput || d.cta ? d : null
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
