import { supabase, fireWebhook } from './supabase'

export interface PostAnalytics {
  id: string
  content_item_id: string | null
  scheduled_post_id: string | null
  profile_id: string
  platform: string
  content_type: string | null
  platform_post_id: string
  post_url: string | null
  impressions: number
  reach: number
  likes: number
  comments: number
  shares: number
  saves: number
  video_views: number
  clicks: number
  engagement: number
  engagement_rate: number
  raw: unknown
  fetched_at: string
  created_at: string
}

export interface AnalyticsState {
  id: number
  last_refreshed_at: string | null
  last_run_status: string | null
  posts_synced: number
}

export interface AiInsight {
  id: string
  profile_id: string
  generated_at: string
  posts_analyzed: number
  overall_summary: string | null
  content_scores: unknown
  winning_hooks: unknown
  audience_behaviour: unknown
  best_posting_time: unknown
  top_creatives: unknown
  raw: unknown
}

export async function listPostAnalytics(profileId: string): Promise<PostAnalytics[]> {
  const { data, error } = await supabase
    .from('post_analytics')
    .select('*')
    .eq('profile_id', profileId)
    .order('engagement', { ascending: false })
  if (error) throw error
  return data as PostAnalytics[]
}

export async function getAnalyticsState(): Promise<AnalyticsState | null> {
  const { data, error } = await supabase.from('analytics_state').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  return data as AnalyticsState | null
}

/** Fires the Analytics Collector (M10). Pulls fresh metrics for every published post. */
export async function triggerAnalyticsRefresh(): Promise<void> {
  await fireWebhook('sp-analytics-refresh', {})
}

export async function getLatestInsights(profileId: string): Promise<AiInsight | null> {
  const { data, error } = await supabase
    .from('ai_insights')
    .select('*')
    .eq('profile_id', profileId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as AiInsight | null
}

/** Fires the AI Insights engine (M11). Feeds the learning loop: best-time -> Publishing, winning hooks -> Content Text Engine. */
export async function triggerInsights(profileId: string): Promise<void> {
  await fireWebhook('sp-ai-insights', { profileId })
}
