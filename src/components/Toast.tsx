import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

// Minimal toast surface. Before this, most async handlers in the app used try/finally with no
// catch — a failed publish/approve/generate showed the user nothing at all and left the button
// spinner stuck. Every one of those paths now reports through here.
//
// Portaled to document.body for the same reason the shared Modal is: `.card`/`.panel` ancestors
// carry backdrop-filter, which creates a containing block and would trap a position:fixed child
// inside that card's box instead of the viewport.

export type ToastTone = 'success' | 'error' | 'info'

interface Toast {
  id: number
  tone: ToastTone
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

const TONE_META: Record<ToastTone, { icon: typeof CheckCircle2; color: string }> = {
  success: { icon: CheckCircle2, color: 'var(--accent-green)' },
  error: { icon: XCircle, color: 'var(--accent-orange)' },
  info: { icon: Info, color: 'var(--accent-blue)' },
}

/** Errors reaching a toast are usually Error objects, but Supabase/fetch can reject with other
 *  shapes — normalise so we never render "[object Object]" at the user. */
export function toastMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      // Date.now() alone collides when two toasts fire in the same millisecond (e.g. a bulk
      // approve failing several items at once), which would break React keys.
      const id = Date.now() + Math.random()
      setToasts((t) => [...t, { id, tone, message }])
      // Errors linger — they're the ones worth reading. Success/info clear themselves.
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4000)
    },
    [dismiss],
  )

  const api: ToastApi = {
    success: useCallback((m: string) => push('success', m), [push]),
    error: useCallback((m: string) => push('error', m), [push]),
    info: useCallback((m: string) => push('info', m), [push]),
  }

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {createPortal(
        <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 items-end pointer-events-none">
          {toasts.map((t) => {
            const meta = TONE_META[t.tone]
            const Icon = meta.icon
            return (
              <div
                key={t.id}
                className="card !p-3 flex items-start gap-2.5 max-w-sm pointer-events-auto shadow-lg"
                style={{ borderLeft: `3px solid ${meta.color}` }}
                role="status"
              >
                <Icon size={16} style={{ color: meta.color }} className="shrink-0 mt-0.5" />
                <span className="text-sm text-secondary leading-snug flex-1">{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="text-muted hover:text-ink transition-colors shrink-0"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
