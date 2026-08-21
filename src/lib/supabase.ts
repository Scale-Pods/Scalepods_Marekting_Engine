import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Surface misconfig loudly in dev rather than failing with an opaque 401.
  console.error('[ScalePods] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/** Supabase Storage rejects object keys containing characters outside a narrow safe set —
 *  apostrophes and spaces are common real-world offenders ("Invalid key" error) — and every
 *  uploader in this app builds its storage path straight from the user's original filename, so a
 *  file named e.g. "Raunak's Post.pdf" fails at upload with no earlier warning. Strips/replaces
 *  anything outside [a-zA-Z0-9._-], collapses repeats, and keeps the extension intact so the file
 *  is still recognizable in the storage browser. */
export function sanitizeStorageFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const safeBase = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const safeExt = ext.replace(/[^a-zA-Z0-9.]+/g, '')
  return (safeBase || 'file') + safeExt
}

/** Base URL for firing n8n webhooks (workflow triggers). */
export const N8N_WEBHOOK_BASE = import.meta.env.VITE_N8N_WEBHOOK_BASE ?? ''

/** Fires an n8n webhook by path (e.g. 'sp-ai-analysis'). Workflow responds 200 immediately and works async. */
export async function fireWebhook(path: string, body?: Record<string, unknown>) {
  if (!N8N_WEBHOOK_BASE) throw new Error('VITE_N8N_WEBHOOK_BASE is not configured')
  const res = await fetch(`${N8N_WEBHOOK_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) throw new Error(`Webhook ${path} failed (${res.status})`)
  return res
}
