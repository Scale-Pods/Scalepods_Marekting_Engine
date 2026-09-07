import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Film, Sparkles, RefreshCw, Play, CheckCircle2, XCircle, Plus, Trash2, TrendingUp, Target, Type,
  Mic, Download, Send, Clapperboard, Wand2, AlertTriangle,
} from 'lucide-react'
import { useProfile } from '../lib/queries'
import { supabase } from '../lib/supabase'
import { listSignalsSince, type TrendSignal } from '../lib/trends'
import type { StudioSourceKind, StudioCopy } from '../lib/studio'
import { ASPECT_RATIOS, PLATFORM_DEFAULT_RATIO, type AspectRatio } from '../lib/studioStyles'
import {
  listVideoJobs, generateVideoBrief, updateVideoDraft, triggerVideoRender, deleteVideoJob,
  markVideoJobUsed, regenerateVideoShot, describeProgress, overallProgress,
  estimateShotsCost, VIDEO_ENGINES, ENGINE_LABEL, PER_VIDEO_CEILING_USD,
  type VideoJob, type CarouselSlide, type VideoShot, type VideoEngine, type VideoType,
} from '../lib/videoStudio'
import { createManualItem, GENERATION_ENABLED, VIDEO_GENERATION_ENABLED } from '../lib/content'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel, Modal } from '../components/ui'
import { useToast, toastMessage } from '../components/Toast'

const POSES = ['casual', 'pointing', 'victory', 'arms-crossed', 'phone'] as const
const SLIDE_COUNTS = [3, 4, 5, 6]
const SHOT_COUNTS = [2, 3, 4, 5, 6]
const SHOT_DURATIONS = [4, 6, 8] as const
const VIDEO_PLATFORMS = ['instagram', 'linkedin', 'facebook'] as const
// Reels/Shorts/Feed shapes only — Video Studio never needs the wider print-style ratios AI
// Studio's image flow offers.
const VIDEO_RATIOS: AspectRatio[] = ['9:16', '1:1', '4:5', '16:9']

function Chip({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: active ? 'var(--accent-green)' : 'var(--fill-secondary)',
        color: active ? 'var(--bg-primary)' : 'var(--text-primary)',
        border: `1.5px solid ${active ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
      }}
    >
      {children}
    </button>
  )
}

function StatusBadge({ status }: { status: VideoJob['status'] }) {
  if (status === 'done') return <Badge tone="green"><CheckCircle2 size={12} /> Done</Badge>
  if (status === 'failed') return <Badge tone="orange"><XCircle size={12} /> Failed</Badge>
  if (status === 'rendering') return <Badge tone="blue">Rendering…</Badge>
  return <Badge tone="grey">Draft</Badge>
}

// One editable card per slide — same shape/fields as Carousel Studio's SlideEditor, since the
// outline this GPT call writes is read by the exact same gen.js templates.
function SlideEditor({ slide, onChange, onRemove }: { slide: CarouselSlide; onChange: (s: CarouselSlide) => void; onRemove: () => void }) {
  const set = (patch: Partial<CarouselSlide>) => onChange({ ...slide, ...patch })

  return (
    <Panel className="!p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Badge tone="blue" className="uppercase">{slide.type}</Badge>
        <div className="flex items-center gap-2">
          <select className="input !w-auto !py-1 text-xs" value={slide.pose ?? 'casual'} onChange={(e) => set({ pose: e.target.value as CarouselSlide['pose'] })}>
            {POSES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={onRemove} className="text-muted hover:text-terracotta" title="Remove slide"><Trash2 size={14} /></button>
        </div>
      </div>

      {slide.type === 'cover' && (
        <>
          <input className="input" placeholder="Eyebrow (e.g. AI AUTOMATION)" value={slide.eyebrow ?? ''} onChange={(e) => set({ eyebrow: e.target.value })} />
          <textarea className="input" rows={3} placeholder="Headline (one line per row)" value={slide.headline ?? ''} onChange={(e) => set({ headline: e.target.value })} />
          <input className="input" placeholder="Subhead" value={slide.subhead ?? ''} onChange={(e) => set({ subhead: e.target.value })} />
        </>
      )}

      {slide.type === 'step' && (
        <>
          <div className="flex gap-2">
            <input className="input !w-32" placeholder="STEP 1" value={slide.stepLabel ?? ''} onChange={(e) => set({ stepLabel: e.target.value })} />
            <input className="input flex-1" placeholder="Heading" value={slide.heading ?? ''} onChange={(e) => set({ heading: e.target.value })} />
          </div>
          {(slide.items ?? []).map((item, i) => (
            <div key={i} className="flex gap-2 items-start">
              <input
                className="input flex-1"
                placeholder="Item heading"
                value={item.heading}
                onChange={(e) => {
                  const items = [...(slide.items ?? [])]
                  items[i] = { ...items[i], heading: e.target.value }
                  set({ items })
                }}
              />
              <input
                className="input flex-1"
                placeholder="Item body"
                value={item.body ?? ''}
                onChange={(e) => {
                  const items = [...(slide.items ?? [])]
                  items[i] = { ...items[i], body: e.target.value }
                  set({ items })
                }}
              />
              <button
                className="text-muted hover:text-terracotta mt-2.5"
                onClick={() => set({ items: (slide.items ?? []).filter((_, idx) => idx !== i) })}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {(slide.items ?? []).length < 3 && (
            <button
              className="text-xs text-sage flex items-center gap-1"
              onClick={() => set({ items: [...(slide.items ?? []), { heading: '', body: '' }] })}
            >
              <Plus size={13} /> Add item
            </button>
          )}
        </>
      )}

      {slide.type === 'stat' && (
        <>
          <input className="input" placeholder="Eyebrow" value={slide.eyebrow ?? ''} onChange={(e) => set({ eyebrow: e.target.value })} />
          <div className="flex gap-2">
            <input className="input !w-28" type="number" placeholder="Value" value={slide.value ?? ''} onChange={(e) => set({ value: Number(e.target.value) })} />
            <input className="input !w-24" placeholder="% / x / (empty)" value={slide.suffix ?? ''} onChange={(e) => set({ suffix: e.target.value })} />
            <input className="input flex-1" placeholder="Label" value={slide.label ?? ''} onChange={(e) => set({ label: e.target.value })} />
          </div>
        </>
      )}

      {slide.type === 'cta' && (
        <>
          <input className="input" placeholder="Eyebrow" value={slide.eyebrow ?? ''} onChange={(e) => set({ eyebrow: e.target.value })} />
          <textarea className="input" rows={2} placeholder="Headline" value={slide.headline ?? ''} onChange={(e) => set({ headline: e.target.value })} />
          <input className="input" placeholder="Closing on-screen word" value={slide.keyword ?? ''} onChange={(e) => set({ keyword: e.target.value.toUpperCase() })} />
        </>
      )}
    </Panel>
  )
}

// One editable card per Veo shot. `onRegenerate` is only offered once the job has moved past
// draft_ready (rendering/done/failed) — a draft shot has no real clip yet to regenerate, editing
// the prompt directly is the equivalent action at that stage.
function ShotEditor({
  shot, engine, onChange, onRemove, onRegenerate, regenerating,
}: {
  shot: VideoShot
  engine: VideoEngine
  onChange: (s: VideoShot) => void
  onRemove?: () => void
  onRegenerate?: () => void
  regenerating?: boolean
}) {
  const set = (patch: Partial<VideoShot>) => onChange({ ...shot, ...patch })
  const cost = estimateShotsCost(engine, [shot])

  return (
    <Panel className="!p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge tone="blue">Shot {shot.index + 1}</Badge>
          {shot.status === 'done' && <Badge tone="green"><CheckCircle2 size={11} /> Done</Badge>}
          {shot.status === 'generating' && <Badge tone="blue">Generating…</Badge>}
          {shot.status === 'failed' && <Badge tone="orange"><XCircle size={11} /> Failed</Badge>}
          <span className="text-[11px] text-muted">≈ ${cost.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <select className="input !w-auto !py-1 text-xs" value={shot.durationS} onChange={(e) => set({ durationS: Number(e.target.value) as VideoShot['durationS'] })}>
            {SHOT_DURATIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
          </select>
          {onRegenerate && (
            <button onClick={onRegenerate} disabled={regenerating} className="text-muted hover:text-sage disabled:opacity-40" title="Regenerate this shot">
              {regenerating ? <Spinner size={13} /> : <RefreshCw size={13} />}
            </button>
          )}
          {onRemove && (
            <button onClick={onRemove} className="text-muted hover:text-terracotta" title="Remove shot"><Trash2 size={14} /></button>
          )}
        </div>
      </div>
      <textarea
        className="input"
        rows={2}
        placeholder="Visual prompt — what the camera sees (no dialogue, no on-screen text described here)"
        value={shot.prompt}
        onChange={(e) => set({ prompt: e.target.value })}
      />
      <input
        className="input"
        placeholder="On-screen caption (optional)"
        value={shot.onScreenText ?? ''}
        onChange={(e) => set({ onScreenText: e.target.value })}
      />
      {shot.status === 'failed' && shot.errorDetail && (
        <div className="text-xs text-terracotta">{shot.errorDetail}</div>
      )}
    </Panel>
  )
}

// Post caption fields alongside the video — same shape AI Studio's copy panel edits, since the
// finished job hands this straight to createManualItem's body/hashtags/cta.
function CopyEditor({ copy, onChange }: { copy: StudioCopy; onChange: (c: StudioCopy) => void }) {
  const set = (patch: Partial<StudioCopy>) => onChange({ ...copy, ...patch })
  return (
    <Panel className="!p-4 space-y-2">
      <div className="label">Post caption</div>
      <input className="input" placeholder="Hook (opening line)" value={copy.hook ?? ''} onChange={(e) => set({ hook: e.target.value })} />
      <textarea className="input" rows={3} placeholder="Body" value={copy.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
      <input className="input" placeholder="CTA" value={copy.cta ?? ''} onChange={(e) => set({ cta: e.target.value })} />
      <input
        className="input"
        placeholder="Hashtags, comma separated"
        value={(copy.hashtags ?? []).join(', ')}
        onChange={(e) => set({ hashtags: e.target.value.split(',').map((h) => h.trim()).filter(Boolean) })}
      />
    </Panel>
  )
}

function JobDetail({ job, onChanged }: { job: VideoJob; onChanged: () => void }) {
  const { data: profile } = useProfile()
  const [outline, setOutline] = useState<CarouselSlide[]>(job.outline_json ?? [])
  const [shots, setShots] = useState<VideoShot[]>(job.shots_json ?? [])
  const [copy, setCopy] = useState<StudioCopy>(job.copy_json ?? {})
  const [voScript, setVoScript] = useState(job.voiceover_script ?? '')
  const [saving, setSaving] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [regeneratingShot, setRegeneratingShot] = useState<number | null>(null)
  const toast = useToast()

  const isGeneratedClips = job.video_type === 'generated_clips'
  const engine = job.engine ?? 'veo-3.1-fast'

  useEffect(() => {
    setOutline(job.outline_json ?? [])
    setShots(job.shots_json ?? [])
    setCopy(job.copy_json ?? {})
    setVoScript(job.voiceover_script ?? '')
  }, [job.id])

  const liveCost = isGeneratedClips ? estimateShotsCost(engine, shots) : 0
  const overCeiling = isGeneratedClips && liveCost > PER_VIDEO_CEILING_USD

  async function doRender() {
    setSaving(true)
    try {
      if (isGeneratedClips) {
        await updateVideoDraft(job.id, { shots_json: shots, estimated_cost_usd: liveCost, copy_json: copy, voiceover_script: voScript || null })
      } else {
        await updateVideoDraft(job.id, { outline_json: outline, copy_json: copy, voiceover_script: voScript || null })
      }
      setSaving(false)
      setRendering(true)
      await triggerVideoRender(job.id, job.video_type)
      toast.info('Render started — this takes several minutes. Come back and the finished video will be here.')
      onChanged()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not start the render'))
    } finally {
      setSaving(false)
      setRendering(false)
    }
  }

  async function onApproveAndRender() {
    if (isGeneratedClips) {
      // Real money about to be spent — PRD §8 guardrail #3, a second explicit click restating
      // the real figure. Motion graphics has no such gate (nothing paid beyond the brief's GPT
      // call, already spent by this point).
      setConfirmOpen(true)
      return
    }
    await doRender()
  }

  async function onRegenerateShot(idx: number) {
    setRegeneratingShot(idx)
    try {
      await regenerateVideoShot(job.id, idx)
      toast.info(`Regenerating shot ${idx + 1}…`)
      onChanged()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not regenerate this shot'))
    } finally {
      setRegeneratingShot(null)
    }
  }

  async function onSendToReview() {
    if (!profile || !job.final_video_url) return
    setSending(true)
    try {
      const item = await createManualItem({
        profileId: profile.id,
        platform: job.platform,
        // generated_clips maps to product_video (a produced/generated shot, not literally
        // user-generated content) — see docs/video-studio-trd-phase2.md §3 for the reasoning.
        contentType: isGeneratedClips ? 'product_video' : 'motion_graphics',
        title: (copy.hook || job.topic || '').slice(0, 60) || null,
        body: [copy.body, copy.cta].filter(Boolean).join('\n\n'),
        mediaUrl: job.final_video_url,
        slides: [],
        hashtags: copy.hashtags ?? [],
        cta: copy.cta ?? '',
        scheduledDate: null,
        scheduledTime: null,
        scheduledAt: null,
        linkedinAccount: null,
        status: 'ready',
      })
      await markVideoJobUsed(job.id, item.id)
      toast.info('Sent to Creative Review.')
      onChanged()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not send this video to review'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-secondary">{job.topic}</div>
          <div className="text-xs text-muted mt-0.5 flex items-center gap-1.5">
            {job.platform} · {job.aspect_ratio}
            {isGeneratedClips && <><span>·</span><span className="flex items-center gap-1"><Wand2 size={11} /> {ENGINE_LABEL[engine]}</span></>}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {job.status === 'draft_ready' && (
        <>
          {isGeneratedClips ? (
            <div className="space-y-3">
              {shots.map((shot, i) => (
                <ShotEditor
                  key={i}
                  shot={shot}
                  engine={engine}
                  onChange={(s) => setShots((prev) => prev.map((p, idx) => (idx === i ? s : p)))}
                  onRemove={() => setShots((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, index: idx })))}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {outline.map((slide, i) => (
                <SlideEditor
                  key={i}
                  slide={slide}
                  onChange={(s) => setOutline((prev) => prev.map((p, idx) => (idx === i ? s : p)))}
                  onRemove={() => setOutline((prev) => prev.filter((_, idx) => idx !== i))}
                />
              ))}
            </div>
          )}
          <CopyEditor copy={copy} onChange={setCopy} />
          {job.voiceover_script !== null && (
            <Panel className="!p-4 space-y-2">
              <div className="label flex items-center gap-1.5"><Mic size={13} /> Voiceover script</div>
              <textarea className="input" rows={3} value={voScript} onChange={(e) => setVoScript(e.target.value)} />
            </Panel>
          )}

          {isGeneratedClips && (
            <div className="flex items-center justify-between text-sm px-1">
              <span className="text-muted">Estimated cost</span>
              <span className={`font-semibold tabular-nums ${overCeiling ? 'text-terracotta' : 'text-sage'}`}>
                ≈ ${liveCost.toFixed(2)} {overCeiling && `(over the $${PER_VIDEO_CEILING_USD} limit)`}
              </span>
            </div>
          )}

          <Button
            onClick={onApproveAndRender}
            loading={saving || rendering}
            disabled={!GENERATION_ENABLED || (isGeneratedClips && (!VIDEO_GENERATION_ENABLED || overCeiling))}
          >
            <Play size={15} /> {isGeneratedClips ? `Approve & Generate — ≈$${liveCost.toFixed(2)}` : 'Approve & Render'}
          </Button>
          {isGeneratedClips && !VIDEO_GENERATION_ENABLED && (
            <div className="text-xs text-terracotta">AI video generation is currently disabled (VIDEO_GENERATION_ENABLED=false).</div>
          )}
        </>
      )}

      {(job.status === 'rendering' || job.status === 'done' || job.status === 'failed') && (
        <>
          {job.status === 'rendering' && (
            <div className="card p-6 flex flex-col items-center gap-3 text-center">
              <Spinner size={22} />
              <div className="text-xs text-sage font-medium tabular-nums">
                {describeProgress(job.render_progress)}
              </div>
              <div className="w-full max-w-xs h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--fill-tertiary)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.round(overallProgress(job.render_progress) * 100)}%`, background: 'var(--accent-blue)' }}
                />
              </div>
              {job.render_progress?.phase === 'retrying' && (
                <div className="text-xs text-terracotta">Some frames dropped — retrying automatically.</div>
              )}
              <div className="text-xs text-muted">
                {isGeneratedClips ? 'Generating shots with Veo, then stitching and branding, takes several minutes.' : 'Stitching, branding, and encoding the final video takes a few minutes.'} You can leave this page.
              </div>
            </div>
          )}

          {isGeneratedClips && shots.length > 0 && (job.status === 'rendering' || job.status === 'failed') && (
            <div className="space-y-2">
              {shots.map((shot, i) => (
                <ShotEditor
                  key={i}
                  shot={shot}
                  engine={engine}
                  onChange={() => {}}
                  onRegenerate={job.status === 'failed' ? () => onRegenerateShot(i) : undefined}
                  regenerating={regeneratingShot === i}
                />
              ))}
            </div>
          )}

          {job.status === 'failed' && (
            <Panel className="!p-4 border border-terracotta/30">
              <div className="flex items-center gap-2 text-terracotta text-sm mb-1"><XCircle size={14} /> Render failed</div>
              <div className="text-xs text-muted break-words">{job.error_detail || 'Unknown error.'}</div>
              <Button variant="ghost" className="!py-1.5 text-xs mt-3" onClick={doRender} loading={saving || rendering}>
                <Play size={13} /> Retry render
              </Button>
            </Panel>
          )}

          {job.status === 'done' && job.final_video_url && (
            <div className="space-y-3">
              <video
                src={job.final_video_url}
                controls
                className="w-full rounded-lg"
                style={{ maxHeight: 480, background: 'var(--fill-tertiary)' }}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <a href={job.final_video_url} target="_blank" rel="noreferrer" className="text-xs text-sage flex items-center gap-1">
                  <Download size={12} /> Download
                </a>
                {job.content_item_id ? (
                  <Badge tone="green"><CheckCircle2 size={12} /> Sent to review</Badge>
                ) : (
                  <Button onClick={onSendToReview} loading={sending} className="!py-1.5 text-xs">
                    <Send size={13} /> Send to Review
                  </Button>
                )}
                <Button variant="ghost" className="!py-1.5 text-xs" onClick={doRender} loading={saving || rendering}>
                  <RefreshCw size={13} /> Regenerate
                </Button>
              </div>
              {isGeneratedClips && job.estimated_cost_usd != null && (
                <div className="text-xs text-muted">Actual cost: ${estimateShotsCost(engine, shots).toFixed(2)}</div>
              )}
            </div>
          )}
        </>
      )}

      {confirmOpen && (
        <Modal title="Confirm real spend" onClose={() => setConfirmOpen(false)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--fill-tertiary)' }}>
              <AlertTriangle size={18} className="text-terracotta shrink-0 mt-0.5" />
              <div className="text-sm text-secondary">
                This fires {shots.length} real {ENGINE_LABEL[engine]} generation{shots.length === 1 ? '' : 's'} —
                a real charge on the connected Google account, not a preview.
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-ink">≈ ${liveCost.toFixed(2)}</div>
              <div className="text-xs text-muted mt-1">≈ ₹{Math.round(liveCost * 88)} · estimate, not a guaranteed cost</div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                loading={saving || rendering}
                onClick={async () => { setConfirmOpen(false); await doRender() }}
              >
                <Play size={15} /> Generate
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default function VideoStudio() {
  const { data: profile, isLoading: profileLoading } = useProfile()
  const [jobs, setJobs] = useState<VideoJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [signals, setSignals] = useState<TrendSignal[]>([])
  const [sourceKind, setSourceKind] = useState<StudioSourceKind>('topic')
  const [signalId, setSignalId] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [platform, setPlatform] = useState<(typeof VIDEO_PLATFORMS)[number]>('instagram')
  const [ratio, setRatio] = useState<AspectRatio>('9:16')
  const [videoType, setVideoType] = useState<VideoType>('motion_graphics')
  const [slideCount, setSlideCount] = useState(4)
  const [engine, setEngine] = useState<VideoEngine>('veo-3.1-fast')
  const [shotCount, setShotCount] = useState(4)
  const [wantsVoiceover, setWantsVoiceover] = useState(false)
  const [generating, setGenerating] = useState(false)
  const toast = useToast()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (profileId: string) => {
    const list = await listVideoJobs(profileId)
    setJobs(list)
    return list
  }, [])

  useEffect(() => {
    if (profile) load(profile.id)
  }, [profile, load])

  useEffect(() => {
    if (!profile) return
    setRatio(PLATFORM_DEFAULT_RATIO[platform] ?? '9:16')
  }, [platform, profile])

  useEffect(() => {
    if (!profile) return
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    listSignalsSince(profile.id, since).then(setSignals).catch(() => setSignals([]))
  }, [profile])

  // Realtime — video_jobs was added to the supabase_realtime publication alongside carousel_jobs
  // specifically for this. Same reasoning as CarouselStudio.tsx: applying the UPDATE payload
  // directly avoids a refetch on every progress tick.
  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel('video-studio-jobs')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'video_jobs', filter: `profile_id=eq.${profile.id}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setJobs((prev) => prev.filter((j) => j.id !== (payload.old as VideoJob).id))
            return
          }
          const row = payload.new as VideoJob
          setJobs((prev) => {
            const idx = prev.findIndex((j) => j.id === row.id)
            if (idx === -1) return [row, ...prev]
            const next = [...prev]
            next[idx] = row
            return next
          })
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile])

  // Safety net only, same as Carousel Studio — re-syncs every 30s while something is rendering,
  // in case the websocket drops.
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'rendering')
    if (!hasActive || !profile) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    if (pollRef.current) return
    pollRef.current = setInterval(() => load(profile.id), 30000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [jobs, profile, load])

  const effectiveTopic = sourceKind === 'trend' ? (signals.find((s) => s.id === signalId)?.topic ?? '') : topic
  const canGenerate = sourceKind === 'trend' ? Boolean(signalId) : sourceKind === 'strategy' ? true : topic.trim().length > 0
  // Rough pre-brief estimate — real shot durations aren't chosen until GPT drafts the storyboard
  // (4/6/8s per shot, picked per-shot); this uses a 6s/shot average purely so the setup screen
  // shows a ballpark before Draft brief is even clicked, same spirit as AI Studio's CostEstimate.
  // The real number (job.estimated_cost_usd, from actual GPT-picked durations) replaces this the
  // moment the brief comes back.
  const roughEstimate = Math.round(shotCount * 6 * (engine === 'veo-3.1-lite' ? 0.08 : engine === 'veo-3.1-fast' ? 0.12 : 0.40) * 100) / 100

  async function onGenerate() {
    if (!profile || !canGenerate) return
    setGenerating(true)
    try {
      const job = await generateVideoBrief({
        profileId: profile.id,
        sourceKind,
        signalId: sourceKind === 'trend' ? signalId : null,
        topic: sourceKind === 'strategy' ? (topic.trim() || 'The current marketing strategy') : (effectiveTopic || topic.trim()),
        platform,
        aspectRatio: ratio,
        wantsVoiceover,
        videoType,
        slideCount: videoType === 'motion_graphics' ? slideCount : undefined,
        engine: videoType === 'generated_clips' ? engine : undefined,
        shotCount: videoType === 'generated_clips' ? shotCount : undefined,
      })
      setJobs((prev) => [job, ...prev])
      setSelectedId(job.id)
      setTopic('')
      setSignalId(null)
      toast.info('Brief drafted — review the outline and caption below, then Approve & Render.')
    } catch (err) {
      toast.error(toastMessage(err, 'Could not draft the brief'))
    } finally {
      setGenerating(false)
    }
  }

  async function onDelete(id: string) {
    await deleteVideoJob(id)
    setJobs((prev) => prev.filter((j) => j.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  if (profileLoading) {
    return <div className="flex justify-center py-16"><Spinner size={24} /></div>
  }
  if (!profile) {
    return (
      <div>
        <PageHeader accent={<Badge><Film size={12} /> Video Studio</Badge>} title="Video Studio" />
        <EmptyState icon={<Film size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  const selectedJob = jobs.find((j) => j.id === selectedId) ?? null

  return (
    <div>
      <PageHeader
        accent={<Badge><Film size={12} /> Video Studio</Badge>}
        title="Video Studio"
        subtitle="Topic in, one continuous branded video out. Draft a brief, review it, then render."
      />

      <Panel className="mb-6 space-y-3">
        <div className="font-medium text-sm">New video</div>

        <div className="flex gap-2 flex-wrap">
          <Chip active={videoType === 'motion_graphics'} onClick={() => setVideoType('motion_graphics')}>
            <span className="flex items-center gap-1.5"><Clapperboard size={13} /> Motion graphics</span>
          </Chip>
          <Chip
            active={videoType === 'generated_clips'}
            onClick={() => setVideoType('generated_clips')}
            disabled={!VIDEO_GENERATION_ENABLED}
          >
            <span className="flex items-center gap-1.5"><Wand2 size={13} /> Generated clips (AI video)</span>
          </Chip>
        </div>
        {!VIDEO_GENERATION_ENABLED && (
          <div className="text-xs text-muted">
            Generated clips (real AI video via Veo) is built but not yet enabled — it needs a Gemini API credential wired up first.
          </div>
        )}
        <p className="text-muted text-xs">
          {videoType === 'motion_graphics'
            ? 'On-screen text and brand shapes, animated — no AI video model, effectively free.'
            : 'Real AI-generated video shots, stitched together — a real cost per video, shown below before you spend anything.'}
        </p>

        <div className="flex gap-2 flex-wrap">
          {([
            { value: 'trend', label: 'A live trend', icon: TrendingUp, hint: 'Anchor the video on something actually happening right now' },
            { value: 'strategy', label: 'The strategy', icon: Target, hint: 'Pull the angle from the current approved strategy' },
            { value: 'topic', label: 'My own topic', icon: Type, hint: 'Write the subject yourself' },
          ] as const).map((s) => {
            const Icon = s.icon
            return (
              <Chip key={s.value} active={sourceKind === s.value} onClick={() => setSourceKind(s.value)}>
                <span className="flex items-center gap-1.5"><Icon size={13} /> {s.label}</span>
              </Chip>
            )
          })}
        </div>

        {sourceKind === 'trend' && (
          signals.length === 0 ? (
            <div className="text-muted text-sm">No trend signals in the last 30 days — run a scan on the Trends page first.</div>
          ) : (
            <select className="input" value={signalId ?? ''} onChange={(e) => setSignalId(e.target.value || null)}>
              <option value="">Pick a trend…</option>
              {signals.map((s) => <option key={s.id} value={s.id}>{s.source} · {s.topic.slice(0, 90)}</option>)}
            </select>
          )
        )}
        {sourceKind === 'topic' && (
          <textarea
            className="input"
            rows={2}
            placeholder="Topic — e.g. Why manual CRM entry is dead"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        )}
        {sourceKind === 'strategy' && (
          <input
            className="input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Optional steer — e.g. focus on the Ops Pod"
          />
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted">Platform</span>
          {VIDEO_PLATFORMS.map((p) => (
            <Chip key={p} active={platform === p} onClick={() => setPlatform(p)}>{p}</Chip>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted">Shape</span>
          {VIDEO_RATIOS.map((r) => (
            <Chip key={r} active={ratio === r} onClick={() => setRatio(r)}>{r}</Chip>
          ))}
        </div>

        {videoType === 'motion_graphics' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted">Slides</span>
            {SLIDE_COUNTS.map((n) => (
              <Chip key={n} active={slideCount === n} onClick={() => setSlideCount(n)}>{n}</Chip>
            ))}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted">Engine</span>
              {VIDEO_ENGINES.map((e) => (
                <Chip key={e} active={engine === e} onClick={() => setEngine(e)}>{ENGINE_LABEL[e]}</Chip>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted">Shots</span>
              {SHOT_COUNTS.map((n) => (
                <Chip key={n} active={shotCount === n} onClick={() => setShotCount(n)}>{n}</Chip>
              ))}
            </div>
            <div className="text-[11px] text-muted">
              Rough estimate before drafting: ≈ ${roughEstimate.toFixed(2)} (real number shown once the brief writes the actual shot durations)
            </div>
          </>
        )}

        <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
          <input type="checkbox" checked={wantsVoiceover} onChange={(e) => setWantsVoiceover(e.target.checked)} />
          <Mic size={13} /> Add a voiceover script (narration is generated with the brief; the audio itself is produced at render time)
        </label>

        <Button onClick={onGenerate} loading={generating} disabled={!canGenerate || !GENERATION_ENABLED || (videoType === 'generated_clips' && !VIDEO_GENERATION_ENABLED)}>
          <Sparkles size={15} /> Draft brief
        </Button>
        {!GENERATION_ENABLED && <div className="text-xs text-terracotta">Generation is currently disabled (GENERATION_ENABLED=false).</div>}
      </Panel>

      {jobs.length === 0 ? (
        <EmptyState icon={<Film size={28} />} title="No videos yet" hint="Give it a topic above to draft your first brief." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(job.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(job.id) }}
                className="w-full text-left cursor-pointer"
              >
                <Panel className={`!p-3 ${selectedId === job.id ? '!border-sage border' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs text-secondary line-clamp-2">{job.topic}</div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(job.id) }}
                      className="text-muted hover:text-terracotta shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <StatusBadge status={job.status} />
                    {job.video_type === 'generated_clips' && <Badge tone="grey"><Wand2 size={10} /></Badge>}
                  </div>
                </Panel>
              </div>
            ))}
          </div>

          <div>
            {selectedJob ? (
              <JobDetail job={selectedJob} onChanged={() => profile && load(profile.id)} />
            ) : (
              <EmptyState icon={<RefreshCw size={24} />} title="Pick a video" hint="Select one from the list to review or watch its render." />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
