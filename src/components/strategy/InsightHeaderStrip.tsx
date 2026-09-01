import type { ReactNode } from 'react'
import { Zap, TrendingDown, ArrowLeftRight } from 'lucide-react'
import { Panel } from '../ui'
import type { HeaderInsights } from '../../lib/strategy'

// Three compact real-data callouts, replacing the wall of generic prose the old format buried
// these findings in. Every number here was computed in n8n from real post_analytics/ai_insights
// data, never invented by GPT — see Build Strategy Prompt in the n8n workflow.
export function InsightHeaderStrip({ insights }: { insights: HeaderInsights | null }) {
  if (!insights) return null

  const cards: { icon: typeof Zap; color: string; title: string; body: ReactNode }[] = []

  if (insights.best_lever) {
    cards.push({
      icon: Zap,
      color: 'var(--accent-green)',
      title: 'Best real lever',
      body: (
        <>
          <div className="font-medium text-sm mb-1">{insights.best_lever.title}</div>
          <div className="text-secondary text-xs mb-1.5">{insights.best_lever.evidence}</div>
          <div className="text-xs" style={{ color: 'var(--accent-green)' }}>{insights.best_lever.recommendation}</div>
        </>
      ),
    })
  }

  if (insights.weakest_pillar) {
    const wp = insights.weakest_pillar
    cards.push({
      icon: TrendingDown,
      color: 'var(--accent-orange)',
      title: 'Weakest pillar',
      body: (
        <>
          <div className="font-medium text-sm mb-1">
            {wp.pillar} — {wp.actual_pct}% actual vs {wp.recommended_pct}% recommended
          </div>
          <div className="text-secondary text-xs">{wp.note}</div>
        </>
      ),
    })
  }

  if (insights.channel_mismatch) {
    const cm = insights.channel_mismatch
    cards.push({
      icon: ArrowLeftRight,
      color: 'var(--accent-blue)',
      title: 'Channel mismatch',
      body: (
        <>
          <div className="font-medium text-sm mb-1 capitalize">
            {cm.stated_primary} stated ({cm.stated_pct}%) vs {cm.actual_leader} actual ({cm.actual_pct}%)
          </div>
          <div className="text-secondary text-xs">{cm.note}</div>
        </>
      ),
    })
  }

  if (cards.length === 0) return null

  return (
    <div className="grid sm:grid-cols-3 gap-3 mb-5">
      {cards.map((c) => {
        const Icon = c.icon
        return (
          <Panel key={c.title} className="!p-3.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: c.color }}>
              <Icon size={13} /> {c.title}
            </div>
            {c.body}
          </Panel>
        )
      })}
    </div>
  )
}
