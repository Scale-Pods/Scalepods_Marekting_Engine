// Lists the connected Canva account's designs (Canva Connect API). Called via
// supabase-js from the authenticated FE, so verify_jwt stays enabled.
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
  if (!conn || conn.status !== 'connected') throw new Error('Canva is not connected yet')
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
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const accessToken = await getAccessToken(supabase)
    const res = await fetch('https://api.canva.com/rest/v1/designs', { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) throw new Error(`Canva API error (${res.status})`)
    const data = await res.json()
    const designs = (data.items ?? []).map((d: Record<string, unknown>) => ({
      id: d.id,
      title: (d as { title?: string }).title ?? 'Untitled',
      thumbnailUrl: (d as { thumbnail?: { url?: string } }).thumbnail?.url ?? null,
    }))
    return new Response(JSON.stringify({ designs }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
})
