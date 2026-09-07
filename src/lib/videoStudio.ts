import { supabase, fireWebhook } from './supabase'
import { GENERATION_ENABLED } from './content'
import type { StudioSourceKind, StudioCopy } from './studio'
import type { CarouselSlide, RenderProgress } from './carousels'
import type { AspectRatio } from './studioStyles'

// Re-exported so page code can import everything Video Studio needs from one module, same as
// carousels.ts does for CarouselStudio.tsx.
export { describeProgress, overallProgress } from './carousels'
export type { CarouselSlide, RenderProgress } from './carousels'

export type VideoJobStatus = 'drafting' | 'draft_ready' | 'rendering' | 'done' | 'failed'

/** Mirrors carousel_studio/studio_jobs' shape closely — see docs/video-studio-trd.md §3a/§3d for
 *  why each field reuses an existing type instead of redefining it. */
export interface VideoJob {
  id: string
  profile_id: string
  source_kind: StudioSourceKind
  source_signal_id: string | null
  topic: string
  platform: string
  aspect_ratio: AspectRatio
  video_type: 'motion_graphics'
  status: VideoJobStatus
  outline_json: CarouselSlide[] | null
  copy_json: StudioCopy | null
  voiceover_script: string | null
  voiceover_url: string | null
  render_progress: RenderProgress | null
  final_video_url: string | null
  error_detail: string | null
  content_item_id: string | null
  created_at: string
  updated_at: string
}

export async function listVideoJobs(profileId: string): Promise<VideoJob[]> {
  const { data, error } = await supabase
    .from('video_jobs')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data as VideoJob[]
}

export async function getVideoJob(id: string): Promise<VideoJob | null> {
  const { data, error } = await supabase.from('video_jobs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as VideoJob | null
}

/** Fires ScalePods · Video Brief — one GPT-4o call writes the post copy AND the slide outline
 *  (+ an optional voiceover script), and the workflow responds synchronously with the inserted
 *  row. Same "review before anything is spent" framing as generateStudioBrief/
 *  generateCarouselOutline — nothing is rendered yet at this point. */
export async function generateVideoBrief(params: {
  profileId: string
  sourceKind: StudioSourceKind
  signalId?: string | null
  topic: string
  platform: string
  aspectRatio: AspectRatio
  slideCount: number
  wantsVoiceover: boolean
}): Promise<VideoJob> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  const res = await fireWebhook('sp-video-brief', {
    profileId: params.profileId,
    sourceKind: params.sourceKind,
    signalId: params.signalId ?? null,
    topic: params.topic,
    platform: params.platform,
    aspectRatio: params.aspectRatio,
    slideCount: params.slideCount,
    wantsVoiceover: params.wantsVoiceover,
  })
  return (await res.json()) as VideoJob
}

/** Persists outline/copy/voiceover-script edits made in the review step, before rendering. */
export async function updateVideoDraft(
  jobId: string,
  patch: { outline_json?: CarouselSlide[]; copy_json?: StudioCopy; voiceover_script?: string | null },
): Promise<void> {
  const { error } = await supabase.from('video_jobs').update(patch).eq('id', jobId)
  if (error) throw error
}

/** Fires ScalePods · Video Render, which POSTs to the Railway worker's /render-video and returns
 *  immediately — the actual stitch+encode takes minutes. Poll getVideoJob()/listVideoJobs() and
 *  watch status/render_progress/final_video_url, same pattern as triggerCarouselRender. */
export async function triggerVideoRender(jobId: string): Promise<void> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  await fireWebhook('sp-video-render', { jobId })
}

export async function deleteVideoJob(jobId: string): Promise<void> {
  const { error } = await supabase.from('video_jobs').delete().eq('id', jobId)
  if (error) throw error
}

/** Links the job to the content_items row Send to Review produced — same purpose as
 *  markStudioJobUsed, so Video Studio can show "already sent to review" instead of letting the
 *  same finished video be pushed through twice. */
export async function markVideoJobUsed(jobId: string, contentItemId: string): Promise<void> {
  const { error } = await supabase.from('video_jobs').update({ content_item_id: contentItemId }).eq('id', jobId)
  if (error) throw error
}
