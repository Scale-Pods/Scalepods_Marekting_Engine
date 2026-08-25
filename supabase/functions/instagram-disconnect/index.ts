// Called from the FE via supabase.functions.invoke (real user session attached, verify_jwt
// stays ON here - unlike the two OAuth redirect functions which the browser navigates to
// directly with no auth header). Just clears the stored token; doesn't call any Instagram API
// (there's no "revoke" endpoint in this product - the user can also revoke from their own
// Instagram app settings if they want to fully cut access).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  await supabase
    .from('instagram_connections')
    .update({
      access_token: null,
      token_expires_at: null,
      ig_user_id: null,
      username: null,
      status: 'disconnected',
      error_message: null,
      connected_at: null,
    })
    .eq('key', 'default')

  return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
})
