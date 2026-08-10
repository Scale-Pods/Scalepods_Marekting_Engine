import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'

// --- Buttons --------------------------------------------------------------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
  loading?: boolean
}
export function Button({ variant = 'primary', loading, children, className = '', disabled, ...rest }: BtnProps) {
  const base = variant === 'primary' ? 'btn-primary' : 'btn-ghost'
  return (
    <button className={`${base} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  )
}

// --- Surfaces -------------------------------------------------------------
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>
}
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel p-5 ${className}`}>{children}</div>
}

// --- Badge ----------------------------------------------------------------
// No dedicated "red" tone — CLAUDE.md/brand-kit define exactly 3 accent colors (sage/blue/
// terracotta) and terracotta (orange) is already the established warnings/errors token used
// throughout the app (Publishing "Failed", ContentFactory failed items). "grey" is safe to
// add since it's a neutral fill from the existing --fill/--text system tokens, not a new hue.
const BADGE_TONE_CLASS: Record<string, string> = {
  green: 'badge',
  blue: 'badge badge-blue',
  orange: 'badge badge-orange',
  grey: 'badge badge-grey',
}

export function Badge({
  children,
  tone = 'green',
  className = '',
}: {
  children: ReactNode
  tone?: 'green' | 'blue' | 'orange' | 'grey'
  className?: string
}) {
  return <span className={`${BADGE_TONE_CLASS[tone]} ${className}`}>{children}</span>
}

// --- Loading / empty ------------------------------------------------------
export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-sage" />
}

export function PageHeader({
  title,
  subtitle,
  accent,
  actions,
}: {
  title: ReactNode
  subtitle?: string
  accent?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        {accent && <div className="mb-2">{accent}</div>}
        <h1 className="text-2xl">{title}</h1>
        {subtitle && <p className="text-muted text-sm mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  // Rendered via portal straight onto <body> — a `fixed`-positioned overlay nested inside
  // any ancestor with backdrop-filter/filter/transform (e.g. `.card`, `.panel`) would
  // otherwise be scoped to that ancestor's box instead of the viewport (CSS containing-block
  // rule), which is exactly what backdrop-filter on `.card` does throughout this app.
  return createPortal(
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`modal-panel w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto p-7`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-2">
      {icon && <div className="text-muted mb-1">{icon}</div>}
      <div className="font-medium">{title}</div>
      {hint && <div className="text-muted text-sm max-w-sm">{hint}</div>}
    </div>
  )
}
