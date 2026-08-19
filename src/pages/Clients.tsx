import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Building2, Plus, ArrowRight, Trash2 } from 'lucide-react'
import { deleteProfile, countProfileContent } from '../lib/clients'
import { useProfiles, qk } from '../lib/queries'
import { PageHeader, EmptyState, Badge, Spinner } from '../components/ui'
import { useToast, toastMessage } from '../components/Toast'

export default function Clients() {
  const { data: profiles, isLoading } = useProfiles()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  // Every table with a profile_id FK cascades on delete — this permanently wipes the profile's
  // content, scheduled posts, strategy, trend data, and AI reports along with it, all in one
  // shot. The count is what makes the confirm actually say something concrete rather than a
  // generic "this can't be undone" nobody reads.
  async function handleDelete(id: string, name: string) {
    let count = 0
    try {
      count = await countProfileContent(id)
    } catch {
      // If the count itself fails, fall through to a confirm without it rather than blocking
      // deletion entirely on a secondary read.
    }
    const contentLine = count > 0 ? ` and its ${count} post${count === 1 ? '' : 's'}` : ''
    if (!window.confirm(
      `Delete "${name}"?\n\nThis permanently removes the profile${contentLine}, plus all scheduled posts, strategy, trend data, and AI reports tied to it. This cannot be undone.`,
    )) return
    setDeletingId(id)
    try {
      await deleteProfile(id)
      qc.invalidateQueries({ queryKey: qk.profiles })
      qc.invalidateQueries({ queryKey: qk.navCounts })
      toast.success(`"${name}" deleted`)
    } catch (err) {
      toast.error(toastMessage(err, 'Could not delete this profile'))
    } finally {
      setDeletingId(null)
    }
  }

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

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : !profiles || profiles.length === 0 ? (
        <EmptyState
          icon={<Building2 size={28} />}
          title="No business profile yet"
          hint="Create the ScalePods profile to seed intelligence, trends, strategy, and content generation."
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {profiles.map((p) => (
            <div key={p.id} className="relative group">
              <Link to={`/clients/${p.id}`} className="card p-5 hover:border-sage/40 transition-colors block">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="h-11 w-11 rounded-xl overflow-hidden shrink-0"
                      style={{ background: 'var(--bg-layer3)' }}
                    >
                      <img src="/brand/logo-square.jpg" alt={p.business_name || 'ScalePods'} className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.business_name || 'Untitled business'}</div>
                      <div className="text-muted text-sm mt-0.5 truncate">{p.industry || 'No industry set'}</div>
                    </div>
                  </div>
                  <ArrowRight size={16} className="text-muted group-hover:text-sage transition-colors shrink-0 mr-8" />
                </div>
                <div className="flex gap-1.5 mt-4 flex-wrap items-center">
                  <Badge tone={p.status === 'active' ? 'green' : 'orange'}>{p.status || 'onboarding'}</Badge>
                  <Badge tone="grey">{p.target_platforms?.length ?? 0} platform{p.target_platforms?.length === 1 ? '' : 's'}</Badge>
                  {p.target_platforms?.map((pl) => (
                    <Badge key={pl} tone="blue">{pl}</Badge>
                  ))}
                </div>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleDelete(p.id, p.business_name || 'this profile')
                }}
                disabled={deletingId === p.id}
                className="absolute top-5 right-5 h-7 w-7 rounded-full flex items-center justify-center text-muted hover:text-[var(--accent-orange)] transition-colors opacity-0 group-hover:opacity-100"
                aria-label={`Delete ${p.business_name || 'this profile'}`}
                title="Delete profile"
              >
                {deletingId === p.id ? <Spinner size={14} /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
