import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckCircle2, XCircle, Sparkles, Send, Clock, Undo2 } from 'lucide-react'
import {
  useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, type AppNotification,
} from '../lib/notifications'

// Per-type icon/tint. Types are free-text (n8n writes some of them), so unknown values fall
// back to a neutral bell rather than breaking the row.
const TYPE_META: Record<string, { icon: typeof Bell; color: string }> = {
  published: { icon: CheckCircle2, color: 'var(--accent-green)' },
  'publish-failed': { icon: XCircle, color: 'var(--accent-orange)' },
  scheduled: { icon: Clock, color: 'var(--accent-blue)' },
  approved: { icon: CheckCircle2, color: 'var(--accent-green)' },
  revision: { icon: Undo2, color: 'var(--accent-orange)' },
  'generation-complete': { icon: Sparkles, color: 'var(--accent-green)' },
  'approval-needed': { icon: Send, color: 'var(--accent-blue)' },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function NotificationRow({ n, onRead }: { n: AppNotification; onRead: (id: string) => void }) {
  const meta = TYPE_META[n.type] ?? { icon: Bell, color: 'var(--text-secondary)' }
  const Icon = meta.icon
  const unread = !n.read_at

  const inner = (
    <div
      className="flex items-start gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-[var(--fill-secondary)]"
      style={{ background: unread ? 'var(--fill-tertiary)' : undefined }}
    >
      <Icon size={15} style={{ color: meta.color }} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug">{n.title}</div>
        {n.body && <div className="text-secondary text-xs mt-0.5 line-clamp-2">{n.body}</div>}
        <div className="text-muted text-[10px] mt-1">{relativeTime(n.created_at)}</div>
      </div>
      {unread && <span className="h-2 w-2 rounded-full shrink-0 mt-1.5" style={{ background: 'var(--accent-blue)' }} />}
    </div>
  )

  return n.link ? (
    <Link to={n.link} onClick={() => onRead(n.id)} className="block text-left">{inner}</Link>
  ) : (
    <button onClick={() => onRead(n.id)} className="block w-full text-left">{inner}</button>
  )
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { data: notifications = [] } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  const unread = notifications.filter((n) => !n.read_at).length

  // Click-outside + Escape to dismiss, matching how the role switcher and modals behave.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn-ghost !p-2.5 relative"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        title="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 text-[10px] font-semibold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1"
            style={{ background: 'var(--accent-orange)', color: '#fff' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 card !p-0 overflow-hidden z-50"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}
        >
          <div
            className="flex items-center justify-between px-3.5 py-2.5"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markAll.mutate()}
                className="text-xs text-sage hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[380px] overflow-y-auto divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {notifications.length === 0 ? (
              <div className="px-3.5 py-8 text-center text-muted text-xs">
                Nothing yet — publishing and review activity shows up here.
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationRow key={n.id} n={n} onRead={(id) => markRead.mutate(id)} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
