import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Settings as SettingsIcon, User, ShieldCheck, Sun, Moon, LogOut, Building2, Sparkles, Send, Instagram, Link2, Unlink, RefreshCw, MessageCircle, Power, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useProfile } from '../lib/queries'
import { GENERATION_ENABLED, PUBLISHING_ENABLED, listCommentAutomations, setCommentAutomationEnabled, type ContentItem } from '../lib/content'
import { toggleTheme, getCurrentTheme, type Theme, ROLE_ACCENT } from '../lib/theme'
import { connectInstagram, disconnectInstagram, getInstagramConnectionStatus, type InstagramConnectionStatus } from '../lib/instagramConnection'
import { trackExternalPost, type TrackExternalPostResult } from '../lib/instagramTracking'
import { PageHeader, Badge, Panel, Button } from '../components/ui'
import AssetUploader from '../components/AssetUploader'

const ROLE_LABEL = { admin: 'Admin', client: 'Client', designer: 'Designer' } as const

export default function Settings() {
  const { user, role, signOut } = useAuth()
  const { data: profile } = useProfile()
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

  // Comment automations: every post/reel currently wired to auto-DM on a keyword, whether it was
  // composed here or an already-live post tracked by URL below.
  const [automations, setAutomations] = useState<ContentItem[]>([])
  const [automationsLoading, setAutomationsLoading] = useState(false)
  const profileId = profile?.id

  const refreshAutomations = useCallback(() => {
    if (!profileId) return
    setAutomationsLoading(true)
    listCommentAutomations(profileId)
      .then(setAutomations)
      .catch(() => setAutomations([]))
      .finally(() => setAutomationsLoading(false))
  }, [profileId])

  useEffect(() => {
    refreshAutomations()
  }, [refreshAutomations])

  const [trackUrl, setTrackUrl] = useState('')
  const [trackKeyword, setTrackKeyword] = useState('')
  const [trackMessage, setTrackMessage] = useState('')
  const [trackAssetUrl, setTrackAssetUrl] = useState('')
  const [trackBusy, setTrackBusy] = useState(false)
  const [trackResult, setTrackResult] = useState<TrackExternalPostResult | null>(null)
  const canTrack = Boolean(profileId && trackUrl.trim() && trackKeyword.trim() && trackMessage.trim())

  async function handleTrackSubmit() {
    if (!profileId || !canTrack) return
    setTrackBusy(true)
    setTrackResult(null)
    try {
      const result = await trackExternalPost({
        postUrl: trackUrl.trim(),
        keyword: trackKeyword.trim(),
        message: trackMessage.trim(),
        assetUrl: trackAssetUrl.trim() || undefined,
        profileId,
      })
      setTrackResult(result)
      if (result.success) {
        setTrackUrl('')
        setTrackKeyword('')
        setTrackMessage('')
        setTrackAssetUrl('')
        refreshAutomations()
      }
    } catch (e) {
      setTrackResult({ success: false, error: e instanceof Error ? e.message : 'Something went wrong.' })
    } finally {
      setTrackBusy(false)
    }
  }

  async function handleDisableAutomation(itemId: string) {
    await setCommentAutomationEnabled(itemId, false)
    refreshAutomations()
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

      <Panel className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 font-medium">
            <MessageCircle size={16} className="text-sage" /> Comment automations
          </div>
          <button onClick={refreshAutomations} className="text-muted hover:text-primary" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
        <p className="text-secondary text-sm mb-4">
          Auto-DM anyone who comments a keyword on a specific Instagram post or reel. New posts are configured from the
          composer — use this to attach it to a post that's already live but wasn't published through Growth OS.
        </p>

        <div className="card p-3 mb-4">
          <div className="label mb-2">Track an existing Instagram post</div>
          <div className="space-y-2">
            <input
              className="input"
              placeholder="https://www.instagram.com/reel/..."
              value={trackUrl}
              onChange={(e) => setTrackUrl(e.target.value)}
            />
            <input
              className="input"
              placeholder="Trigger keyword (e.g. ANALYST)"
              value={trackKeyword}
              onChange={(e) => setTrackKeyword(e.target.value)}
            />
            <textarea
              className="input"
              rows={2}
              placeholder="DM to send"
              value={trackMessage}
              onChange={(e) => setTrackMessage(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                placeholder="Link or file (optional)"
                value={trackAssetUrl}
                onChange={(e) => setTrackAssetUrl(e.target.value)}
              />
              <AssetUploader pathPrefix={`manual/${profileId ?? 'shared'}`} label="Upload" onUploaded={(url) => setTrackAssetUrl(url)} />
            </div>
            <Button variant="primary" className="!py-1.5 !px-3 text-xs" onClick={handleTrackSubmit} disabled={trackBusy || !canTrack}>
              {trackBusy ? 'Looking up post…' : 'Track this post'}
            </Button>
          </div>
          {trackResult && (
            trackResult.success ? (
              <div className="mt-3 flex items-start gap-1.5 text-xs" style={{ color: 'var(--accent-green, #B1D997)' }}>
                <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                <span>{trackResult.updated ? 'Automation updated on' : 'Now tracking'} "{(trackResult.caption || '').slice(0, 70)}
                  {(trackResult.caption?.length ?? 0) > 70 ? '…' : ''}"</span>
              </div>
            ) : (
              <div className="mt-3 text-xs" style={{ color: 'var(--accent-orange, #CC6B49)' }}>{trackResult.error}</div>
            )
          )}
        </div>

        {automations.length === 0 ? (
          <p className="text-muted text-xs">{automationsLoading ? 'Loading…' : 'No active comment automations yet.'}</p>
        ) : (
          <div className="space-y-2">
            {automations.map((item) => {
              const auto = item.metadata.comment_automation
              if (!auto) return null
              return (
                <div key={item.id} className="card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm truncate flex items-center gap-2">
                      {item.title || 'Untitled post'}
                      {item.metadata.external_post && <Badge tone="blue">External</Badge>}
                    </div>
                    <div className="text-muted text-xs mt-0.5 truncate">Keyword "{auto.keyword}" — {auto.message}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" className="!py-1 !px-2 text-xs" onClick={() => handleDisableAutomation(item.id)}>
                      <Power size={12} /> Disable
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
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
