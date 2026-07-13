import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, BrainCircuit, TrendingUp, Target, Sparkles,
  CheckSquare, CalendarDays, Send, BarChart3, Settings, Sun, Moon, LogOut, ChevronDown,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
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

export default function AppShell({ children }: { children: ReactNode }) {
  const { role, setRole, signOut } = useAuth()
  const [theme, setTheme] = useState<Theme>(getTheme())
  const [roleOpen, setRoleOpen] = useState(false)
  const navigate = useNavigate()

  const logo = theme === 'dark' ? '/brand/logo-white.png' : '/brand/logo-black.png'
  const items = NAV.filter((n) => n.roles.includes(role))

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-line bg-card/40 flex flex-col sticky top-0 h-screen">
        <div className="p-5 border-b border-line">
          <div className="inline-flex items-center rounded-lg px-3 py-2 bg-white/5 dark:bg-white/5">
            <img src={logo} alt="ScalePods" className="h-6" />
          </div>
          <div className="badge mt-3"><Sparkles size={12} /> Growth OS</div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-sage/12 text-sage font-medium'
                    : 'text-secondary hover:bg-panel hover:text-ink'
                }`
              }
            >
              {n.icon}
              {n.label}
            </NavLink>
          ))}
        </nav>

        {/* Role switcher + theme + signout */}
        <div className="p-3 border-t border-line space-y-2">
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
