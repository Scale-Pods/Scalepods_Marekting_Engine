// Exports a Canva design as PNG and uploads it into content-media. Input:
// { designId, itemId }. Output: { url }. Called via supabase-js from the FE.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CANVA_CLIENT_ID = Deno.env.get('CANVA_CLIENT_ID') ?? ''
const CANVA_CLIENT_SECRET = Deno.env.get('CANVA_CLIENT_SECRET') ?? ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function getAccessToken(supabase: SupabaseClient): Promise<string> {
  const { data: conn } = await supabase.from('canva_connections').select('*').eq('key', 'default').maybeSingle()
  // `status` can get reset to 'pending' by a hit to canva-oauth-start that never completes
  // (e.g. an abandoned reconnect attempt) even though a still-valid token pair from an
  // earlier successful connection is sitting right there — trust the token, not the label.
  if (!conn || !conn.access_token || !conn.refresh_token) throw new Error('Canva is not connected yet')
  if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() > Date.now() + 60_000) {
    return conn.access_token
  }
  const res = await fetch('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  })
  if (!res.ok) throw new Error('Failed to refresh Canva token')
  const tok = await res.json()
  const expiresAt = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString()
  await supabase
    .from('canva_connections')
    .update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, token_expires_at: expiresAt })
    .eq('key', 'default')
  return tok.access_token
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  try {
    const { designId, itemId } = await req.json()
    if (!designId) return new Response(JSON.stringify({ error: 'designId is required' }), { status: 400, headers: CORS_HEADERS })

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const accessToken = await getAccessToken(supabase)

    const exportRes = await fetch('https://api.canva.com/rest/v1/exports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ design_id: designId, format: { type: 'png' } }),
    })
    if (!exportRes.ok) throw new Error(`Canva export failed (${exportRes.status})`)
    const exportJob = await exportRes.json()
    const jobId = exportJob.job?.id
    if (!jobId) throw new Error('Canva did not return an export job id')

    let downloadUrl: string | null = null
    for (let i = 0; i < 15 && !downloadUrl; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const statusRes = await fetch(`https://api.canva.com/rest/v1/exports/${jobId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      const statusJson = await statusRes.json()
      if (statusJson.job?.status === 'success') downloadUrl = statusJson.job.urls?.[0]
      else if (statusJson.job?.status === 'failed') throw new Error('Canva export job failed')
    }
    if (!downloadUrl) throw new Error('Canva export timed out')

    const fileRes = await fetch(downloadUrl)
    const bytes = new Uint8Array(await fileRes.arrayBuffer())
    const path = `canva/${itemId ?? designId}-${Date.now()}.png`
    const { error: uploadError } = await supabase.storage.from('content-media').upload(path, bytes, { contentType: 'image/png', upsert: true })
    if (uploadError) throw uploadError

    const { data } = supabase.storage.from('content-media').getPublicUrl(path)
    return new Response(JSON.stringify({ url: data.publicUrl }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
