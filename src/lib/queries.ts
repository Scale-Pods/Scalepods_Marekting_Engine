import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from './supabase'
import { listProfiles, getStoredActiveProfileId, setStoredActiveProfileId } from './clients'
import { listApprovedItems, listScheduledPosts } from './publishing'
import { getLatestRun, listItemsForRun, listReviewItems, listCalendarItems, isActivePlatform } from './content'
import { NOTIFICATIONS_KEY } from './notifications'
import { listBlogPosts, getBlogPost } from './blog'

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
  activeProfileId: ['activeProfileId'] as const,
  approvedItems: (profileId: string) => ['approvedItems', profileId] as const,
  scheduledPosts: (profileId: string) => ['scheduledPosts', profileId] as const,
  latestRun: (profileId: string) => ['latestRun', profileId] as const,
  runItems: (runId: string) => ['runItems', runId] as const,
  reviewItems: (profileId: string) => ['reviewItems', profileId] as const,
  calendarItems: (profileId: string) => ['calendarItems', profileId] as const,
  notifications: NOTIFICATIONS_KEY,
  navCounts: ['navCounts'] as const,
  blogPosts: ['blogPosts'] as const,
  blogPost: (id: string) => ['blogPost', id] as const,
}

/** Sidebar badge counts. Was a blind 60s setInterval; now realtime-invalidated like everything
 *  else. `profiles` is deliberately a total across every business profile (it's what the
 *  "Business" nav badge means); `pendingReview` is scoped to the active profile — unscoped it
 *  used to count every profile's pending items together, which was invisible with only one real
 *  profile but would now misreport the "Creative Review" badge the moment a second profile
 *  (e.g. a test one) has anything sitting in review too. */
export function useNavCounts(profileId: string | undefined) {
  return useQuery({
    queryKey: [...qk.navCounts, profileId ?? 'none'],
    queryFn: async () => {
      const [profilesRes, reviewRes] = await Promise.all([
        supabase.from('business_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('content_items').select('id', { count: 'exact', head: true }).eq('profile_id', profileId!).in('status', ['ready', 'revision']),
      ])
      return { profiles: profilesRes.count ?? 0, pendingReview: reviewRes.count ?? 0 }
    },
    enabled: Boolean(profileId),
  })
}

/** All business profiles — the profile switcher's dropdown, and what useProfile() below
 *  resolves the active one out of. */
export function useProfiles() {
  return useQuery({
    queryKey: qk.profiles,
    queryFn: listProfiles,
    staleTime: 5 * 60_000,
  })
}

/** Which profile id is "active" right now — read once from localStorage (see clients.ts) and
 *  from then on lives in the query cache, so useSetActiveProfile's setQueryData below is what
 *  actually notifies every open page, not a localStorage-polling effect. */
export function useActiveProfileId() {
  return useQuery({
    queryKey: qk.activeProfileId,
    queryFn: () => getStoredActiveProfileId(),
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/**
 * The profile the rest of the app operates on. Used to just be profiles[0] (the oldest one,
 * unconditionally) — now resolves whichever id the switcher last picked, falling back to
 * profiles[0] if nothing's stored yet or the stored id doesn't match any real profile anymore
 * (e.g. it was deleted). Every page that used to call listProfiles() and take [0] itself should
 * use this instead, so the switcher actually reaches them.
 */
export function useProfile() {
  const { data: profiles, isLoading: profilesLoading } = useProfiles()
  const { data: activeId } = useActiveProfileId()
  const profile = profiles === undefined
    ? undefined
    : (profiles.find((p) => p.id === activeId) ?? profiles[0] ?? null)
  return { data: profile, isLoading: profilesLoading }
}

/** Switches the active profile — persists it (survives a reload) and updates the query cache
 *  directly (no network refetch needed, every useProfile() caller re-renders immediately). */
export function useSetActiveProfile() {
  const qc = useQueryClient()
  return (id: string) => {
    setStoredActiveProfileId(id)
    qc.setQueryData(qk.activeProfileId, id)
  }
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

export function useCalendarItems(profileId: string | undefined) {
  return useQuery({
    queryKey: qk.calendarItems(profileId ?? 'none'),
    queryFn: async () => (await listCalendarItems(profileId!)).filter((i) => isActivePlatform(i.platform)),
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

export function useBlogPosts() {
  return useQuery({ queryKey: qk.blogPosts, queryFn: listBlogPosts })
}

export function useBlogPost(id: string | undefined) {
  return useQuery({
    queryKey: qk.blogPost(id ?? 'none'),
    queryFn: () => getBlogPost(id!),
    enabled: Boolean(id),
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
        qc.invalidateQueries({ queryKey: ['calendarItems'] })
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blog_posts' }, () => {
        qc.invalidateQueries({ queryKey: qk.blogPosts })
        qc.invalidateQueries({ queryKey: ['blogPost'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [qc])
}
