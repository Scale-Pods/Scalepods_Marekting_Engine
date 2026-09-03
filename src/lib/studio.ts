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
  | 'gemini-flash-image'
  | 'higgsfield-soul'
  | 'higgsfield-soul-reference'
  | 'higgsfield-soul-character'
  | 'higgsfield-popcorn'
  | 'flux-pro-kontext'

export interface ImageModel {
  id: ImageModelId
  label: string
  provider: 'openai' | 'google' | 'higgsfield'
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
  /**
   * USD per single image at a square ratio, medium quality — shown on the model card and used
   * for the live cost estimate near Generate. `null` for models billed in the provider's own
   * credits rather than USD (every Higgsfield model: their pricing is a credit balance on
   * cloud.higgsfield.ai, not a published per-image dollar rate) — the UI shows `priceNote`
   * instead of a dollar figure for those.
   */
  pricePerImage: number | null
  /** Shown instead of a dollar figure when pricePerImage is null, or alongside it as a caveat
   *  (e.g. "varies with size/quality"). */
  priceNote?: string
}

/** Flip to true the moment the Higgsfield credential is bound in n8n (see the Studio plan —
 *  credentials come from cloud.higgsfield.ai and are sent as `Key <KEY_ID>:<KEY_SECRET>`).
 *  Nothing else needs to change: the workflow branches already exist. */
export const HIGGSFIELD_ENABLED = false

/** Credential bound and the google branch verified against 2 real calls (2026-09-03): fixed a
 *  missing aspect-ratio param (defaulted to 16:9-ish regardless of what was requested) and a
 *  hardcoded image/png that didn't match the real returned bytes (JPEG) — see
 *  ScalePods · Studio Generate's Normalize Google Response / Split Variants nodes. */
export const GOOGLE_ENABLED = true

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
    // OpenAI's published rate for medium-quality 1024x1024 (its default for this size). A
    // non-square ratio renders more pixels (1024x1536/1536x1024) and OpenAI charges more for
    // that — see estimateStudioCost, which applies the ~1.5x published for those sizes.
    pricePerImage: 0.042,
    priceNote: 'OpenAI medium quality — taller/wider ratios cost more',
  },
  {
    id: 'gemini-flash-image',
    label: 'Google · Gemini Flash Image',
    provider: 'google',
    blurb: 'Fast, cheap, strong prompt following ("Nano Banana 2 Lite").',
    supportsReference: false,
    supportsCharacter: false,
    // Gemini's generateContent returns exactly one image per call, unlike gpt-image-1's `n`
    // param — capped to 1 rather than faking multi-variant support with N sequential calls, so
    // the on-screen cost never implies a batch discount that doesn't exist. AIStudio.tsx's
    // variant-count picker already bounds itself to maxVariants, so this alone is the whole fix.
    maxVariants: 1,
    aspectRatios: ['1:1', '4:5', '16:9'],
    available: GOOGLE_ENABLED,
    // Google's published rate for gemini-3.1-flash-lite-image ("Nano Banana 2 Lite") — the
    // cheapest model in the Gemini image family, and Google's own current recommendation over
    // the older 2.5 Flash Image. Confirm against a real invoice once billed; Google's per-image
    // figures are derived from per-token pricing, not a flat published rate.
    pricePerImage: 0.034,
    priceNote: 'Nano Banana 2 Lite — approximate, confirm against your first real invoice',
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
    // Higgsfield bills from a credit balance on cloud.higgsfield.ai, not a published per-image
    // USD rate — don't fabricate a dollar figure. Once the credential is bound, replace this
    // with the real cost read from that account.
    pricePerImage: null,
    priceNote: 'Billed in Higgsfield credits, not USD',
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
    // Higgsfield bills from a credit balance on cloud.higgsfield.ai, not a published per-image
    // USD rate — don't fabricate a dollar figure. Once the credential is bound, replace this
    // with the real cost read from that account.
    pricePerImage: null,
    priceNote: 'Billed in Higgsfield credits, not USD',
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
    // Higgsfield bills from a credit balance on cloud.higgsfield.ai, not a published per-image
    // USD rate — don't fabricate a dollar figure. Once the credential is bound, replace this
    // with the real cost read from that account.
    pricePerImage: null,
    priceNote: 'Billed in Higgsfield credits, not USD',
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
    // Higgsfield bills from a credit balance on cloud.higgsfield.ai, not a published per-image
    // USD rate — don't fabricate a dollar figure. Once the credential is bound, replace this
    // with the real cost read from that account.
    pricePerImage: null,
    priceNote: 'Billed in Higgsfield credits, not USD',
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
    // Higgsfield bills from a credit balance on cloud.higgsfield.ai, not a published per-image
    // USD rate — don't fabricate a dollar figure. Once the credential is bound, replace this
    // with the real cost read from that account.
    pricePerImage: null,
    priceNote: 'Billed in Higgsfield credits, not USD',
  },
]

export function getModel(id: string | null | undefined): ImageModel | null {
  if (!id) return null
  return IMAGE_MODELS.find((m) => m.id === id) ?? null
}

/**
 * Live cost estimate shown next to the Generate button, so a variant count or model switch is
 * priced before it's clicked rather than after. `usd` is null when the model's price isn't in
 * USD (Higgsfield) — render `note` instead of a dollar figure in that case.
 */
export function estimateStudioCost(
  model: ImageModel | null,
  ratio: AspectRatio,
  variantCount: number,
): { usd: number | null; note?: string } {
  if (!model) return { usd: null }
  if (model.pricePerImage == null) return { usd: null, note: model.priceNote }
  // A non-1:1 ratio renders more pixels than the base square price accounts for — OpenAI's own
  // tiered pricing charges roughly 1.5x for its 1024x1536/1536x1024 sizes over 1024x1024.
  const perImage = ratio === '1:1' ? model.pricePerImage : model.pricePerImage * 1.5
  return { usd: perImage * Math.max(1, variantCount) }
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
  /** True for the styles whose artwork IS lettering (poster, quote card). The workflow then
   *  names the exact words to set — the hook it just wrote — instead of leaving the model to
   *  invent gibberish or, worse, obeying a blanket "no text" rule and returning a wordless
   *  poster. See StudioStyle.rendersText. */
  styleRendersText: boolean
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
    styleRendersText: params.styleRendersText,
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
