import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Users, UserPlus, Search, ShieldCheck, Clock, Ban, ChevronLeft, Save,
  Trash2, CircleDot, Wallet, Mail, AlertTriangle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  listTeam, initialsOf, ROLE_LABEL, ROLE_ACCENT, TEAM_KEY,
  type AppUser, type TeamRole, type TeamStatus,
} from '../lib/team'
import {
  FEATURES, FEATURE_GROUPS, ROLE_PRESETS, LEVEL_LABEL, availableLevels, fetchPermissions,
  savePermissions, createTeamUser, isCustomised,
  type AccessLevel, type FeatureKey, type PermissionMap,
} from '../lib/permissions'
import { PageHeader, Panel, Button, Badge, Spinner, Modal, EmptyState } from '../components/ui'
import { useToast, toastMessage } from '../components/Toast'

// Settings → Team. Where an admin creates people and decides what each of them can reach.
//
// Every rule this screen appears to enforce is also enforced by the app_users_guard trigger in
// Postgres — the owner cannot be demoted or suspended, you cannot strip your own admin access or
// suspend yourself, and the last active admin cannot be removed. The disabled buttons here are a
// courtesy so an admin isn't led into an error; they are not the protection.

const ROLES: TeamRole[] = ['admin', 'designer', 'writer', 'client']

const STATUS_META: Record<TeamStatus, { label: string; tone: 'green' | 'blue' | 'orange' | 'grey'; hint: string }> = {
  active: { label: 'Active', tone: 'green', hint: 'Can sign in and use the app.' },
  invited: { label: 'Invited', tone: 'blue', hint: 'Has not been switched on yet — sees the "Almost there" screen.' },
  suspended: { label: 'Suspended', tone: 'orange', hint: 'Blocked from the app; history and assignments are kept.' },
}

function money(n: number | null): string {
  return n === null ? 'Uncapped' : `$${n}/mo`
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString()
}

export default function TeamAccess() {
  const { appUser } = useAuth()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const { data: team = [], isLoading } = useQuery({ queryKey: TEAM_KEY, queryFn: listTeam })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return team
    return team.filter((u) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [team, query])

  const selected = team.find((u) => u.id === selectedId) ?? null

  if (selected) {
    return <MemberDetail member={selected} onBack={() => setSelectedId(null)} isMe={selected.id === appUser?.id} />
  }

  return (
    <div>
      <PageHeader
        title="Team & access"
        subtitle="Who can sign in, and which parts of the Growth OS each person can reach."
        accent={<Badge tone="green"><Users size={13} /> {team.length} people</Badge>}
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus size={15} /> Add person
          </Button>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input !pl-9"
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size={24} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Users size={22} />} title="Nobody matches that" hint="Try a different name or email." />
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => (
            <MemberRow key={u.id} member={u} isMe={u.id === appUser?.id} onOpen={() => setSelectedId(u.id)} />
          ))}
        </div>
      )}

      {creating && <CreateMemberModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id) }} />}
    </div>
  )
}

function MemberRow({ member, isMe, onOpen }: { member: AppUser; isMe: boolean; onOpen: () => void }) {
  const status = STATUS_META[member.status]
  return (
    <button onClick={onOpen} className="card w-full !p-4 flex items-center gap-4 text-left hover:opacity-90 transition-opacity">
      {member.avatar_url ? (
        <img src={member.avatar_url} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 text-white"
          style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-green))' }}
        >
          {initialsOf(member.full_name, member.email)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{member.full_name}</span>
          {isMe && <span className="text-muted text-[11px]">(you)</span>}
        </div>
        <div className="text-muted text-xs truncate">{member.email}</div>
      </div>

      <div className="hidden md:block text-xs shrink-0 w-28" style={{ color: ROLE_ACCENT[member.role] }}>
        {ROLE_LABEL[member.role]}
      </div>

      <div className="hidden lg:flex items-center gap-1.5 text-muted text-xs shrink-0 w-28">
        <Wallet size={13} /> {money(member.monthly_spend_cap_usd)}
      </div>

      <div className="hidden sm:block text-muted text-xs shrink-0 w-24">{relativeTime(member.last_seen_at)}</div>

      <Badge tone={status.tone} className="shrink-0">{status.label}</Badge>
    </button>
  )
}

function CreateMemberModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<TeamRole>('designer')
  const [capped, setCapped] = useState(true)
  const [cap, setCap] = useState('50')

  const domainOk = /@scalepods\.co$/i.test(email.trim())

  const create = useMutation({
    mutationFn: () =>
      createTeamUser({
        email,
        fullName,
        role,
        monthlySpendCapUsd: capped ? Number(cap) || 0 : null,
      }),
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: TEAM_KEY })
      toast.success(`${fullName || email} added — they can sign in with Google now.`)
      onCreated(id)
    },
    onError: (e) => toast.error(toastMessage(e, 'Could not add that person.')),
  })

  return (
    <Modal title="Add someone to the team" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Work email</label>
          <input
            className="input mt-1"
            type="email"
            placeholder="name@scalepods.co"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          {email.trim() !== '' && !domainOk && (
            <p className="text-[var(--accent-orange)] text-xs mt-1.5">
              Must be an @scalepods.co address — the database refuses to create an account for anything else.
            </p>
          )}
        </div>

        <div>
          <label className="label">Full name</label>
          <input
            className="input mt-1"
            placeholder="Priya"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Role</label>
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRole(r)
                  // Match the seeded defaults so the cap and the role stay coherent.
                  if (r === 'admin') setCapped(false)
                  else { setCapped(true); setCap(r === 'writer' ? '20' : '50') }
                }}
                className={`panel !py-2.5 text-sm text-left transition-all ${role === r ? 'ring-2' : 'opacity-70 hover:opacity-100'}`}
                style={role === r ? ({ '--tw-ring-color': ROLE_ACCENT[r] } as React.CSSProperties) : undefined}
              >
                <span className="flex items-center gap-2">
                  <CircleDot size={13} style={{ color: ROLE_ACCENT[r] }} />
                  {ROLE_LABEL[r]}
                </span>
              </button>
            ))}
          </div>
          <p className="text-muted text-xs mt-2">
            Sets a starting bundle of permissions. You can change any of them individually on the next screen.
          </p>
        </div>

        <div>
          <label className="label">Monthly generation budget</label>
          <div className="flex items-center gap-2 mt-1.5">
            <button
              type="button"
              onClick={() => setCapped((c) => !c)}
              className={`panel !py-2 !px-3 text-sm ${capped ? 'ring-2' : 'opacity-70'}`}
              style={capped ? ({ '--tw-ring-color': 'var(--accent-green)' } as React.CSSProperties) : undefined}
            >
              {capped ? 'Capped' : 'Uncapped'}
            </button>
            {capped && (
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                <input
                  className="input !pl-6"
                  type="number"
                  min={0}
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                />
              </div>
            )}
          </div>
          <p className="text-muted text-xs mt-2">
            How much this person may spend on AI generation per calendar month. The per-video $5 ceiling still applies on top.
          </p>
        </div>

        <Panel className="!py-3">
          <div className="flex gap-2.5 text-xs text-secondary">
            <Mail size={15} className="shrink-0 mt-0.5 text-muted" />
            <span>
              No invite email is sent yet — tell them to open the app and use <b className="text-ink">Continue with Google</b>.
              Their account links itself on first sign-in, and stays <b className="text-ink">Invited</b> until you switch it to Active.
            </span>
          </div>
        </Panel>

        <div className="flex gap-2 pt-1">
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!domainOk} className="flex-1">
            <UserPlus size={15} /> Add person
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}

function MemberDetail({ member, onBack, isMe }: { member: AppUser; onBack: () => void; isMe: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()

  const { data: saved, isLoading } = useQuery({
    queryKey: ['permissions', member.id],
    queryFn: () => fetchPermissions(member.id),
  })

  // Draft state, seeded once the saved map arrives and re-seeded only when a different person is
  // opened — the same pattern the studios use for their editable drafts, so a background refetch
  // can't wipe what an admin is halfway through changing.
  const [draft, setDraft] = useState<PermissionMap | null>(null)
  const [draftFor, setDraftFor] = useState<string | null>(null)
  const [role, setRole] = useState<TeamRole>(member.role)
  const [fullName, setFullName] = useState(member.full_name)
  const [cap, setCap] = useState<string>(member.monthly_spend_cap_usd === null ? '' : String(member.monthly_spend_cap_usd))

  if (saved && draftFor !== member.id) {
    setDraft(saved)
    setDraftFor(member.id)
    setRole(member.role)
    setFullName(member.full_name)
    setCap(member.monthly_spend_cap_usd === null ? '' : String(member.monthly_spend_cap_usd))
  }

  const isOwner = member.role === 'owner'
  const status = STATUS_META[member.status]

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('app_users')
        .update({
          full_name: fullName.trim() || member.full_name,
          role,
          monthly_spend_cap_usd: cap.trim() === '' ? null : Number(cap),
        })
        .eq('id', member.id)
      if (error) throw error
      if (draft) await savePermissions(member.id, draft)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TEAM_KEY })
      qc.invalidateQueries({ queryKey: ['permissions', member.id] })
      qc.invalidateQueries({ queryKey: ['appUser'] })
      toast.success('Saved.')
    },
    onError: (e) => toast.error(toastMessage(e, 'Could not save those changes.')),
  })

  const setStatus = useMutation({
    mutationFn: async (next: TeamStatus) => {
      const { error } = await supabase.from('app_users').update({ status: next }).eq('id', member.id)
      if (error) throw error
      return next
    },
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: TEAM_KEY })
      toast.success(next === 'active' ? `${member.full_name} can now use the app.` : `${member.full_name} is ${next}.`)
    },
    onError: (e) => toast.error(toastMessage(e, 'Could not change that status.')),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('app_users').delete().eq('id', member.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TEAM_KEY })
      toast.success(`${member.full_name} removed.`)
      onBack()
    },
    onError: (e) => toast.error(toastMessage(e, 'Could not remove that person.')),
  })

  function applyPreset(next: TeamRole) {
    setRole(next)
    setDraft({ ...ROLE_PRESETS[next] })
  }

  const customised = draft ? isCustomised(role, draft) : false

  return (
    <div>
      <button onClick={onBack} className="btn-ghost !py-1.5 !px-3 mb-4 text-sm">
        <ChevronLeft size={15} /> All people
      </button>

      <PageHeader
        title={member.full_name}
        subtitle={member.email}
        accent={
          <div className="flex items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {isOwner && <Badge tone="grey"><ShieldCheck size={12} /> Owner</Badge>}
            {isMe && <Badge tone="grey">You</Badge>}
          </div>
        }
        actions={<Button onClick={() => save.mutate()} loading={save.isPending}><Save size={15} /> Save changes</Button>}
      />

      {isOwner && (
        <Panel className="!py-3 mb-4">
          <div className="flex gap-2.5 text-xs text-secondary">
            <ShieldCheck size={15} className="shrink-0 mt-0.5 text-sage" />
            <span>
              This is the owner account. It cannot be demoted, suspended or deleted by anyone — including itself.
              That rule lives in the database, so it holds even outside this screen.
            </span>
          </div>
        </Panel>
      )}

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
        {/* Identity + status */}
        <div className="space-y-4">
          <div className="card !p-5">
            <div className="text-muted text-[11px] uppercase tracking-wide mb-3">Profile</div>

            <label className="label">Display name</label>
            <input className="input mt-1 mb-4" value={fullName} onChange={(e) => setFullName(e.target.value)} />

            <label className="label">Role</label>
            <div className="grid grid-cols-2 gap-2 mt-1.5 mb-2">
              {(isOwner ? (['owner'] as TeamRole[]) : ROLES).map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={isOwner}
                  onClick={() => applyPreset(r)}
                  className={`panel !py-2 text-sm text-left transition-all ${role === r ? 'ring-2' : 'opacity-70 hover:opacity-100'} ${isOwner ? '!opacity-60 cursor-not-allowed' : ''}`}
                  style={role === r ? ({ '--tw-ring-color': ROLE_ACCENT[r] } as React.CSSProperties) : undefined}
                >
                  <span className="flex items-center gap-2">
                    <CircleDot size={13} style={{ color: ROLE_ACCENT[r] }} />
                    {ROLE_LABEL[r]}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-muted text-xs mb-4">
              {customised
                ? 'Permissions have been customised away from this role’s defaults. Picking a role again resets them.'
                : 'Picking a role replaces every permission below with that role’s defaults.'}
            </p>

            <label className="label">Monthly generation budget</label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
              <input
                className="input !pl-6"
                type="number"
                min={0}
                placeholder="Uncapped"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </div>
            <p className="text-muted text-xs mt-2">Leave empty for no cap. Enforced in Phase 6.</p>
          </div>

          <div className="card !p-5">
            <div className="text-muted text-[11px] uppercase tracking-wide mb-1">Access</div>
            <p className="text-muted text-xs mb-3">{status.hint}</p>

            {member.status !== 'active' ? (
              <Button className="w-full" onClick={() => setStatus.mutate('active')} loading={setStatus.isPending}>
                <ShieldCheck size={15} /> Activate account
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="w-full"
                disabled={isOwner || isMe}
                onClick={() => setStatus.mutate('suspended')}
                loading={setStatus.isPending}
              >
                <Ban size={15} /> Suspend
              </Button>
            )}

            <div className="flex items-center gap-1.5 text-muted text-xs mt-3">
              <Clock size={12} /> Last seen {relativeTime(member.last_seen_at)}
            </div>
          </div>

          {!isOwner && !isMe && (
            <div className="card !p-5">
              <div className="text-[var(--accent-orange)] text-[11px] uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Danger zone
              </div>
              <p className="text-muted text-xs mb-3">
                Removing someone deletes their team record. Suspend instead if you want to keep their history.
              </p>
              <Button variant="ghost" className="w-full" onClick={() => remove.mutate()} loading={remove.isPending}>
                <Trash2 size={15} /> Remove from team
              </Button>
            </div>
          )}
        </div>

        {/* The permission matrix */}
        <div className="card !p-5">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-muted text-[11px] uppercase tracking-wide">Feature access</div>
            {customised && <Badge tone="blue">Customised</Badge>}
          </div>
          <p className="text-muted text-xs mb-5">
            Each level includes the ones before it. Admins always reach every screen and this page; that follows
            from the role itself.
          </p>

          {isLoading || !draft ? (
            <div className="flex justify-center py-12"><Spinner size={22} /></div>
          ) : (
            <div className="space-y-5">
              {FEATURE_GROUPS.map((group) => {
                const items = FEATURES.filter((f) => f.group === group)
                if (!items.length) return null
                return (
                  <div key={group}>
                    <div className="text-muted text-[10px] font-semibold uppercase tracking-wide mb-2">{group}</div>
                    <div className="space-y-1.5">
                      {items.map((f) => (
                        <FeatureRow
                          key={f.key}
                          feature={f}
                          level={draft[f.key] ?? 'none'}
                          disabled={isOwner}
                          onChange={(lvl) => setDraft({ ...draft, [f.key]: lvl })}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FeatureRow({
  feature, level, disabled, onChange,
}: {
  feature: (typeof FEATURES)[number]
  level: AccessLevel
  disabled?: boolean
  onChange: (l: AccessLevel) => void
}) {
  const options = availableLevels(feature)
  const blurb =
    level === 'none' ? 'Hidden entirely' :
    level === 'view' ? feature.levels.view :
    level === 'edit' ? feature.levels.edit :
    feature.levels.full

  return (
    <div className="panel !py-2.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{feature.label}</div>
        <div className="text-muted text-[11px] truncate">{blurb}</div>
      </div>

      <div className="flex rounded-lg overflow-hidden shrink-0" style={{ outline: '1px solid var(--border-subtle)', outlineOffset: -1 }}>
        {options.map((opt) => {
          const active = level === opt
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt)}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
              style={{
                background: active ? 'var(--accent-green)' : 'transparent',
                color: active ? 'var(--cta-text)' : 'var(--text-muted)',
              }}
            >
              {LEVEL_LABEL[opt]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type { FeatureKey }
