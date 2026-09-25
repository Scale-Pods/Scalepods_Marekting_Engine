import { supabase, fireWebhook } from './supabase'
import type { ScheduledPost } from './publishing'

// Editing a post that is already live. See docs/edit-published-post-plan.md.
//
// The new text never goes through the n8n webhook (those are unauthenticated). The browser saves
// it as a `post_edits` row — RLS lets only an admin or the owner do that — and pokes the webhook
// with just the row's id. n8n claims the row, calls the platform, and only then updates our own
// copy of the caption, so a failed call can't leave us claiming something the live post doesn't say.

export type PostEditStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface PostEdit {
  id: string
  scheduled_post_id: string
  platform: string
  requested_by: string | null
  old_caption: string | null
  new_caption: string
  old_title: string | null
  new_title: string | null
  status: PostEditStatus
  error: string | null
  created_at: string
  completed_at: string | null
}

export const POST_EDITS_KEY = ['post_edits'] as const

/** Platform limits enforced in the dialog before anything is sent (n8n checks again). YouTube's
 *  description is the caption plus "\n\n#Shorts", hence the 9 characters held back. */
export const EDIT_LIMITS = {
  linkedin: { caption: 3000 },
  youtube: { title: 100, caption: 5000 - '\n\n#Shorts'.length },
} as const

export function isOpenEdit(e: Pick<PostEdit, 'status'>): boolean {
  return e.status === 'pending' || e.status === 'running'
}

/**
 * Why this post can't be edited, or null when it can. Shown to the person instead of hiding the
 * button, so nobody is left wondering where it went. Mirrors the checks n8n's claim step makes
 * (post_edit_claim) — the database is the one that actually refuses; this just explains early.
 */
export function editBlockReason(post: ScheduledPost): string | null {
  if (post.status !== 'published') return 'Only a published post can be edited.'
  if (post.platform === 'instagram') {
    return "Instagram doesn't let a published caption be changed through its API. To fix it, delete the post on Instagram and publish it again."
  }
  if (post.platform === 'facebook') return "Editing a live Facebook post isn't available yet."
  if (post.platform === 'x') return "X posts go out through Buffer, which can't edit a post once it is sent."
  if (post.platform !== 'linkedin' && post.platform !== 'youtube') return `Editing a live ${post.platform} post isn't supported.`
  if (!post.platform_post_id) return "This post has no platform id on record, so it can't be edited."
  if (post.platform_post_id.startsWith('buffer:')) return "This post went out through Buffer, which can't edit a post once it is sent."
  if (post.platform === 'linkedin' && post.content_items?.metadata?.linkedin_account === 'company_page') {
    return "ScalePods Page posts go out through Buffer, which can't edit a post once it is sent."
  }
  return null
}

export async function listPostEdits(scheduledPostId: string): Promise<PostEdit[]> {
  const { data, error } = await supabase
    .from('post_edits')
    .select('*')
    .eq('scheduled_post_id', scheduledPostId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return data as PostEdit[]
}

/** Records the request (RLS: admins/owner only), then wakes n8n with just its id. If the wake-up
 *  is lost the row stays 'pending' and the dialog offers a retry — claiming is once-only, so
 *  poking it twice is harmless. */
export async function requestPostEdit(
  post: ScheduledPost,
  next: { caption: string; title: string | null },
): Promise<PostEdit> {
  const { data, error } = await supabase
    .from('post_edits')
    .insert({
      scheduled_post_id: post.id,
      platform: post.platform,
      old_caption: post.caption,
      new_caption: next.caption,
      old_title: post.title,
      new_title: next.title,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  const edit = data as PostEdit
  await fireWebhook('sp-edit-published', { editId: edit.id }).catch(() => {})
  return edit
}

export async function retryPostEditWebhook(editId: string): Promise<void> {
  await fireWebhook('sp-edit-published', { editId })
}
