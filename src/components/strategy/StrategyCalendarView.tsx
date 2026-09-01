import { useState } from 'react'
import { CalendarDays, List, LayoutGrid } from 'lucide-react'
import { Panel, Badge } from '../ui'
import type { CalendarItem } from '../../lib/strategy'

const PLATFORM_TONE: Record<string, 'green' | 'blue' | 'orange'> = {
  linkedin: 'blue', instagram: 'green', facebook: 'blue', youtube: 'orange',
}

// A separate mapping from PLATFORM_TONE — this one keys off the content pillar (HR/Sales/Ops/
// Marketing), not the platform, so a Month view day chip's color always means "which Pod",
// independent of the Table view's platform badges directly below it. Solid dots for the legend,
// a 20%-tinted version (via CSS relative color syntax) for the day-chip background itself.
const PILLAR_COLOR: Record<string, string> = {
  HR: 'var(--accent-blue)', Sales: 'var(--accent-green)', Ops: 'var(--accent-orange)', Marketing: 'var(--text-muted)',
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function buildMonthGrid(items: CalendarItem[]): { weeks: Date[][]; monthLabel: string } {
  const validDates = items.map((i) => i.scheduled_date).filter(Boolean) as string[]
  if (validDates.length === 0) return { weeks: [], monthLabel: '' }

  const times = validDates.map((d) => new Date(`${d}T00:00:00`).getTime())
  const min = new Date(Math.min(...times))
  const max = new Date(Math.max(...times))

  const start = new Date(min)
  start.setDate(start.getDate() - start.getDay())
  const end = new Date(max)
  end.setDate(end.getDate() + (6 - end.getDay()))

  const days: Date[] = []
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d))

  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  const monthLabel = min.getMonth() === max.getMonth()
    ? min.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : `${min.toLocaleDateString(undefined, { month: 'long' })} – ${max.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`

  return { weeks, monthLabel }
}

function toDateKey(d: Date) {
  return d.toISOString().slice(0, 10)
}

export function StrategyCalendarView({
  items, onSelect,
}: {
  items: CalendarItem[]
  onSelect: (item: CalendarItem) => void
}) {
  const [view, setView] = useState<'table' | 'month'>('table')

  if (items.length === 0) {
    return (
      <Panel>
        <div className="flex items-center gap-2 mb-4 font-medium">
          <CalendarDays size={16} className="text-sage" /> Content Calendar
        </div>
        <div className="text-muted text-sm">No calendar items.</div>
      </Panel>
    )
  }

  const byDate = new Map<string, CalendarItem[]>()
  for (const item of items) {
    if (!item.scheduled_date) continue
    const list = byDate.get(item.scheduled_date) ?? []
    list.push(item)
    byDate.set(item.scheduled_date, list)
  }
  const { weeks, monthLabel } = buildMonthGrid(items)

  return (
    <Panel>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2 font-medium">
          <CalendarDays size={16} className="text-sage" /> Content Calendar
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setView('table')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
            style={{
              background: view === 'table' ? 'var(--accent-green)' : 'var(--fill-secondary)',
              color: view === 'table' ? 'var(--bg-primary)' : 'var(--text-primary)',
              border: `1.5px solid ${view === 'table' ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
            }}
          >
            <List size={12} /> Table
          </button>
          <button
            onClick={() => setView('month')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
            style={{
              background: view === 'month' ? 'var(--accent-green)' : 'var(--fill-secondary)',
              color: view === 'month' ? 'var(--bg-primary)' : 'var(--text-primary)',
              border: `1.5px solid ${view === 'month' ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
            }}
          >
            <LayoutGrid size={12} /> Month
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Date', 'Platform', 'Topic', 'Hook'].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-muted uppercase tracking-wide py-2 px-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={i}
                  onClick={() => onSelect(item)}
                  className="cursor-pointer hover:bg-[var(--fill-tertiary)] transition-colors"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <td className="py-2.5 px-2 text-muted text-xs whitespace-nowrap">{item.scheduled_date || '—'}</td>
                  <td className="py-2.5 px-2">
                    <Badge tone={PLATFORM_TONE[item.platform?.toLowerCase()] ?? 'blue'}>{item.platform}</Badge>
                  </td>
                  <td className="py-2.5 px-2 font-medium">{item.title}</td>
                  <td className="py-2.5 px-2 text-secondary text-xs truncate max-w-xs">{item.hook || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-secondary">{monthLabel}</div>
            <div className="flex items-center gap-3 flex-wrap">
              {Object.entries(PILLAR_COLOR).map(([pillar, color]) => (
                <span key={pillar} className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: color, display: 'inline-block' }} />
                  {pillar}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-muted uppercase tracking-wide py-1">{d}</div>
            ))}
          </div>
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((day) => {
                  const key = toDateKey(day)
                  const dayItems = byDate.get(key) ?? []
                  return (
                    <div
                      key={key}
                      className="panel !p-1.5 min-h-[64px]"
                      style={{ background: dayItems.length ? 'var(--fill-secondary)' : 'transparent' }}
                    >
                      <div className="text-[10px] text-muted mb-1">{day.getDate()}</div>
                      <div className="space-y-1">
                        {dayItems.map((item, i) => {
                          const color = PILLAR_COLOR[item.pillar || ''] ?? 'var(--text-muted)'
                          return (
                            <button
                              key={i}
                              onClick={() => onSelect(item)}
                              className="w-full text-left text-[10px] font-semibold px-1.5 py-0.5 rounded truncate"
                              style={{ background: `color-mix(in srgb, ${color} 20%, transparent)`, color: 'var(--text-primary)' }}
                              title={item.title}
                            >
                              {item.title}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}
