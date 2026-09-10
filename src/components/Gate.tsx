import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { FEATURES, LEVEL_LABEL, type AccessLevel, type FeatureKey } from '../lib/permissions'
import { myMonthSpend, MONTH_SPEND_KEY } from '../lib/spend'

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

/** The bare boolean, for deciding whether to render something at all rather than disable it. */
export function useCan(feature: FeatureKey, level: AccessLevel = 'full'): boolean {
  const { can } = useAuth()
  return can(feature, level)
}

/**
 * The dollar half of Phase 6 (spend caps) — sits alongside `useGate`, not instead of it: a
 * generate button needs both `studio:full` (this is the right kind of action) and this (there's
 * still budget for it). `estimatedCostUsd` is whatever the page is already showing next to the
 * button, so this never re-derives pricing on its own.
 *
 * `spend_events_guard` in Postgres is what actually refuses an over-cap spend — this hook exists
 * so the button already explains why before anyone clicks it, same courtesy `useGate` gives
 * permissions.
 */
export function useBudgetGate(estimatedCostUsd: number) {
  const { appUser } = useAuth()
  const { data: spent = 0 } = useQuery({
    queryKey: MONTH_SPEND_KEY,
    queryFn: myMonthSpend,
    staleTime: 15_000,
  })
  const cap = appUser?.monthly_spend_cap_usd ?? null
  const projected = spent + Math.max(0, estimatedCostUsd)
  const wouldExceed = cap !== null && projected > cap

  return {
    allowed: !wouldExceed,
    spent,
    cap,
    props: wouldExceed
      ? {
          disabled: true,
          title: `This would put you at $${projected.toFixed(2)} this month, over your $${cap} monthly cap. Ask an admin to raise it in Team & access.`,
        }
      : {},
  }
}
