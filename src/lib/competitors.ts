import { supabase, fireWebhook } from './supabase'
import type { Competitor } from './clients'

export interface CompetitorCandidate {
  name: string
  website: string | null
  socials: Competitor['socials']
  source_url: string | null
  confidence: 'high' | 'medium' | 'low'
}

export interface CompetitorSearchRun {
  id: string
  profile_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  results: CompetitorCandidate[]
  error_message: string | null
  created_at: string
  updated_at: string
}

/** Fires the AI competitor-discovery workflow. It reads the profile's own business info (name,
 *  industry, description, website), runs a REAL Apify Google Search, and has GPT-4o pick out
 *  competitors + their real site/social links ONLY from what the search actually returned —
 *  same "real data in, AI only organizes" guard used for Trend Intelligence. Writes a row here;
 *  the FE polls/subscribes rather than awaiting the webhook response directly. */
export async function startCompetitorSearch(profileId: string): Promise<CompetitorSearchRun> {
  const { data, error } = await supabase
    .from('competitor_search_runs')
    .insert({ profile_id: profileId, status: 'pending' })
    .select()
    .single()
  if (error) throw error
  await fireWebhook('sp-competitor-search', { profileId, runId: data.id })
  return data as CompetitorSearchRun
}

export async function getSearchRun(runId: string): Promise<CompetitorSearchRun | null> {
  const { data, error } = await supabase
    .from('competitor_search_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw error
  return data as CompetitorSearchRun | null
}

/** Most recent search run for a profile, regardless of who started it or on which tab/device.
 *  A search takes 1-2 minutes (two real Apify calls + GPT) — long enough that a page refresh,
 *  a lost tab, or the user just navigating away and back is the norm, not the exception. Without
 *  this, the FE's in-memory `aiRun` state (plain useState) is gone the moment the component
 *  remounts, even though the backend finished the run successfully — the button would need to be
 *  clicked all over again to see results that already exist. Called on mount so a pending/
 *  processing run resumes polling, and a completed-but-unseen run reappears for review. */
export async function getLatestSearchRun(profileId: string): Promise<CompetitorSearchRun | null> {
  const { data, error } = await supabase
    .from('competitor_search_runs')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as CompetitorSearchRun | null
}

/** Tracks the last search run this browser has already reviewed (added-from or dismissed), per
 *  profile, so a completed run doesn't keep reappearing for review forever after a reload —
 *  only a genuinely new, not-yet-handled run resurfaces. Plain localStorage, same pattern as
 *  clients.ts's active-profile tracking; per-browser only, not synced across devices. */
function seenRunKey(profileId: string): string {
  return `sp-competitor-search-seen-${profileId}`
}

export function getSeenRunId(profileId: string): string | null {
  try {
    return localStorage.getItem(seenRunKey(profileId))
  } catch {
    return null
  }
}

export function markRunSeen(profileId: string, runId: string) {
  try {
    localStorage.setItem(seenRunKey(profileId), runId)
  } catch {
    // Storage full or blocked — worst case the run reappears for review once more next load.
  }
}
