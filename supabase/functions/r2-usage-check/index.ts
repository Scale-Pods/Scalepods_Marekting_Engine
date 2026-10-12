// Daily R2 storage watch. Adds up everything in the R2 bucket, records it, and warns the owner and
// admins (in-app + email, through the same notifications table the board digests use) when it
// reaches 5 GB, 8 GB, and 10 GB (the free allowance; beyond it R2 bills about $0.015 per GB-month).
// Also warns on a sudden jump (more than 2 GB in a day), which would suggest runaway uploads.
// Called by pg_cron once a day. verify_jwt is OFF because the caller is the database, not a user;
// instead the request must carry the shared secret in x-usage-secret.
import { AwsClient } from 'npm:aws4fetch@1.0.20'
import { createClient } from 'npm:@supabase/supabase-js@2'

const GUARD = 'df2cfea2f50248a7933bddfdfd8af55e'
const GB = 1_000_000_000 // Cloudflare bills in decimal gigabytes
const LEVELS = [
  { level: 1, bytes: 5 * GB, label: '5 GB', note: 'Half of the 10 GB free allowance.' },
  { level: 2, bytes: 8 * GB, label: '8 GB', note: 'Close to the 10 GB free allowance. Time to clear out old media or plan for the small paid rate.' },
  { level: 3, bytes: 10 * GB, label: '10 GB', note: 'The free 10 GB is used up. From here Cloudflare charges about $0.015 per GB a month, so 100 GB is roughly $1.50 a month.' },
]
const JUMP_BYTES = 2 * GB

Deno.serve(async (req) => {
  if (req.headers.get('x-usage-secret') !== GUARD) return new Response('forbidden', { status: 403 })
  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const simulate = url.searchParams.get('simulate_bytes')

  const secret = (n: string) => (Deno.env.get(n) ?? '').trim()
  const endpoint = secret('R2_ENDPOINT').replace(/\/+$/, '')
  const bucket = secret('R2_BUCKET')
  const aws = new AwsClient({ accessKeyId: secret('R2_ACCESS_KEY_ID'), secretAccessKey: secret('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Add up the bucket, 1,000 files at a time.
  let bytes = 0
  let objects = 0
  if (simulate) {
    bytes = Number(simulate)
  } else {
    let token = ''
    for (let page = 0; page < 200; page++) {
      const listUrl = `${endpoint}/${bucket}?list-type=2&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`
      const res = await aws.fetch(listUrl)
      if (!res.ok) return Response.json({ error: `R2 list failed (${res.status})` }, { status: 502 })
      const xml = await res.text()
      for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) { bytes += Number(m[1]); objects++ }
      const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
      if (!next || !/<IsTruncated>true<\/IsTruncated>/.test(xml)) break
      token = next[1]
    }
  }

  const { data: last } = await sb.from('r2_usage_log').select('bytes,alert_level').order('checked_at', { ascending: false }).limit(1).maybeSingle()
  const reached = LEVELS.filter((l) => bytes >= l.bytes).at(-1)?.level ?? 0
  const lastLevel = last?.alert_level ?? 0
  const jumped = last ? bytes - Number(last.bytes) >= JUMP_BYTES : false

  const messages: { title: string; body: string }[] = []
  if (reached > lastLevel) {
    const l = LEVELS.find((x) => x.level === reached)!
    messages.push({ title: `Media storage has reached ${l.label}`, body: `${(bytes / GB).toFixed(1)} GB of media is now stored on Cloudflare R2. ${l.note}` })
  }
  if (jumped) {
    messages.push({ title: 'Media storage jumped in one day', body: `Storage grew by ${((bytes - Number(last!.bytes)) / GB).toFixed(1)} GB since the last check (now ${(bytes / GB).toFixed(1)} GB). If you did not upload that much, tell the developer.` })
  }

  const result = { bytes, objects, gb: Number((bytes / GB).toFixed(3)), level: reached, previous_level: lastLevel, jumped, would_notify: messages.map((m) => m.title) }
  if (dry) return Response.json({ ...result, dry: true })

  await sb.from('r2_usage_log').insert({ bytes, objects, alert_level: reached })
  if (messages.length) {
    const { data: admins } = await sb.from('app_users').select('id').in('role', ['owner', 'admin']).neq('status', 'suspended')
    const rows = (admins ?? []).flatMap((a) => messages.map((m) => ({ user_id: a.id, type: 'storage-alert', title: m.title, body: m.body, link: '/settings' })))
    if (rows.length) await sb.from('notifications').insert(rows)
  }
  return Response.json(result)
})
