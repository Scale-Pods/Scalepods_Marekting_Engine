import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { Panel } from '../ui'
import type { PillarBalance } from '../../lib/strategy'

const PILLARS: { key: 'hr' | 'sales' | 'ops' | 'marketing'; label: string }[] = [
  { key: 'hr', label: 'HR' },
  { key: 'sales', label: 'Sales' },
  { key: 'ops', label: 'Ops' },
  { key: 'marketing', label: 'Marketing' },
]

// recommended = sage (this app's primary accent), actual = electric blue (secondary) — never
// terracotta here, that's reserved for Claude-partner badges / warning callouts elsewhere.
export function PillarBalanceChart({ balance }: { balance: PillarBalance | null }) {
  if (!balance) return null

  const hasActual = balance.source_posts_analyzed > 0
  const data = PILLARS.map((p) => ({
    name: p.label,
    Recommended: balance.recommended[p.key] ?? 0,
    ...(hasActual ? { Actual: balance.actual[p.key] ?? 0 } : {}),
  }))

  return (
    <Panel className="mb-5">
      <div className="flex items-center justify-between mb-1">
        <div className="font-medium">Pillar Balance</div>
        {hasActual ? (
          <div className="text-muted text-xs">From {balance.source_posts_analyzed} real published posts</div>
        ) : (
          <div className="text-muted text-xs">No pillar-tagged posts published yet</div>
        )}
      </div>
      {!hasActual && (
        <div className="text-secondary text-xs mb-2">
          Showing the recommended split only — not enough published, pillar-tagged content yet to compare against what's actually gone out.
        </div>
      )}
      <ResponsiveContainer width="100%" height={220} className="chart-clean">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 6" stroke="var(--border-subtle)" strokeWidth={0.5} vertical={false} />
          <XAxis dataKey="name" axisLine={false} tickLine={false} stroke="var(--text-muted)" fontSize={12} />
          <YAxis axisLine={false} tickLine={false} stroke="var(--text-muted)" fontSize={12} unit="%" />
          <Tooltip
            cursor={{ fill: 'var(--fill-tertiary)' }}
            contentStyle={{
              background: 'var(--glass-fill)', backdropFilter: 'blur(20px)',
              border: 'none', outline: '1px solid var(--glass-border)', borderRadius: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Recommended" fill="var(--accent-green)" radius={[6, 6, 0, 0]} maxBarSize={40} />
          {hasActual && <Bar dataKey="Actual" fill="var(--accent-blue)" radius={[6, 6, 0, 0]} maxBarSize={40} />}
        </BarChart>
      </ResponsiveContainer>
      {hasActual && balance.actual.unclassified > 0 && (
        <div className="text-muted text-xs mt-2">
          {balance.actual.unclassified}% of published posts aren't tagged to a pillar yet, so the real split above undercounts each pod.
        </div>
      )}
    </Panel>
  )
}
