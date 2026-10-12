// Gives the signed-in app a short-lived link to upload ONE file straight to Cloudflare R2, so
// big media (video, PDF, images) no longer counts against Supabase storage or egress.
// Input:  { path, contentType, size }   (path like "manual/<profileId>/<timestamp>-<name>")
// Output: { uploadUrl, publicUrl, path } — the browser PUTs the file to uploadUrl with the same
//         Content-Type, then stores publicUrl as the file's address.
// Secrets (Supabase > Edge Functions > Secrets): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL. They never reach the browser.
import { AwsClient } from 'npm:aws4fetch@1.0.20'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MB = 1024 * 1024
// Only these top-level folders may be written through this function.
const ALLOWED_PREFIXES = ['manual', 'studio-refs', 'review-attachments', 'blog', 'brand-assets', 'edited', 'import']
// Files are served publicly from a separate domain; never host anything a browser would run.
const BLOCKED_TYPES = new Set([
  'text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/javascript', 'application/javascript',
  'application/x-msdownload', 'application/x-sh', 'application/x-httpd-php',
])
const UPLOAD_LINK_SECONDS = 600

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function maxBytes(contentType: string) {
  return contentType.startsWith('video/') ? 300 * MB : 100 * MB
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Secrets are trimmed: a value pasted into the dashboard with a trailing newline or space would
  // otherwise break request signing in a way that is very hard to spot.
  const secret = (name: string) => (Deno.env.get(name) ?? '').trim()
  const accessKeyId = secret('R2_ACCESS_KEY_ID')
  const secretAccessKey = secret('R2_SECRET_ACCESS_KEY')
  const endpoint = secret('R2_ENDPOINT').replace(/\/+$/, '')
  const bucket = secret('R2_BUCKET')
  const publicUrl = secret('R2_PUBLIC_URL').replace(/\/+$/, '')
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket || !publicUrl) {
    return json({ error: 'R2 storage is not configured' }, 500)
  }

  // Who is asking: a real, signed-in, active team member (same bar as the existing storage rules).
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: authData, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !authData.user) return json({ error: 'Sign in required' }, 401)
  const { data: member } = await supabase
    .from('app_users').select('id').eq('auth_user_id', authData.user.id).eq('status', 'active').maybeSingle()
  if (!member) return json({ error: 'Not an active team member' }, 403)

  let body: { path?: unknown; contentType?: unknown; size?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid request' }, 400) }
  const path = typeof body.path === 'string' ? body.path : ''
  const contentType = typeof body.contentType === 'string' && body.contentType ? body.contentType : 'application/octet-stream'
  const size = typeof body.size === 'number' ? body.size : NaN

  const segments = path.split('/')
  const pathOk =
    path.length > 0 && path.length <= 300 && segments.length >= 2 &&
    ALLOWED_PREFIXES.includes(segments[0]) &&
    segments.every((s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && s !== '..')
  if (!pathOk) return json({ error: 'That file location is not allowed' }, 400)
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(contentType) || BLOCKED_TYPES.has(contentType.toLowerCase())) {
    return json({ error: 'That file type is not allowed' }, 400)
  }
  if (!Number.isFinite(size) || size <= 0) return json({ error: 'File size is missing' }, 400)
  if (size > maxBytes(contentType)) {
    return json({ error: `File is too large (limit ${maxBytes(contentType) / MB} MB)` }, 413)
  }

  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' })
  const target = new URL(`${endpoint}/${bucket}/${path}`)
  target.searchParams.set('X-Amz-Expires', String(UPLOAD_LINK_SECONDS))
  const signed = await aws.sign(new Request(target, { method: 'PUT', headers: { 'Content-Type': contentType } }), {
    aws: { signQuery: true },
  })
  return json({ uploadUrl: signed.url, publicUrl: `${publicUrl}/${path}`, path, contentType })
})
