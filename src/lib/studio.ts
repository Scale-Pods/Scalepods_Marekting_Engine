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
// flags. Both branches in the n8n `sp-studio-generate` workflow take the model id verbatim (the
// OpenAI branch as the `model` field, the Google branch as the URL path segment before
// `:generateContent`), so `id` here MUST be the literal, real API model string for that
// provider — never an invented internal name. Adding a model later is one entry here, no
// workflow change, as long as it's a sibling model on an already-wired provider.
//
// Higgsfield was removed 2026-09-03 at the user's request (no credential was ever bound for it).

export type ImageModelId =
  | 'gpt-image-1-mini'
  | 'gpt-image-1'
  | 'gpt-image-1.5'
  | 'gpt-image-2'
  | 'gemini-2.5-flash-image'
  | 'gemini-3.1-flash-lite-image'
  | 'gemini-3.1-flash-image'
  | 'gemini-3-pro-image'

export interface ImageModel {
  id: ImageModelId
  label: string
  provider: 'openai' | 'google'
  blurb: string
  /** Accepts a reference image to steer style/content. None of the models below support this —
   *  kept on the type since AIStudio.tsx's reference-image uploader already reads it, in case a
   *  future OpenAI/Google model (or Higgsfield, if it comes back) does. */
  supportsReference: boolean
  supportsCharacter: boolean
  /** Most variants this model will return in one call. */
  maxVariants: number
  /** Ratios this model actually accepts — the picker only offers these. */
  aspectRatios: AspectRatio[]
  /** True once the model itself is confirmed to exist and be current on the provider's own
   *  official docs (not a live-fire test — the user explicitly chose "trust the docs" over
   *  spending money to test-fire every sibling model on an already-proven provider/endpoint).
   *  A model still failing for some other reason (quota, a param it doesn't like) surfaces
   *  through the existing Mark Image Failed path with the real API error, same as any model. */
  available: boolean
  /**
   * USD per single image at a square ratio, medium quality. gpt-image-1's own $0.042 figure
   * (proven live) implies ~1056 output tokens for one medium 1024x1024 image; every other
   * OpenAI price below is that same token count times that model's own official per-1M-output-
   * token rate (developers.openai.com/api/docs/pricing, checked 2026-09-03) — so the relative
   * ordering between models is trustworthy even though the absolute figure is an estimate.
   * Every Google figure is Google's own stated per-image equivalent (ai.google.dev/gemini-api/
   * docs/pricing, same date) — not derived, quoted directly. Both providers actually bill by
   * tokens/compute, not a flat per-image rate, so the FE always labels this "(est.)".
   */
  pricePerImage: number
  /** Shown as the model card's hover tooltip — source/caveat for the price estimate. */
  priceNote?: string
}

export const IMAGE_MODELS: ImageModel[] = [
  {
    id: 'gpt-image-1-mini',
    label: 'OpenAI · gpt-image-1-mini',
    provider: 'openai',
    blurb: 'Cheapest OpenAI option. Good for quick drafts.',
    supportsReference: false,
    supportsCharacter: false,
    maxVariants: 4,
    aspectRatios: ['1:1', '4:5', '16:9'],
    available: true,
    pricePerImage: 0.0084,
    priceNote: 'Estimate from OpenAI\'s official $8/1M-output-token rate',
  },
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
    priceNote: 'OpenAI medium quality — taller/wider ratios cost more. Verified live 2026-09-02.',
  },
  {
    id: 'gpt-image-1.5',
    label: 'OpenAI · gpt-image-1.5',
    provider: 'openai',
    blurb: 'Between gpt-image-1 and the newest gpt-image-2.',
    supportsReference: false,
    supportsCharacter: false,
    maxVariants: 4,
    aspectRatios: ['1:1', '4:5', '16:9'],
    available: true,
    pricePerImage: 0.0338,
    priceNote: 'Estimate from OpenAI\'s official $32/1M-output-token rate',
  },
  {
    id: 'gpt-image-2',
    label: 'OpenAI · gpt-image-2',
    provider: 'openai',
    blurb: "OpenAI's newest image model — cheaper per token than gpt-image-1 despite being newer.",
    supportsReference: false,
    supportsCharacter: false,
    maxVariants: 4,
    aspectRatios: ['1:1', '4:5', '16:9'],
    available: true,
    pricePerImage: 0.0317,
    priceNote: 'Estimate from OpenAI\'s official $30/1M-output-token rate',
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'Google · Gemini 2.5 Flash Image',
    provider: 'google',
    blurb: '"Nano Banana" — the original. Google now recommends the Lite successor instead.',
    supportsReference: false,
    supportsCharacter: false,
    maxVariants: 1,
    aspectRatios: ['1:1', '4:5', '16:9'],
    available: true,
    pricePerImage: 0.039,
    priceNote: "Google's own stated per-image rate",
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Google · Gemini Flash Image',
    provider: 'google',
    blurb: 'Fast, cheap, strong prompt following ("Nano Banana 2 Lite").',
    supportsReference: false,
    supportsCharacter: false,
    // Gemini's generateContent returns exactly one image per call, unlike gpt-image-1's `n`
    // param — capped to 1 rather than faking multi-variant support with N sequential calls, so
    // the on-screen cost never implies a batch discount that doesn't exist.
    maxVariants: 1,
    aspectRatios: ['1:1', '4:5', '16:9'],
    available: true,
    pricePerImage: 0.034,
    priceNote: "Nano Banana 2 Lite — Google's own stated rate, verified live 2026-09-03",
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Google · Gemini 3.1 Flash Image',
    provider: 'google',
    blurb: '"Nano Banana 2" — newer and pricier than the Lite version above.',
    supportsReference: false,
    supportsCharacter: false,
    maxVariants: 1,
    aspectRatios: ['1:1', '4:5', '16:9'],
    available: true,
    pricePerImage: 0.067,
    priceNote: "Google's own stated per-image rate",
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Google · Gemini 3 Pro Image',
    provider: 'google',
    blurb: '"Nano Banana Pro" — best quality in the family, up to 4K.',
    supportsReference: false,
    supportsCharacter: false,
    maxVariants: 1,
    aspectRatios: ['1:1', '4:5', '16:9'],
    available: true,
    pricePerImage: 0.134,
    priceNote: "Google's own stated rate at 1K/2K — 4K output costs more (~$0.24)",
  },
]

export function getModel(id: string | null | undefined): ImageModel | null {
  if (!id) return null
  return IMAGE_MODELS.find((m) => m.id === id) ?? null
}

/** Live cost estimate shown next to the Generate button, so a variant count or model switch is
 *  priced before it's clicked rather than after. Always an estimate — see ImageModel.pricePerImage. */
export function estimateStudioCost(model: ImageModel | null, ratio: AspectRatio, variantCount: number): { usd: number | null } {
  if (!model) return { usd: null }
  // A non-1:1 ratio renders more pixels than the base square price accounts for — OpenAI's own
  // tiered pricing charges roughly 1.5x for its 1024x1536/1536x1024 sizes over 1024x1024.
  const perImage = ratio === '1:1' ? model.pricePerImage : model.pricePerImage * 1.5
  return { usd: perImage * Math.max(1, variantCount) }
}

/** Approximate USD→INR rate — fluctuates daily, last checked 2026-09-03 (~₹94.5/$1 per
 *  live market rates that day). Display convenience only, per the user's request to see both
 *  currencies; never used for anything that touches real billing. */
export const USD_TO_INR = 94.5

/** "$0.042 (₹3.97)" — the shared USD+INR format used everywhere the Studio shows a price. */
export function formatUsdInr(usd: number, decimals = 3): string {
  return `$${usd.toFixed(decimals)} (₹${(usd * USD_TO_INR).toFixed(2)})`
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
