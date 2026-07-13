import { supabase, fireWebhook } from './supabase'

export interface CalendarItem {
  scheduled_date: string | null
  platform: string
  content_type: string
  title: string
  hook?: string
  pillar?: string
}

export interface MarketingStrategy {
  id: string
  profile_id: string
  status: 'processing' | 'completed' | 'approved' | 'failed'
  ai_summary: string | null
  campaign_planning: unknown
  weekly_content_strategy: unknown
  content_pillars: unknown
  content_calendar: CalendarItem[]
  platform_strategy: unknown
  lead_generation_strategy: unknown
  cta_strategy: unknown
  created_at: string
  updated_at: string
}

export async function getLatestStrategy(profileId: string): Promise<MarketingStrategy | null> {
  const { data, error } = await supabase
    .from('marketing_strategies')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as MarketingStrategy | null
}

export async function listStrategies(profileId: string): Promise<MarketingStrategy[]> {
  const { data, error } = await supabase
    .from('marketing_strategies')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as MarketingStrategy[]
}

/** Fires the Marketing Strategy n8n workflow (M5). Writes a new marketing_strategies row. */
export async function triggerStrategy(profileId: string): Promise<void> {
  await fireWebhook('sp-strategy', { profileId })
}

export async function approveStrategy(id: string): Promise<void> {
  const { error } = await supabase.from('marketing_strategies').update({ status: 'approved' }).eq('id', id)
  if (error) throw error
}
