import { fireWebhook } from './supabase'

export interface TrackExternalPostInput {
  postUrl: string
  keyword: string
  message: string
  assetUrl?: string
  profileId: string
}

export interface TrackExternalPostResult {
  success: boolean
  error?: string
  contentItemId?: string
  mediaId?: string
  permalink?: string
  caption?: string
  thumbnailUrl?: string | null
  updated?: boolean
}

/** Attaches comment-to-DM automation to a real Instagram post/reel that already exists (posted
 *  outside Growth OS) by URL — n8n resolves the URL against the connected account's recent media
 *  and upserts a content_items+scheduled_posts row, so it flows through the exact same lookup the
 *  Comment-to-DM workflow already uses for composer-published posts. Re-submitting the same URL
 *  edits the existing automation rather than creating a duplicate (handled server-side). */
export async function trackExternalPost(input: TrackExternalPostInput): Promise<TrackExternalPostResult> {
  const res = await fireWebhook('sp-ig-track-post', { ...input })
  return (await res.json()) as TrackExternalPostResult
}
