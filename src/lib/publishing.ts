import { supabase, fireWebhook } from './supabase'
import { PUBLISHING_ENABLED, type ContentItem } from './content'

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
