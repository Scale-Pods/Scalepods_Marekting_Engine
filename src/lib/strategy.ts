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
  /** Set when this strategy was generated via "General Strategy" on a specific trend card,
   *  rather than the broad "Regenerate all" — null for the latter. */
  source_signal_id: string | null
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

/** Fires the Marketing Strategy n8n workflow (M5). Writes a new marketing_strategies row.
 *  Pass `signalId` (a trend_signals.id) to anchor the strategy around one specific trend —
 *  fired from the "General Strategy" button on a Trends signal card — instead of the broad,
 *  all-trends synthesis the plain "Regenerate all" button on the Strategy page still uses. */
export async function triggerStrategy(profileId: string, signalId?: string): Promise<void> {
  await fireWebhook('sp-strategy', signalId ? { profileId, signalId } : { profileId })
}

/** The one trend signal a strategy was generated around, for a "Generated from" credit on the
 *  Strategy page — null when the strategy has no source_signal_id (the normal "Regenerate all"
 *  case) or when that signal has since been deleted. */
export async function getSourceSignal(signalId: string): Promise<{ id: string; source: string; topic: string } | null> {
  const { data, error } = await supabase
    .from('trend_signals')
    .select('id, source, topic')
    .eq('id', signalId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function approveStrategy(id: string): Promise<void> {
  const { error } = await supabase.from('marketing_strategies').update({ status: 'approved' }).eq('id', id)
  if (error) throw error
}

export type StrategySection =
  | 'campaign_planning' | 'weekly_content_strategy' | 'content_pillars'
  | 'platform_strategy' | 'lead_generation_strategy' | 'cta_strategy'

/** Direct manual edit — PATCHes just the one JSON column. */
export async function updateStrategySection(id: string, section: StrategySection, value: unknown): Promise<void> {
  const { error } = await supabase.from('marketing_strategies').update({ [section]: value }).eq('id', id)
  if (error) throw error
}

/** Fires the section-level AI regenerate n8n workflow (M5b) — rewrites just one column. */
export async function regenerateStrategySection(strategyId: string, profileId: string, section: StrategySection): Promise<void> {
  await fireWebhook('sp-strategy-section-regenerate', { strategyId, profileId, section })
}
