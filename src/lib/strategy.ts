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

export type StrategySection =
  | 'campaign_planning' | 'weekly_content_strategy' | 'content_pillars'
  | 'platform_strategy' | 'lead_generation_strategy' | 'cta_strategy'

// --- Strategies -------------------------------------------------------------
//
// `strategy_generations` is the single source of truth for every strategy — the old, separate
// `marketing_strategies` ("the one active strategy", written only by the now-retired
// "Regenerate all") was unified in here on 2026-09-03: the single row it ever had was migrated
// once by hand, and `marketing_strategies` itself is left untouched as a frozen historical
// record, read by nothing. Every strategy — day/week/month scope, trend-anchored or general — is
// a `StrategyGeneration` row now, and any of them can be approved: `approveStrategy` enforces
// exactly one `status='approved'` row per profile at a time, which is what "the strategy content
// generation is gated on" (see ContentFactory.tsx) means in practice.

export type GenerationScope = 'day' | 'week' | 'month'

export interface SourceSignalSnapshot {
  id: string
  source: string
  topic: string
}

export interface StrategyGeneration {
  id: string
  profile_id: string
  status: 'processing' | 'completed' | 'approved' | 'failed'
  source_signal_ids: string[]
  /** Durable snapshot of the trend(s) this was generated from, taken at generation time — still
   *  renders correctly even if the original trend_signals row is later pruned by a newer scan.
   *  Empty for a strategy that wasn't anchored on any particular trend. */
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

/** Fires the scoped Strategy Generation n8n workflow (sp-strategy-generate) — the only way any
 *  new strategy gets created. `platform`/`contentType` omitted or empty means "any"; `signalIds`
 *  empty means a general strategy not anchored on any particular trend. */
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

/** The one strategy currently approved for a profile — what ContentFactory.tsx's "content
 *  generation stays locked until a strategy is approved" gate actually checks. `order by
 *  updated_at desc` is a defensive tiebreaker only; `approveStrategy` below keeps this to at
 *  most one row in practice. */
export async function getApprovedStrategy(profileId: string): Promise<StrategyGeneration | null> {
  const { data, error } = await supabase
    .from('strategy_generations')
    .select('*')
    .eq('profile_id', profileId)
    .eq('status', 'approved')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as StrategyGeneration | null
}

/** Approves one strategy and un-approves any other currently-approved strategy for the same
 *  profile, so exactly one is ever active at a time — same semantics the old single-row
 *  `marketing_strategies` table gave for free, now enforced explicitly since any strategy here
 *  can be approved. */
export async function approveStrategy(id: string, profileId: string): Promise<void> {
  const { error: approveError } = await supabase
    .from('strategy_generations')
    .update({ status: 'approved' })
    .eq('id', id)
  if (approveError) throw approveError

  const { error: demoteError } = await supabase
    .from('strategy_generations')
    .update({ status: 'completed' })
    .eq('profile_id', profileId)
    .eq('status', 'approved')
    .neq('id', id)
  if (demoteError) throw demoteError
}

/** Direct manual edit — PATCHes just the one JSON column. */
export async function updateStrategySection(id: string, section: StrategySection, value: unknown): Promise<void> {
  const { error } = await supabase.from('strategy_generations').update({ [section]: value }).eq('id', id)
  if (error) throw error
}

/** Fires the section-level AI regenerate n8n workflow — rewrites just one column. */
export async function regenerateStrategySection(strategyId: string, profileId: string, section: StrategySection): Promise<void> {
  await fireWebhook('sp-strategy-section-regenerate', { strategyId, profileId, section })
}
