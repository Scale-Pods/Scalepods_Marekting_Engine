import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const navigate = useNavigate()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else {
      setDone(true)
      setTimeout(() => navigate('/'), 1200)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 grid-overlay">
      <div className="glass rounded-2xl w-full max-w-sm p-8">
        <div className="badge mb-4"><KeyRound size={13} /> Reset password</div>
        <h1 className="text-2xl mb-6">Set a new password</h1>
        {done ? (
          <p className="text-sage text-sm">Password updated. Redirecting…</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">New password</label>
              <input
                className="input mt-1"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
