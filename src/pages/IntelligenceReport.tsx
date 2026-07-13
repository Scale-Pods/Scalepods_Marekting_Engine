import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, BrainCircuit } from 'lucide-react'
import { getReport, type BIReport } from '../lib/clients'
import { PageHeader, Badge, Spinner, EmptyState } from '../components/ui'
import Markdown from '../components/Markdown'

const SECTIONS: { key: keyof BIReport; label: string }[] = [
  { key: 'website_analysis', label: 'Website' },
  { key: 'instagram_analysis', label: 'Instagram' },
  { key: 'facebook_analysis', label: 'Facebook' },
  { key: 'linkedin_analysis', label: 'LinkedIn' },
  { key: 'competitor_analysis', label: 'Competitor' },
  { key: 'seo_analysis', label: 'SEO' },
  { key: 'audience_analysis', label: 'Audience' },
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

  return (
    <div>
      <Link to="/intelligence" className="text-muted text-sm inline-flex items-center gap-1 mb-4 hover:text-sage">
        <ArrowLeft size={14} /> Back to Intelligence
      </Link>
      <PageHeader
        accent={<Badge><BrainCircuit size={12} /> Intelligence</Badge>}
        title="Business Intelligence Report"
        subtitle={new Date(report.created_at).toLocaleString()}
      />

      {report.status === 'failed' ? (
        <EmptyState title="Analysis failed" hint={report.error_message || 'Unknown error — try re-running from the Intelligence page.'} />
      ) : (
        <>
          <div className="flex gap-2 flex-wrap mb-6">
            <button
              onClick={() => setActive('full')}
              className={active === 'full' ? 'badge' : 'badge opacity-40'}
            >
              Full report
            </button>
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setActive(s.key)}
                className={active === s.key ? 'badge badge-blue' : 'badge badge-blue opacity-40'}
                disabled={!report[s.key]}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="card p-6">
            {body ? <Markdown text={body} /> : <div className="text-muted text-sm">No content for this section yet.</div>}
          </div>
        </>
      )}
    </div>
  )
}
