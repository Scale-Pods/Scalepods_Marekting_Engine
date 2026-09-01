import { supabase, fireWebhook } from './supabase'

export interface TrendRun {
  id: string
  profile_id: string
  status: string
  sources_completed: string[]
  ai_summary: string | null
  created_at: string
}

export interface TrendSignal {
  id: string
  run_id: string
  profile_id: string
  source: string
  topic: string
  relevance_score: number
  relevance_reason: string | null
  url: string | null
  meta: Record<string, unknown>
  created_at: string
}

export async function getLatestRun(profileId: string): Promise<TrendRun | null> {
  const { data, error } = await supabase
    .from('trend_runs')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as TrendRun | null
}

export async function listRuns(profileId: string): Promise<TrendRun[]> {
  const { data, error } = await supabase
    .from('trend_runs')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as TrendRun[]
}

export async function listSignals(runId: string): Promise<TrendSignal[]> {
  const { data, error } = await supabase
    .from('trend_signals')
    .select('*')
    .eq('run_id', runId)
    .order('relevance_score', { ascending: false })
  if (error) throw error
  return data as TrendSignal[]
}

/** The 5 sources the Apify-backed scan actually supports today — matches trend_signals.source
 *  values exactly (see SOURCE_COLOR in Trends.tsx). LinkedIn/Facebook are deliberately excluded:
 *  no cheap keyword-search Apify actor exists for either yet. */
export const SCAN_PLATFORMS = ['Reddit', 'Instagram', 'YouTube', 'Google Search', 'Google Trends'] as const
export type ScanPlatform = (typeof SCAN_PLATFORMS)[number]

export interface ScanOptions {
  /** Which sources to run this scan against. Omitted/empty = all 5 (matches the 24h scheduler's
   *  plain {profileId} call, and the n8n side defaults the same way). */
  platforms?: ScanPlatform[]
  /** Per-platform result count (e.g. {"YouTube": 3}) — how many items to pull FROM that source
   *  before AI ranks them, not how many signals end up on the page (GPT still filters for
   *  relevance same as always). Google Trends has no count knob: it's a fixed live leaderboard
   *  + one growth reading per keyword, not a paged list. */
  counts?: Partial<Record<ScanPlatform, number>>
}

/** Fires the Trend Intelligence n8n workflow (M4). Writes a new trend_runs + trend_signals. */
export async function triggerTrends(profileId: string, options?: ScanOptions): Promise<void> {
  const body: Record<string, unknown> = { profileId }
  if (options?.platforms?.length) body.platforms = options.platforms
  if (options?.counts && Object.keys(options.counts).length) body.counts = options.counts
  await fireWebhook('sp-trends', body)
}

/** All signals for a profile across EVERY run since `sinceIso` (or all-time if omitted), and
 *  optionally up to `untilIso` (for a custom start-end range) — the cross-day view. listSignals()
 *  above stays scoped to one run for the single-scan view; this is what makes "last 7 days" or a
 *  custom "Aug 1 – Aug 15" range possible now that scans run daily. */
export async function listSignalsSince(profileId: string, sinceIso?: string, untilIso?: string): Promise<TrendSignal[]> {
  let query = supabase
    .from('trend_signals')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
  if (sinceIso) query = query.gte('created_at', sinceIso)
  if (untilIso) query = query.lte('created_at', untilIso)
  const { data, error } = await query
  if (error) throw error
  return data as TrendSignal[]
}
