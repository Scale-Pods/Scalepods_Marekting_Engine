import { supabase } from './supabase'

/**
 * Client-side brand stamping.
 *
 * Why this lives in the browser: the `brand-overlay` edge function is a deliberate pass-through —
 * server-side WASM compositing (ImageScript, magick-wasm, imagescript) hit boot errors and worker
 * crashes on this project's Supabase tier, so it re-uploads the source bytes unchanged (verified:
 * a Quick Post image and its "branded" copy have identical MD5s). The real stamp has always been
 * MediaEditor's canvas export — but only images a human happened to open in MediaEditor ever got
 * it, so nothing the generation pipeline produced was ever actually branded.
 *
 * This module is that same canvas logic, extracted so the AI Studio can stamp a generated image
 * automatically on the way to Creative Review. MediaEditor keeps its own crop/rotate/filter
 * export (it needs the extra passes); both share `loadImage` and the same logo placement rules.
 */

const LOGO_URL = 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/brand/logo-white.png'

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Required or the canvas is tainted and toBlob() throws — the Supabase storage bucket is
    // public and sends permissive CORS headers, so this succeeds for our own generated images.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Draws the wordmark onto an image and returns the composite. Same 20%-width-capped-at-180px
 * placement MediaEditor uses, so a Studio-stamped image and a hand-edited one look identical.
 *
 * A failure to load the logo is non-fatal (matching MediaEditor): you get the unstamped image
 * back rather than losing the generation entirely. The caller can tell the difference — see
 * `stamped` in the result.
 */
export async function stampBrand(imageUrl: string): Promise<{ blob: Blob; stamped: boolean }> {
  const image = await loadImage(imageUrl)

  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0)

  let stamped = false
  try {
    const logo = await loadImage(LOGO_URL)
    const targetW = Math.min(180, Math.round(canvas.width * 0.2))
    const targetH = (logo.height / logo.width) * targetW
    const margin = Math.round(canvas.width * 0.035)
    ctx.drawImage(logo, margin, margin, targetW, targetH)
    stamped = true
  } catch {
    // Logo unreachable — keep the image, report it wasn't stamped.
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png')
  })
  return { blob, stamped }
}

/**
 * Stamps `imageUrl` and uploads the result, returning the new public URL. Used by the AI Studio
 * when a variant is accepted, so what reaches Creative Review is genuinely branded rather than
 * merely sitting under a `branded/` path.
 */
export async function stampAndUpload(imageUrl: string, pathPrefix: string): Promise<{ url: string; stamped: boolean }> {
  const { blob, stamped } = await stampBrand(imageUrl)
  const path = `${pathPrefix}/${Date.now()}.png`
  const { error } = await supabase.storage.from('content-media').upload(path, blob, {
    contentType: 'image/png',
    upsert: true,
  })
  if (error) throw error
  const { data } = supabase.storage.from('content-media').getPublicUrl(path)
  return { url: data.publicUrl, stamped }
}
