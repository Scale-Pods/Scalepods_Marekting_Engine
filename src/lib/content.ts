import { supabase, fireWebhook } from './supabase'
import { pushNotification } from './notifications'

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

/**
 * Platforms actually in use — YouTube/Facebook are still part of the wider platform surface
 * (Meta Graph publish nodes, PlatformBadge glyphs, etc.) but generate/show no content right
 * now. Content Text Engine (n8n) filters its calendar to this same list before generating, so
 * this FE filter and that generation-side filter always agree. Update both together.
 */
export const ACTIVE_PLATFORMS = ['instagram', 'linkedin'] as const

export function isActivePlatform(platform?: string | null): boolean {
  return (ACTIVE_PLATFORMS as readonly string[]).includes((platform || '').toLowerCase())
}

/**
 * Which LinkedIn identity a post goes out as. Values here MUST match the string literals the
 * "LinkedIn Account Router" switch in the ScalePods · Publishing Engine n8n workflow checks
 * for ('hrishikesh' | 'adnan' | 'raunak') — the switch has no fallback branch, so any other
 * value (a stale 'founder2', a typo, etc.) makes the post silently vanish with no error and no
 * publish. Update both together.
 *
 * "company_page" has no matching branch yet — it's offered here so the composer doesn't need a
 * follow-up change, but selecting it today is a no-op until Community Management API's
 * w_organization_social approval lands and that branch gets added (pending as of 2026-08-13).
 */
export const LINKEDIN_ACCOUNTS: { value: string; label: string }[] = [
  { value: 'hrishikesh', label: "Hrishikesh's LinkedIn Account" },
  { value: 'adnan', label: "Adnan's LinkedIn Account" },
  { value: 'raunak', label: "Raunak's LinkedIn Account" },
  { value: 'company_page', label: 'ScalePods Page' },
]

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
  /** 24h "HH:mm", local to whoever composed the post — kept for display alongside
   *  scheduled_date (a DATE column with no time component). Not used for the actual firing:
   *  see scheduled_at, which is the unambiguous instant. */
  scheduled_time?: string
  /**
   * Absolute target instant as a UTC ISO string, computed in the browser where the composer's
   * timezone is actually known. n8n has no idea what timezone the user is in, so it must never
   * reconstruct this from scheduled_date + scheduled_time (doing so treated IST wall-clock as
   * UTC and scheduled posts 5.5h late). This is what the Publishing Engine schedules on.
   */
  scheduled_at?: string
  /** Which of LINKEDIN_ACCOUNTS this post goes out as — only meaningful when platform is
   *  linkedin. Read by the Publishing Engine (n8n) to pick the right credential/author URN. */
  linkedin_account?: string
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
  const { data, error } = await supabase
    .from('content_items')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', id)
    .select('profile_id,title')
    .single()
  if (error) throw error
  await fireWebhook('sp-notify', { type: 'approved', itemId: id }).catch(() => {})
  // In-app bell for the rest of the team. Fire-and-forget for the same reason the webhook is:
  // failing to record a notification must never fail the approval itself.
  await pushNotification({
    profileId: data?.profile_id,
    type: 'approved',
    title: 'Post approved',
    body: data?.title ?? null,
    itemId: id,
    link: '/publishing',
  }).catch(() => {})
}

export async function approveAllItems(ids: string[]): Promise<void> {
  const { data, error } = await supabase
    .from('content_items')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .in('id', ids)
    .select('profile_id')
  if (error) throw error
  await pushNotification({
    profileId: data?.[0]?.profile_id,
    type: 'approved',
    title: `${ids.length} post${ids.length === 1 ? '' : 's'} approved`,
    body: 'Ready to publish.',
    link: '/publishing',
  }).catch(() => {})
}

export async function sendBackItem(id: string, notes: string): Promise<void> {
  const { data, error } = await supabase
    .from('content_items')
    .update({ status: 'revision', review_notes: notes })
    .eq('id', id)
    .select('profile_id,title')
    .single()
  if (error) throw error
  await fireWebhook('sp-notify', { type: 'revision', itemId: id }).catch(() => {})
  await pushNotification({
    profileId: data?.profile_id,
    type: 'revision',
    title: 'Post sent back for revision',
    body: notes || data?.title || null,
    itemId: id,
    link: '/review',
  }).catch(() => {})
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

/**
 * Hand-authored post from the "Create post" composer (Content Factory / Creative Review).
 * Inserted directly as `approved` — there's no AI draft to review, the user already finished
 * it in the composer — so it lands straight in Publishing's "Ready to publish" list and flows
 * through the exact same real Post now / Schedule pipeline as an AI-generated item.
 */
export async function createManualItem(input: {
  profileId: string
  platform: string
  contentType: 'static_image' | 'social_caption'
  title: string | null
  body: string
  mediaUrl: string | null
  hashtags: string[]
  cta: string
  scheduledDate: string | null
  scheduledTime: string | null
  scheduledAt: string | null
  linkedinAccount: string | null
}): Promise<ContentItem> {
  const { data, error } = await supabase
    .from('content_items')
    .insert({
      run_id: null,
      profile_id: input.profileId,
      strategy_id: null,
      calendar_index: null,
      content_type: input.contentType,
      status: 'approved',
      approved_at: new Date().toISOString(),
      platform: input.platform,
      scheduled_date: input.scheduledDate,
      title: input.title,
      body: input.body,
      media_url: input.mediaUrl,
      metadata: {
        hashtags: input.hashtags,
        ...(input.cta ? { cta: input.cta } : {}),
        ...(input.scheduledTime ? { scheduled_time: input.scheduledTime } : {}),
        ...(input.scheduledAt ? { scheduled_at: input.scheduledAt } : {}),
        ...(input.linkedinAccount ? { linkedin_account: input.linkedinAccount } : {}),
      },
    })
    .select()
    .single()
  if (error) throw error
  return data as ContentItem
}
