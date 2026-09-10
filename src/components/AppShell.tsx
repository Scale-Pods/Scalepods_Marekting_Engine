import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, BrainCircuit, TrendingUp, Target,
  CheckSquare, CalendarDays, Send, BarChart3, Settings, Sun, Moon, LogOut, ChevronDown, Newspaper,
  PanelLeftClose, PanelLeftOpen, Check, Plus, Clapperboard, Wand2, BookOpen, Film, MessageCircleQuestion, Eye,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useRealtimeSync, useNavCounts, useProfile, useProfiles, useSetActiveProfile } from '../lib/queries'
import NotificationBell from './NotificationBell'
import { toggleTheme, getCurrentTheme, type Theme, type Role, ROLE_ACCENT } from '../lib/theme'
import { initialsOf, ROLE_LABEL as TEAM_ROLE_LABEL, ROLE_ACCENT as TEAM_ROLE_ACCENT } from '../lib/team'

// `external: true` items link off-app (target="_blank") instead of routing internally — `to`
// holds the full URL in that case, and the render loop below branches to a plain <a> for them.
type NavItem = { to: string; label: string; icon: ReactNode; roles: Role[]; external?: boolean }

// SupportAI is a separate tool (no code/API integration on either side) — this is just its
// documented "Add the button in your other tools" link pattern: a plain link to its home page
// with ?source=<toolName> so it knows which tool the user came from. Nothing else changes on
// our side if SupportAI's URL or behavior changes later.
const SUPPORT_AI_URL = 'https://support-ai-woad.vercel.app/?source=scalepods-growth-os'

// Grouped by pipeline stage: Marketing Strategy (plan) -> Content Generation (make) ->
// Publishing Engine (ship) -> Insight (Analytics/Intelligence/Settings read/interpret data the
// engine produces rather than driving the pipeline itself). Dashboard sits above every group,
// ungrouped (empty `section` skips the header render below) — it's the one screen that isn't
// part of any single pipeline stage.
const NAV_GROUPS: { section: string; items: NavItem[] }[] = [
  {
    section: '',
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} />, roles: ['admin', 'client', 'designer'] },
    ],
  },
  {
    section: 'Marketing Strategy',
    items: [
      { to: '/clients', label: 'Business', icon: <Building2 size={18} />, roles: ['admin'] },
      { to: '/trends', label: 'Trends', icon: <TrendingUp size={18} />, roles: ['admin', 'client'] },
      { to: '/strategy', label: 'Strategy', icon: <Target size={18} />, roles: ['admin', 'client'] },
    ],
  },
  {
    section: 'Content Generation',
    items: [
      { to: '/studio', label: 'AI Studio', icon: <Wand2 size={18} />, roles: ['admin'] },
      // Content Factory hidden from nav 2026-09-03 — superseded by AI Studio for now. Route and
      // page are untouched, just not linked from the sidebar; see the "Content Factory" memory.
      { to: '/carousel-studio', label: 'Carousel Studio', icon: <Clapperboard size={18} />, roles: ['admin'] },
      { to: '/video-studio', label: 'Video Studio', icon: <Film size={18} />, roles: ['admin'] },
      { to: '/review', label: 'Creative Review', icon: <CheckSquare size={18} />, roles: ['admin', 'client', 'designer'] },
    ],
  },
  {
    section: 'Publishing Engine',
    items: [
      { to: '/calendar', label: 'Calendar', icon: <CalendarDays size={18} />, roles: ['admin', 'client'] },
      { to: '/publishing', label: 'Publishing', icon: <Send size={18} />, roles: ['admin'] },
      { to: '/blog', label: 'Blog', icon: <Newspaper size={18} />, roles: ['admin', 'client'] },
    ],
  },
  {
    section: 'Insight',
    items: [
      { to: '/analytics', label: 'Analytics', icon: <BarChart3 size={18} />, roles: ['admin', 'client'] },
      { to: '/intelligence', label: 'Intelligence', icon: <BrainCircuit size={18} />, roles: ['admin', 'client'] },
      { to: '/settings', label: 'Settings', icon: <Settings size={18} />, roles: ['admin'] },
      // Every role, unlike the rest of this section — a designer or client landing here for the
      // first time needs the manual more than an admin does.
      { to: '/manual', label: 'User Manual', icon: <BookOpen size={18} />, roles: ['admin', 'client', 'designer'] },
      { to: SUPPORT_AI_URL, label: 'Support AI', icon: <MessageCircleQuestion size={18} />, roles: ['admin', 'client', 'designer'], external: true },
    ],
  },
]

const SIDEBAR_PINNED_KEY = 'sp-sidebar-pinned'

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', client: 'Client', designer: 'Designer' }

// Live count badges shown next to a nav item — path → which counter to read.
const NAV_COUNT: Record<string, 'profiles' | 'pendingReview'> = {
  '/clients': 'profiles',
  '/review': 'pendingReview',
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, appUser, role, setRole, signOut } = useAuth()
  const [theme, setTheme] = useState<Theme>(getCurrentTheme())
  const [roleOpen, setRoleOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const navigate = useNavigate()

  const { data: profile } = useProfile()
  const { data: profiles = [] } = useProfiles()
  const setActiveProfile = useSetActiveProfile()

  // Gmail-style rail: pinned = always the full w-64 sidebar (persisted — this one's worth
  // remembering across visits, unlike theme). Unpinned = a narrow icon-only rail by default
  // that expands on hover and collapses again the moment the cursor leaves it, so the content
  // area gets the width back without needing a click either way.
  const [pinned, setPinned] = useState(() => localStorage.getItem(SIDEBAR_PINNED_KEY) !== 'false')
  const [hovering, setHovering] = useState(false)
  const expanded = pinned || hovering
  useEffect(() => {
    localStorage.setItem(SIDEBAR_PINNED_KEY, String(pinned))
  }, [pinned])

  const logo = theme === 'dark' ? '/brand/logo-white.png' : '/brand/logo-black.png'
  const initials = initialsOf(appUser?.full_name, user?.email)

  // One Realtime subscription for the whole authenticated session — every page's queries
  // invalidate off it, which is what replaces the per-page polling.
  useRealtimeSync()
  const { data: counts = { profiles: 0, pendingReview: 0 } } = useNavCounts(profile?.id)

  return (
    <div className="min-h-screen flex">
      {/* Sidebar — collapses to an icon-only rail when unpinned, expands on hover (Gmail-style)
          and snaps back the moment the cursor leaves. Pinning is what persists; hover-expansion
          itself is deliberately session-only state. */}
      <aside
        className={`sidebar shrink-0 flex flex-col sticky top-0 h-screen overflow-hidden ${expanded ? 'w-64' : 'w-[72px]'}`}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <div
          className={`p-5 flex items-center shrink-0 ${expanded ? 'justify-between' : 'justify-center'}`}
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          {expanded ? (
            <img src={logo} alt="ScalePods" className="h-7 shrink-0" />
          ) : (
            <img src="/brand/icon.png" alt="ScalePods" className="h-7 w-7 object-contain shrink-0" />
          )}
          {expanded && (
            <button
              onClick={() => setPinned((p) => !p)}
              className="text-muted hover:text-ink transition-colors shrink-0"
              aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
              title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
            >
              {pinned ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            </button>
          )}
        </div>

        {/* Profile switcher — which business profile the rest of the app operates on. Sits
            above the nav (the primary context switch, not a page destination) rather than
            next to the demo-only Role switcher at the bottom. */}
        <div className="p-3 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="relative">
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className={`w-full flex items-center rounded-lg panel text-sm ${expanded ? 'justify-between px-3 py-2' : 'justify-center py-2'}`}
              title={expanded ? undefined : (profile?.business_name ?? 'No profile')}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Building2 size={14} className="shrink-0 text-sage" />
                {expanded && <span className="truncate">{profile?.business_name ?? 'No profile'}</span>}
              </span>
              {expanded && <ChevronDown size={15} className={`transition-transform shrink-0 ${profileOpen ? 'rotate-180' : ''}`} />}
            </button>
            {profileOpen && (
              <div className="absolute top-full mt-2 left-0 w-56 card p-1 z-10">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setActiveProfile(p.id)
                      setProfileOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-panel text-left"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: p.id === profile?.id ? 'var(--accent-green)' : 'var(--fill-tertiary)' }}
                    />
                    <span className="truncate flex-1">{p.business_name || 'Untitled business'}</span>
                    {p.id === profile?.id && <Check size={13} className="text-sage shrink-0" />}
                  </button>
                ))}
                <Link
                  to="/clients/new"
                  onClick={() => setProfileOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-panel text-left text-muted"
                >
                  <Plus size={13} /> New profile
                </Link>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((n) => n.roles.includes(role))
            if (items.length === 0) return null
            return (
              <div key={group.section || 'ungrouped'}>
                {expanded && group.section && (
                  <div className="text-muted text-[10px] font-semibold uppercase tracking-wide px-3 mb-1.5 whitespace-nowrap">
                    {group.section}
                  </div>
                )}
                <div className="space-y-1">
                  {items.map((n) => {
                    if (n.external) {
                      return (
                        <a
                          key={n.to}
                          href={n.to}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={expanded ? undefined : n.label}
                          className={`nav-item relative ${expanded ? '' : 'justify-center'}`}
                        >
                          {n.icon}
                          {expanded && <span className="flex-1 whitespace-nowrap">{n.label}</span>}
                        </a>
                      )
                    }
                    const countKey = NAV_COUNT[n.to]
                    const count = countKey ? counts[countKey] : 0
                    return (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        end={n.to === '/'}
                        title={expanded ? undefined : n.label}
                        className={({ isActive }) => `nav-item relative ${expanded ? '' : 'justify-center'} ${isActive ? 'active' : ''}`}
                      >
                        {n.icon}
                        {expanded && <span className="flex-1 whitespace-nowrap">{n.label}</span>}
                        {count > 0 && expanded && (
                          <span
                            className="text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0"
                            style={{ background: 'var(--accent-orange)', color: '#fff' }}
                          >
                            {count}
                          </span>
                        )}
                        {count > 0 && !expanded && (
                          <span
                            className="absolute top-1 right-1.5 h-2 w-2 rounded-full"
                            style={{ background: 'var(--accent-orange)' }}
                          />
                        )}
                      </NavLink>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Preview switcher — NOT identity. This is the old localStorage Role (theme.ts) and it
            only changes which nav items render; the signed-in person's real role is in the top
            bar. Labelled "View as" so the two can't be confused while both exist. Phase 2 of the
            team-collaboration PRD removes this entirely, once the sidebar filters on real
            permissions instead. */}
        <div className="p-3 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="relative">
            <button
              onClick={() => setRoleOpen((o) => !o)}
              className={`w-full flex items-center rounded-lg panel text-sm ${expanded ? 'justify-between px-3 py-2' : 'justify-center py-2'}`}
              title={expanded ? undefined : `Previewing the ${ROLE_LABEL[role]} view — click to switch`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Eye size={14} className="shrink-0 text-muted" />
                {expanded && (
                  <span className="whitespace-nowrap truncate">
                    <span className="text-muted">View as</span> {ROLE_LABEL[role]}
                  </span>
                )}
              </span>
              {expanded && <ChevronDown size={15} className={`transition-transform ${roleOpen ? 'rotate-180' : ''}`} />}
            </button>
            {roleOpen && (
              <div className="absolute bottom-full mb-2 left-0 w-48 card p-1 z-10">
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
              <div className="text-sm font-medium truncate max-w-[180px]">
                {appUser?.full_name || user?.email}
              </div>
              {appUser && (
                <span className="text-[11px]" style={{ color: TEAM_ROLE_ACCENT[appUser.role] }}>
                  {TEAM_ROLE_LABEL[appUser.role]}
                </span>
              )}
            </div>
            {appUser?.avatar_url ? (
              <img
                src={appUser.avatar_url}
                alt={appUser.full_name}
                referrerPolicy="no-referrer"
                className="h-9 w-9 rounded-full object-cover shrink-0"
              />
            ) : (
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 text-white"
                style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-green))' }}
              >
                {initials}
              </div>
            )}
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
