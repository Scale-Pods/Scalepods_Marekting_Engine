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

/** Fires the Trend Intelligence n8n workflow (M4). Writes a new trend_runs + trend_signals. */
export async function triggerTrends(profileId: string): Promise<void> {
  await fireWebhook('sp-trends', { profileId })
}
