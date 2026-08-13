import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, BrainCircuit, TrendingUp, Target, Sparkles,
  CheckSquare, CalendarDays, Send, BarChart3, Settings, Sun, Moon, LogOut, ChevronDown,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useRealtimeSync, useNavCounts } from '../lib/queries'
import NotificationBell from './NotificationBell'
import { toggleTheme, getTheme, type Theme, type Role, ROLE_ACCENT } from '../lib/theme'

type NavItem = { to: string; label: string; icon: ReactNode; roles: Role[] }

// Grouped the same way as the "Marketing engine" / "Insight" section split — Analytics,
// Intelligence, and Settings read/interpret data the engine produces rather than driving the
// pipeline itself.
const NAV_GROUPS: { section: string; items: NavItem[] }[] = [
  {
    section: 'Marketing Engine',
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} />, roles: ['admin', 'client', 'designer'] },
      { to: '/clients', label: 'Business', icon: <Building2 size={18} />, roles: ['admin'] },
      { to: '/trends', label: 'Trends', icon: <TrendingUp size={18} />, roles: ['admin', 'client'] },
      { to: '/strategy', label: 'Strategy', icon: <Target size={18} />, roles: ['admin', 'client'] },
      { to: '/content', label: 'Content Factory', icon: <Sparkles size={18} />, roles: ['admin'] },
      { to: '/review', label: 'Creative Review', icon: <CheckSquare size={18} />, roles: ['admin', 'client', 'designer'] },
      { to: '/calendar', label: 'Calendar', icon: <CalendarDays size={18} />, roles: ['admin', 'client'] },
      { to: '/publishing', label: 'Publishing', icon: <Send size={18} />, roles: ['admin'] },
    ],
  },
  {
    section: 'Insight',
    items: [
      { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={18} />, roles: ['admin', 'client'] },
      { to: '/intelligence', label: 'Intelligence', icon: <BrainCircuit size={18} />, roles: ['admin', 'client'] },
      { to: '/settings', label: 'Settings', icon: <Settings size={18} />, roles: ['admin'] },
    ],
  },
]

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', client: 'Client', designer: 'Designer' }

// Live count badges shown next to a nav item — path → which counter to read.
const NAV_COUNT: Record<string, 'profiles' | 'pendingReview'> = {
  '/clients': 'profiles',
  '/review': 'pendingReview',
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, role, setRole, signOut } = useAuth()
  const [theme, setTheme] = useState<Theme>(getTheme())
  const [roleOpen, setRoleOpen] = useState(false)
  const navigate = useNavigate()

  const logo = theme === 'dark' ? '/brand/logo-white.png' : '/brand/logo-black.png'
  const initials = (user?.email || 'U').slice(0, 2).toUpperCase()

  // One Realtime subscription for the whole authenticated session — every page's queries
  // invalidate off it, which is what replaces the per-page polling.
  useRealtimeSync()
  const { data: counts = { profiles: 0, pendingReview: 0 } } = useNavCounts()

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="sidebar w-64 shrink-0 flex flex-col sticky top-0 h-screen">
        <div className="p-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <img src={logo} alt="ScalePods" className="h-7" />
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((n) => n.roles.includes(role))
            if (items.length === 0) return null
            return (
              <div key={group.section}>
                <div className="text-muted text-[10px] font-semibold uppercase tracking-wide px-3 mb-1.5">
                  {group.section}
                </div>
                <div className="space-y-1">
                  {items.map((n) => {
                    const countKey = NAV_COUNT[n.to]
                    const count = countKey ? counts[countKey] : 0
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        end={n.to === '/'}
                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                      >
                        {n.icon}
                        <span className="flex-1">{n.label}</span>
                        {count > 0 && (
                          <span
                            className="text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
                            style={{ background: 'var(--accent-orange)', color: '#fff' }}
                          >
                            {count}
                          </span>
                        )}
                      </NavLink>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Role switcher (single-login demo — switches which workspace view is active) */}
        <div className="p-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="relative">
            <button
              onClick={() => setRoleOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg panel text-sm"
            >
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: ROLE_ACCENT[role] }} />
                {ROLE_LABEL[role]}
              </span>
              <ChevronDown size={15} className={`transition-transform ${roleOpen ? 'rotate-180' : ''}`} />
            </button>
            {roleOpen && (
              <div className="absolute bottom-full mb-2 w-full card p-1 z-10">
                {(['admin', 'client', 'designer'] as Role[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setRole(r)
                      setRoleOpen(false)
                      navigate('/')
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-panel text-left"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: ROLE_ACCENT[r] }} />
                    {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar — identity + theme + sign-out. No decorative search box: this app has no
            real search endpoint yet, and a non-functional input is worse than none. */}
        <div
          className="flex items-center gap-3 px-8 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex-1" />
          <NotificationBell />
          <button onClick={() => setTheme(toggleTheme())} className="btn-ghost !p-2.5" aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <div className="flex items-center gap-2.5">
            <div className="text-right leading-tight hidden sm:block">
              <div className="text-sm font-medium truncate max-w-[180px]">{user?.email}</div>
              <span className="text-muted text-[11px] capitalize">{ROLE_LABEL[role]}</span>
            </div>
            <div
              className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 text-white"
              style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-green))' }}
            >
              {initials}
            </div>
          </div>
          <button onClick={signOut} className="btn-ghost !p-2.5" aria-label="Sign out" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>

        <main className="flex-1 min-w-0">
          {/* Fluid up to a generous cap — fills real monitor width instead of leaving dead
              gutters (was a fixed max-w-6xl/1152px regardless of viewport), but still centers
              with a ceiling so prose/cards don't stretch edge-to-edge on ultra-wide displays. */}
          <div className="max-w-[1680px] mx-auto p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
