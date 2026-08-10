import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, BrainCircuit, TrendingUp, Target, Sparkles,
  CheckSquare, CalendarDays, Send, BarChart3, Settings, Sun, Moon, LogOut, ChevronDown,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { toggleTheme, getTheme, type Theme, type Role, ROLE_ACCENT } from '../lib/theme'

type NavItem = { to: string; label: string; icon: ReactNode; roles: Role[] }

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} />, roles: ['admin', 'client', 'designer'] },
  { to: '/clients', label: 'Business', icon: <Building2 size={18} />, roles: ['admin'] },
  { to: '/intelligence', label: 'Intelligence', icon: <BrainCircuit size={18} />, roles: ['admin', 'client'] },
  { to: '/trends', label: 'Trends', icon: <TrendingUp size={18} />, roles: ['admin', 'client'] },
  { to: '/strategy', label: 'Strategy', icon: <Target size={18} />, roles: ['admin', 'client'] },
  { to: '/content', label: 'Content Factory', icon: <Sparkles size={18} />, roles: ['admin'] },
  { to: '/review', label: 'Creative Review', icon: <CheckSquare size={18} />, roles: ['admin', 'client', 'designer'] },
  { to: '/calendar', label: 'Calendar', icon: <CalendarDays size={18} />, roles: ['admin', 'client'] },
  { to: '/publishing', label: 'Publishing', icon: <Send size={18} />, roles: ['admin'] },
  { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={18} />, roles: ['admin', 'client'] },
  { to: '/settings', label: 'Settings', icon: <Settings size={18} />, roles: ['admin'] },
]

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', client: 'Client', designer: 'Designer' }

// Live count badges shown next to a nav item — path → which counter to read.
const NAV_COUNT: Record<string, 'profiles' | 'pendingReview'> = {
  '/clients': 'profiles',
  '/review': 'pendingReview',
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { role, setRole, signOut } = useAuth()
  const [theme, setTheme] = useState<Theme>(getTheme())
  const [roleOpen, setRoleOpen] = useState(false)
  const [counts, setCounts] = useState({ profiles: 0, pendingReview: 0 })
  const navigate = useNavigate()

  const logo = theme === 'dark' ? '/brand/logo-white.png' : '/brand/logo-black.png'
  const items = NAV.filter((n) => n.roles.includes(role))

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [profilesRes, reviewRes] = await Promise.all([
        supabase.from('business_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('content_items').select('id', { count: 'exact', head: true }).in('status', ['ready', 'revision']),
      ])
      if (!cancelled) setCounts({ profiles: profilesRes.count ?? 0, pendingReview: reviewRes.count ?? 0 })
    }
    load()
    const interval = setInterval(load, 60000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="sidebar w-64 shrink-0 flex flex-col sticky top-0 h-screen">
        <div className="p-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <img src={logo} alt="ScalePods" className="h-9" />
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
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
        </nav>

        {/* Role switcher + theme + signout */}
        <div className="p-3 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
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

          <div className="flex gap-2">
            <button
              onClick={() => setTheme(toggleTheme())}
              className="btn-ghost flex-1 !py-2"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={signOut} className="btn-ghost !py-2" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto p-8">{children}</div>
      </main>
    </div>
  )
}
