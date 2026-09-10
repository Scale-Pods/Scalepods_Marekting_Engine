import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sun, Moon, Sparkles, ArrowRight, Send, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { toggleTheme, getCurrentTheme, type Theme } from '../lib/theme'

/** Google's four-colour mark. Inlined rather than loaded from a CDN because their brand
 *  guidelines require the official artwork on the button, and lucide has no Google icon. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  )
}

export default function Login() {
  const { signIn, signInWithGoogle, sendReset } = useAuth()
  const [theme, setTheme] = useState<Theme>(getCurrentTheme())
  const [email, setEmail] = useState('marketing@scalepods.co')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetMode, setResetMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const navigate = useNavigate()

  const logo = theme === 'dark' ? '/brand/logo-white.png' : '/brand/logo-black.png'

  // A rejected Google sign-in comes back as an OAuth error in the URL, not as something we could
  // catch from signInWithOAuth. The domain trigger on auth.users surfaces through Supabase as the
  // generic "Database error saving new user", which tells the person nothing useful — translate
  // that one case into the real reason, then scrub the URL so a refresh doesn't re-show it.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    const desc = hash.get('error_description') ?? query.get('error_description')
    const code = hash.get('error') ?? query.get('error')
    if (!desc && !code) return
    const d = (desc ?? '').toLowerCase()
    setOauthError(
      d.includes('database error') || d.includes('saving new user')
        ? 'That Google account cannot be used. The Growth OS is limited to @scalepods.co addresses — sign in with your work account, or ask an admin to invite you.'
        : (desc ?? 'Google sign-in failed. Please try again.'),
    )
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  async function onGoogle() {
    setGoogleBusy(true)
    setOauthError(null)
    const { error } = await signInWithGoogle()
    // On success the browser is already navigating away to Google, so this only runs on failure.
    if (error) {
      setOauthError(error)
      setGoogleBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await signIn(email, password)
    setBusy(false)
    if (error) setError(error)
    else navigate('/')
  }

  function openResetPanel() {
    if (!email) return setError('Enter your email first')
    setError(null)
    setResetMode(true)
  }

  function closeResetPanel() {
    setResetMode(false)
    setResetSent(false)
    setResetError(null)
  }

  async function sendResetLink() {
    setResetBusy(true)
    setResetError(null)
    const { error } = await sendReset(email)
    setResetBusy(false)
    if (error) setResetError(error)
    else setResetSent(true)
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand panel — deliberately always the dark hero treatment regardless of the app's own
          light/dark theme (same idea as Vercel/Linear's login splash), not a themed surface. It
          used to sit on --alt-bg-green, whose light-mode value is a pale #E7F0DF — leaving the
          hardcoded white heading/logo on that background is how "light theme" turned into
          barely-legible white-on-white. Pinned to the actual dark value directly so this panel
          reads the same in both themes; --alt-bg-green itself stays theme-reactive for its one
          other real use (::selection). */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden bg-[#0B1A08]">
        {/* Looping ambient background (Pixabay, royalty-free, no attribution required —
            license: https://pixabay.com/service/license-summary/). Replaces the old animated
            blob-gradient decoration — a real loop already supplies the motion, so layering both
            would be too busy. The dark overlay is what keeps the heading readable regardless of
            what's happening in the footage; drop this whole block to go back to the flat color
            if the video doesn't earn its keep. */}
        <video
          className="absolute inset-0 w-full h-full object-cover"
          src="/brand/login-bg.mp4"
          autoPlay
          muted
          loop
          playsInline
        />
        <div className="absolute inset-0" style={{ background: 'rgba(11,26,8,0.72)' }} />
        <div className="absolute inset-0 grid-overlay opacity-40" />
        <div className="relative">
          <img src="/brand/logo-white.png" alt="ScalePods" className="h-7" />
        </div>
        <div className="relative">
          <div className="badge mb-5"><Sparkles size={13} /> Growth OS</div>
          <h1 className="text-5xl leading-[1.05] text-white max-w-lg">
            The marketing OS we <span className="accent-serif">run on ourselves</span>.
          </h1>
          <p className="text-white/60 mt-5 max-w-md">
            Brand knowledge → intelligence → strategy → content → publishing → analytics.
            Every screen is a live demo of what we build for you.
          </p>
        </div>
        <div className="relative badge badge-blue w-fit">
          <Sparkles size={12} /> Generated by ScalePods Growth OS AI
        </div>
      </div>

      {/* Form panel */}
      <div className="relative flex items-center justify-center p-6 sm:p-12">
        <button
          onClick={() => setTheme(toggleTheme())}
          className="btn-ghost absolute top-5 right-5 !p-2 !rounded-full"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div className="w-full max-w-sm">
          <img src={logo} alt="ScalePods" className="h-7 mb-8 lg:hidden" />
          <h2 className="text-2xl mb-1">Welcome back</h2>
          <p className="text-muted text-sm mb-6">Sign in to your Growth OS workspace.</p>

          {resetMode ? (
            <div>
              <div className="font-medium mb-1.5">Reset password</div>
              <p className="text-secondary text-sm mb-5 leading-relaxed">
                A password reset link will be sent to <b className="text-ink">{email}</b>.
              </p>

              {resetSent ? (
                <div
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm mb-4"
                  style={{ background: 'rgb(var(--accent-green-rgb) / 0.12)', border: '1px solid rgb(var(--accent-green-rgb) / 0.3)', color: 'var(--accent-green)' }}
                >
                  <Send size={16} className="shrink-0" />
                  <span>Reset link sent — check <b>{email}</b></span>
                </div>
              ) : (
                <>
                  {resetError && <div className="text-sm text-[var(--accent-orange)] mb-3">{resetError}</div>}
                  <button className="btn-primary w-full mb-3" onClick={sendResetLink} disabled={resetBusy}>
                    {resetBusy ? 'Sending…' : 'Send reset link'}
                  </button>
                </>
              )}

              <button onClick={closeResetPanel} className="text-sm text-muted hover:text-sage underline">
                ← Back to sign in
              </button>
            </div>
          ) : (
            <>
              {oauthError && (
                <div
                  className="flex items-start gap-2.5 px-4 py-3 rounded-xl text-sm mb-5"
                  style={{
                    background: 'rgb(var(--accent-orange-rgb) / 0.12)',
                    border: '1px solid rgb(var(--accent-orange-rgb) / 0.3)',
                    color: 'var(--accent-orange)',
                  }}
                >
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{oauthError}</span>
                </div>
              )}

              {/* The primary path for the team: everyone has a @scalepods.co Google account, so
                  there are no passwords to issue, rotate or forget. The email form below stays as a
                  fallback so a misconfigured OAuth client can't lock everybody out at once. */}
              <button type="button" onClick={onGoogle} disabled={googleBusy} className="btn-ghost w-full !py-3 !font-semibold">
                <GoogleMark />
                {googleBusy ? 'Redirecting to Google…' : 'Continue with Google'}
              </button>

              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                <span className="text-muted text-[11px] uppercase tracking-wide">or</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input mt-1"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="label">Password</label>
                    <button type="button" onClick={openResetPanel} className="text-xs text-sage hover:underline">
                      Forgot?
                    </button>
                  </div>
                  <div className="relative mt-1">
                    <input
                      className="input !pr-10"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-sage"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {error && <div className="text-sm text-[var(--accent-orange)]">{error}</div>}

                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} />
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
