import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, AlertTriangle, Wand2 } from 'lucide-react'
import { Badge, Button, Modal, Spinner } from '../ui'
import { PlatformBadge } from '../mediaUi'
import { StrategyCalendarView } from './StrategyCalendarView'
import type { StrategyGeneration, CalendarItem } from '../../lib/strategy'

// AI Studio only generates images for these three — a calendar item planned for YouTube still
// forwards, just without a platform preselected (video generation stays manual project-wide).
const STUDIO_SUPPORTED_PLATFORMS = new Set(['instagram', 'linkedin', 'facebook'])

const SCOPE_LABEL: Record<string, string> = { day: 'Single post', week: 'One week', month: 'Full month' }
const PLATFORM_TONE: Record<string, 'green' | 'blue' | 'orange'> = {
  linkedin: 'blue', instagram: 'green', facebook: 'blue', youtube: 'orange',
}

const SECTIONS: { key: keyof StrategyGeneration; label: string }[] = [
  { key: 'campaign_planning', label: 'Campaign Planning' },
  { key: 'weekly_content_strategy', label: 'Weekly Content' },
  { key: 'content_pillars', label: 'Content Pillars' },
  { key: 'platform_strategy', label: 'Platform Strategy' },
  { key: 'lead_generation_strategy', label: 'Lead-Gen' },
  { key: 'cta_strategy', label: 'CTA Strategy' },
]

// Deliberately read-only — a scoped generation never becomes "the" active strategy (locked in
// with the user), so there's no save/regenerate here the way the main Strategy page's
// SectionEditor has. Just a plain key/value render of whatever GPT returned for each section.
function ReadOnlySection({ label, value }: { label: string; value: unknown }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return null
  return (
    <div>
      <div className="label mb-2">{label}</div>
      <div className="space-y-2.5">
        {entries.map(([k, v]) => (
          <div key={k}>
            <div className="text-xs font-semibold text-secondary capitalize mb-1">{k.replace(/_/g, ' ')}</div>
            <div className="text-sm text-secondary">
              {Array.isArray(v) ? (
                <ul className="list-disc list-inside space-y-0.5">
                  {v.map((item, i) => (
                    <li key={i}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                  ))}
                </ul>
              ) : v && typeof v === 'object' ? (
                <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre>
              ) : (
                String(v ?? '')
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StrategyGenerationModal({ generation, onClose }: { generation: StrategyGeneration; onClose: () => void }) {
  const [detailItem, setDetailItem] = useState<CalendarItem | null>(null)
  const navigate = useNavigate()
  const topics = generation.source_signals_snapshot.map((s) => s.topic).join(', ') || 'Generated strategy'

  // Same deep-link pattern Trends.tsx's "Create Post" already uses (navigate to /studio with
  // state AI Studio's own mount effect reads) — one calendar item maps cleanly to one AI Studio
  // brief, the same granularity as picking a single trend, unlike the whole generation which can
  // span a week or month of posts.
  function onCreatePost(item: CalendarItem) {
    onClose()
    navigate('/studio', {
      state: {
        topic: item.hook ? `${item.title}: ${item.hook}` : item.title,
        platform: STUDIO_SUPPORTED_PLATFORMS.has(item.platform?.toLowerCase()) ? item.platform.toLowerCase() : undefined,
      },
    })
  }

  return (
    <>
      <Modal title={topics.length > 60 ? `${topics.slice(0, 60)}…` : topics} onClose={onClose} size="lg">
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="blue">{SCOPE_LABEL[generation.scope] ?? generation.scope}</Badge>
            {generation.platform && <PlatformBadge platform={generation.platform} />}
            {generation.content_type && <Badge tone="orange">{generation.content_type.replace(/_/g, ' ')}</Badge>}
            <Badge tone={generation.status === 'completed' ? 'green' : generation.status === 'failed' ? 'orange' : 'grey'}>
              {generation.status}
            </Badge>
            <span className="text-muted text-xs">{new Date(generation.created_at).toLocaleString()}</span>
          </div>

          {generation.source_signals_snapshot.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Sparkles size={12} style={{ color: 'var(--accent-orange)' }} />
              {generation.source_signals_snapshot.map((s) => (
                <span key={s.id} className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}>
                  {s.source} — {s.topic.slice(0, 50)}
                </span>
              ))}
            </div>
          )}

          {generation.status === 'processing' && (
            <div className="card p-6 flex flex-col items-center gap-3 text-center">
              <Spinner size={20} />
              <div className="text-sm text-secondary">Still generating…</div>
            </div>
          )}

          {generation.status === 'failed' && (
            <div className="flex items-start gap-3 panel p-3">
              <AlertTriangle size={18} style={{ color: 'var(--accent-orange)' }} className="shrink-0 mt-0.5" />
              <div className="text-sm text-secondary">{generation.error_detail || 'Unknown error.'}</div>
            </div>
          )}

          {generation.status === 'completed' && (
            <>
              {generation.ai_summary && <p className="text-secondary text-sm">{generation.ai_summary}</p>}

              {generation.content_calendar.length > 0 && (
                <div>
                  <div className="label mb-2">Content Calendar</div>
                  <StrategyCalendarView items={generation.content_calendar} onSelect={setDetailItem} />
                </div>
              )}

              {SECTIONS.map((s) => (
                <ReadOnlySection key={String(s.key)} label={s.label} value={generation[s.key]} />
              ))}
            </>
          )}
        </div>
      </Modal>

      {detailItem && (
        <Modal title={detailItem.title} onClose={() => setDetailItem(null)}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={PLATFORM_TONE[detailItem.platform?.toLowerCase()] ?? 'blue'}>{detailItem.platform}</Badge>
              <Badge tone="orange">{detailItem.content_type?.replace(/_/g, ' ')}</Badge>
              {detailItem.scheduled_date && <span className="text-muted text-xs">{detailItem.scheduled_date}</span>}
            </div>
            {detailItem.pillar && (
              <div>
                <div className="label mb-1">Pillar</div>
                <div className="text-sm text-secondary">{detailItem.pillar}</div>
              </div>
            )}
            {detailItem.hook && (
              <div>
                <div className="label mb-1">Hook</div>
                <div className="text-sm text-secondary">{detailItem.hook}</div>
              </div>
            )}
            <div className="flex justify-end pt-1">
              <Button onClick={() => onCreatePost(detailItem)}>
                <Wand2 size={15} /> Create Post
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
