// Starts the Instagram Business Login OAuth flow (Instagram API with Instagram Login - the
// same product the Comment-to-DM send already uses, see comment-to-dm-instagram memory).
// Browser navigates here directly (not via supabase-js), so verify_jwt is disabled.
// ScalePods-only single connection: one row, key='default' (no multi-account support - see
// the Part C scope decision in that memory before generalizing this).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const INSTAGRAM_APP_ID = Deno.env.get('INSTAGRAM_APP_ID') ?? ''
const REDIRECT_URI = Deno.env.get('INSTAGRAM_REDIRECT_URI') ?? `${SUPABASE_URL}/functions/v1/instagram-oauth-callback`

// New (post Jan-2025) Instagram Login scope names - the old business_basic/business_manage_*
// names are deprecated. Matches what the Comment-to-DM send token already uses.
const SCOPES = ['instagram_business_basic', 'instagram_business_manage_comments', 'instagram_business_manage_messages'].join(',')

Deno.serve(async () => {
  if (!INSTAGRAM_APP_ID) {
    return new Response('Instagram is not configured yet - set INSTAGRAM_APP_ID as a Supabase Edge Function secret.', { status: 500 })
  }

  const state = crypto.randomUUID()

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  await supabase
    .from('instagram_connections')
    .upsert({ key: 'default', state, status: 'pending', error_message: null }, { onConflict: 'key' })

  // Business Login for Instagram: the authorize screen itself lives on instagram.com (distinct
  // from the token-exchange endpoint below, which stays on api.instagram.com) - confirmed against
  // Meta's current Instagram Platform docs, not the older deprecated Basic Display API.
  const authorizeUrl = new URL('https://www.instagram.com/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', INSTAGRAM_APP_ID)
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', SCOPES)
  authorizeUrl.searchParams.set('state', state)

  return Response.redirect(authorizeUrl.toString(), 302)
})
