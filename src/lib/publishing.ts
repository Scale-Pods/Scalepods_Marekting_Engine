import { supabase, fireWebhook } from './supabase'
import { PUBLISHING_ENABLED, updateContentItemText, type ContentItem } from './content'

export interface ScheduledPost {
  id: string
  content_item_id: string
  profile_id: string
  platform: string
  caption: string | null
  media_url: string | null
  title: string | null
  platform_post_id: string | null
  post_url: string | null
  post_type: string | null
  status: string
  scheduled_time: string | null
  published_at: string | null
  error: string | null
  retry_count: number
  ai_best_time: unknown
  created_at: string
}

export async function listApprovedItems(profileId: string): Promise<ContentItem[]> {
  const { data, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('profile_id', profileId)
    .eq('status', 'approved')
    .order('scheduled_date', { ascending: true })
  if (error) throw error
  return data as ContentItem[]
}

export async function listScheduledPosts(profileId: string): Promise<ScheduledPost[]> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data as ScheduledPost[]
}

/** Fires the Publishing Engine (M9). scheduleNow=true posts immediately; false uses AI best-time scheduling. */
export async function triggerPublish(itemId: string, scheduleNow: boolean): Promise<void> {
  if (!PUBLISHING_ENABLED) throw new Error('Publishing is disabled (PUBLISHING_ENABLED=false)')
  await fireWebhook('sp-publish', { itemId, scheduleNow })
}

/**
 * Cancels a scheduled post: removes it from the scheduler's queue (deleting the row here is
 * what stops the Publishing Scheduler's "Fetch Due Posts" query from ever picking it up) and
 * returns the underlying content item to 'approved' so it lands back in "Ready to publish" —
 * cancelling means stop the automatic firing, not discard the post. Realtime (queries.ts) picks
 * up both changes immediately, no reload needed.
 */
export async function cancelScheduledPost(post: ScheduledPost): Promise<void> {
  const { error: delErr } = await supabase.from('scheduled_posts').delete().eq('id', post.id)
  if (delErr) throw delErr
  const { data: existing, error: fetchErr } = await supabase
    .from('content_items')
    .select('metadata')
    .eq('id', post.content_item_id)
    .single()
  if (fetchErr) throw fetchErr
  const metadata = { ...(existing?.metadata ?? {}) }
  delete metadata.scheduled_at
  const { error } = await supabase
    .from('content_items')
    .update({ status: 'approved', metadata })
    .eq('id', post.content_item_id)
  if (error) throw error
}

/**
 * Edits the text of an already-scheduled post. One free-text caption field (not a separate
 * hashtags input) — the post may already have hashtags typed inline in its body, and trying to
 * split those back out of existing text to re-populate a separate field is exactly the kind of
 * fragile text-parsing worth avoiding; a real caption editor just lets you edit the whole thing.
 * `metadata.hashtags` is cleared so the Publishing Engine's Build Context doesn't append the
 * OLD structured hashtags on top of whatever's now inline in body, duplicating them on the live
 * post. Updates the source content_item (what the Publishing Engine actually re-reads at the
 * real publish moment — an edit here reaches the live post even after scheduling) and this
 * row's own cached caption/title (what Publishing's own "Recent activity" preview displays), so
 * the two never drift apart.
 */
export async function editScheduledPost(
  post: ScheduledPost,
  patch: { title: string | null; body: string },
): Promise<void> {
  await updateContentItemText(post.content_item_id, { title: patch.title, body: patch.body, hashtags: [] })
  const { error } = await supabase
    .from('scheduled_posts')
    .update({ caption: patch.body, title: patch.title })
    .eq('id', post.id)
  if (error) throw error
}
