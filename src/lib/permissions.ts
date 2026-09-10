// Per-feature access control — Phase 1 of docs/team-collaboration-prd.md.
//
// One access level per feature per person. Four levels rather than a flat on/off is what makes
// "a designer may edit the video prompt but may not fire the $3 render" expressible without a
// second permission axis.
//
// This file is the UI's source of truth for the catalogue and the role presets. The database
// stores only the resulting (user_id, feature, level) rows — a preset is *written out*, never
// implied at read time, so what the Users screen shows is exactly what Phase 3's RLS will
// enforce. There is no invisible second ruleset.

import { supabase } from './supabase'
import type { TeamRole } from './team'

export type AccessLevel = 'none' | 'view' | 'edit' | 'full'

export const LEVELS: AccessLevel[] = ['none', 'view', 'edit', 'full']

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, full: 3 }

export const LEVEL_LABEL: Record<AccessLevel, string> = {
  none: 'None',
  view: 'View',
  edit: 'Edit',
  full: 'Full',
}

export type FeatureKey =
  | 'dashboard' | 'business' | 'trends' | 'strategy'
  | 'studio' | 'carousel_studio' | 'video_studio' | 'content' | 'review'
  | 'calendar' | 'publishing' | 'blog'
  | 'analytics' | 'intelligence' | 'board' | 'settings'

export interface FeatureDef {
  key: FeatureKey
  label: string
  /** Route this feature guards. Used by the sidebar/route filter in Phase 2. */
  to: string
  /** Mirrors the sidebar grouping so the permission matrix reads in the same order as the app. */
  group: 'Overview' | 'Marketing Strategy' | 'Content Generation' | 'Publishing Engine' | 'Team' | 'Insight'
  /** What each level actually unlocks, shown under the radio row so an admin isn't guessing. */
  levels: { view: string; edit?: string; full?: string }
}

/**
 * Every gateable screen. Deliberately does NOT include a 'users' entry: access to the Users
 * screen follows from app_users.role being owner/admin. A role AND a users-permission would be
 * two switches for one thing, free to contradict each other, and app_is_admin() already keys off
 * the role for every database check.
 */
export const FEATURES: FeatureDef[] = [
  { key: 'dashboard', label: 'Dashboard', to: '/', group: 'Overview',
    levels: { view: 'See the KPI overview' } },

  { key: 'business', label: 'Business', to: '/clients', group: 'Marketing Strategy',
    levels: { view: 'See business profiles', edit: 'Edit profile and competitors', full: 'Create and delete profiles' } },
  { key: 'trends', label: 'Trends', to: '/trends', group: 'Marketing Strategy',
    levels: { view: 'See trend signals', edit: 'Select and tag trends', full: 'Run a trend scan' } },
  { key: 'strategy', label: 'Strategy', to: '/strategy', group: 'Marketing Strategy',
    levels: { view: 'Read strategies', edit: 'Edit a strategy', full: 'Generate a new strategy' } },

  { key: 'studio', label: 'AI Studio', to: '/studio', group: 'Content Generation',
    levels: { view: 'See jobs', edit: 'Edit prompts and copy', full: 'Generate — spends money' } },
  { key: 'carousel_studio', label: 'Carousel Studio', to: '/carousel-studio', group: 'Content Generation',
    levels: { view: 'See jobs', edit: 'Edit slides and copy', full: 'Render — spends money' } },
  { key: 'video_studio', label: 'Video Studio', to: '/video-studio', group: 'Content Generation',
    levels: { view: 'See jobs', edit: 'Edit shots and script', full: 'Generate — spends money' } },
  { key: 'content', label: 'Content Factory', to: '/content', group: 'Content Generation',
    levels: { view: 'See runs', edit: 'Edit items', full: 'Run the content engine' } },
  { key: 'review', label: 'Creative Review', to: '/review', group: 'Content Generation',
    levels: { view: 'See the queue', edit: 'Comment and fix copy', full: 'Approve and send back' } },

  { key: 'calendar', label: 'Calendar', to: '/calendar', group: 'Publishing Engine',
    levels: { view: 'See the schedule', edit: 'Move and reschedule posts' } },
  { key: 'publishing', label: 'Publishing', to: '/publishing', group: 'Publishing Engine',
    levels: { view: 'See the queue', edit: 'Schedule posts', full: 'Publish now and cancel' } },
  { key: 'blog', label: 'Blog', to: '/blog', group: 'Publishing Engine',
    levels: { view: 'Read posts', edit: 'Write and edit', full: 'Publish to scalepods.co' } },

  { key: 'board', label: 'Board', to: '/board', group: 'Team',
    levels: { view: 'See the board', edit: 'Create and work own tickets', full: 'Assign to others, manage columns' } },

  { key: 'analytics', label: 'Analytics', to: '/analytics', group: 'Insight',
    levels: { view: 'See metrics and leads', full: 'Refresh data, run AI insights' } },
  { key: 'intelligence', label: 'Intelligence', to: '/intelligence', group: 'Insight',
    levels: { view: 'Read reports', full: 'Run a new analysis' } },
  { key: 'settings', label: 'Settings', to: '/settings', group: 'Insight',
    levels: { view: 'See own profile', edit: 'Own profile and preferences', full: 'Connections, credentials, safety switches' } },
]

export const FEATURE_GROUPS = ['Overview', 'Marketing Strategy', 'Content Generation', 'Publishing Engine', 'Team', 'Insight'] as const

/** User Manual and Support AI are never gated — somebody landing here confused needs the manual
 *  more than anyone, and hiding it would be perverse. */
export const ALWAYS_AVAILABLE_ROUTES = ['/manual']

export type PermissionMap = Partial<Record<FeatureKey, AccessLevel>>

/**
 * Starting bundle per role. A role is a preset, not a cage — every entry is overridable per user
 * afterwards, and the Users screen marks a person as "customised" once their map diverges.
 * Kept in step with the phase1_seed_role_presets migration, which seeded the same values.
 */
export const ROLE_PRESETS: Record<TeamRole, PermissionMap> = {
  owner: Object.fromEntries(FEATURES.map((f) => [f.key, 'full'])) as PermissionMap,
  admin: Object.fromEntries(FEATURES.map((f) => [f.key, 'full'])) as PermissionMap,

  // The three studios at full — designers may spend, bounded by their monthly cap.
  designer: {
    dashboard: 'view',
    studio: 'full', carousel_studio: 'full', video_studio: 'full',
    review: 'edit', calendar: 'view', board: 'edit', settings: 'edit',
  },

  // Words, not renders: studios at edit (prompts and copy, no spend), no Video Studio at all,
  // Blog up to edit but not publish.
  writer: {
    dashboard: 'view', trends: 'view', strategy: 'view',
    content: 'edit', studio: 'edit', carousel_studio: 'edit',
    review: 'edit', calendar: 'edit', blog: 'edit', board: 'edit', settings: 'edit',
  },

  // Read the plan and the results, approve the work, nothing else.
  client: {
    dashboard: 'view', trends: 'view', strategy: 'view',
    review: 'full', calendar: 'view', blog: 'view',
    analytics: 'view', intelligence: 'view', settings: 'edit',
  },
}

export function levelFor(map: PermissionMap | undefined | null, feature: FeatureKey): AccessLevel {
  return map?.[feature] ?? 'none'
}

/** "At least this level." The whole point of ordered levels — `can(map, 'studio', 'edit')` is
 *  true for both edit and full, so callers never enumerate levels by hand. */
export function can(map: PermissionMap | undefined | null, feature: FeatureKey, min: AccessLevel): boolean {
  return LEVEL_RANK[levelFor(map, feature)] >= LEVEL_RANK[min]
}

/** True when someone's permissions no longer match their role's preset — surfaced in the UI so
 *  an admin can tell a deliberate override from a stale default. */
export function isCustomised(role: TeamRole, map: PermissionMap): boolean {
  const preset = ROLE_PRESETS[role]
  return FEATURES.some((f) => (map[f.key] ?? 'none') !== (preset[f.key] ?? 'none'))
}

/** Only levels the feature actually defines. Calendar has no `full`, Dashboard only has `view` —
 *  offering every level everywhere would invite grants that mean nothing. */
export function availableLevels(feature: FeatureDef): AccessLevel[] {
  const out: AccessLevel[] = ['none', 'view']
  if (feature.levels.edit) out.push('edit')
  if (feature.levels.full) out.push('full')
  return out
}

// --- data access -----------------------------------------------------------

export async function fetchPermissions(userId: string): Promise<PermissionMap> {
  const { data, error } = await supabase
    .from('user_permissions')
    .select('feature, level')
    .eq('user_id', userId)
  if (error) throw error
  const map: PermissionMap = {}
  for (const row of data as { feature: FeatureKey; level: AccessLevel }[]) map[row.feature] = row.level
  return map
}

/**
 * Replaces a person's whole permission set in one go.
 *
 * 'none' is stored as the *absence* of a row rather than a row saying 'none', so the table stays
 * a list of what someone can reach. Deletes go first: an admin dropping a feature to none and
 * raising another in the same save must not leave the removed row behind if the upsert fails.
 */
export async function savePermissions(userId: string, map: PermissionMap): Promise<void> {
  const granted = FEATURES
    .map((f) => ({ user_id: userId, feature: f.key, level: map[f.key] ?? 'none' }))
    .filter((r) => r.level !== 'none')

  const revoked = FEATURES.map((f) => f.key).filter((k) => (map[k] ?? 'none') === 'none')

  if (revoked.length) {
    const { error } = await supabase
      .from('user_permissions')
      .delete()
      .eq('user_id', userId)
      .in('feature', revoked)
    if (error) throw error
  }

  if (granted.length) {
    const { error } = await supabase
      .from('user_permissions')
      .upsert(granted, { onConflict: 'user_id,feature' })
    if (error) throw error
  }
}

export async function createTeamUser(input: {
  email: string
  fullName: string
  role: TeamRole
  monthlySpendCapUsd: number | null
}): Promise<string> {
  const email = input.email.trim().toLowerCase()
  const { data, error } = await supabase
    .from('app_users')
    .insert({
      email,
      full_name: input.fullName.trim() || email.split('@')[0],
      role: input.role,
      // Always 'invited'. The row is claimed by the matching Google account on first sign-in;
      // an admin then switches it to active. Nobody is created already-live.
      status: 'invited',
      monthly_spend_cap_usd: input.monthlySpendCapUsd,
    })
    .select('id')
    .single()
  if (error) throw error

  const id = (data as { id: string }).id
  await savePermissions(id, ROLE_PRESETS[input.role])
  return id
}
