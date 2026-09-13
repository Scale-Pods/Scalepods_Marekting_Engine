/**
 * "just now" / "12m ago" / "3h ago" / "2d ago" / "3w ago" — shared relative-time formatting for
 * every "recent" grid and list in the app (Publishing's Ready to publish/Recent activity, AI
 * Studio's and Video Studio's Recent grids, Creative Review, notifications) so the granularity
 * and wording never drifts between them. Falls back to an absolute short date once something is
 * old enough that "Nw ago" stops being useful (a review/publish queue can hold items far older
 * than a notification bell ever would).
 */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
