// Instagram redirects the browser here after the user approves the connection.
// No custom auth header is attached by that redirect, so verify_jwt is disabled.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const INSTAGRAM_APP_ID = Deno.env.get('INSTAGRAM_APP_ID') ?? ''
const INSTAGRAM_APP_SECRET = Deno.env.get('INSTAGRAM_APP_SECRET') ?? ''
const REDIRECT_URI = Deno.env.get('INSTAGRAM_REDIRECT_URI') ?? `${SUPABASE_URL}/functions/v1/instagram-oauth-callback`
const SITE_URL = Deno.env.get('SITE_URL') ?? ''

function page(message: string, ok: boolean) {
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;background:#04070D;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center;max-width:420px;padding:24px"><h2 style="color:${ok ? '#B1D997' : '#CC6B49'}">${message}</h2><p style="color:#9aa;">You can close this tab${SITE_URL ? ` or <a href="${SITE_URL}/settings" style="color:#63A5E7">go back to Growth OS</a>` : ''}.</p></div></body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  )
}

async function markError(supabase: ReturnType<typeof createClient>, message: string) {
  await supabase.from('instagram_connections').update({ status: 'error', error_message: message }).eq('key', 'default')
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error')
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  if (oauthError) {
    await markError(supabase, oauthError)
    return page(`Instagram connection failed: ${oauthError}`, false)
  }
  if (!code || !state) return page('Missing code or state parameter', false)

  const { data: conn } = await supabase.from('instagram_connections').select('*').eq('key', 'default').maybeSingle()
  if (!conn || conn.state !== state) return page('State mismatch - please retry the connection', false)

  // Step 1: authorization code -> short-lived token (1hr). Business Login keeps this exchange
  // on api.instagram.com even though the authorize screen itself is on www.instagram.com.
  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: INSTAGRAM_APP_ID,
      client_secret: INSTAGRAM_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code,
    }),
  })
  if (!shortRes.ok) {
    const detail = await shortRes.text()
    await markError(supabase, `short-lived token exchange failed (${shortRes.status}): ${detail}`)
    return page(`Instagram connection failed (${shortRes.status})`, false)
  }
  const shortTok = await shortRes.json()

  // Step 2: short-lived -> long-lived token (~60 days, refreshable while >24h old).
  const longUrl = new URL('https://graph.instagram.com/access_token')
  longUrl.searchParams.set('grant_type', 'ig_exchange_token')
  longUrl.searchParams.set('client_secret', INSTAGRAM_APP_SECRET)
  longUrl.searchParams.set('access_token', shortTok.access_token)
  const longRes = await fetch(longUrl.toString())
  if (!longRes.ok) {
    const detail = await longRes.text()
    await markError(supabase, `long-lived token exchange failed (${longRes.status}): ${detail}`)
    return page(`Instagram connection failed (${longRes.status})`, false)
  }
  const longTok = await longRes.json()
  const expiresAt = new Date(Date.now() + (longTok.expires_in ?? 5184000) * 1000).toISOString()

  // Step 3: who did we just connect? (for the Settings page "Connected as @username" display)
  const meRes = await fetch(`https://graph.instagram.com/v22.0/me?fields=user_id,username&access_token=${longTok.access_token}`)
  const me = meRes.ok ? await meRes.json() : {}

  await supabase
    .from('instagram_connections')
    .update({
      access_token: longTok.access_token,
      token_expires_at: expiresAt,
      ig_user_id: me.user_id ?? shortTok.user_id ?? null,
      username: me.username ?? null,
      status: 'connected',
      error_message: null,
      connected_at: new Date().toISOString(),
    })
    .eq('key', 'default')

  return page(me.username ? `Instagram connected as @${me.username}` : 'Instagram connected successfully', true)
})
