// The team directory — one row per human, introduced in Phase 0 of
// docs/team-collaboration-prd.md.
//
// Until now this app had exactly one login and a `Role` that lived in
// localStorage (see theme.ts), i.e. a view toggle rather than an identity. This
// module is the real thing: who is signed in, what they are called, and what
// they are allowed to be. Permissions themselves arrive in Phase 1.

import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type TeamRole = 'owner' | 'admin' | 'designer' | 'writer' | 'client'

/** invited: seeded or invited, never switched on by an admin — can sign in, can't use the app.
 *  active: may use the app. suspended: signed in but not authorised (or switched off later). */
export type TeamStatus = 'invited' | 'active' | 'suspended'

export interface AppUser {
  id: string
  /** Null until the person first signs in with Google and claims their invited row. */
  auth_user_id: string | null
  email: string
  full_name: string
  avatar_url: string | null
  role: TeamRole
  status: TeamStatus
  monthly_spend_cap_usd: number | null
  email_notifications: boolean
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export const ME_KEY = ['appUser', 'me'] as const
export const TEAM_KEY = ['appUser', 'team'] as const

export const ROLE_LABEL: Record<TeamRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  designer: 'Designer',
  writer: 'Content Writer',
  client: 'Client',
}

/** Reuses the existing brand accents rather than inventing a palette: sage for the people who
 *  run the place, blue for the people who make things, muted for read-only. */
export const ROLE_ACCENT: Record<TeamRole, string> = {
  owner: 'var(--accent-green)',
  admin: 'var(--accent-green)',
  designer: 'var(--accent-blue)',
  writer: 'var(--accent-blue)',
  client: 'var(--text-muted)',
}

export function isAdminRole(role: TeamRole | undefined | null): boolean {
  return role === 'owner' || role === 'admin'
}

/** Two letters for the avatar fallback: initials from the name where there is one, otherwise
 *  the first two characters of the email (which is what the top bar did before Phase 0). */
export function initialsOf(fullName?: string | null, email?: string | null): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase()
  return (email || 'U').slice(0, 2).toUpperCase()
}

/** The signed-in person's directory row, or null if they have none.
 *
 *  Returns null rather than throwing when there is no row: the caller (the account wall in
 *  App.tsx) has to tell "no row" apart from "the lookup failed" — denying access on a transient
 *  network error would lock the whole team out, so those two cases render differently. */
export async function fetchMe(): Promise<AppUser | null> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('auth_user_id', auth.user.id)
    .maybeSingle()
  if (error) throw error
  return (data as AppUser) ?? null
}

export async function listTeam(): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .order('full_name', { ascending: true })
  if (error) throw error
  return data as AppUser[]
}

/**
 * Copies the name and photo Google holds onto the directory row when they differ.
 *
 * handle_new_auth_user() captures these, but only fires on INSERT into auth.users — so it
 * never runs when Google is *linked* to an account that already exists (Supabase merges the
 * identity instead of creating a second user), and it would never notice a photo somebody
 * changed later either. Running it on sign-in covers both.
 *
 * Only fills a blank name; an admin who deliberately set someone's display name should not have
 * it overwritten by whatever that person calls themselves in Google.
 */
export async function syncFromProvider(
  me: AppUser,
  meta: { full_name?: string; name?: string; avatar_url?: string; picture?: string } | undefined,
): Promise<boolean> {
  if (!meta) return false
  const avatar = (meta.avatar_url ?? meta.picture ?? '').trim() || null
  const name = (meta.full_name ?? meta.name ?? '').trim()

  const patch: { avatar_url?: string | null; full_name?: string } = {}
  if (avatar && avatar !== me.avatar_url) patch.avatar_url = avatar
  if (name && !me.full_name.trim()) patch.full_name = name
  if (Object.keys(patch).length === 0) return false

  const { error } = await supabase.from('app_users').update(patch).eq('id', me.id)
  if (error) throw error
  return true
}

/** Fire-and-forget presence stamp — powers "last seen" in the Users screen (Phase 1). Never
 *  allowed to break a page load, same reasoning as pushNotification in notifications.ts. */
export async function touchLastSeen(appUserId: string): Promise<void> {
  await supabase.from('app_users').update({ last_seen_at: new Date().toISOString() }).eq('id', appUserId)
}

export function useTeam() {
  return useQuery({ queryKey: TEAM_KEY, queryFn: listTeam })
}
