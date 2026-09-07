import { supabase, fireWebhook } from './supabase'
import { GENERATION_ENABLED, VIDEO_GENERATION_ENABLED } from './content'
import type { StudioSourceKind, StudioCopy } from './studio'
import type { CarouselSlide, RenderProgress } from './carousels'
import type { AspectRatio } from './studioStyles'

// Re-exported so page code can import everything Video Studio needs from one module, same as
// carousels.ts does for CarouselStudio.tsx.
export { describeProgress, overallProgress } from './carousels'
export type { CarouselSlide, RenderProgress } from './carousels'

export type VideoJobStatus = 'drafting' | 'draft_ready' | 'rendering' | 'done' | 'failed'
export type VideoType = 'motion_graphics' | 'generated_clips'

export const VIDEO_ENGINES = ['veo-3.1-lite', 'veo-3.1-fast', 'veo-3.1-standard'] as const
export type VideoEngine = (typeof VIDEO_ENGINES)[number]
export const ENGINE_LABEL: Record<VideoEngine, string> = {
  'veo-3.1-lite': 'Veo 3.1 Lite',
  'veo-3.1-fast': 'Veo 3.1 Fast',
  'veo-3.1-standard': 'Veo 3.1 Standard',
}

/** Real 1080p Veo 3.1 pricing (ai.google.dev/gemini-api/docs/pricing, confirmed 2026-09-08 —
 *  see docs/video-studio-trd-phase2.md §1). Duplicated in carousel-studio/veo.js and the
 *  ScalePods · Video Brief n8n workflow — three places with no shared build step between them,
 *  kept in sync by hand, same convention this project already uses elsewhere (TARGET_DIMENSIONS
 *  etc). This copy drives the FE's live cost estimate; the worker's copy is what actually bills. */
export const PRICE_PER_SECOND: Record<VideoEngine, number> = {
  'veo-3.1-lite': 0.08,
  'veo-3.1-fast': 0.12,
  'veo-3.1-standard': 0.40,
}

/** Hard per-video spend ceiling (PRD §8's proposed default, locked 2026-09-08 — see the PRD's
 *  "Phase 2 decisions" block). The Approve & Generate button is disabled above this, not just
 *  warned — "structurally impossible, not just unlikely" is the PRD's own bar. */
export const PER_VIDEO_CEILING_USD = 5

export interface VideoShot {
  index: number
  prompt: string
  onScreenText?: string
  durationS: 4 | 6 | 8
  status: 'pending' | 'generating' | 'done' | 'failed'
  clipUrl: string | null
  costUsd: number | null
  errorDetail?: string | null
}

/** Sum of every shot's real cost at its engine's real per-second rate — used both for the live
 *  estimate shown before Approve & Generate (all shots still 'pending', so this IS the estimate)
 *  and for a "what did this actually cost" total once some/all shots have a real costUsd. */
export function estimateShotsCost(engine: VideoEngine, shots: VideoShot[]): number {
  const rate = PRICE_PER_SECOND[engine]
  const total = shots.reduce((sum, s) => sum + (s.costUsd ?? s.durationS * rate), 0)
  return Math.round(total * 100) / 100
}

/** Mirrors carousel_studio/studio_jobs' shape closely — see docs/video-studio-trd.md §3a/§3d and
 *  docs/video-studio-trd-phase2.md §3 for why each field reuses an existing type instead of
 *  redefining it. `outline_json`/`engine`+`shots_json` are mutually exclusive depending on
 *  `video_type` — a motion_graphics job only ever populates the former, a generated_clips job
 *  only ever the latter. */
export interface VideoJob {
  id: string
  profile_id: string
  source_kind: StudioSourceKind
  source_signal_id: string | null
  topic: string
  platform: string
  aspect_ratio: AspectRatio
  video_type: VideoType
  status: VideoJobStatus
  outline_json: CarouselSlide[] | null
  copy_json: StudioCopy | null
  voiceover_script: string | null
  voiceover_url: string | null
  render_progress: RenderProgress | null
  final_video_url: string | null
  error_detail: string | null
  content_item_id: string | null
  engine: VideoEngine | null
  shots_json: VideoShot[] | null
  estimated_cost_usd: number | null
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

/** Fires ScalePods · Video Brief — one GPT-4o call writes the post copy AND, depending on
 *  `videoType`, either a motion-graphics slide outline or a generated-clips shot storyboard
 *  (+ an optional voiceover script), and the workflow responds synchronously with the inserted
 *  row. Same "review before anything is spent" framing as generateStudioBrief/
 *  generateCarouselOutline — nothing is rendered/generated yet at this point, even for
 *  generated_clips (the brief step is a GPT call only; Veo isn't touched until Approve &
 *  Generate). */
export async function generateVideoBrief(params: {
  profileId: string
  sourceKind: StudioSourceKind
  signalId?: string | null
  topic: string
  platform: string
  aspectRatio: AspectRatio
  wantsVoiceover: boolean
  videoType: VideoType
  /** motion_graphics only */
  slideCount?: number
  /** generated_clips only */
  engine?: VideoEngine
  shotCount?: number
}): Promise<VideoJob> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  if (params.videoType === 'generated_clips' && !VIDEO_GENERATION_ENABLED) {
    throw new Error('AI video generation is disabled (VIDEO_GENERATION_ENABLED=false)')
  }
  const res = await fireWebhook('sp-video-brief', {
    profileId: params.profileId,
    sourceKind: params.sourceKind,
    signalId: params.signalId ?? null,
    topic: params.topic,
    platform: params.platform,
    aspectRatio: params.aspectRatio,
    wantsVoiceover: params.wantsVoiceover,
    videoType: params.videoType,
    slideCount: params.slideCount,
    engine: params.engine,
    shotCount: params.shotCount,
  })
  return (await res.json()) as VideoJob
}

/** Persists outline/shots/copy/voiceover-script edits made in the review step, before
 *  rendering/generating. */
export async function updateVideoDraft(
  jobId: string,
  patch: {
    outline_json?: CarouselSlide[]
    shots_json?: VideoShot[]
    estimated_cost_usd?: number
    copy_json?: StudioCopy
    voiceover_script?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('video_jobs').update(patch).eq('id', jobId)
  if (error) throw error
}

/** Fires ScalePods · Video Render, which POSTs to the Railway worker's /render-video
 *  (motion_graphics) or /generate-video (generated_clips) and returns immediately — the actual
 *  work takes minutes. Poll getVideoJob()/listVideoJobs() and watch status/render_progress/
 *  shots_json/final_video_url, same pattern as triggerCarouselRender. This is the step that
 *  spends real money for a generated_clips job — the caller must have already shown the real
 *  cost + gotten explicit confirmation (PRD §8 guardrail #3) before calling this. */
export async function triggerVideoRender(jobId: string, videoType: VideoType): Promise<void> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  if (videoType === 'generated_clips' && !VIDEO_GENERATION_ENABLED) {
    throw new Error('AI video generation is disabled (VIDEO_GENERATION_ENABLED=false)')
  }
  await fireWebhook('sp-video-render', { jobId })
}

/** Re-generates exactly ONE shot (fires ScalePods · Video Regenerate Shot). Does not re-run
 *  assembly — the worker uploads the regenerated clip and the next Approve & Generate reuses it
 *  instead of paying for it again, mirroring AI Studio's per-slide regenerate economics. */
export async function regenerateVideoShot(jobId: string, shotIndex: number): Promise<void> {
  if (!VIDEO_GENERATION_ENABLED) throw new Error('AI video generation is disabled (VIDEO_GENERATION_ENABLED=false)')
  await fireWebhook('sp-video-regenerate-shot', { jobId, shotIndex })
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
