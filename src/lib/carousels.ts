import { supabase, fireWebhook } from './supabase'
import { GENERATION_ENABLED } from './content'

export type CarouselSlideType = 'cover' | 'step' | 'stat' | 'cta'

/** One slide in a carousel outline — shape matches carousel-studio/gen.js's templates exactly
 *  (flat, no nested "fields" wrapper). Not every field applies to every type; gen.js just reads
 *  whichever ones its template for that `type` needs. */
export interface CarouselSlide {
  type: CarouselSlideType
  pose?: 'casual' | 'pointing' | 'victory' | 'arms-crossed' | 'phone'
  eyebrow?: string
  headline?: string
  subhead?: string
  heading?: string
  stepLabel?: string
  items?: { heading: string; body?: string }[]
  value?: number
  suffix?: string
  label?: string
  keyword?: string
}

export type CarouselJobStatus = 'drafting' | 'draft_ready' | 'rendering' | 'done' | 'failed'

export interface CarouselJob {
  id: string
  profile_id: string
  topic: string
  comment_keyword: string | null
  platform: string
  status: CarouselJobStatus
  outline_json: CarouselSlide[] | null
  slide_urls: string[]
  error_detail: string | null
  created_at: string
  updated_at: string
}

export async function listCarouselJobs(profileId: string): Promise<CarouselJob[]> {
  const { data, error } = await supabase
    .from('carousel_jobs')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data as CarouselJob[]
}

export async function getCarouselJob(id: string): Promise<CarouselJob | null> {
  const { data, error } = await supabase.from('carousel_jobs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as CarouselJob | null
}

/** Fires the outline-generation n8n workflow. Unlike every other webhook in this app, this one
 *  responds synchronously with the created row's real content (a single GPT call, a few seconds)
 *  — no polling needed for this step, only the render step below is long-running. */
export async function generateCarouselOutline(params: {
  profileId: string
  topic: string
  commentKeyword: string
  platform?: string
}): Promise<CarouselJob> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  const res = await fireWebhook('sp-carousel-outline', {
    profileId: params.profileId,
    topic: params.topic,
    commentKeyword: params.commentKeyword,
    platform: params.platform ?? 'instagram',
  })
  return (await res.json()) as CarouselJob
}

/** Persists outline edits made in the review step, before the user approves & renders. */
export async function updateCarouselOutline(jobId: string, outline: CarouselSlide[]): Promise<void> {
  const { error } = await supabase.from('carousel_jobs').update({ outline_json: outline }).eq('id', jobId)
  if (error) throw error
}

/** Fires the render-trigger workflow, which POSTs to the Railway render worker and returns
 *  immediately — the actual render takes minutes. Progress/result is NOT in this response; poll
 *  getCarouselJob()/listCarouselJobs() and watch status/slide_urls instead. */
export async function triggerCarouselRender(jobId: string): Promise<void> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  await fireWebhook('sp-carousel-render', { jobId })
}

export async function deleteCarouselJob(jobId: string): Promise<void> {
  const { error } = await supabase.from('carousel_jobs').delete().eq('id', jobId)
  if (error) throw error
}
