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

/** Base URL for firing n8n webhooks (workflow triggers). */
export const N8N_WEBHOOK_BASE = import.meta.env.VITE_N8N_WEBHOOK_BASE ?? ''
