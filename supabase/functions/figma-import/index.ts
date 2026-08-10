// Exports a Figma frame as PNG and uploads it into content-media. Input:
// { fileKey, nodeId, itemId }. Output: { url }. Called via supabase-js from the FE.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FIGMA_PAT = Deno.env.get('FIGMA_PAT') ?? ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    if (!FIGMA_PAT) {
      return new Response(JSON.stringify({ error: 'Figma is not configured yet — set FIGMA_PAT as a Supabase secret.' }), { status: 500, headers: CORS_HEADERS })
    }
    const { fileKey, nodeId, itemId } = await req.json()
    if (!fileKey || !nodeId) {
      return new Response(JSON.stringify({ error: 'fileKey and nodeId are required' }), { status: 400, headers: CORS_HEADERS })
    }

    const imgRes = await fetch(
      `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`,
      { headers: { 'X-Figma-Token': FIGMA_PAT } },
    )
    if (!imgRes.ok) throw new Error(`Figma API error (${imgRes.status})`)
    const imgJson = await imgRes.json()
    const downloadUrl = imgJson.images?.[nodeId]
    if (!downloadUrl) throw new Error('Figma did not return an image URL for that node — check the node ID')

    const fileRes = await fetch(downloadUrl)
    const bytes = new Uint8Array(await fileRes.arrayBuffer())
    const path = `figma/${itemId ?? fileKey}-${Date.now()}.png`

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { error: uploadError } = await supabase.storage.from('content-media').upload(path, bytes, { contentType: 'image/png', upsert: true })
    if (uploadError) throw uploadError

    const { data } = supabase.storage.from('content-media').getPublicUrl(path)
    return new Response(JSON.stringify({ url: data.publicUrl }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
