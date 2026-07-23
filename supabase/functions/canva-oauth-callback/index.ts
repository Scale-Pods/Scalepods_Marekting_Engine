// Canva redirects the browser here after the user approves the connection.
// No custom auth header is attached by that redirect, so verify_jwt is disabled.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CANVA_CLIENT_ID = Deno.env.get('CANVA_CLIENT_ID') ?? ''
const CANVA_CLIENT_SECRET = Deno.env.get('CANVA_CLIENT_SECRET') ?? ''
const REDIRECT_URI = Deno.env.get('CANVA_REDIRECT_URI') ?? `${SUPABASE_URL}/functions/v1/canva-oauth-callback`

function page(message: string) {
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;background:#04070D;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>${message}</h2><p>You can close this tab.</p></div></body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  )
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')
  if (oauthError) return page(`Canva connection failed: ${oauthError}`)
  if (!code || !state) return page('Missing code or state parameter')

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: conn } = await supabase.from('canva_connections').select('*').eq('key', 'default').maybeSingle()
  if (!conn || conn.state !== state) return page('State mismatch — please retry the connection')

  const tokenRes = await fetch('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: conn.code_verifier,
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!tokenRes.ok) return page(`Token exchange failed (${tokenRes.status})`)
  const tok = await tokenRes.json()
  const expiresAt = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString()

  await supabase
    .from('canva_connections')
    .update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      token_expires_at: expiresAt,
      status: 'connected',
    })
    .eq('key', 'default')

  return page('Canva connected successfully')
})
