import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Film, Sparkles, RefreshCw, Play, CheckCircle2, XCircle, Plus, Trash2, TrendingUp, Target, Type,
  Mic, Download, Send, Clapperboard, Wand2, AlertTriangle, ExternalLink, Clock, Music, Pause,
  ThumbsUp, ThumbsDown,
} from 'lucide-react'
import { useProfile } from '../lib/queries'
import { supabase } from '../lib/supabase'
import { listSignalsSince, type TrendSignal } from '../lib/trends'
import type { StudioSourceKind, StudioCopy } from '../lib/studio'
import { PLATFORM_DEFAULT_RATIO, type AspectRatio } from '../lib/studioStyles'
import { VIDEO_TYPES, getVideoType, videoTypeDirection } from '../lib/videoTypes'
import {
  listVideoJobs, generateVideoBrief, updateVideoDraft, triggerVideoRender, deleteVideoJob,
  markVideoJobUsed, regenerateVideoShot, describeProgress, overallProgress,
  estimateShotsCost, totalDurationS, ratePerSecond, formatUsdInr, describeVideoError,
  VIDEO_ENGINES, VIDEO_RESOLUTIONS, ENGINE_LABEL, ENGINE_BLURB, PER_VIDEO_CEILING_USD,
  MUSIC_COST_USD, VOICE_OPTIONS, DEFAULT_VOICE, voiceSampleUrl, foldFeedbackIntoText,
  type VideoJob, type CarouselSlide, type VideoShot, type VideoEngine, type VideoType,
  type VideoResolution, type ItemFeedback,
} from '../lib/videoStudio'
import { createManualItem, GENERATION_ENABLED, VIDEO_GENERATION_ENABLED } from '../lib/content'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel, Modal } from '../components/ui'
import { PostTile } from '../components/postPreview'
import { useToast, toastMessage } from '../components/Toast'

const POSES = ['casual', 'pointing', 'victory', 'arms-crossed', 'phone'] as const
const SLIDE_COUNTS = [3, 4, 5, 6]
const SHOT_COUNTS = [1, 2, 3, 4, 5, 6]
const SHOT_DURATIONS = [4, 6, 8] as const
const VIDEO_PLATFORMS = ['instagram', 'linkedin', 'facebook'] as const
// Reels/Shorts/Feed shapes only — Video Studio never needs the wider print-style ratios AI
// Studio's image flow offers.
const VIDEO_RATIOS: AspectRatio[] = ['9:16', '1:1', '4:5', '16:9']

function Chip({ active, onClick, disabled, title, children }: { active: boolean; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
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

/** The live price of what's currently configured, broken down so the number is never a mystery:
 *  what it's charging per second, how many seconds, and the total in both currencies. Mirrors
 *  AI Studio's CostEstimate, but video costs 10-100x more per click so it gets more room. */
function CostBar({
  engine, resolution, seconds, shots, overCeiling, music = false,
}: {
  engine: VideoEngine
  resolution: VideoResolution
  seconds: number
  shots: number
  overCeiling: boolean
  /** Adds the flat music charge. The voiceover is deliberately not itemised — it is token-priced
   *  and lands in fractions of a cent, so listing it would imply a decision worth making. */
  music?: boolean
}) {
  const rate = ratePerSecond(engine, resolution)
  if (rate == null) {
    return (
      <div className="text-xs text-terracotta">
        {ENGINE_LABEL[engine]} does not offer {resolution}. Pick another resolution.
      </div>
    )
  }
  const total = Math.round((rate * seconds + (music ? MUSIC_COST_USD : 0)) * 100) / 100
  return (
    <div
      className="rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap"
      style={{ background: 'var(--fill-tertiary)', border: `1px solid ${overCeiling ? 'var(--accent-orange)' : 'var(--border-subtle)'}` }}
    >
      <div className="text-[11px] text-muted tabular-nums">
        {shots} shot{shots === 1 ? '' : 's'} · {seconds}s total · ${rate.toFixed(2)}/sec at {resolution}
        {music && ` · +$${MUSIC_COST_USD.toFixed(2)} music`}
      </div>
      <div className={`text-sm font-bold tabular-nums ${overCeiling ? 'text-terracotta' : 'text-sage'}`}>
        ≈ {formatUsdInr(total)}
      </div>
      {overCeiling && (
        <div className="w-full text-[11px] text-terracotta">
          Over the ${PER_VIDEO_CEILING_USD} per-video limit — remove a shot, shorten one, or pick a cheaper engine.
        </div>
      )}
    </div>
  )
}

/**
 * Voice picker with an audible preview — you should not have to generate a video to find out
 * what a voice sounds like.
 *
 * Samples are static files generated once per voice, so playback is instant and costs nothing.
 * A voice whose sample has not been generated yet still selects fine; only its play button goes
 * quiet, which is why a missing file is treated as a normal state rather than an error.
 */
function VoicePicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Only ever one preview at a time — clicking a second voice should replace the first, not
  // talk over it.
  useEffect(() => () => { audioRef.current?.pause() }, [])

  function preview(voiceId: string) {
    audioRef.current?.pause()
    if (playing === voiceId) { setPlaying(null); return }
    const audio = new Audio(voiceSampleUrl(voiceId))
    audioRef.current = audio
    audio.onended = () => setPlaying(null)
    audio.onerror = () => {
      setUnavailable((prev) => new Set(prev).add(voiceId))
      setPlaying(null)
    }
    audio.play().then(() => setPlaying(voiceId)).catch(() => {
      setUnavailable((prev) => new Set(prev).add(voiceId))
      setPlaying(null)
    })
  }

  const shown = showAll ? VOICE_OPTIONS : VOICE_OPTIONS.filter((v) => v.recommended || v.id === value)

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {shown.map((v) => {
          const active = value === v.id
          return (
            <div
              key={v.id}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5"
              style={{
                background: active ? 'var(--fill-secondary)' : 'var(--bg-card)',
                border: `1.5px solid ${active ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
              }}
            >
              <button
                type="button"
                onClick={() => preview(v.id)}
                title={unavailable.has(v.id) ? 'No preview generated for this voice yet' : `Hear ${v.id}`}
                className="shrink-0 text-muted hover:text-sage disabled:opacity-30"
                disabled={unavailable.has(v.id)}
              >
                {playing === v.id ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                type="button"
                onClick={() => onChange(v.id)}
                disabled={disabled}
                className="flex-1 text-left disabled:opacity-40"
              >
                <div className={`text-xs font-semibold ${active ? 'text-sage' : 'text-ink'}`}>{v.id}</div>
                <div className="text-[10px] text-muted">{v.tone}</div>
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => setShowAll((s) => !s)}
        className="text-[11px] text-sage"
      >
        {showAll ? 'Show fewer' : `Show all ${VOICE_OPTIONS.length} voices`}
      </button>
    </div>
  )
}

/** Renders a worker-written failure as something actionable — most importantly the
 *  out-of-credits case, where the fix is a specific page rather than "try again". */
function ErrorPanel({ raw, onRetry, retrying }: { raw: string | null; onRetry?: () => void; retrying?: boolean }) {
  const err = describeVideoError(raw)
  if (!err) return null
  return (
    <Panel className="!p-4 border border-terracotta/30 space-y-2">
      <div className="flex items-center gap-2 text-terracotta text-sm font-medium">
        <AlertTriangle size={15} /> {err.title}
      </div>
      <div className="text-xs text-secondary break-words">{err.detail}</div>
      <div className="flex items-center gap-2 flex-wrap pt-1">
        {err.actionUrl && (
          <a
            href={err.actionUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium px-2.5 py-1.5 rounded-full flex items-center gap-1.5"
            style={{ background: 'var(--fill-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            {err.actionLabel} <ExternalLink size={11} />
          </a>
        )}
        {onRetry && (
          <Button variant="ghost" className="!py-1.5 text-xs" onClick={onRetry} loading={retrying}>
            <RefreshCw size={13} /> Try again
          </Button>
        )}
      </div>
    </Panel>
  )
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

/** One shot of the storyboard. The prompt is the expensive part, so it's fully editable before
 *  anything is spent — same "review the prompt before you pay" gate AI Studio has for images. */
/**
 * Thumbs up/down + an optional note, shared by shots, the voiceover, and the music bed. The
 * rating alone is the log (option 1 of the hybrid the user asked for); the note, once you hit
 * regenerate, gets folded straight into that item's prompt/script text (option 2) — the same
 * click that records the problem tries to fix it, rather than the note sitting unread somewhere.
 */
function FeedbackControl({
  feedback, onChange, disabled, notePlaceholder,
}: {
  feedback: ItemFeedback | null | undefined
  onChange: (f: ItemFeedback) => void
  disabled?: boolean
  notePlaceholder: string
}) {
  const rating = feedback?.rating ?? null
  const note = feedback?.note ?? ''
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange({ rating: rating === 'up' ? null : 'up', note })}
        disabled={disabled}
        title="This is good"
        className="disabled:opacity-40"
        style={{ color: rating === 'up' ? 'var(--accent-green)' : 'var(--text-muted)' }}
      >
        <ThumbsUp size={13} />
      </button>
      <button
        type="button"
        onClick={() => onChange({ rating: rating === 'down' ? null : 'down', note })}
        disabled={disabled}
        title="Needs work"
        className="disabled:opacity-40"
        style={{ color: rating === 'down' ? 'var(--accent-orange)' : 'var(--text-muted)' }}
      >
        <ThumbsDown size={13} />
      </button>
      <input
        className="input !py-1 text-xs flex-1"
        placeholder={notePlaceholder}
        value={note}
        onChange={(e) => onChange({ rating, note: e.target.value })}
        disabled={disabled}
      />
    </div>
  )
}

function ShotEditor({
  shot, engine, resolution, editable, onChange, onRemove, onRegenerate, regenerating,
}: {
  shot: VideoShot
  engine: VideoEngine
  resolution: VideoResolution
  editable: boolean
  onChange: (s: VideoShot) => void
  onRemove?: () => void
  onRegenerate?: () => void
  regenerating?: boolean
}) {
  const set = (patch: Partial<VideoShot>) => onChange({ ...shot, ...patch })
  const rate = ratePerSecond(engine, resolution) ?? 0
  const cost = shot.costUsd ?? Math.round(shot.durationS * rate * 100) / 100

  return (
    <Panel className="!p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge tone="blue">Shot {shot.index + 1}</Badge>
          {shot.status === 'done' && <Badge tone="green"><CheckCircle2 size={11} /> Done</Badge>}
          {shot.status === 'generating' && <Badge tone="blue">Generating…</Badge>}
          {shot.status === 'failed' && <Badge tone="orange"><XCircle size={11} /> Failed</Badge>}
          <span className="text-[11px] text-muted tabular-nums">
            {shot.durationS}s · ${cost.toFixed(2)}{shot.costUsd != null ? ' spent' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {editable && (
            <select className="input !w-auto !py-1 text-xs" value={shot.durationS} onChange={(e) => set({ durationS: Number(e.target.value) as VideoShot['durationS'] })}>
              {SHOT_DURATIONS.map((d) => <option key={d} value={d}>{d}s</option>)}
            </select>
          )}
          {onRegenerate && (
            <button onClick={onRegenerate} disabled={regenerating} className="text-muted hover:text-sage disabled:opacity-40" title="Regenerate just this shot">
              {regenerating ? <Spinner size={13} /> : <RefreshCw size={13} />}
            </button>
          )}
          {editable && onRemove && (
            <button onClick={onRemove} className="text-muted hover:text-terracotta" title="Remove shot"><Trash2 size={14} /></button>
          )}
        </div>
      </div>

      <div className="label !mb-1">Veo prompt</div>
      <textarea
        className="input"
        rows={4}
        readOnly={!editable}
        placeholder="Cinematography → subject → action → context → style & ambiance"
        value={shot.prompt}
        onChange={(e) => set({ prompt: e.target.value })}
      />

      <div className="label !mb-1 flex items-center gap-1.5">
        On-screen text
        <span className="text-[10px] text-muted font-normal normal-case">— burned in by us, not by Veo</span>
      </div>
      <input
        className="input"
        readOnly={!editable}
        placeholder="Short caption for this shot (optional)"
        value={shot.onScreenText ?? ''}
        onChange={(e) => set({ onScreenText: e.target.value })}
      />

      {editable && (
        <details>
          <summary className="text-[11px] text-muted cursor-pointer">Negative prompt</summary>
          <input
            className="input mt-1.5"
            placeholder="Things to keep out of this shot"
            value={shot.negativePrompt ?? ''}
            onChange={(e) => set({ negativePrompt: e.target.value })}
          />
        </details>
      )}

      {shot.status === 'failed' && shot.errorDetail && (
        <div className="text-xs text-terracotta break-words">{shot.errorDetail}</div>
      )}
      {shot.status === 'done' && shot.clipUrl && (
        <>
          <video src={shot.clipUrl} controls className="w-full rounded-lg mt-1" style={{ maxHeight: 220, background: 'var(--fill-tertiary)' }} />
          <FeedbackControl
            feedback={shot.feedback}
            onChange={(f) => set({ feedback: f })}
            disabled={!editable}
            notePlaceholder="What's wrong? Folded into the prompt when you regenerate"
          />
        </>
      )}
    </Panel>
  )
}

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
  const [voice, setVoice] = useState(job.voice ?? DEFAULT_VOICE)
  const [musicPrompt, setMusicPrompt] = useState(job.music_prompt ?? '')
  // Whether the audio editor's two fields are open — separate from whether they already have
  // content, so a job made before this job ever had a script/prompt (or made before the music
  // feature existed at all) can still turn either on now, not just edit what's already there.
  const [wantsVoiceoverEdit, setWantsVoiceoverEdit] = useState(job.voiceover_script !== null)
  const [wantsMusicEdit, setWantsMusicEdit] = useState(job.music_prompt !== null)
  const [voFeedback, setVoFeedback] = useState<ItemFeedback | null>(job.voiceover_feedback)
  const [musicFeedback, setMusicFeedback] = useState<ItemFeedback | null>(job.music_feedback)
  const [saving, setSaving] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [regeneratingShot, setRegeneratingShot] = useState<number | null>(null)
  const [regeneratingAudio, setRegeneratingAudio] = useState<'voiceover' | 'music' | null>(null)
  const toast = useToast()

  const isGeneratedClips = job.video_type === 'generated_clips'
  const engine = job.engine ?? 'veo-3.1-fast'
  const resolution = job.resolution ?? '1080p'
  const typeDef = getVideoType(job.video_style_id)

  useEffect(() => {
    setOutline(job.outline_json ?? [])
    setShots(job.shots_json ?? [])
    setCopy(job.copy_json ?? {})
    setVoScript(job.voiceover_script ?? '')
    setVoice(job.voice ?? DEFAULT_VOICE)
    setMusicPrompt(job.music_prompt ?? '')
    setWantsVoiceoverEdit(job.voiceover_script !== null)
    setWantsMusicEdit(job.music_prompt !== null)
    setVoFeedback(job.voiceover_feedback)
    setMusicFeedback(job.music_feedback)
  }, [job.id])

  // Live, not stale: recomputed on every duration change / shot removal, so the number on the
  // button is always what the next click will actually cost.
  const liveCost = isGeneratedClips ? estimateShotsCost(engine, resolution, shots) : 0
  const seconds = totalDurationS(shots)
  const overCeiling = isGeneratedClips && liveCost > PER_VIDEO_CEILING_USD
  // Editable in every state except mid-render — after a video is finished you can still rework a
  // shot prompt and re-run it, which is the whole point of keeping the storyboard on screen.
  const editable = job.status !== 'rendering'

  // A shot that already has a real clip is REUSED by the worker rather than regenerated, so the
  // next click only pays for shots that still need generating. Editing a prompt resets that shot
  // (see onShotChange), which is exactly when it re-enters this number.
  const pendingShots = shots.filter((s) => !(s.status === 'done' && s.clipUrl))
  const nextRunCost = isGeneratedClips
    ? Math.round(pendingShots.reduce((sum, s) => sum + s.durationS * (ratePerSecond(engine, resolution) ?? 0), 0) * 100) / 100
    : 0
  const nextRunOverCeiling = isGeneratedClips && nextRunCost > PER_VIDEO_CEILING_USD
  const hasFinished = job.status === 'done' && Boolean(job.final_video_url)

  /**
   * Editing a shot's PROMPT (or its duration) invalidates the clip that was generated from the
   * old one — the worker reuses any shot still marked done+clipUrl, so without this the edit
   * would silently do nothing and the old footage would be stitched back in.
   *
   * Editing only the on-screen text does NOT reset it: captions are burned on at assembly time
   * by ffmpeg, so changing the words costs nothing and needs no regeneration. That difference is
   * worth real money, so the UI states it rather than making people guess.
   */
  function onShotChange(i: number, next: VideoShot) {
    setShots((prev) => prev.map((p, idx) => {
      if (idx !== i) return p
      const regenerationNeeded = p.status === 'done' && (next.prompt !== p.prompt || next.durationS !== p.durationS)
      return regenerationNeeded ? { ...next, status: 'pending', clipUrl: null, costUsd: null } : next
    }))
  }

  // Changing the script or the voice invalidates the recording that was made from the old one —
  // clearing the URL is what makes the next run re-record it instead of silently reusing the
  // previous take. Same rule as an edited shot prompt; both are cheap, so unlike a shot this
  // costs essentially nothing to redo. The toggle, not just the text, decides what actually gets
  // saved — unchecking clears it back to null (worker skips generating it), and checking it on a
  // job that never had it invalidates nothing because there was never a URL to begin with, it
  // just starts generating on the next run. Hoisted above doRender so the post-render toast can
  // tell "audio is (re)generating" apart from "nothing but reused shots and on-screen text" —
  // both look identical from pendingShots alone.
  const effectiveVoScript = wantsVoiceoverEdit ? (voScript || null) : null
  const effectiveMusicPrompt = wantsMusicEdit ? (musicPrompt || null) : null
  const voChanged = effectiveVoScript !== (job.voiceover_script || null) || (wantsVoiceoverEdit && voice !== (job.voice ?? DEFAULT_VOICE))
  const musicChanged = effectiveMusicPrompt !== (job.music_prompt || null)
  const audioChanged = voChanged || musicChanged

  async function doRender() {
    setSaving(true)
    try {
      if (isGeneratedClips) {
        await updateVideoDraft(job.id, {
          shots_json: shots,
          estimated_cost_usd: liveCost,
          copy_json: copy,
          voiceover_script: effectiveVoScript,
          voice,
          music_prompt: effectiveMusicPrompt,
          voiceover_feedback: voFeedback,
          music_feedback: musicFeedback,
          ...(voChanged ? { voiceover_url: null } : {}),
          ...(musicChanged ? { music_url: null } : {}),
        })
      } else {
        await updateVideoDraft(job.id, { outline_json: outline, copy_json: copy, voiceover_script: voScript || null })
      }
      setSaving(false)
      setRendering(true)
      // The ceiling applies to what this run will actually charge — already-generated shots are
      // reused, not re-billed.
      await triggerVideoRender(job.id, job.video_type, nextRunCost)
      toast.info(
        isGeneratedClips
          ? (pendingShots.length > 0
            ? `Generating ${pendingShots.length} shot${pendingShots.length === 1 ? '' : 's'} — Veo takes a few minutes each.`
            : audioChanged
              ? 'Recording the audio and re-assembling — shots are reused, so this only costs the audio itself.'
              : 'Re-assembling with your new on-screen text — no new generation, no extra cost.')
          : 'Render started — this takes several minutes.',
      )
      onChanged()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not start the render'))
    } finally {
      setSaving(false)
      setRendering(false)
    }
  }

  async function onApprove() {
    // Real money about to be spent — PRD §8 guardrail #3: a second, explicit confirmation
    // restating the actual figure. Motion graphics has no such gate (nothing paid past the GPT
    // brief, already spent by this point), and neither does a re-assembly that generates nothing
    // new — confirming a $0.00 charge is just friction.
    if (isGeneratedClips && nextRunCost > 0) { setConfirmOpen(true); return }
    await doRender()
  }

  async function onRegenerateShot(idx: number) {
    setRegeneratingShot(idx)
    try {
      // A feedback note gets folded into the prompt BEFORE firing — n8n reads shots_json fresh
      // from Supabase when this webhook lands, so the worker only ever sees what is actually
      // saved, not local component state. The note is cleared once folded in (it is now part of
      // the prompt text itself, visible and editable there); the rating stays as the log.
      const note = shots[idx].feedback?.note?.trim()
      let nextShots = shots
      if (note) {
        nextShots = shots.map((s, i) => (i === idx ? { ...s, prompt: foldFeedbackIntoText(s.prompt, note), feedback: { rating: s.feedback?.rating ?? null, note: '' } } : s))
        setShots(nextShots)
        await updateVideoDraft(job.id, { shots_json: nextShots })
      }
      await regenerateVideoShot(job.id, idx)
      toast.info(`Regenerating shot ${idx + 1} — this costs the price of that one shot.`)
      onChanged()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not regenerate this shot'))
    } finally {
      setRegeneratingShot(null)
    }
  }

  /** Redo a take with the SAME script/prompt — for "the words are right, I just don't like how
   *  it sounds." Editing the text already invalidates and re-records; this covers the case where
   *  nothing changed but the take itself did not land. Nulling the url and re-firing the full
   *  render is cheap: shots are already done and reused, so the worker only redoes audio +
   *  re-assembly. */
  async function onRegenerateAudio(kind: 'voiceover' | 'music') {
    setRegeneratingAudio(kind)
    try {
      // Same fold-then-regenerate as a shot: a note gets baked into the actual script/prompt
      // that gets saved, then cleared (the rating stays, as the log). Whatever is currently on
      // screen is what gets folded and saved — not just what was there when the job last loaded.
      const isVo = kind === 'voiceover'
      const feedback = isVo ? voFeedback : musicFeedback
      const note = feedback?.note?.trim()
      const patch: Parameters<typeof updateVideoDraft>[1] = isVo ? { voiceover_url: null } : { music_url: null }
      if (note) {
        if (isVo) {
          const folded = foldFeedbackIntoText(voScript, note)
          setVoScript(folded)
          setVoFeedback({ rating: feedback?.rating ?? null, note: '' })
          patch.voiceover_script = folded
          patch.voiceover_feedback = { rating: feedback?.rating ?? null, note: '' }
        } else {
          const folded = foldFeedbackIntoText(musicPrompt, note)
          setMusicPrompt(folded)
          setMusicFeedback({ rating: feedback?.rating ?? null, note: '' })
          patch.music_prompt = folded
          patch.music_feedback = { rating: feedback?.rating ?? null, note: '' }
        }
      }
      await updateVideoDraft(job.id, patch)
      await triggerVideoRender(job.id, job.video_type, 0)
      toast.info(isVo ? 'Re-recording the voiceover…' : 'Re-composing the music bed — $0.04.')
      onChanged()
    } catch (err) {
      toast.error(toastMessage(err, `Could not regenerate the ${kind}`))
    } finally {
      setRegeneratingAudio(null)
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
        // user-generated content) — see docs/video-studio-trd-phase2.md §3.
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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm text-secondary">{job.topic}</div>
          <div className="text-xs text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
            {job.platform} · {job.aspect_ratio}
            {isGeneratedClips && <><span>·</span><span className="flex items-center gap-1"><Wand2 size={11} /> {ENGINE_LABEL[engine]} {resolution}</span></>}
            {typeDef && <><span>·</span><span>{typeDef.label}</span></>}
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
                  resolution={resolution}
                  editable
                  onChange={(s) => onShotChange(i, s)}
                  onRemove={shots.length > 1 ? () => setShots((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, index: idx }))) : undefined}
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
          {isGeneratedClips && (
            <Panel className="!p-4 space-y-3">
              <div className="label !mb-0">Audio</div>
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={wantsVoiceoverEdit} onChange={(e) => setWantsVoiceoverEdit(e.target.checked)} />
                  <Mic size={13} /> Voiceover
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={wantsMusicEdit} onChange={(e) => setWantsMusicEdit(e.target.checked)} />
                  <Music size={13} /> Background music
                </label>
              </div>
              {wantsVoiceoverEdit && (
                <>
                  <VoicePicker value={voice} onChange={setVoice} />
                  <textarea className="input" rows={3} placeholder="What the narrator says over the whole video" value={voScript} onChange={(e) => setVoScript(e.target.value)} />
                  {job.voiceover_url && <audio src={job.voiceover_url} controls className="w-full" />}
                </>
              )}
              {wantsMusicEdit && (
                <>
                  <input className="input" value={musicPrompt} onChange={(e) => setMusicPrompt(e.target.value)} placeholder="Describe the backing track" />
                  {job.music_url && <audio src={job.music_url} controls className="w-full" />}
                </>
              )}
              <div className="text-[11px] text-muted">
                Re-recording the voiceover or the music costs essentially nothing — only the shots carry a real price.
              </div>
            </Panel>
          )}

          {isGeneratedClips && (
            <CostBar engine={engine} resolution={resolution} seconds={seconds} shots={shots.length} overCeiling={overCeiling} />
          )}

          <Button
            onClick={onApprove}
            loading={saving || rendering}
            disabled={!GENERATION_ENABLED || (isGeneratedClips && (!VIDEO_GENERATION_ENABLED || overCeiling))}
          >
            <Play size={15} /> {isGeneratedClips ? `Generate video — ≈$${liveCost.toFixed(2)}` : 'Approve & Render'}
          </Button>
        </>
      )}

      {(job.status === 'rendering' || job.status === 'done' || job.status === 'failed') && (
        <>
          {job.status === 'rendering' && (
            <div className="card p-6 flex flex-col items-center gap-3 text-center">
              <Spinner size={22} />
              <div className="text-xs text-sage font-medium tabular-nums">{describeProgress(job.render_progress)}</div>
              <div className="w-full max-w-xs h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--fill-tertiary)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.round(overallProgress(job.render_progress) * 100)}%`, background: 'var(--accent-blue)' }}
                />
              </div>
              <div className="text-xs text-muted">
                {isGeneratedClips
                  ? 'Veo generates each shot separately — a few minutes each. You can leave this page.'
                  : 'Stitching, branding and encoding takes a few minutes. You can leave this page.'}
              </div>
            </div>
          )}

          {/* The finished video first — it's what you came back to look at. */}
          {hasFinished && (
            <div className="space-y-3">
              <video
                src={job.final_video_url!}
                controls
                className="w-full rounded-lg"
                style={{ maxHeight: 480, background: 'var(--fill-tertiary)' }}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <a href={job.final_video_url!} target="_blank" rel="noreferrer" className="text-xs text-sage flex items-center gap-1">
                  <Download size={12} /> Download
                </a>
                {job.content_item_id ? (
                  <Badge tone="green"><CheckCircle2 size={12} /> Sent to review</Badge>
                ) : (
                  <Button onClick={onSendToReview} loading={sending} className="!py-1.5 text-xs">
                    <Send size={13} /> Send to Review
                  </Button>
                )}
              </div>
              {isGeneratedClips && (
                <div className="text-xs text-muted">
                  Spent so far: {formatUsdInr(estimateShotsCost(engine, resolution, shots))} across {shots.length} shot{shots.length === 1 ? '' : 's'}.
                </div>
              )}
            </div>
          )}

          {job.status === 'failed' && (
            <ErrorPanel raw={job.error_detail} onRetry={doRender} retrying={saving || rendering} />
          )}

          {/* The storyboard stays on screen after generation, still editable — this is how you
              rework a shot you don't like and run it again without starting over. */}
          {isGeneratedClips && shots.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="label !mb-0">Storyboard</div>
                {editable && (
                  <div className="text-[11px] text-muted">
                    Editing a prompt re-generates that shot · editing on-screen text is free
                  </div>
                )}
              </div>
              {shots.map((shot, i) => (
                <ShotEditor
                  key={i}
                  shot={shot}
                  engine={engine}
                  resolution={resolution}
                  editable={editable}
                  onChange={(s) => onShotChange(i, s)}
                  onRegenerate={editable ? () => onRegenerateShot(i) : undefined}
                  regenerating={regeneratingShot === i}
                />
              ))}

              <CopyEditor copy={copy} onChange={setCopy} />
              {isGeneratedClips && (
                <Panel className="!p-4 space-y-3">
                  <div className="label !mb-0">Audio</div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={wantsVoiceoverEdit} onChange={(e) => setWantsVoiceoverEdit(e.target.checked)} disabled={!editable} />
                      <Mic size={13} /> Voiceover
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={wantsMusicEdit} onChange={(e) => setWantsMusicEdit(e.target.checked)} disabled={!editable} />
                      <Music size={13} /> Background music
                    </label>
                  </div>
                  {wantsVoiceoverEdit && (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <VoicePicker value={voice} onChange={setVoice} disabled={!editable} />
                        {editable && job.voiceover_url && (
                          <button onClick={() => onRegenerateAudio('voiceover')} disabled={regeneratingAudio === 'voiceover'} className="text-muted hover:text-sage disabled:opacity-40 shrink-0" title="Not happy with this take? Re-record the same script.">
                            {regeneratingAudio === 'voiceover' ? <Spinner size={13} /> : <RefreshCw size={13} />}
                          </button>
                        )}
                      </div>
                      <textarea className="input" rows={3} placeholder="What the narrator says over the whole video" value={voScript} onChange={(e) => setVoScript(e.target.value)} disabled={!editable} />
                      {job.voiceover_url && (
                        <>
                          <audio src={job.voiceover_url} controls className="w-full" />
                          <FeedbackControl feedback={voFeedback} onChange={setVoFeedback} disabled={!editable} notePlaceholder="What's wrong? Folded into the script when you redo the take" />
                        </>
                      )}
                    </>
                  )}
                  {wantsMusicEdit && (
                    <>
                      <div className="flex items-center gap-2">
                        <input className="input" value={musicPrompt} onChange={(e) => setMusicPrompt(e.target.value)} disabled={!editable} placeholder="Describe the backing track" />
                        {editable && job.music_url && (
                          <button onClick={() => onRegenerateAudio('music')} disabled={regeneratingAudio === 'music'} className="text-muted hover:text-sage disabled:opacity-40 shrink-0" title="Not happy with this take? Re-compose the same brief.">
                            {regeneratingAudio === 'music' ? <Spinner size={13} /> : <RefreshCw size={13} />}
                          </button>
                        )}
                      </div>
                      {job.music_url && (
                        <>
                          <audio src={job.music_url} controls className="w-full" />
                          <FeedbackControl feedback={musicFeedback} onChange={setMusicFeedback} disabled={!editable} notePlaceholder="What's wrong? Folded into the brief when you redo the take" />
                        </>
                      )}
                    </>
                  )}
                  <div className="text-[11px] text-muted">
                    Re-recording the voiceover or the music costs essentially nothing — only the shots carry a real price.
                  </div>
                </Panel>
              )}

              {editable && (
                <>
                  {nextRunCost > 0 ? (
                    <CostBar
                      engine={engine}
                      resolution={resolution}
                      seconds={totalDurationS(pendingShots)}
                      shots={pendingShots.length}
                      overCeiling={nextRunOverCeiling}
                    />
                  ) : (
                    <div className="text-xs text-sage">
                      Nothing to re-generate — re-assembling only applies your new on-screen text and caption, at no cost.
                    </div>
                  )}
                  <Button
                    onClick={onApprove}
                    loading={saving || rendering}
                    disabled={!GENERATION_ENABLED || !VIDEO_GENERATION_ENABLED || nextRunOverCeiling}
                  >
                    <RefreshCw size={15} />{' '}
                    {nextRunCost > 0
                      ? `Regenerate video — ≈$${nextRunCost.toFixed(2)}`
                      : 'Rebuild video'}
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {confirmOpen && (
        <Modal title="Confirm this spend" onClose={() => setConfirmOpen(false)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--fill-tertiary)' }}>
              <AlertTriangle size={18} className="text-terracotta shrink-0 mt-0.5" />
              <div className="text-sm text-secondary">
                This will generate {pendingShots.length} shot{pendingShots.length === 1 ? '' : 's'}{' '}
                ({totalDurationS(pendingShots)} seconds) with <b className="text-ink">{ENGINE_LABEL[engine]}</b> at{' '}
                {resolution}. It charges the connected Google account immediately — this is a real payment, not a
                preview.
                {shots.length > pendingShots.length && (
                  <> {shots.length - pendingShots.length} already-generated shot
                    {shots.length - pendingShots.length === 1 ? ' is' : 's are'} reused free of charge.</>
                )}
              </div>
            </div>
            <div className="text-center py-1">
              <div className="text-3xl font-bold text-ink tabular-nums">${nextRunCost.toFixed(2)}</div>
              <div className="text-sm text-secondary mt-1">≈ ₹{Math.round(nextRunCost * 94.6).toLocaleString('en-IN')}</div>
              <div className="text-[11px] text-muted mt-2">
                Estimate based on Google's published per-second rate. You are only charged for shots that generate successfully.
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                loading={saving || rendering}
                onClick={async () => { setConfirmOpen(false); await doRender() }}
              >
                <Play size={15} /> Yes, generate
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
  const [createOpen, setCreateOpen] = useState(false)
  const [signals, setSignals] = useState<TrendSignal[]>([])
  const [sourceKind, setSourceKind] = useState<StudioSourceKind>('trend')
  const [signalId, setSignalId] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [platform, setPlatform] = useState<(typeof VIDEO_PLATFORMS)[number]>('instagram')
  const [ratio, setRatio] = useState<AspectRatio>('9:16')
  const [videoType, setVideoType] = useState<VideoType>('generated_clips')
  const [styleId, setStyleId] = useState<string>(VIDEO_TYPES[0].id)
  const [slideCount, setSlideCount] = useState(4)
  const [engine, setEngine] = useState<VideoEngine>('veo-3.1-fast')
  const [resolution, setResolution] = useState<VideoResolution>('1080p')
  const [shotCount, setShotCount] = useState(3)
  const [durationS, setDurationS] = useState<4 | 6 | 8>(4)
  const [wantsVoiceover, setWantsVoiceover] = useState(false)
  const [wantsMusic, setWantsMusic] = useState(false)
  const [voice, setVoice] = useState(DEFAULT_VOICE)
  const [generating, setGenerating] = useState(false)
  const toast = useToast()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedType = useMemo(() => getVideoType(styleId), [styleId])

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

  // Picking a treatment pulls its own sensible defaults, the same way choosing an AI Studio style
  // preselects that style's ratio — the type knows better than a global default what it needs.
  useEffect(() => {
    if (!selectedType) return
    setEngine(selectedType.defaultEngine)
    setShotCount(selectedType.defaultShots)
    setDurationS(selectedType.defaultDurationS)
    setWantsVoiceover(selectedType.wantsVoiceover)
    setRatio(selectedType.defaultRatio)
  }, [styleId])

  useEffect(() => {
    if (!profile) return
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    listSignalsSince(profile.id, since).then(setSignals).catch(() => setSignals([]))
  }, [profile])

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

  // Safety net only — realtime above is the real mechanism, but a dropped websocket would
  // otherwise leave a multi-minute generation looking frozen.
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
  const isClips = videoType === 'generated_clips'
  const plannedSeconds = shotCount * durationS
  const plannedRate = ratePerSecond(engine, resolution)
  const plannedCost = plannedRate == null ? null : Math.round(plannedRate * plannedSeconds * 100) / 100
  const plannedOverCeiling = plannedCost != null && plannedCost > PER_VIDEO_CEILING_USD

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
        wantsMusic: isClips ? wantsMusic : false,
        videoType,
        slideCount: isClips ? undefined : slideCount,
        engine: isClips ? engine : undefined,
        resolution: isClips ? resolution : undefined,
        shotCount: isClips ? shotCount : undefined,
        durationS: isClips ? durationS : undefined,
        videoStyleId: isClips ? styleId : undefined,
        styleDirection: isClips && selectedType ? videoTypeDirection(selectedType) : undefined,
        styleArc: isClips && selectedType ? selectedType.arc : undefined,
      })
      setJobs((prev) => [job, ...prev])
      setCreateOpen(false)
      setSelectedId(job.id)
      setTopic('')
      setSignalId(null)
      toast.info('Storyboard drafted — review every shot prompt below. Nothing has been charged yet.')
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

  if (profileLoading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>
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
        subtitle="A trend or a topic in, a branded short-form video out. Review every shot and its real price before anything is generated."
      />

      {/* --- Recent videos, with the create action opposite the heading ------- */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <div className="label !mb-0">Recent videos</div>
            {jobs.length > 0 && <span className="text-[11px] text-muted">{jobs.length} total</span>}
          </div>
          <Button onClick={() => setCreateOpen(true)} className="!py-1.5 text-xs">
            <Plus size={14} /> New video
          </Button>
        </div>
        {/* Same tile grid as Creative Review, and the same PostTile component — it already
            renders a muted video thumbnail with a play badge for any .mp4 URL. */}
        {jobs.length === 0 ? (
          <EmptyState icon={<Film size={28} />} title="No videos yet" hint="Hit New video to draft your first storyboard." />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-1.5">
            {jobs.map((job) => (
              <PostTile
                key={job.id}
                img={job.final_video_url}
                platform={job.platform}
                placeholder={job.topic}
                busyNote={job.status === 'rendering' ? (
                  <>
                    <Spinner size={16} />
                    <span className="text-[10px] text-muted px-2 text-center leading-tight">
                      {describeProgress(job.render_progress)}
                    </span>
                  </>
                ) : undefined}
                topRight={
                  job.status === 'failed'
                    ? <Badge tone="orange" className="!text-[10px] !px-1.5 !py-0.5">Failed</Badge>
                    : job.status === 'draft_ready'
                      ? <Badge tone="grey" className="!text-[10px] !px-1.5 !py-0.5">Draft</Badge>
                      : job.video_type === 'generated_clips'
                        ? <Badge tone="blue" className="!text-[10px] !px-1.5 !py-0.5">AI</Badge>
                        : undefined
                }
                bottomLeft={
                  job.estimated_cost_usd != null && job.video_type === 'generated_clips' ? (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums text-white"
                      style={{ background: 'rgba(0,0,0,0.55)' }}
                    >
                      ${job.estimated_cost_usd.toFixed(2)}
                    </span>
                  ) : undefined
                }
                onClick={() => setSelectedId(selectedId === job.id ? null : job.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* --- A video opens as its own overlay ---------------------------------
          Deliberately NOT inline under the grid: sitting directly above the
          create form, the two sections read as one block and it was never
          obvious which video the controls underneath belonged to. An overlay
          makes "this is that video, and nothing else" unambiguous. */}
      {selectedJob && (
        <Modal title={selectedJob.topic || 'Video'} size="xl" onClose={() => setSelectedId(null)}>
          <div className="flex justify-end mb-3">
            <button
              onClick={() => onDelete(selectedJob.id)}
              className="text-xs text-muted hover:text-terracotta flex items-center gap-1"
            >
              <Trash2 size={12} /> Delete this video
            </button>
          </div>
          <JobDetail job={selectedJob} onChanged={() => profile && load(profile.id)} />
        </Modal>
      )}

      {createOpen && (
      <Modal title="New video" size="xl" onClose={() => setCreateOpen(false)}>
        <div className="space-y-4">

        {/* --- How it's made ------------------------------------------------ */}
        <div className="flex gap-2 flex-wrap">
          <Chip active={videoType === 'generated_clips'} onClick={() => setVideoType('generated_clips')} disabled={!VIDEO_GENERATION_ENABLED}>
            <span className="flex items-center gap-1.5"><Wand2 size={13} /> AI video (Veo)</span>
          </Chip>
          <Chip active={videoType === 'motion_graphics'} onClick={() => setVideoType('motion_graphics')}>
            <span className="flex items-center gap-1.5"><Clapperboard size={13} /> Motion graphics</span>
          </Chip>
        </div>
        <p className="text-muted text-xs -mt-1">
          {isClips
            ? 'Real generated footage from written shot prompts. Costs real money per second — the exact figure is shown before you commit.'
            : 'Animated on-screen text and brand shapes. No AI video model, effectively free.'}
        </p>

        {/* --- Video type gallery ------------------------------------------- */}
        {isClips && (
          <div>
            <div className="label mb-2">What kind of video?</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {VIDEO_TYPES.map((t) => {
                const active = styleId === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setStyleId(t.id)}
                    className="text-left rounded-lg p-3 transition-all"
                    style={{
                      background: active ? 'var(--fill-secondary)' : 'var(--bg-card)',
                      border: `1.5px solid ${active ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    <div className={`text-xs font-semibold ${active ? 'text-sage' : 'text-ink'}`}>{t.label}</div>
                    <div className="text-[10px] text-muted mt-1 leading-snug">{t.bestFor}</div>
                  </button>
                )
              })}
            </div>
            {selectedType && (
              <p className="text-[11px] text-muted mt-2 leading-relaxed">
                <b className="text-secondary">The arc:</b> {selectedType.arc}
              </p>
            )}
          </div>
        )}

        {/* --- Source ------------------------------------------------------- */}
        <div>
          <div className="label mb-2">What's it about?</div>
          <div className="flex gap-2 flex-wrap mb-2">
            {([
              { value: 'trend', label: 'A live trend', icon: TrendingUp },
              { value: 'strategy', label: 'The strategy', icon: Target },
              { value: 'topic', label: 'My own topic', icon: Type },
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
              placeholder="Topic — e.g. Why manual client onboarding breaks past 20 clients"
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
        </div>

        {/* --- Settings ----------------------------------------------------- */}
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted w-20">Platform</span>
            {VIDEO_PLATFORMS.map((p) => <Chip key={p} active={platform === p} onClick={() => setPlatform(p)}>{p}</Chip>)}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted w-20">Shape</span>
            {VIDEO_RATIOS.map((r) => <Chip key={r} active={ratio === r} onClick={() => setRatio(r)}>{r}</Chip>)}
          </div>

          {isClips ? (
            <>
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-xs text-muted w-20 pt-1.5">Model</span>
                <div className="flex-1 min-w-[240px]">
                  <div className="flex gap-2 flex-wrap">
                    {VIDEO_ENGINES.map((e) => (
                      <Chip key={e} active={engine === e} onClick={() => setEngine(e)}>{ENGINE_LABEL[e]}</Chip>
                    ))}
                  </div>
                  <div className="text-[11px] text-muted mt-1.5">{ENGINE_BLURB[engine]}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted w-20">Resolution</span>
                {VIDEO_RESOLUTIONS.map((r) => {
                  const available = ratePerSecond(engine, r) != null
                  return (
                    <Chip
                      key={r}
                      active={resolution === r}
                      onClick={() => setResolution(r)}
                      disabled={!available}
                      title={available ? `$${ratePerSecond(engine, r)?.toFixed(2)}/sec` : `${ENGINE_LABEL[engine]} does not offer ${r}`}
                    >
                      {r}
                    </Chip>
                  )
                })}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted w-20">Shots</span>
                {SHOT_COUNTS.map((n) => <Chip key={n} active={shotCount === n} onClick={() => setShotCount(n)}>{n}</Chip>)}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted w-20">Each shot</span>
                {SHOT_DURATIONS.map((d) => <Chip key={d} active={durationS === d} onClick={() => setDurationS(d)}>{d}s</Chip>)}
                <span className="text-[11px] text-muted flex items-center gap-1">
                  <Clock size={11} /> {plannedSeconds}s total
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted w-20">Slides</span>
              {SLIDE_COUNTS.map((n) => <Chip key={n} active={slideCount === n} onClick={() => setSlideCount(n)}>{n}</Chip>)}
            </div>
          )}
        </div>

        {/* --- Audio -------------------------------------------------------- */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
            <input type="checkbox" checked={wantsVoiceover} onChange={(e) => setWantsVoiceover(e.target.checked)} />
            <Mic size={13} /> Add a voiceover
          </label>
          {wantsVoiceover && (
            <div className="pl-6">
              <VoicePicker value={voice} onChange={setVoice} />
            </div>
          )}
          {isClips && (
            <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
              <input type="checkbox" checked={wantsMusic} onChange={(e) => setWantsMusic(e.target.checked)} />
              <Music size={13} /> Add background music
              <span className="text-[11px] text-muted">
                +${MUSIC_COST_USD.toFixed(2)} · also smooths the audio between shots
              </span>
            </label>
          )}
        </div>

        {/* --- Price -------------------------------------------------------- */}
        {isClips && (
          <CostBar engine={engine} resolution={resolution} seconds={plannedSeconds} shots={shotCount} overCeiling={plannedOverCeiling} music={wantsMusic} />
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={onGenerate}
            loading={generating}
            disabled={!canGenerate || !GENERATION_ENABLED || (isClips && (!VIDEO_GENERATION_ENABLED || plannedOverCeiling || plannedRate == null))}
          >
            <Sparkles size={15} /> Write the storyboard
          </Button>
          {isClips && (
            <span className="text-[11px] text-muted">Free — writes the shot prompts only. Nothing is generated until you approve.</span>
          )}
        </div>
        {!GENERATION_ENABLED && <div className="text-xs text-terracotta">Generation is currently disabled (GENERATION_ENABLED=false).</div>}
        {isClips && !VIDEO_GENERATION_ENABLED && <div className="text-xs text-terracotta">AI video generation is disabled (VIDEO_GENERATION_ENABLED=false).</div>}
        </div>
      </Modal>
      )}
    </div>
  )
}
