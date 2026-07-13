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

export const ROLE_ACCENT: Record<Role, string> = {
  admin: 'var(--accent-green)',
  client: 'var(--accent-blue)',
  designer: 'var(--accent-orange)',
}
