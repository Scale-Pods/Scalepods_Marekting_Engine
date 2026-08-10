import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Check, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const navigate = useNavigate()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) return setError('Password must be at least 6 characters')
    if (password !== confirm) return setError('Passwords do not match')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else {
      setDone(true)
      setTimeout(() => navigate('/'), 1500)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 grid-overlay">
      <div className="glass rounded-2xl w-full max-w-sm p-8">
        <div className="badge mb-4"><KeyRound size={13} /> Reset password</div>
        <h1 className="text-2xl mb-1">{done ? 'Password updated!' : 'Set a new password'}</h1>
        {done && <p className="text-muted text-sm mb-6">Redirecting…</p>}
        {done ? (
          <div className="flex justify-center py-2">
            <div
              className="h-14 w-14 rounded-full flex items-center justify-center"
              style={{ background: 'rgb(var(--accent-green-rgb) / 0.15)' }}
            >
              <Check size={26} className="text-sage" />
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 mt-5">
            <div>
              <label className="label">New password</label>
              <div className="relative mt-1">
                <input
                  className="input"
                  style={{ paddingRight: 42 }}
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-sage"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="label">Confirm password</label>
              <input
                className="input mt-1"
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={6}
                required
              />
            </div>
            {error && <div className="text-sm text-[var(--accent-orange)]">{error}</div>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
