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
