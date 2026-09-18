import { supabase } from './supabase'

// Trend Alerts: watch a topic across the web and get alerted when something meaningful happens.
// The pipeline is DB + n8n (see docs/radar-prd.md and the trend_alerts_* SQL functions):
// pg_cron queues due checks -> n8n "ScalePods · Trend Alerts Run" collects and classifies ->
// the database filters, groups, detects spikes, matches rules and sends. The app only reads the
// results and edits watch items / rules.

export type WatchSource = 'google_news' | 'reddit' | 'web' | 'youtube' | 'rss'
export type WatchStatus = 'active' | 'paused'
export type Importance = 'low' | 'medium' | 'high' | 'critical'
export type Sentiment = 'positive' | 'negative' | 'neutral' | 'mixed'
export type Delivery = 'immediate' | 'daily' | 'weekly'
export type Channel = 'app' | 'slack' | 'webhook'

export interface TrendAlertWatch {
  id: string
  profile_id: string | null
  name: string
  description: string
  keywords: string[]
  exclude_keywords: string[]
  sources: WatchSource[]
  rss_urls: string[]
  region: string
  results_per_source: number
  frequency_minutes: number
  lookback_days: number
  relevance_threshold: number
  monthly_budget_usd: number | null
  status: WatchStatus
  next_run_at: string
  last_run_at: string | null
  last_run_status: string | null
  last_error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TrendAlertSourceRef {
  source: string
  url: string
  title: string
  publisher?: string | null
}

export interface TrendAlertEvent {
  id: string
  watch_id: string
  kind: 'story' | 'spike'
  status: 'pending' | 'active' | 'discarded'
  title: string
  summary: string | null
  explanation: string | null
  primary_url: string | null
  primary_source: string | null
  sources: TrendAlertSourceRef[]
  mention_count: number
  source_count: number
  relevance: number | null
  sentiment: Sentiment | null
  sentiment_intensity: number | null
  positive_aspects: string | null
  negative_aspects: string | null
  topic: string | null
  importance: Importance | null
  credibility: number | null
  spike: { today: number; mean_7d: number; stddev_7d: number; ratio: number | null } | null
  first_seen_at: string
  last_seen_at: string
}

export interface TrendAlertRule {
  id: string
  watch_id: string
  name: string
  enabled: boolean
  min_relevance: number
  min_importance: Importance
  sentiments: Sentiment[]
  min_source_count: number
  min_credibility: number
  include_spikes: boolean
  delivery: Delivery
  channels: Channel[]
  recipient_user_ids: string[]
  slack_webhook_url: string | null
  webhook_url: string | null
  created_at: string
}

export interface TrendAlertRun {
  id: string
  watch_id: string
  trigger: 'schedule' | 'manual'
  status: 'queued' | 'running' | 'completed' | 'failed'
  started_at: string
  finished_at: string | null
  raw_count: number
  new_count: number
  kept_count: number
  events_created: number
  events_updated: number
  alerts_immediate: number
  alerts_digest: number
  est_cost_usd: number
  source_stats: Record<string, number | string>
  error: string | null
}

export interface TrendAlertStat {
  watch_id: string
  day: string
  mention_count: number
  event_count: number
  positive: number
  negative: number
  neutral: number
  mixed: number
}

// ─── Option catalogues ───────────────────────────────────────────────────────

export const SOURCE_OPTIONS: { value: WatchSource; label: string; hint: string; paid: boolean }[] = [
  { value: 'google_news', label: 'Google News', hint: 'News articles from the last 7 days. Free.', paid: false },
  { value: 'reddit', label: 'Reddit', hint: 'Posts from the last week. Paid per post (Apify).', paid: true },
  { value: 'web', label: 'Web search', hint: 'Google results from the last 7 days. Paid per search (Apify).', paid: true },
  { value: 'youtube', label: 'YouTube', hint: 'Videos uploaded this week. Paid per video (Apify).', paid: true },
  { value: 'rss', label: 'RSS feeds', hint: 'Any blog or site feed you add. Free.', paid: false },
]

export const SOURCE_LABEL: Record<string, string> = {
  google_news: 'Google News', reddit: 'Reddit', web: 'Web', youtube: 'YouTube', rss: 'RSS', trend_alerts: 'Trend Alerts',
}

export const FREQUENCY_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 240, label: 'Every 4 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Once a day' },
]

export const DEFAULT_FREQUENCY = 60

export function frequencyLabel(minutes: number): string {
  return FREQUENCY_OPTIONS.find((f) => f.value === minutes)?.label ?? `Every ${minutes} minutes`
}

export const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: 'US', label: 'United States' },
  { value: 'IN', label: 'India' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'AU', label: 'Australia' },
  { value: 'CA', label: 'Canada' },
  { value: 'SG', label: 'Singapore' },
  { value: 'AE', label: 'UAE' },
]

/** Sentinel region value meaning "no region restriction" — Google News' global edition, no
 *  countryCode filter on web search. Reddit/YouTube don't take a region param either way. */
export const ALL_REGIONS = 'ALL'

export const LOOKBACK_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 15, label: 'Last 15 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 3 months' },
  { value: 365, label: 'Last year' },
]

export const DEFAULT_LOOKBACK_DAYS = 7

export const STRICTNESS_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 0.75, label: 'Strict', hint: 'Only clearly on-topic stories' },
  { value: 0.6, label: 'Balanced', hint: 'Recommended' },
  { value: 0.45, label: 'Broad', hint: 'Also loosely related coverage' },
]

export const IMPORTANCE_OPTIONS: { value: Importance; label: string }[] = [
  { value: 'low', label: 'Any importance' },
  { value: 'medium', label: 'Medium or higher' },
  { value: 'high', label: 'High or critical' },
  { value: 'critical', label: 'Critical only' },
]

export const DELIVERY_OPTIONS: { value: Delivery; label: string }[] = [
  { value: 'immediate', label: 'Right away' },
  { value: 'daily', label: 'Daily digest (9:00 AM IST)' },
  { value: 'weekly', label: 'Weekly digest (Monday 9:00 AM IST)' },
]

// ─── Cost estimate ───────────────────────────────────────────────────────────
// Mirrors the prices the n8n workflow uses to record real per-check spend (Apify free-tier
// pay-per-event rates). The AI allowance is a deliberately generous average: embeddings cost
// almost nothing, classification uses gpt-4o-mini, and gpt-4o only writes the text for
// alerts that actually go out right away. Checks that find nothing new cost only collection.
const AI_ALLOWANCE_PER_CHECK = 0.003

export function estimateCheckCost(sources: WatchSource[], resultsPerSource: number): number {
  let cost = 0
  if (sources.includes('reddit')) cost += 0.003 + 0.00115 * resultsPerSource
  if (sources.includes('web')) cost += 0.001 + 0.0045
  if (sources.includes('youtube')) cost += 0.004 * resultsPerSource
  return cost + AI_ALLOWANCE_PER_CHECK
}

export function estimateMonthlyCost(sources: WatchSource[], resultsPerSource: number, frequencyMinutes: number): number {
  const checksPerMonth = (30 * 24 * 60) / Math.max(30, frequencyMinutes)
  return estimateCheckCost(sources, resultsPerSource) * checksPerMonth
}

const USD_TO_INR = 83
export function formatUsd(usd: number, decimals = 2): string {
  return `$${usd.toFixed(decimals)} (≈₹${Math.round(usd * USD_TO_INR).toLocaleString('en-IN')})`
}

/** Start of the current month in IST, which is how budgets reset in the database. */
export function monthStartIso(): string {
  const now = new Date()
  const ist = new Date(now.getTime() + 330 * 60_000)
  const start = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000
  return new Date(start).toISOString()
}

// ─── Watch items ─────────────────────────────────────────────────────────────

export interface WatchInput {
  name: string
  description: string
  keywords: string[]
  exclude_keywords: string[]
  sources: WatchSource[]
  rss_urls: string[]
  region: string
  results_per_source: number
  frequency_minutes: number
  lookback_days: number
  relevance_threshold: number
  monthly_budget_usd: number | null
}

export async function listWatches(): Promise<TrendAlertWatch[]> {
  const { data, error } = await supabase
    .from('trend_alert_watches')
    .select('id,profile_id,name,description,keywords,exclude_keywords,sources,rss_urls,region,results_per_source,frequency_minutes,lookback_days,relevance_threshold,monthly_budget_usd,status,next_run_at,last_run_at,last_run_status,last_error,created_by,created_at,updated_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as TrendAlertWatch[]
}

export async function createWatch(input: WatchInput, profileId: string | null): Promise<TrendAlertWatch> {
  const { data, error } = await supabase
    .from('trend_alert_watches')
    .insert({ ...input, profile_id: profileId })
    .select('id,profile_id,name,description,keywords,exclude_keywords,sources,rss_urls,region,results_per_source,frequency_minutes,lookback_days,relevance_threshold,monthly_budget_usd,status,next_run_at,last_run_at,last_run_status,last_error,created_by,created_at,updated_at')
    .single()
  if (error) throw error
  const watch = data as TrendAlertWatch

  // Two sensible starting rules so a new watch item alerts out of the box.
  const { error: rulesError } = await supabase.from('trend_alert_rules').insert([
    {
      watch_id: watch.id, name: 'Important news, right away', min_relevance: Math.max(0.7, input.relevance_threshold),
      min_importance: 'high', delivery: 'immediate', channels: ['app'], include_spikes: true,
    },
    {
      watch_id: watch.id, name: 'Everything relevant, daily digest', min_relevance: input.relevance_threshold,
      min_importance: 'low', delivery: 'daily', channels: ['app'], include_spikes: false,
    },
  ])
  if (rulesError) throw rulesError
  return watch
}

export async function updateWatch(id: string, patch: Partial<WatchInput> & { status?: WatchStatus }): Promise<void> {
  const { error } = await supabase.from('trend_alert_watches').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteWatch(id: string): Promise<void> {
  const { error } = await supabase.from('trend_alert_watches').delete().eq('id', id)
  if (error) throw error
}

export async function runWatchNow(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('trend_alerts_run_now', { p_watch_id: id })
  if (error) throw new Error(error.message)
  return data as string
}

// ─── Feed, stats, runs ───────────────────────────────────────────────────────

export async function listEvents(watchId: string, includeDiscarded: boolean): Promise<TrendAlertEvent[]> {
  let q = supabase
    .from('trend_alert_events')
    .select('id,watch_id,kind,status,title,summary,explanation,primary_url,primary_source,sources,mention_count,source_count,relevance,sentiment,sentiment_intensity,positive_aspects,negative_aspects,topic,importance,credibility,spike,first_seen_at,last_seen_at')
    .eq('watch_id', watchId)
    .order('last_seen_at', { ascending: false })
    .limit(200)
  q = includeDiscarded ? q.in('status', ['active', 'discarded']) : q.eq('status', 'active')
  const { data, error } = await q
  if (error) throw error
  return data as TrendAlertEvent[]
}

export async function listStats(watchId: string, days = 30): Promise<TrendAlertStat[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('trend_alert_stats_daily')
    .select('*')
    .eq('watch_id', watchId)
    .gte('day', since)
    .order('day', { ascending: true })
  if (error) throw error
  return data as TrendAlertStat[]
}

export async function listRuns(watchId: string, limit = 50): Promise<TrendAlertRun[]> {
  const { data, error } = await supabase
    .from('trend_alert_runs')
    .select('*')
    .eq('watch_id', watchId)
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as TrendAlertRun[]
}

/** Month-to-date spend per watch item (IST month), from the recorded per-check costs. */
export async function monthSpendByWatch(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('trend_alert_runs')
    .select('watch_id,est_cost_usd')
    .gte('started_at', monthStartIso())
  if (error) throw error
  const out: Record<string, number> = {}
  for (const r of data as { watch_id: string; est_cost_usd: number }[]) {
    out[r.watch_id] = (out[r.watch_id] ?? 0) + Number(r.est_cost_usd || 0)
  }
  return out
}

/** Relevant stories per watch item over the last 24 hours, for the list cards. */
export async function recentEventCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('trend_alert_events')
    .select('watch_id')
    .eq('status', 'active')
    .gte('last_seen_at', new Date(Date.now() - 86_400_000).toISOString())
  if (error) throw error
  const out: Record<string, number> = {}
  for (const r of data as { watch_id: string }[]) out[r.watch_id] = (out[r.watch_id] ?? 0) + 1
  return out
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export type RuleInput = Omit<TrendAlertRule, 'id' | 'watch_id' | 'created_at'>

export async function listRules(watchId: string): Promise<TrendAlertRule[]> {
  const { data, error } = await supabase
    .from('trend_alert_rules')
    .select('*')
    .eq('watch_id', watchId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as TrendAlertRule[]
}

export async function createRule(watchId: string, input: RuleInput): Promise<void> {
  const { error } = await supabase.from('trend_alert_rules').insert({ ...input, watch_id: watchId })
  if (error) throw error
}

export async function updateRule(id: string, input: Partial<RuleInput>): Promise<void> {
  const { error } = await supabase.from('trend_alert_rules').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase.from('trend_alert_rules').delete().eq('id', id)
  if (error) throw error
}

export async function testRule(id: string): Promise<void> {
  const { error } = await supabase.rpc('trend_alerts_test_rule', { p_rule_id: id })
  if (error) throw new Error(error.message)
}

export function splitList(text: string): string[] {
  return text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
}
