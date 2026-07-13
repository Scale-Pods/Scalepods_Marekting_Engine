import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, BrainCircuit, TrendingUp, Target, Sparkles, Send, BarChart3, ArrowRight,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { PageHeader, Badge } from '../components/ui'

const PIPELINE = [
  { to: '/clients', label: 'Business Profile', icon: Building2, desc: 'Brand knowledge base' },
  { to: '/intelligence', label: 'Intelligence', icon: BrainCircuit, desc: 'AI business analysis' },
  { to: '/trends', label: 'Trends', icon: TrendingUp, desc: '8-source signal scan' },
  { to: '/strategy', label: 'Strategy', icon: Target, desc: '7-part plan + approve' },
  { to: '/content', label: 'Content Factory', icon: Sparkles, desc: 'Copy + image + brand' },
  { to: '/publishing', label: 'Publishing', icon: Send, desc: 'IG · YT · FB · LinkedIn' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, desc: 'Insights + learning loop' },
]

export default function Dashboard() {
  const { role } = useAuth()
  const [profile, setProfile] = useState<{ business_name: string | null } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase
      .from('business_profiles')
      .select('business_name')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setProfile(data)
        setLoaded(true)
      })
  }, [])

  return (
    <div>
      <PageHeader
        accent={<Badge><Sparkles size={12} /> Growth OS</Badge>}
        title={
          <>
            Welcome back to <span className="accent-serif">Growth OS</span>
          </>
        }
        subtitle="ScalePods running its own marketing on the exact system it sells — end to end, one screen at a time."
      />

      {loaded && !profile && role === 'admin' && (
        <div className="card p-5 mb-6 flex items-center justify-between gap-4 border-sage/30">
          <div>
            <div className="font-medium">Start here — create the ScalePods business profile.</div>
            <div className="text-muted text-sm">It seeds every downstream engine.</div>
          </div>
          <Link to="/clients" className="btn-primary shrink-0">
            Set up profile <ArrowRight size={16} />
          </Link>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PIPELINE.map((s) => {
          const Icon = s.icon
          return (
            <Link key={s.to} to={s.to} className="card p-5 hover:border-sage/40 transition-colors group">
              <div className="flex items-center justify-between mb-3">
                <div className="h-10 w-10 rounded-lg panel flex items-center justify-center">
                  <Icon size={20} className="text-sage" />
                </div>
                <ArrowRight size={16} className="text-muted group-hover:text-sage transition-colors" />
              </div>
              <div className="font-medium">{s.label}</div>
              <div className="text-muted text-sm">{s.desc}</div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
