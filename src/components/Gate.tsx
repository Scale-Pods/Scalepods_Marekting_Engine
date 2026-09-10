import { useAuth } from '../lib/auth'
import { FEATURES, LEVEL_LABEL, type AccessLevel, type FeatureKey } from '../lib/permissions'

/**
 * The permission check for a single control.
 *
 * Hiding a nav item and blocking a route are about whole screens; this is for the actions inside
 * one — the buttons that spend money, publish something, or approve work. Those are exactly what
 * the `full` level exists to separate from `edit`.
 *
 * Returns a disabled flag and a reason, rather than hiding the control. A button that vanishes
 * leaves someone hunting for a feature they were told exists; a disabled button that explains
 * itself on hover tells them who to ask. (Destructive controls are the exception — the danger
 * zone in Team & access hides outright.)
 *
 * This is a courtesy, not a protection. Phase 3's RLS is what actually refuses the write.
 */
export function useGate(feature: FeatureKey, level: AccessLevel = 'full') {
  const { can } = useAuth()
  const allowed = can(feature, level)
  const label = FEATURES.find((f) => f.key === feature)?.label ?? feature

  return {
    allowed,
    /** Spread onto a <Button>/<button>: disables it and explains why on hover. */
    props: allowed
      ? {}
      : {
          disabled: true,
          title: `You need ${LEVEL_LABEL[level]} access to ${label}. An admin can grant it in Settings → Team & access.`,
        },
  }
}
