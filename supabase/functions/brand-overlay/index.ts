// Branding pass-through. Server-side WASM image compositing (tried deno.land/x
// ImageScript, npm:@imagemagick/magick-wasm, npm:imagescript) hit boot errors,
// compute-resource limits, and worker crashes on this project's edge function
// tier — a platform constraint, not fixable by code alone. The brand stamp is
// applied client-side instead, in MediaEditor's canvas export (reliable, and
// lets Admin/Designer preview the stamp before it's used). This function stays
// as the n8n chain's expected endpoint: it passes the image through unchanged
// so the Branding Overlay workflow always completes without erroring.
// Input: { imageUrl, itemId }. Output: { url }.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {
  try {
    const { imageUrl, itemId } = await req.json()
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: 'imageUrl is required' }), { status: 400 })
    }

    const srcRes = await fetch(imageUrl)
    if (!srcRes.ok) throw new Error(`Could not fetch source image (${srcRes.status})`)
    const bytes = new Uint8Array(await srcRes.arrayBuffer())

    const path = `branded/${itemId ?? crypto.randomUUID()}-${Date.now()}.png`
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { error: uploadError } = await supabase.storage
      .from('content-media')
      .upload(path, bytes, { contentType: 'image/png', upsert: true })
    if (uploadError) throw uploadError

    const { data } = supabase.storage.from('content-media').getPublicUrl(path)
    return new Response(JSON.stringify({ url: data.publicUrl }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
