import { supabase, fireWebhook } from './supabase'

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
  website_url: string | null
  social_media_urls: Record<string, string>
  assets: { name: string; url: string }[]
  additional_notes: string | null
  fb_page_id: string | null
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
