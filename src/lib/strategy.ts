import { supabase, fireWebhook } from './supabase'

export interface CalendarItem {
  scheduled_date: string | null
  platform: string
  content_type: string
  title: string
  hook?: string
  pillar?: string
}

/** Real numeric/enum signals computed in n8n code (never GPT-authored) from actual post
 *  performance + ai_insights, then wrapped in GPT-written prose. See the note on
 *  `pillar_balance` below for why this is a separate concept from `content_pillars`. */
export interface HeaderInsights {
  best_lever: { title: string; evidence: string; recommendation: string } | null
  weakest_pillar: { pillar: 'HR' | 'Sales' | 'Ops' | 'Marketing'; actual_pct: number; recommended_pct: number; note: string } | null
  channel_mismatch: { stated_primary: string; actual_leader: string; stated_pct: number; actual_pct: number; note: string } | null
}

/** Quantitative pillar split — deliberately distinct from `content_pillars` (the free-form
 *  narrative section: "why HR matters, example angles for Sales"). `recommended` is GPT's
 *  suggested %-split; `actual` is spliced straight from the latest `ai_insights.pillar_mix`
 *  real published-content counts, never trusted from GPT's own output. */
export interface PillarBalance {
  recommended: { hr: number; sales: number; ops: number; marketing: number }
  actual: { hr: number; sales: number; ops: number; marketing: number; unclassified: number }
  source_posts_analyzed: number
  notes?: Partial<Record<'hr' | 'sales' | 'ops' | 'marketing', string>>
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
  /** Null on any strategy generated before this redesign shipped — every renderer for these
   *  two must handle null gracefully. */
  header_insights: HeaderInsights | null
  pillar_balance: PillarBalance | null
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

// --- Scoped, trend-anchored generations (M5c) ------------------------------
//
// A completely separate artifact from `marketing_strategies` above — picking trends on the
// Trends page and generating never touches the current active strategy (getLatestStrategy always
// stays whatever it was). Each one is a standalone saved record, shown in Strategy.tsx's "Recent"
// section, keyed to whichever trend(s) it was anchored on.

export type GenerationScope = 'day' | 'week' | 'month'

export interface SourceSignalSnapshot {
  id: string
  source: string
  topic: string
}

export interface StrategyGeneration {
  id: string
  profile_id: string
  status: 'processing' | 'completed' | 'failed'
  source_signal_ids: string[]
  /** Durable snapshot of the trend(s) this was generated from, taken at generation time — still
   *  renders correctly even if the original trend_signals row is later pruned by a newer scan. */
  source_signals_snapshot: SourceSignalSnapshot[]
  scope: GenerationScope
  /** Empty string = "any relevant platform", not a specific one. */
  platform: string
  /** Empty string = "AI decides the mix", not one pinned content type. */
  content_type: string
  ai_summary: string | null
  campaign_planning: unknown
  weekly_content_strategy: unknown
  content_pillars: unknown
  content_calendar: CalendarItem[]
  platform_strategy: unknown
  lead_generation_strategy: unknown
  cta_strategy: unknown
  header_insights: HeaderInsights | null
  pillar_balance: PillarBalance | null
  error_detail: string | null
  created_at: string
  updated_at: string
}

/** Fires the scoped Strategy Generation n8n workflow (M5c, sp-strategy-generate) — writes a new
 *  standalone `strategy_generations` row, never `marketing_strategies`. `platform`/`contentType`
 *  omitted or empty means "any". */
export async function triggerStrategyGeneration(
  profileId: string,
  signalIds: string[],
  scope: GenerationScope,
  platform?: string | null,
  contentType?: string | null,
): Promise<void> {
  await fireWebhook('sp-strategy-generate', {
    profileId,
    signalIds,
    scope,
    platform: platform || null,
    contentType: contentType || null,
  })
}

export async function listStrategyGenerations(profileId: string): Promise<StrategyGeneration[]> {
  const { data, error } = await supabase
    .from('strategy_generations')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as StrategyGeneration[]
}

export async function getStrategyGeneration(id: string): Promise<StrategyGeneration | null> {
  const { data, error } = await supabase
    .from('strategy_generations')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as StrategyGeneration | null
}
