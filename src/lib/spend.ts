// Phase 6 of docs/team-collaboration-prd.md — per-user monthly spend caps.
//
// studio_jobs/carousel_jobs/video_jobs are all written by n8n via the service-role key, which
// carries no JWT — a trigger on those tables would never know which person fired a given
// generation. So the record of who spent what lives here instead, written by the browser (with
// the real user's session) at the exact moment it is about to fire the paid webhook.
//
// `spend_events_guard` in Postgres is what actually enforces the cap: it overwrites `user_id`
// from the caller's own JWT (a forged id in the insert is ignored) and refuses the insert outright
// once this calendar month's total would clear `app_users.monthly_spend_cap_usd`. Refuse here
// means the webhook that spends real money is never fired — this is the real gate, not a UI
// nicety. One honest limitation: `amount_usd` itself is computed client-side from the same
// pricing tables the Studio pages already show on screen, so it is trusted input, not
// independently re-derived from the job's own columns — the same trust model the existing
// PER_VIDEO_CEILING_USD check already accepted for video (see videoStudio.ts).

import { supabase } from './supabase'

export type SpendSource = 'studio' | 'carousel_studio' | 'video_studio'

export const MONTH_SPEND_KEY = ['spend', 'month'] as const

/**
 * Logs a spend and enforces the cap in the same round trip. Throws the trigger's own message
 * (e.g. "This would put you at $55 this month, over your $50 monthly cap...") when it's refused —
 * callers must not fire the paid webhook if this throws.
 */
export async function recordSpend(source: SpendSource, jobId: string | null, amountUsd: number): Promise<void> {
  if (amountUsd <= 0) return // nothing to log or gate for a free action
  // user_id is omitted on purpose: the BEFORE INSERT trigger fills it in from the caller's own
  // JWT before the NOT NULL constraint is even checked, so there is nothing here for a forged
  // value to overwrite.
  const { error } = await supabase
    .from('spend_events')
    .insert({ source, job_id: jobId, amount_usd: amountUsd })
  if (error) throw error
}

/** This calendar month's total for the signed-in user (Asia/Kolkata, matching the digest). */
export async function myMonthSpend(): Promise<number> {
  const { data, error } = await supabase.rpc('month_spend_for')
  if (error) throw error
  return Number(data ?? 0)
}

/** Someone else's month-to-date total — resolves to 0 for a non-admin asking about anyone but
 *  themselves, same as the underlying function. Used by the Team & access usage display. */
export async function monthSpendFor(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('month_spend_for', { p_user_id: userId })
  if (error) throw error
  return Number(data ?? 0)
}
