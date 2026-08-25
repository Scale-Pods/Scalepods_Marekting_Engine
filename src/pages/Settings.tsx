import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Settings as SettingsIcon, User, ShieldCheck, Sun, Moon, LogOut, Building2, Sparkles, Send, Instagram, Link2, Unlink, RefreshCw } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { GENERATION_ENABLED, PUBLISHING_ENABLED } from '../lib/content'
import { toggleTheme, getCurrentTheme, type Theme, ROLE_ACCENT } from '../lib/theme'
import { connectInstagram, disconnectInstagram, getInstagramConnectionStatus, type InstagramConnectionStatus } from '../lib/instagramConnection'
import { PageHeader, Badge, Panel, Button } from '../components/ui'

const ROLE_LABEL = { admin: 'Admin', client: 'Client', designer: 'Designer' } as const

export default function Settings() {
  const { user, role, signOut } = useAuth()
  const [theme, setTheme] = useState<Theme>(getCurrentTheme())
  const [igStatus, setIgStatus] = useState<InstagramConnectionStatus | null>(null)
  const [igBusy, setIgBusy] = useState(false)

  const refreshIgStatus = useCallback(() => {
    getInstagramConnectionStatus().then(setIgStatus).catch(() => setIgStatus(null))
  }, [])

  useEffect(() => {
    refreshIgStatus()
    // connectInstagram() opens the OAuth flow in a new tab - re-check status when the user
    // comes back to this tab instead of requiring a manual refresh click every time.
    window.addEventListener('focus', refreshIgStatus)
    return () => window.removeEventListener('focus', refreshIgStatus)
  }, [refreshIgStatus])

  const igConnected = igStatus?.status === 'connected'

  async function handleDisconnectInstagram() {
    setIgBusy(true)
    try {
      await disconnectInstagram()
      refreshIgStatus()
    } finally {
      setIgBusy(false)
    }
  }

  return (
    <div>
      <PageHeader accent={<Badge><SettingsIcon size={12} /> Settings</Badge>} title="Settings" subtitle="Account, appearance, and credit-safety status." />

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Panel>
          <div className="flex items-center gap-2 mb-4 font-medium">
            <User size={16} className="text-sage" /> Account
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <div className="label">Email</div>
              <div className="mt-0.5">{user?.email}</div>
            </div>
            <div>
              <div className="label">Role</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: ROLE_ACCENT[role] }} />
                {ROLE_LABEL[role]}
                <span className="text-muted text-xs">(switch from the sidebar)</span>
              </div>
            </div>
          </div>
          <Button variant="ghost" className="mt-4 !py-1.5 !px-3 text-xs" onClick={signOut}>
            <LogOut size={13} /> Sign out
          </Button>
        </Panel>

        <Panel>
          <div className="flex items-center gap-2 mb-4 font-medium">
            {theme === 'dark' ? <Moon size={16} className="text-sage" /> : <Sun size={16} className="text-sage" />} Appearance
          </div>
          <p className="text-secondary text-sm mb-3">Dark cyber-navy is the default brand theme; light mint-alabaster is available for bright environments.</p>
          <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={() => setTheme(toggleTheme())}>
            {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />} Switch to {theme === 'dark' ? 'light' : 'dark'}
          </Button>
        </Panel>
      </div>

      <Panel className="mb-4">
        <div className="flex items-center gap-2 mb-4 font-medium">
          <ShieldCheck size={16} className="text-sage" /> Credit-safety flags
        </div>
        <p className="text-secondary text-sm mb-4">
          Master switches in <code className="font-mono text-xs">src/lib/content.ts</code>. Video engines (HeyGen, fal.ai) are never wired to
          either flag — they stay manual-only in n8n regardless.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="card p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Sparkles size={14} className="text-sage" /> Content generation
            </div>
            <Badge tone={GENERATION_ENABLED ? 'green' : 'orange'}>{GENERATION_ENABLED ? 'Enabled' : 'Disabled'}</Badge>
          </div>
          <div className="card p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Send size={14} className="text-sage" /> Publishing
            </div>
            <Badge tone={PUBLISHING_ENABLED ? 'green' : 'orange'}>{PUBLISHING_ENABLED ? 'Enabled' : 'Disabled'}</Badge>
          </div>
        </div>
      </Panel>

      <Panel className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 font-medium">
            <Link2 size={16} className="text-sage" /> Connections
          </div>
          <button onClick={refreshIgStatus} className="text-muted hover:text-primary" title="Refresh status">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="card p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Instagram size={14} className="text-sage" />
            <div>
              <div>Instagram (comment-to-DM)</div>
              {igConnected ? (
                <div className="text-muted text-xs mt-0.5">
                  Connected as @{igStatus?.username ?? 'unknown'}
                </div>
              ) : igStatus?.status === 'error' ? (
                <div className="text-xs mt-0.5" style={{ color: 'var(--accent-orange, #CC6B49)' }}>
                  {igStatus.error_message || 'Connection failed'}
                </div>
              ) : (
                <div className="text-muted text-xs mt-0.5">Not connected</div>
              )}
            </div>
          </div>
          {igConnected ? (
            <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={handleDisconnectInstagram} disabled={igBusy}>
              <Unlink size={13} /> Disconnect
            </Button>
          ) : (
            <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={connectInstagram}>
              <Instagram size={13} /> Connect Instagram
            </Button>
          )}
        </div>
        <p className="text-secondary text-xs mt-3">
          Needed for the per-post "auto-DM on comment" automation and for Meta's app review to approve it for real users.
        </p>
      </Panel>

      <Panel>
        <div className="flex items-center gap-2 mb-4 font-medium">
          <Building2 size={16} className="text-sage" /> Business profile
        </div>
        <p className="text-secondary text-sm mb-4">Edit the brand knowledge base that seeds every downstream engine.</p>
        <Link to="/clients" className="btn-ghost w-fit !py-1.5 !px-3 text-xs">
          Manage business profile
        </Link>
      </Panel>
    </div>
  )
}
