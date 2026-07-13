import { useEffect, useState } from 'react'
import { Sparkles, Sun, Moon, Database, ShieldCheck } from 'lucide-react'
import { toggleTheme, getTheme, type Theme } from './lib/theme'
import { supabase } from './lib/supabase'

// Step-1 scaffold screen: proves brand tokens, fonts, glass, theme toggle, and
// the Supabase connection are wired. Replaced by real routing in build step 2.
export default function App() {
  const [theme, setTheme] = useState<Theme>(getTheme())
  const [dbOk, setDbOk] = useState<'checking' | 'ok' | 'fail'>('checking')

  useEffect(() => {
    supabase
      .from('business_profiles')
      .select('id', { count: 'exact', head: true })
      .then(({ error }) => setDbOk(error ? 'fail' : 'ok'))
  }, [])

  const logo = theme === 'dark' ? '/brand/logo-white.png' : '/brand/logo-black.png'

  return (
    <div className="min-h-screen grid-overlay flex items-center justify-center p-6">
      <div className="glass rounded-2xl max-w-xl w-full p-10 relative">
        <button
          onClick={() => setTheme(toggleTheme())}
          className="btn-ghost absolute top-5 right-5 !p-2 !rounded-full"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <img src={logo} alt="ScalePods" className="h-8 mb-8" />

        <div className="badge mb-5"><Sparkles size={13} /> Growth OS</div>

        <h1 className="text-4xl leading-tight mb-3">
          The marketing OS we <span className="accent-serif">run on ourselves</span>.
        </h1>
        <p className="text-secondary mb-8">
          Brand knowledge → intelligence → strategy → content → publishing →
          analytics → self-improvement. Scaffold online.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="panel p-4 flex items-center gap-3">
            <ShieldCheck size={20} className="text-sage" />
            <div className="text-sm">
              <div className="font-medium">Brand system</div>
              <div className="text-muted text-xs">Tokens + fonts loaded</div>
            </div>
          </div>
          <div className="panel p-4 flex items-center gap-3">
            <Database
              size={20}
              style={{ color: dbOk === 'fail' ? 'var(--accent-orange)' : 'var(--accent-green)' }}
            />
            <div className="text-sm">
              <div className="font-medium">Supabase</div>
              <div className="text-muted text-xs">
                {dbOk === 'checking' ? 'Connecting…' : dbOk === 'ok' ? 'Schema reachable' : 'Check config'}
              </div>
            </div>
          </div>
        </div>

        <button className="btn-primary w-full mt-6">Continue — build step 2</button>
      </div>
    </div>
  )
}
