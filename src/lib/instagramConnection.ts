import { supabase } from './supabase'

/** Token-free status row - see the instagram_connection_status view (instagram_connections
 *  itself is service-role only, the access_token never reaches the browser). */
export interface InstagramConnectionStatus {
  key: string
  username: string | null
  status: 'pending' | 'connected' | 'disconnected' | 'error'
  connected_at: string | null
  token_expires_at: string | null
  error_message: string | null
  updated_at: string
}

/** Opens the Instagram Business Login OAuth flow in a new tab (server-side token exchange). */
export function connectInstagram(): void {
  window.open(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-oauth-start`, '_blank')
}

export async function getInstagramConnectionStatus(): Promise<InstagramConnectionStatus | null> {
  const { data, error } = await supabase.from('instagram_connection_status').select('*').eq('key', 'default').maybeSingle()
  if (error) throw error
  return data as InstagramConnectionStatus | null
}

export async function disconnectInstagram(): Promise<void> {
  const { error } = await supabase.functions.invoke('instagram-disconnect')
  if (error) throw error
}
