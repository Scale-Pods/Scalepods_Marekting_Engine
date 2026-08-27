import { supabase, fireWebhook } from './supabase'

/** One row per real Instagram comment (not just ones that matched an automation keyword) — the
 *  actual "lead magnet" data: who commented, what they said, and whether it triggered a DM.
 *  Populated two ways: real-time by the Comment-to-DM n8n workflow as comments come in, and by
 *  the on-demand `sp-ig-sync-comments` backfill (see triggerCommentSync below) which also picks
 *  up everything commented before this feature existed. Comments from the account's own reply
 *  (e.g. the public-reply feature) are filtered out server-side — this is commenters only. */
export interface InstagramLead {
  id: string
  content_item_id: string | null
  media_id: string
  comment_id: string
  commenter_id: string
  commenter_username: string | null
  comment_text: string | null
  like_count: number
  commented_at: string | null
  matched_keyword: string | null
  dm_sent: boolean
  follow_gate_status: string | null
  follower_count: number | null
  is_verified_user: boolean | null
  profile_pic_url: string | null
  enriched_at: string | null
  created_at: string
  /** Joined from the source content_item, when it's still tracked — post title/permalink for
   *  display, not stored on this row itself. */
  content_items?: { title: string | null } | null
}

export async function listInstagramLeads(): Promise<InstagramLead[]> {
  const { data, error } = await supabase
    .from('instagram_leads')
    .select('*, content_items(title)')
    .order('commented_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data as InstagramLead[]
}

/** Fires the backfill/resync workflow — pulls the full comment history for every tracked
 *  Instagram post. Safe to re-run any time: upserts on comment_id, and only ever merges in the
 *  raw comment fields, never resetting dm_sent/matched_keyword a real-time capture already set. */
export async function triggerCommentSync(): Promise<void> {
  await fireWebhook('sp-ig-sync-comments', {})
}

export function leadsToCsv(leads: InstagramLead[]): string {
  const headers = ['Username', 'Comment', 'Post', 'Commented At', 'Matched Keyword', 'DM Sent', 'Follow Status', 'Follower Count', 'Verified']
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = leads.map((l) => [
    l.commenter_username,
    l.comment_text,
    l.content_items?.title ?? l.media_id,
    l.commented_at,
    l.matched_keyword,
    l.dm_sent ? 'Yes' : 'No',
    l.follow_gate_status ?? '',
    l.follower_count ?? '',
    l.is_verified_user === null ? '' : l.is_verified_user ? 'Yes' : 'No',
  ].map(escape).join(','))
  return [headers.join(','), ...rows].join('\n')
}
