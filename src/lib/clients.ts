import { supabase, fireWebhook } from './supabase'

/** One structured competitor entry — replaces the old free-text "Competitors" textarea.
 *  `source` distinguishes a manually-typed entry from one accepted out of an AI search run
 *  (competitors.ts), purely for display ("Found by AI" badge); both are edited identically. */
export interface Competitor {
  id: string
  name: string
  website: string | null
  socials: {
    instagram?: string
    facebook?: string
    linkedin?: string
    youtube?: string
  }
  source: 'manual' | 'ai'
}

export interface BusinessProfile {
  id: string
  business_name: string | null
  tagline: string | null
  industry: string | null
  description: string | null
  products_services: string | null
  target_audience: string | null
  business_goals: string | null
  brand_guidelines: string | null
  brand_voice: string | null
  target_platforms: string[]
  competitors: string | null
  competitor_profiles: Competitor[]
  website_url: string | null
  social_media_urls: Record<string, string>
  assets: { name: string; url: string }[]
  additional_notes: string | null
  phone: string | null
  email: string | null
  address: string | null
  hours: string | null
  service_areas: string[]
  fb_page_id: string | null
  /** Per-profile avatar/cover — fall back to the generic ScalePods placeholder assets when
   *  unset. Previously these were hardcoded static files (`/brand/logo-square.jpg` /
   *  `/brand/profile-banner.png`) shown identically for every profile, ScalePods or not. */
  logo_url: string | null
  cover_url: string | null
  status: string
  created_at: string
  updated_at: string
}

export type BusinessProfileInput = Partial<
  Omit<BusinessProfile, 'id' | 'created_at' | 'updated_at'>
>

export async function listProfiles(): Promise<BusinessProfile[]> {
  const { data, error } = await supabase
    .from('business_profiles')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as BusinessProfile[]
}

// --- Active profile (the profile switcher) ----------------------------------
// The app was single-profile-only for a long time (every page just took profiles[0], the
// oldest one) — that stopped being enough the moment a second real profile could exist
// alongside it. Which profile is "active" now persists per-browser here; lib/queries.ts's
// useProfile() is what actually resolves it (falling back to profiles[0] if the stored id
// doesn't match anything, e.g. it was deleted).
const ACTIVE_PROFILE_KEY = 'sp-active-profile-id'

export function getStoredActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY)
  } catch {
    return null
  }
}

export function setStoredActiveProfileId(id: string) {
  try {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id)
  } catch {
    // Storage full or blocked (private mode) — the switch still works for this tab via the
    // react-query cache (see useSetActiveProfile), it just won't survive a reload.
  }
}

export async function getProfile(id: string): Promise<BusinessProfile> {
  const { data, error } = await supabase.from('business_profiles').select('*').eq('id', id).single()
  if (error) throw error
  return data as BusinessProfile
}

export async function createProfile(input: BusinessProfileInput): Promise<BusinessProfile> {
  const { data, error } = await supabase.from('business_profiles').insert(input).select().single()
  if (error) throw error
  return data as BusinessProfile
}

export async function updateProfile(id: string, input: BusinessProfileInput): Promise<BusinessProfile> {
  const { data, error } = await supabase.from('business_profiles').update(input).eq('id', id).select().single()
  if (error) throw error
  return data as BusinessProfile
}

/** Every table with a profile_id FK cascades on delete (content_items, scheduled_posts,
 *  business_intelligence_reports, marketing_strategies, trend_runs/signals, post_analytics,
 *  notifications, ai_insights) — deleting a profile wipes all of it, permanently, in one go.
 *  Callers must confirm clearly before calling this; see countProfileContent for surfacing the
 *  real scope of that beforehand. */
export async function deleteProfile(id: string): Promise<void> {
  const { error } = await supabase.from('business_profiles').delete().eq('id', id)
  if (error) throw error
}

/** Content item count for a profile — used to make the delete-profile confirmation say
 *  something concrete ("...and its 42 posts...") instead of a generic "this can't be undone". */
export async function countProfileContent(id: string): Promise<number> {
  const { count, error } = await supabase.from('content_items').select('id', { count: 'exact', head: true }).eq('profile_id', id)
  if (error) throw error
  return count ?? 0
}

/** Fires the AI Analysis n8n workflow (M3). Writes a new business_intelligence_reports row. */
export async function triggerAiAnalysis(profileId: string): Promise<void> {
  await fireWebhook('sp-ai-analysis', { profileId })
}

export interface BIReport {
  id: string
  profile_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  website_analysis: string | null
  instagram_analysis: string | null
  facebook_analysis: string | null
  linkedin_analysis: string | null
  competitor_analysis: string | null
  seo_analysis: string | null
  audience_analysis: string | null
  full_report: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export async function listReports(profileId: string): Promise<BIReport[]> {
  const { data, error } = await supabase
    .from('business_intelligence_reports')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as BIReport[]
}

export async function getReport(id: string): Promise<BIReport> {
  const { data, error } = await supabase.from('business_intelligence_reports').select('*').eq('id', id).single()
  if (error) throw error
  return data as BIReport
}

export async function getLatestReport(profileId: string): Promise<BIReport | null> {
  const { data, error } = await supabase
    .from('business_intelligence_reports')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as BIReport | null
}
