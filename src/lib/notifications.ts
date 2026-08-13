import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

// Defined here rather than imported from queries.ts on purpose: content.ts imports this module
// (to record approve/send-back events), and queries.ts imports content.ts — pulling the key
// from queries.ts would close that loop into a circular import, which Vite can resolve to an
// undefined binding at module-eval time. queries.ts imports this constant instead.
export const NOTIFICATIONS_KEY = ['notifications'] as const

export interface AppNotification {
  id: string
  profile_id: string | null
  type: string
  title: string
  body: string | null
  item_id: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

/** Newest first, capped — the bell is a recent-activity feed, not an archive. */
export async function listNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return data as AppNotification[]
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
  if (error) throw error
}

/**
 * Records an in-app notification. Fire-and-forget from FE actions — a failure here must never
 * break the action that triggered it (same reasoning as the existing sp-notify webhook calls,
 * which are also .catch(() => {})).
 */
export async function pushNotification(input: {
  profileId?: string | null
  type: string
  title: string
  body?: string | null
  itemId?: string | null
  link?: string | null
}): Promise<void> {
  await supabase.from('notifications').insert({
    profile_id: input.profileId ?? null,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    item_id: input.itemId ?? null,
    link: input.link ?? null,
  })
}

export function useNotifications() {
  return useQuery({ queryKey: NOTIFICATIONS_KEY, queryFn: listNotifications })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })
}
