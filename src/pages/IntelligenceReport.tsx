import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, BrainCircuit, Globe, Instagram, Facebook, Linkedin, TrendingUp, Search, Users, FileText,
} from 'lucide-react'
import { getReport, type BIReport } from '../lib/clients'
import { Spinner, EmptyState } from '../components/ui'
import Markdown from '../components/Markdown'

const SECTIONS: { key: keyof BIReport; label: string; icon: typeof Globe; color: string }[] = [
  { key: 'website_analysis', label: 'Website', icon: Globe, color: 'var(--accent-blue)' },
  { key: 'instagram_analysis', label: 'Instagram', icon: Instagram, color: '#E1306C' },
  { key: 'facebook_analysis', label: 'Facebook', icon: Facebook, color: '#1877F2' },
  { key: 'linkedin_analysis', label: 'LinkedIn', icon: Linkedin, color: '#0A66C2' },
  { key: 'competitor_analysis', label: 'Competitor', icon: TrendingUp, color: 'var(--accent-orange)' },
  { key: 'seo_analysis', label: 'SEO', icon: Search, color: 'var(--accent-green)' },
  { key: 'audience_analysis', label: 'Audience', icon: Users, color: 'var(--accent-blue)' },
]

export default function IntelligenceReport() {
  const { id } = useParams()
  const [report, setReport] = useState<BIReport | null>(null)
  const [active, setActive] = useState<'full' | keyof BIReport>('full')

  useEffect(() => {
    if (id) getReport(id).then(setReport)
  }, [id])

  if (!report) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    )
  }

  const body = active === 'full' ? report.full_report : (report[active] as string | null)
  const availableSections = SECTIONS.filter((s) => report[s.key])
  const activeMeta = active !== 'full' ? SECTIONS.find((s) => s.key === active) : null
  const activeIndex = activeMeta ? availableSections.findIndex((s) => s.key === active) : -1

  return (
    <div>
      <Link to="/intelligence" className="text-muted text-sm inline-flex items-center gap-1 mb-4 hover:text-sage">
        <ArrowLeft size={14} /> Back to Intelligence
      </Link>

      <div className="card overflow-hidden mb-6 p-0">
        <div
          className="h-20 relative"
          style={{ background: 'linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-green) 100%)' }}
        >
          <div
            className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 15% 30%, #fff 0, transparent 40%), radial-gradient(circle at 85% 70%, #fff 0, transparent 40%)' }}
          />
        </div>
        <div className="px-6 pb-5">
          <div className="flex items-end justify-between -mt-7 mb-2">
            <div
              className="h-14 w-14 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--bg-layer3)', border: '3px solid var(--glass-fill)' }}
            >
              <BrainCircuit size={24} style={{ color: 'var(--accent-green)' }} />
            </div>
          </div>
          <h1 className="text-xl font-semibold">Business Intelligence Report</h1>
          <p className="text-muted text-sm mt-0.5">{new Date(report.created_at).toLocaleString()}</p>
        </div>
      </div>

      {report.status === 'failed' ? (
        <EmptyState title="Analysis failed" hint={report.error_message || 'Unknown error — try re-running from the Intelligence page.'} />
      ) : (
        <>
          <div className="flex gap-2 flex-wrap mb-6">
            <button
              onClick={() => setActive('full')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={{
                background: active === 'full' ? 'var(--accent-green)' : 'var(--fill-secondary)',
                color: active === 'full' ? 'var(--cta-text)' : 'var(--text-primary)',
                border: `1.5px solid ${active === 'full' ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
              }}
            >
              <FileText size={13} /> Full report
            </button>
            {SECTIONS.map((s) => {
              const hasData = Boolean(report[s.key])
              const isActive = active === s.key
              const Icon = s.icon
              return (
                <button
                  key={s.key}
                  onClick={() => setActive(s.key)}
                  disabled={!hasData}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all disabled:cursor-not-allowed"
                  style={{
                    background: isActive ? s.color : 'var(--fill-secondary)',
                    color: isActive ? '#fff' : hasData ? 'var(--text-primary)' : 'var(--text-quaternary)',
                    border: `1.5px solid ${isActive ? s.color : 'var(--border-subtle)'}`,
                    opacity: hasData ? 1 : 0.5,
                  }}
                >
                  <Icon size={13} /> {s.label}
                </button>
              )
            })}
          </div>

          <div className="card p-6">
            {activeMeta && (
              <div className="flex items-center gap-2.5 mb-4 pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${activeMeta.color}22` }}>
                  <activeMeta.icon size={16} style={{ color: activeMeta.color }} />
                </div>
                <div className="font-medium">{activeMeta.label} Analysis</div>
                {activeIndex >= 0 && (
                  <span className="text-muted text-xs ml-auto">{activeIndex + 1} of {availableSections.length} sections</span>
                )}
              </div>
            )}
            {body ? <Markdown text={body} /> : <div className="text-muted text-sm">No content for this section yet.</div>}
          </div>
        </>
      )}
    </div>
  )
}
