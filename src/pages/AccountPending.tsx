import { ShieldAlert, Clock, MailQuestion, RefreshCw, LogOut } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { getCurrentTheme } from '../lib/theme'

/**
 * The wall a signed-in person hits when they are authenticated but not authorised.
 *
 * Getting through Google only proves the address is real and on the right domain — it grants
 * nothing. An admin still has to switch the account on from the Users screen. This screen is what
 * stands between "signed in" and "in", and it is deliberately a full-page stop rather than an
 * empty dashboard, so there is never any doubt about what happened.
 */
export type AccountBlockReason = 'invited' | 'suspended' | 'no-record' | 'lookup-failed'

const COPY: Record<AccountBlockReason, { icon: typeof Clock; title: string; body: string; tone: string }> = {
  invited: {
    icon: Clock,
    title: 'Almost there',
    body:
      'Your ScalePods account exists but has not been switched on yet. An admin needs to activate it and choose which parts of the Growth OS you can reach. You will get an email once that is done.',
    tone: 'var(--accent-blue)',
  },
  suspended: {
    icon: ShieldAlert,
    title: 'Account not active',
    body:
      'This account is not authorised to use the Growth OS. If you think that is a mistake, ask Palki, Raunak or Adnan to activate it from Settings → Team.',
    tone: 'var(--accent-orange)',
  },
  'no-record': {
    icon: MailQuestion,
    title: 'No team record found',
    body:
      'You signed in successfully, but there is no ScalePods team record for this address. An admin can add you from Settings → Team using this exact email.',
    tone: 'var(--accent-orange)',
  },
  'lookup-failed': {
    icon: RefreshCw,
    title: "Couldn't verify your account",
    body:
      'We could not reach the team directory to check your access. This is usually a connection blip rather than a permissions problem — try again in a moment.',
    tone: 'var(--accent-orange)',
  },
}

export default function AccountPending({ reason }: { reason: AccountBlockReason }) {
  const { user, appUser, signOut, refetchAppUser } = useAuth()
  const logo = getCurrentTheme() === 'dark' ? '/brand/logo-white.png' : '/brand/logo-black.png'
  const copy = COPY[reason]
  const Icon = copy.icon

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <img src={logo} alt="ScalePods" className="h-7 mx-auto mb-8" />
        <div
          className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: 'var(--fill-tertiary)', color: copy.tone }}
        >
          <Icon size={24} />
        </div>

        <h1 className="text-xl mb-2">{copy.title}</h1>
        <p className="text-secondary text-sm leading-relaxed mb-6">{copy.body}</p>

        <div className="panel !py-3 text-sm mb-6">
          <div className="text-muted text-[11px] uppercase tracking-wide mb-1">Signed in as</div>
          <div className="truncate">{appUser?.full_name || user?.email}</div>
          {appUser?.full_name && <div className="text-muted text-xs truncate">{user?.email}</div>}
        </div>

        <div className="flex gap-2">
          {reason === 'lookup-failed' && (
            <button className="btn-primary flex-1" onClick={refetchAppUser}>
              <RefreshCw size={15} /> Try again
            </button>
          )}
          <button className={reason === 'lookup-failed' ? 'btn-ghost flex-1' : 'btn-primary w-full'} onClick={signOut}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
