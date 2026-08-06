import { supabase, fireWebhook } from './supabase'

// Credit-safety master flags (CLAUDE.md / TRD §11). GENERATION_ENABLED gates the
// text/image FE triggers below. PUBLISHING_ENABLED gates publish webhooks (Step 7).
// Video engines (HeyGen, fal.ai) are NEVER wired to a trigger here — manual n8n only.
export const GENERATION_ENABLED = true
export const PUBLISHING_ENABLED = true

export type ContentType =
  | 'static_image' | 'carousel' | 'ugc_video' | 'motion_graphics' | 'product_video'
  | 'blog' | 'social_caption' | 'linkedin_article' | 'website_content' | 'email' | 'story'

export type ContentStatus =
  | 'pending' | 'generating' | 'ready' | 'in_review' | 'approved' | 'revision'
  | 'failed' | 'published' | 'scheduled' | 'publishing'

/** Image Engine filter — must match exactly (credit safety: never video). */
export const IMAGE_CONTENT_TYPES: ContentType[] = ['static_image', 'carousel', 'social_caption']
export const VIDEO_CONTENT_TYPES: ContentType[] = ['ugc_video', 'motion_graphics', 'product_video']

export interface ContentSlide {
  idx: number
  title: string
  caption: string
  url: string
}

export interface ContentItemMetadata {
  hashtags?: string[]
  cta?: string
  keywords?: string[]
  seo_notes?: string
  hook?: string
  pillar?: string
  slides?: ContentSlide[]
  branded?: boolean
}

export interface ContentItem {
  id: string
  run_id: string
  profile_id: string
  strategy_id: string | null
  calendar_index: number | null
  content_type: ContentType
  status: ContentStatus
  platform: string
  scheduled_date: string | null
  title: string | null
  body: string | null
  media_url: string | null
  thumbnail_url: string | null
  metadata: ContentItemMetadata
  review_notes: string | null
  revision_count: number
  error_message: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export interface ContentRun {
  id: string
  profile_id: string
  strategy_id: string | null
  status: string
  total_items: number
  completed_items: number
  ai_summary: string | null
  created_at: string
  updated_at: string
}

export async function getLatestRun(profileId: string): Promise<ContentRun | null> {
  const { data, error } = await supabase
    .from('content_runs')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as ContentRun | null
}

export async function listItemsForRun(runId: string): Promise<ContentItem[]> {
  const { data, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('run_id', runId)
    .order('calendar_index', { ascending: true })
  if (error) throw error
  return data as ContentItem[]
}

/** Fires the Content Text Engine (M6). Auto-chains Image Engine -> Branding Overlay. */
export async function triggerContentGeneration(profileId: string): Promise<void> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  await fireWebhook('sp-content-text', { profileId })
}

/** Fires the Carousel Generator for one item (plans + generates 4 slides). */
export async function triggerCarousel(itemId: string): Promise<void> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  await fireWebhook('sp-carousel', { itemId })
}

/** Items awaiting creative review (M8): ready for the first time, or sent back for revision. */
export async function listReviewItems(profileId: string): Promise<ContentItem[]> {
  const { data, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('profile_id', profileId)
    .in('status', ['ready', 'revision'])
    .order('scheduled_date', { ascending: true })
  if (error) throw error
  return data as ContentItem[]
}

export async function approveItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('content_items')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await fireWebhook('sp-notify', { type: 'approved', itemId: id }).catch(() => {})
}

export async function approveAllItems(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('content_items')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .in('id', ids)
  if (error) throw error
}

export async function sendBackItem(id: string, notes: string): Promise<void> {
  const { error } = await supabase.from('content_items').update({ status: 'revision', review_notes: notes }).eq('id', id)
  if (error) throw error
  await fireWebhook('sp-notify', { type: 'revision', itemId: id }).catch(() => {})
}

/** Replaces an item's creative (upload / Canva / Figma / MediaEditor export). */
export async function replaceItemMedia(id: string, mediaUrl: string): Promise<void> {
  const { data: existing, error: fetchErr } = await supabase.from('content_items').select('metadata').eq('id', id).single()
  if (fetchErr) throw fetchErr
  const metadata = { ...(existing?.metadata ?? {}), branded: true }
  const { error } = await supabase.from('content_items').update({ media_url: mediaUrl, metadata }).eq('id', id)
  if (error) throw error
}

/** Fires the Content Revision workflow (M8 "Revise with AI") — regenerates copy for one item. */
export async function reviseWithAi(itemId: string, notes: string): Promise<void> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  await fireWebhook('sp-content-revise', { itemId, notes })
}
