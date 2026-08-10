import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Plus, ArrowRight } from 'lucide-react'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import { PageHeader, EmptyState, Badge, Spinner } from '../components/ui'

export default function Clients() {
  const [profiles, setProfiles] = useState<BusinessProfile[] | null>(null)

  useEffect(() => {
    listProfiles().then(setProfiles)
  }, [])

  return (
    <div>
      <PageHeader
        accent={<Badge><Building2 size={12} /> Business</Badge>}
        title="Business profiles"
        subtitle="Brand knowledge base — one profile seeds every downstream engine (intelligence, trends, strategy, content)."
        actions={
          <Link to="/clients/new" className="btn-primary">
            <Plus size={16} /> New profile
          </Link>
        }
      />

      {profiles === null ? (
        <div className="flex justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : profiles.length === 0 ? (
        <EmptyState
          icon={<Building2 size={28} />}
          title="No business profile yet"
          hint="Create the ScalePods profile to seed intelligence, trends, strategy, and content generation."
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {profiles.map((p) => (
            <Link key={p.id} to={`/clients/${p.id}`} className="card p-5 hover:border-sage/40 transition-colors group">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="h-11 w-11 rounded-xl flex items-center justify-center text-sm font-semibold shrink-0"
                    style={{ background: 'var(--bg-layer3)', color: 'var(--accent-green)' }}
                  >
                    {(p.business_name || 'SP').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.business_name || 'Untitled business'}</div>
                    <div className="text-muted text-sm mt-0.5 truncate">{p.industry || 'No industry set'}</div>
                  </div>
                </div>
                <ArrowRight size={16} className="text-muted group-hover:text-sage transition-colors shrink-0" />
              </div>
              <div className="flex gap-1.5 mt-4 flex-wrap items-center">
                <Badge tone={p.status === 'active' ? 'green' : 'orange'}>{p.status || 'onboarding'}</Badge>
                <Badge tone="grey">{p.target_platforms?.length ?? 0} platform{p.target_platforms?.length === 1 ? '' : 's'}</Badge>
                {p.target_platforms?.map((pl) => (
                  <Badge key={pl} tone="blue">{pl}</Badge>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
