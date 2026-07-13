import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

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
export function Badge({
  children,
  tone = 'green',
  className = '',
}: {
  children: ReactNode
  tone?: 'green' | 'blue' | 'orange'
  className?: string
}) {
  const cls = tone === 'blue' ? 'badge badge-blue' : tone === 'orange' ? 'badge badge-orange' : 'badge'
  return <span className={`${cls} ${className}`}>{children}</span>
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

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-2">
      {icon && <div className="text-muted mb-1">{icon}</div>}
      <div className="font-medium">{title}</div>
      {hint && <div className="text-muted text-sm max-w-sm">{hint}</div>}
    </div>
  )
}
