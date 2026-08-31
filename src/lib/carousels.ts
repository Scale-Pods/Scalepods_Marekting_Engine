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

/** Live progress written by the Railway render worker as it works, so the UI can show what's
 *  actually happening inside a multi-minute render. The worker throttles these writes (~1/sec)
 *  but always writes immediately on a phase change, so the phase label is never stale. */
export interface RenderProgress {
  phase: 'starting' | 'loading' | 'capturing' | 'retrying' | 'encoding' | 'uploading' | 'slide_failed' | 'done' | 'failed'
  slideIndex?: number
  slideTotal?: number
  slideName?: string
  frame?: number
  frameTotal?: number
  message?: string
}

export interface CarouselJob {
  id: string
  profile_id: string
  topic: string
  comment_keyword: string | null
  platform: string
  status: CarouselJobStatus
  outline_json: CarouselSlide[] | null
  slide_urls: string[]
  render_progress: RenderProgress | null
  error_detail: string | null
  created_at: string
  updated_at: string
}

/** Human-readable one-liner for whatever the worker is doing right now. */
export function describeProgress(p: RenderProgress | null | undefined): string {
  if (!p) return 'Starting…'
  const slide = p.slideIndex && p.slideTotal ? `Slide ${p.slideIndex}/${p.slideTotal}` : null
  switch (p.phase) {
    case 'starting': return 'Preparing slides…'
    case 'loading': return `${slide ?? 'Slide'} — loading…`
    case 'capturing': return `${slide ?? 'Slide'} — capturing frame ${p.frame ?? 0}/${p.frameTotal ?? 0}`
    case 'retrying': return p.message ?? `${slide ?? 'Slide'} — retrying dropped frames`
    case 'encoding': return `${slide ?? 'Slide'} — encoding video…`
    case 'uploading': return `${slide ?? 'Slide'} — uploading…`
    case 'slide_failed': return `${slide ?? 'Slide'} failed — ${p.message ?? 'unknown error'}`
    case 'done': return 'Finished'
    case 'failed': return p.message ?? 'Render failed'
    default: return 'Working…'
  }
}

/** 0..1 across the WHOLE carousel, blending completed slides with progress inside the current
 *  one — a bar that only moved on slide completion sat still for a minute at a time. */
export function overallProgress(p: RenderProgress | null | undefined): number {
  if (!p || !p.slideTotal) return 0
  const done = Math.max(0, (p.slideIndex ?? 1) - 1)
  let within = 0
  if (p.phase === 'capturing' && p.frameTotal) within = (p.frame ?? 0) / p.frameTotal * 0.85
  else if (p.phase === 'encoding') within = 0.9
  else if (p.phase === 'uploading') within = 0.97
  else if (p.phase === 'done') return 1
  return Math.min(1, (done + within) / p.slideTotal)
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
