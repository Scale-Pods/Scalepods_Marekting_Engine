import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

import { fetchMe, touchLastSeen, syncFromProvider, isAdminRole, ME_KEY, type AppUser } from './team'
import { fetchPermissions, can as canDo, type AccessLevel, type FeatureKey, type PermissionMap } from './permissions'

interface AuthState {
  session: Session | null
  user: User | null
  /** The signed-in person's team-directory row — their real name, role and status. Null while
   *  loading, or if they have no row at all (see `appUserError` to tell those apart). This is the
   *  identity; `role` below is the legacy localStorage view toggle and is on its way out. */
  appUser: AppUser | null
  appUserLoading: boolean
  appUserError: Error | null
  refetchAppUser: () => void
  /** What this person may reach, by feature. Empty while loading — `can()` answers false until
   *  it arrives, so a permission-gated control is never briefly clickable on a slow connection. */
  permissions: PermissionMap
  permissionsLoading: boolean
  /** "At least this level." The single access question the whole UI asks:
   *  `can('studio', 'full')` for a spend button, `can('studio', 'view')` for the nav item.
   *  Mirrors app_can() in Postgres, which is what actually protects the data in Phase 3 — this
   *  only decides what is worth rendering. */
  can: (feature: FeatureKey, level: AccessLevel) => boolean
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  sendReset: (email: string) => Promise<{ error: string | null }>
}

const AuthCtx = createContext<AuthState | undefined>(undefined)

// Stable identity so `can` isn't rebuilt on every render while permissions are still loading.
const EMPTY_PERMISSIONS: PermissionMap = {}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const authUserId = session?.user?.id ?? null

  // Keyed on the auth user id so signing out and back in as someone else can never serve the
  // previous person's identity from cache. Retried once only: the account wall denies access
  // when this fails, so a long retry storm would just hold the whole app on a spinner.
  const {
    data: appUser = null,
    isLoading: appUserLoading,
    error: appUserError,
    refetch,
  } = useQuery({
    queryKey: [...ME_KEY, authUserId],
    queryFn: fetchMe,
    enabled: !!authUserId,
    retry: 1,
    staleTime: 60_000,
  })

  // Presence stamp, once per mount of a signed-in session. Deliberately not awaited and never
  // surfaced — "last seen" is a nicety in the Users screen, not something worth a failed render.
  //
  // The provider sync rides along here for the same reason: a stale avatar is not worth an error
  // toast, and refetching only when something actually changed keeps this from looping.
  const providerMeta = session?.user?.user_metadata as
    | { full_name?: string; name?: string; avatar_url?: string; picture?: string }
    | undefined
  useEffect(() => {
    if (!appUser?.id) return
    touchLastSeen(appUser.id).catch(() => {})
    syncFromProvider(appUser, providerMeta)
      .then((changed) => { if (changed) void refetch() })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser?.id, providerMeta?.avatar_url, providerMeta?.picture])

  // Only fetched once there is a directory row to fetch them for. A suspended or unknown
  // account never gets this far — the wall in App.tsx stops it — but the query is keyed on the
  // row id anyway so switching accounts can't serve the previous person's permissions.
  const { data: permissions = EMPTY_PERMISSIONS, isLoading: permsLoading } = useQuery({
    queryKey: ['permissions', appUser?.id],
    queryFn: () => fetchPermissions(appUser!.id),
    enabled: !!appUser?.id,
    staleTime: 60_000,
  })

  const permissionsLoading = !!appUser?.id && permsLoading

  // Owners and admins always answer true, without consulting the map. app_can() in Postgres will
  // do the same in Phase 3, so the UI and the database agree — and it means an admin can never
  // lock themselves out of their own app by mangling a permission row.
  const can = useCallback(
    (feature: FeatureKey, level: AccessLevel) => {
      if (isAdminRole(appUser?.role)) return true
      if (permissionsLoading) return false
      return canDo(permissions, feature, level)
    },
    [appUser?.role, permissions, permissionsLoading],
  )

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  /** Redirects to Google and comes back to `/`. The `hd` parameter only *hints* to Google which
   *  Workspace domain to prefer — it is trivially removable from the URL, so the real restriction
   *  is the enforce_signup_domain trigger on auth.users, which refuses to create an account at
   *  all for an address that is neither @scalepods.co nor already invited. */
  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
        queryParams: { hd: 'scalepods.co', prompt: 'select_account' },
      },
    })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    // Drop every cached query, not just the identity one: react-query would otherwise hand the
    // next person to sign in on this browser the previous user's data while their own loads.
    qc.clear()
  }

  const sendReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error: error?.message ?? null }
  }

  return (
    <AuthCtx.Provider
      value={{
        session,
        user: session?.user ?? null,
        appUser,
        appUserLoading: !!authUserId && appUserLoading,
        appUserError: (appUserError as Error) ?? null,
        refetchAppUser: () => void refetch(),
        permissions,
        permissionsLoading,
        can,
        loading,
        signIn,
        signInWithGoogle,
        signOut,
        sendReset,
      }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
