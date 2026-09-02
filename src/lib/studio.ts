import { supabase, fireWebhook } from './supabase'
import { GENERATION_ENABLED } from './content'
import type { AspectRatio } from './studioStyles'

/**
 * AI Studio — job CRUD + the image-model registry.
 *
 * Shaped deliberately like carousels.ts: a sync webhook for the fast GPT step (returns the row
 * directly, no polling) and an async webhook for the slow generation step (poll the row). That
 * split is already proven by Carousel Studio, so both the FE and the n8n side follow a pattern
 * this codebase has debugged once already.
 */

// --- Model registry -------------------------------------------------------
// The single seam for adding providers. The UI enables/disables controls off these capability
// flags, and the n8n `sp-studio-generate` workflow switches on `id`. Adding a model later is one
// entry here plus one Switch branch there — no schema change, no page rewrite.
//
// Every Higgsfield entry below is transcribed from their live OpenAPI spec (docs.higgsfield.ai/
// docs/openapi.json), so the param names and allowed values are real, not guessed.

export type ImageModelId =
  | 'gpt-image-1'
  | 'higgsfield-soul'
  | 'higgsfield-soul-reference'
  | 'higgsfield-soul-character'
  | 'higgsfield-popcorn'
  | 'flux-pro-kontext'

export interface ImageModel {
  id: ImageModelId
  label: string
  provider: 'openai' | 'higgsfield'
  blurb: string
  /** Accepts a reference image to steer style/content. */
  supportsReference: boolean
  /** Accepts a saved Higgsfield character (custom_reference_id). */
  supportsCharacter: boolean
  /** Most variants this model will return in one call. */
  maxVariants: number
  /** Ratios this model actually accepts — the picker only offers these. */
  aspectRatios: AspectRatio[]
  /** False until the provider's credential is bound in n8n; the UI shows it greyed with a note
   *  rather than hiding it, so it's obvious what unlocks once the key lands. */
  available: boolean
}

/** Flip to true the moment the Higgsfield credential is bound in n8n (see the Studio plan —
 *  credentials come from cloud.higgsfield.ai and are sent as `Key <KEY_ID>:<KEY_SECRET>`).
 *  Nothing else needs to change: the workflow branches already exist. */
export const HIGGSFIELD_ENABLED = false

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: 'gpt-image-1',
    label: 'OpenAI · gpt-image-1',
    provider: 'openai',
    blurb: 'Reliable all-rounder. Strong at diagrams and clean graphic work.',
    supportsReference: false,
    supportsCharacter: false,
    maxVariants: 4,
    // gpt-image-1 takes pixel sizes, not ratio strings — mapped in the workflow.
    aspectRatios: ['1:1', '4:5', '16:9'],
    available: true,
  },
  {
    id: 'higgsfield-soul',
    label: 'Higgsfield · Soul',
    provider: 'higgsfield',
    blurb: 'Best photographic and editorial quality. Up to 4K.',
    supportsReference: false,
    supportsCharacter: false,
    maxVariants: 4,
    aspectRatios: ['1:1', '4:5', '9:16', '16:9', '4:3', '3:2'],
    available: HIGGSFIELD_ENABLED,
  },
  {
    id: 'higgsfield-soul-reference',
    label: 'Higgsfield · Soul (reference)',
    provider: 'higgsfield',
    blurb: 'Matches the look of an image you attach.',
    supportsReference: true,
    supportsCharacter: false,
    maxVariants: 4,
    aspectRatios: ['1:1', '4:5', '9:16', '16:9', '4:3', '3:2'],
    available: HIGGSFIELD_ENABLED,
  },
  {
    id: 'higgsfield-soul-character',
    label: 'Higgsfield · Soul (character)',
    provider: 'higgsfield',
    blurb: 'Keeps a saved person consistent across posts.',
    supportsReference: true,
    supportsCharacter: true,
    maxVariants: 4,
    aspectRatios: ['1:1', '4:5', '9:16', '16:9', '4:3', '3:2'],
    available: HIGGSFIELD_ENABLED,
  },
  {
    id: 'higgsfield-popcorn',
    label: 'Higgsfield · Popcorn',
    provider: 'higgsfield',
    blurb: 'Blends up to 8 reference images. Good for moodboards.',
    supportsReference: true,
    supportsCharacter: false,
    maxVariants: 8,
    aspectRatios: ['1:1', '4:5', '9:16', '16:9', '4:3', '3:2'],
    available: HIGGSFIELD_ENABLED,
  },
  {
    id: 'flux-pro-kontext',
    label: 'Flux Pro · Kontext Max',
    provider: 'higgsfield',
    blurb: 'Sharp typography and graphic composition.',
    supportsReference: false,
    supportsCharacter: false,
    maxVariants: 1,
    aspectRatios: ['1:1', '4:5', '9:16', '16:9', '4:3', '3:2'],
    available: HIGGSFIELD_ENABLED,
  },
]

export function getModel(id: string | null | undefined): ImageModel | null {
  if (!id) return null
  return IMAGE_MODELS.find((m) => m.id === id) ?? null
}

// --- Job -----------------------------------------------------------------

export type StudioJobStatus = 'drafting' | 'draft_ready' | 'generating' | 'done' | 'failed'
export type StudioSourceKind = 'trend' | 'strategy' | 'topic'

/** The editable copy GPT drafts alongside the image prompt. Same field names the Content Text
 *  Engine already writes into content_items.metadata, so handing off costs no translation. */
export interface StudioCopy {
  hook?: string
  body?: string
  hashtags?: string[]
  cta?: string
}

export interface StudioJob {
  id: string
  profile_id: string
  status: StudioJobStatus
  source_kind: StudioSourceKind
  source_signal_id: string | null
  topic: string
  platform: string
  aspect_ratio: string
  style_id: string | null
  model: ImageModelId
  reference_image_url: string | null
  character_id: string | null
  variant_count: number
  copy_json: StudioCopy | null
  image_prompt: string | null
  image_urls: string[]
  selected_image_url: string | null
  provider_request_id: string | null
  error_detail: string | null
  content_item_id: string | null
  created_at: string
  updated_at: string
}

export async function listStudioJobs(profileId: string): Promise<StudioJob[]> {
  const { data, error } = await supabase
    .from('studio_jobs')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data as StudioJob[]
}

export async function getStudioJob(id: string): Promise<StudioJob | null> {
  const { data, error } = await supabase.from('studio_jobs').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as StudioJob | null
}

/**
 * Fires the brief workflow — GPT writes the copy AND an art-directed image prompt from real
 * context (the trend signal / approved strategy / winning hooks), then inserts the job row.
 * Responds synchronously with the row (one GPT call, a few seconds), same as
 * generateCarouselOutline — no polling for this step.
 *
 * Nothing is generated yet: the point is that the image prompt is reviewed and editable BEFORE
 * any image credit is spent. That review step is the main fix for the clip-art output.
 */
export async function generateStudioBrief(params: {
  profileId: string
  sourceKind: StudioSourceKind
  signalId?: string | null
  topic: string
  platform: string
  aspectRatio: string
  styleId: string
  model: ImageModelId
  referenceImageUrl?: string | null
  characterId?: string | null
  variantCount: number
  /** Human label + the full art-direction text for the chosen style. Sent from the app rather
   *  than looked up in n8n so the wording stays versioned here (studioStyles.ts) and shows up in
   *  a diff when it changes. */
  styleLabel: string
  styleDirection: string
}): Promise<StudioJob> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  const res = await fireWebhook('sp-studio-brief', {
    profileId: params.profileId,
    sourceKind: params.sourceKind,
    signalId: params.signalId ?? null,
    topic: params.topic,
    platform: params.platform,
    aspectRatio: params.aspectRatio,
    styleId: params.styleId,
    styleLabel: params.styleLabel,
    styleDirection: params.styleDirection,
    model: params.model,
    referenceImageUrl: params.referenceImageUrl ?? null,
    characterId: params.characterId ?? null,
    variantCount: params.variantCount,
  })
  return (await res.json()) as StudioJob
}

/** Persists edits made to the copy / image prompt in the review step, before generating. */
export async function updateStudioDraft(
  jobId: string,
  patch: { copy_json?: StudioCopy; image_prompt?: string; aspect_ratio?: string; model?: ImageModelId; variant_count?: number },
): Promise<void> {
  const { error } = await supabase.from('studio_jobs').update(patch).eq('id', jobId)
  if (error) throw error
}

/** Fires the generation workflow. Returns immediately — poll getStudioJob() and watch
 *  status/image_urls, exactly like the carousel render step. */
export async function triggerStudioGenerate(jobId: string): Promise<void> {
  if (!GENERATION_ENABLED) throw new Error('Content generation is disabled (GENERATION_ENABLED=false)')
  await fireWebhook('sp-studio-generate', { jobId })
}

export async function selectStudioVariant(jobId: string, imageUrl: string): Promise<void> {
  const { error } = await supabase.from('studio_jobs').update({ selected_image_url: imageUrl }).eq('id', jobId)
  if (error) throw error
}

/** Links the job to the content_items row it produced, so the Studio can show "already sent to
 *  review" instead of silently letting the same job be pushed through twice. */
export async function markStudioJobUsed(jobId: string, contentItemId: string): Promise<void> {
  const { error } = await supabase.from('studio_jobs').update({ content_item_id: contentItemId }).eq('id', jobId)
  if (error) throw error
}

export async function deleteStudioJob(jobId: string): Promise<void> {
  const { error } = await supabase.from('studio_jobs').delete().eq('id', jobId)
  if (error) throw error
}
