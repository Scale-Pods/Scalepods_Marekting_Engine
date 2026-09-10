import { Link } from 'react-router-dom'
import { Lock, BookOpen, LayoutDashboard } from 'lucide-react'
import { FEATURES, type FeatureKey } from '../lib/permissions'

/**
 * Shown when somebody reaches a route their permissions don't cover.
 *
 * Deliberately an explanation rather than a redirect. Bouncing someone silently to the dashboard
 * reads like a broken link; saying "this exists, you don't have it, here's who to ask" is the
 * difference between a permission boundary and a bug report.
 */
export default function NoAccess({ feature }: { feature: FeatureKey }) {
  const def = FEATURES.find((f) => f.key === feature)

  return (
    <div className="flex items-center justify-center py-20">
      <div className="card max-w-md w-full p-8 text-center">
        <div
          className="h-12 w-12 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: 'var(--fill-tertiary)', color: 'var(--text-muted)' }}
        >
          <Lock size={20} />
        </div>

        <h1 className="text-lg mb-2">{def ? `${def.label} isn’t part of your access` : 'You don’t have access to this'}</h1>
        <p className="text-secondary text-sm leading-relaxed mb-6">
          This screen exists, but your account hasn’t been given access to it. An admin can change that from
          Settings → Team &amp; access.
        </p>

        <div className="flex gap-2">
          <Link to="/" className="btn-primary flex-1">
            <LayoutDashboard size={15} /> Dashboard
          </Link>
          <Link to="/manual" className="btn-ghost flex-1">
            <BookOpen size={15} /> User manual
          </Link>
        </div>
      </div>
    </div>
  )
}
