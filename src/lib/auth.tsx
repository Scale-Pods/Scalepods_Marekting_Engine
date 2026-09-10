import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { getRole, setRole as persistRole, type Role } from './theme'
import { fetchMe, touchLastSeen, syncFromProvider, ME_KEY, type AppUser } from './team'

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
  /** @deprecated Phase 0 of the team-collaboration PRD replaced this with `appUser.role`. It is
   *  still a localStorage-backed *view* switcher (any user can pick any value), so it must never
   *  be used for an access decision. Phase 2 deletes it along with the sidebar switcher. */
  role: Role
  loading: boolean
  setRole: (r: Role) => void
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  sendReset: (email: string) => Promise<{ error: string | null }>
}

const AuthCtx = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRoleState] = useState<Role>(getRole())
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

  const setRole = (r: Role) => {
    persistRole(r)
    setRoleState(r)
  }

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
        role,
        loading,
        setRole,
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
