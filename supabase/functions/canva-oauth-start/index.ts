// Starts the Canva Connect OAuth (PKCE) flow. Browser navigates here directly
// (not via supabase-js), so verify_jwt is disabled for this function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CANVA_CLIENT_ID = Deno.env.get('CANVA_CLIENT_ID') ?? ''
const REDIRECT_URI = Deno.env.get('CANVA_REDIRECT_URI') ?? `${SUPABASE_URL}/functions/v1/canva-oauth-callback`

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return base64url(new Uint8Array(digest))
}

Deno.serve(async () => {
  if (!CANVA_CLIENT_ID) {
    return new Response('Canva is not configured yet — set CANVA_CLIENT_ID as a Supabase secret.', { status: 500 })
  }

  const state = crypto.randomUUID()
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const codeChallenge = await sha256(codeVerifier)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  await supabase
    .from('canva_connections')
    .upsert({ key: 'default', state, code_verifier: codeVerifier, status: 'pending' }, { onConflict: 'key' })

  const authorizeUrl = new URL('https://www.canva.com/api/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', CANVA_CLIENT_ID)
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', 'design:content:read design:content:write')
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('code_challenge', codeChallenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')

  return Response.redirect(authorizeUrl.toString(), 302)
})
