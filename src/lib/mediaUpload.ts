import { supabase } from './supabase'

/**
 * Where an upload goes. Big media (video, PDF, images from the composer) is stored on Cloudflare
 * R2 so it no longer counts against Supabase storage or egress. Blog images stay on Supabase: the
 * public website loads them, and the free r2.dev address is meant for internal traffic only.
 * Every other bucket (ticket attachments, brand logos) is unchanged.
 */
export function usesR2(bucket: string, path: string): boolean {
  return bucket === 'content-media' && !path.startsWith('blog/')
}

/**
 * Uploads one file to R2 and returns its public address. The browser never holds an R2 key: the
 * `r2-upload` edge function checks who is asking, then hands back a link that works for 10 minutes
 * for exactly this file name, type and size.
 */
export async function uploadToR2(path: string, file: Blob, contentType?: string): Promise<string> {
  const type = contentType || file.type || 'application/octet-stream'
  const { data, error } = await supabase.functions.invoke('r2-upload', {
    body: { path, contentType: type, size: file.size },
  })
  if (error) {
    // supabase-js hides the server's own message inside the response; pull it out so people see
    // "File is too large (limit 300 MB)" rather than a generic "non-2xx status code".
    let message = error.message
    const response = (error as { context?: Response }).context
    if (response && typeof response.json === 'function') {
      try {
        const body = await response.json()
        if (body?.error) message = body.error
      } catch { /* keep the generic message */ }
    }
    throw new Error(message)
  }
  const put = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': data.contentType ?? type }, body: file })
  if (!put.ok) throw new Error(`Upload failed (${put.status})`)
  return data.publicUrl as string
}
