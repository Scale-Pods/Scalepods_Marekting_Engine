import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrainCircuit, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { listProfiles, listReports, getLatestReport, triggerAiAnalysis, type BusinessProfile, type BIReport } from '../lib/clients'
import { PageHeader, Badge, Button, EmptyState, Spinner } from '../components/ui'

const STATUS_META: Record<BIReport['status'], { label: string; tone: 'green' | 'blue' | 'orange'; icon: typeof CheckCircle2 }> = {
  completed: { label: 'Completed', tone: 'green', icon: CheckCircle2 },
  processing: { label: 'Processing', tone: 'blue', icon: Loader2 },
  pending: { label: 'Pending', tone: 'blue', icon: Loader2 },
  failed: { label: 'Failed', tone: 'orange', icon: XCircle },
}

export default function Intelligence() {
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [latest, setLatest] = useState<BIReport | null>(null)
  const [history, setHistory] = useState<BIReport[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (profileId: string) => {
    const [lat, hist] = await Promise.all([getLatestReport(profileId), listReports(profileId)])
    setLatest(lat)
    setHistory(hist)
    return lat
  }, [])

  useEffect(() => {
    listProfiles().then(async (profiles) => {
      const p = profiles[0] ?? null
      setProfile(p)
      if (p) await load(p.id)
    })
  }, [load])

  useEffect(() => {
    if (!profile) return
    const isActive = latest?.status === 'processing' || latest?.status === 'pending'
    if (isActive && !pollRef.current) {
      pollRef.current = setInterval(() => load(profile.id), 4000)
    } else if (!isActive && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [profile, latest?.status, load])

  async function onRefresh() {
    if (!profile) return
    setRefreshing(true)
    await triggerAiAnalysis(profile.id)
    await load(profile.id)
    setRefreshing(false)
  }

  if (profile === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    )
  }

  if (!profile) {
    return (
      <div>
        <PageHeader accent={<Badge><BrainCircuit size={12} /> Intelligence</Badge>} title="Intelligence" />
        <EmptyState
          icon={<BrainCircuit size={28} />}
          title="No business profile yet"
          hint="Create the business profile first — saving it fires the AI Business Analysis automatically."
        />
      </div>
    )
  }

  const meta = latest ? STATUS_META[latest.status] : null
  const StatusIcon = meta?.icon ?? BrainCircuit
  const isActive = latest?.status === 'processing' || latest?.status === 'pending'

  return (
    <div>
      <PageHeader
        accent={<Badge><BrainCircuit size={12} /> Intelligence</Badge>}
        title={`AI Business Analysis — ${profile.business_name}`}
        subtitle="7 sub-analyses (website, Instagram, Facebook, LinkedIn, competitor, SEO, audience) compiled into one report."
        actions={
          <Button variant="ghost" onClick={onRefresh} loading={refreshing}>
            <RefreshCw size={15} /> Re-run
          </Button>
        }
      />

      {!latest ? (
        <EmptyState icon={<BrainCircuit size={28} />} title="No report yet" hint="Click Re-run to generate the first analysis." />
      ) : (
        <Link to={`/intelligence/${latest.id}`} className="card p-5 flex items-center justify-between hover:border-sage/40 transition-colors mb-6">
          <div className="flex items-center gap-3">
            <StatusIcon size={20} className={isActive ? 'animate-spin text-electric' : meta!.tone === 'orange' ? 'text-terracotta' : 'text-sage'} />
            <div>
              <div className="font-medium">Latest report</div>
              <div className="text-muted text-xs">{new Date(latest.created_at).toLocaleString()}</div>
            </div>
          </div>
          <Badge tone={meta!.tone}>{meta!.label}</Badge>
        </Link>
      )}

      {isActive && (
        <div className="card p-5 mb-6 flex flex-wrap items-center gap-2">
          <span className="text-muted text-xs mr-1">Running:</span>
          {['Website', 'Instagram', 'Facebook', 'LinkedIn', 'Competitors', 'SEO', 'Synthesis'].map((step, i) => (
            <span
              key={step}
              className="badge badge-blue"
              style={{ animation: `spFadeInUp 0.4s ease ${i * 0.12}s both` }}
            >
              {step}
            </span>
          ))}
          <style>{`@keyframes spFadeInUp { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
      )}

      {history.length > 1 && (
        <>
          <div className="text-sm font-medium text-secondary mb-3">History</div>
          <div className="space-y-2">
            {history.slice(1).map((r) => {
              const m = STATUS_META[r.status]
              return (
                <Link key={r.id} to={`/intelligence/${r.id}`} className="card p-3 flex items-center justify-between hover:border-sage/40 transition-colors">
                  <span className="text-sm text-secondary">{new Date(r.created_at).toLocaleString()}</span>
                  <Badge tone={m.tone}>{m.label}</Badge>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
