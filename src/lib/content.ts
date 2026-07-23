import { supabase, fireWebhook } from './supabase'

// Credit-safety master flags (CLAUDE.md / TRD §11). GENERATION_ENABLED gates the
// text/image FE triggers below. PUBLISHING_ENABLED gates publish webhooks (Step 7).
// Video engines (HeyGen, fal.ai) are NEVER wired to a trigger here — manual n8n only.
export const GENERATION_ENABLED = true
export const PUBLISHING_ENABLED = false

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
