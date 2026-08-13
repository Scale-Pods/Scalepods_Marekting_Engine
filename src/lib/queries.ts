import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from './supabase'
import { listProfiles, type BusinessProfile } from './clients'
import { listApprovedItems, listScheduledPosts } from './publishing'
import { getLatestRun, listItemsForRun, listReviewItems, isActivePlatform } from './content'
import { NOTIFICATIONS_KEY } from './notifications'

// Shared query cache. Before this every page cold-fetched on mount — including re-running
// listProfiles() on nearly every screen — so navigating back and forth refetched everything
// and the UI only ever refreshed via six separate setInterval pollers.

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Realtime (below) is what actually invalidates data, so cached results can be trusted
      // between events instead of being re-fetched on every mount/focus.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export const qk = {
  profiles: ['profiles'] as const,
  approvedItems: (profileId: string) => ['approvedItems', profileId] as const,
  scheduledPosts: (profileId: string) => ['scheduledPosts', profileId] as const,
  latestRun: (profileId: string) => ['latestRun', profileId] as const,
  runItems: (runId: string) => ['runItems', runId] as const,
  reviewItems: (profileId: string) => ['reviewItems', profileId] as const,
  notifications: NOTIFICATIONS_KEY,
  navCounts: ['navCounts'] as const,
}

/** Sidebar badge counts. Was a blind 60s setInterval; now realtime-invalidated like everything else. */
export function useNavCounts() {
  return useQuery({
    queryKey: qk.navCounts,
    queryFn: async () => {
      const [profilesRes, reviewRes] = await Promise.all([
        supabase.from('business_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('content_items').select('id', { count: 'exact', head: true }).in('status', ['ready', 'revision']),
      ])
      return { profiles: profilesRes.count ?? 0, pendingReview: reviewRes.count ?? 0 }
    },
  })
}

/** The whole app is single-profile today (profiles[0]) but every page re-queried it. */
export function useProfile() {
  const q = useQuery({
    queryKey: qk.profiles,
    queryFn: async (): Promise<BusinessProfile | null> => (await listProfiles())[0] ?? null,
    staleTime: 5 * 60_000,
  })
  return q
}

export function useApprovedItems(profileId: string | undefined) {
  return useQuery({
    queryKey: qk.approvedItems(profileId ?? 'none'),
    queryFn: async () => (await listApprovedItems(profileId!)).filter((i) => isActivePlatform(i.platform)),
    enabled: Boolean(profileId),
  })
}

export function useScheduledPosts(profileId: string | undefined) {
  return useQuery({
    queryKey: qk.scheduledPosts(profileId ?? 'none'),
    queryFn: async () => (await listScheduledPosts(profileId!)).filter((p) => isActivePlatform(p.platform)),
    enabled: Boolean(profileId),
  })
}

export function useReviewItems(profileId: string | undefined) {
  return useQuery({
    queryKey: qk.reviewItems(profileId ?? 'none'),
    queryFn: async () => (await listReviewItems(profileId!)).filter((i) => isActivePlatform(i.platform)),
    enabled: Boolean(profileId),
  })
}

export function useLatestRun(profileId: string | undefined) {
  return useQuery({
    queryKey: qk.latestRun(profileId ?? 'none'),
    queryFn: () => getLatestRun(profileId!),
    enabled: Boolean(profileId),
  })
}

export function useRunItems(runId: string | undefined) {
  return useQuery({
    queryKey: qk.runItems(runId ?? 'none'),
    queryFn: () => listItemsForRun(runId!),
    enabled: Boolean(runId),
  })
}

/**
 * One Postgres-changes subscription for the whole app. Any insert/update/delete on the content
 * or publishing tables invalidates the matching queries, so every open screen (and every
 * teammate's browser) updates itself — this is what removes the manual reload, and it replaces
 * the 4s pollers that used to be the only source of freshness.
 *
 * Mounted once in AppShell so it lives for the whole authenticated session.
 */
export function useRealtimeSync() {
  const qc = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('scalepods-app-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_items' }, () => {
        qc.invalidateQueries({ queryKey: ['approvedItems'] })
        qc.invalidateQueries({ queryKey: ['reviewItems'] })
        qc.invalidateQueries({ queryKey: ['runItems'] })
        qc.invalidateQueries({ queryKey: qk.navCounts })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_posts' }, () => {
        qc.invalidateQueries({ queryKey: ['scheduledPosts'] })
        qc.invalidateQueries({ queryKey: ['approvedItems'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'content_runs' }, () => {
        qc.invalidateQueries({ queryKey: ['latestRun'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [qc])
}
