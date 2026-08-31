import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Sparkles, RefreshCw, Play, CheckCircle2, XCircle, Plus, Trash2, Download } from 'lucide-react'
import { useProfile } from '../lib/queries'
import {
  listCarouselJobs, generateCarouselOutline, updateCarouselOutline, triggerCarouselRender,
  deleteCarouselJob, type CarouselJob, type CarouselSlide,
} from '../lib/carousels'
import { GENERATION_ENABLED } from '../lib/content'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel } from '../components/ui'
import { useToast, toastMessage } from '../components/Toast'

const POSES = ['casual', 'pointing', 'victory', 'arms-crossed', 'phone'] as const

function StatusBadge({ status }: { status: CarouselJob['status'] }) {
  if (status === 'done') return <Badge tone="green"><CheckCircle2 size={12} /> Done</Badge>
  if (status === 'failed') return <Badge tone="orange"><XCircle size={12} /> Failed</Badge>
  if (status === 'rendering') return <Badge tone="blue">Rendering…</Badge>
  return <Badge tone="grey">Draft</Badge>
}

// One editable card per slide — only the fields that slide's gen.js template actually reads are
// shown, so the form never offers something that would silently do nothing.
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
          <input className="input" placeholder="Comment keyword" value={slide.keyword ?? ''} onChange={(e) => set({ keyword: e.target.value.toUpperCase() })} />
        </>
      )}
    </Panel>
  )
}

function JobDetail({ job, onChanged }: { job: CarouselJob; onChanged: () => void }) {
  const [outline, setOutline] = useState<CarouselSlide[]>(job.outline_json ?? [])
  const [saving, setSaving] = useState(false)
  const [rendering, setRendering] = useState(false)
  const toast = useToast()

  useEffect(() => { setOutline(job.outline_json ?? []) }, [job.id])

  const editable = job.status === 'draft_ready'
  const expectedSlides = job.outline_json?.length ?? 0
  const doneSlides = job.slide_urls?.length ?? 0

  async function onApproveAndRender() {
    setSaving(true)
    try {
      await updateCarouselOutline(job.id, outline)
      setSaving(false)
      setRendering(true)
      await triggerCarouselRender(job.id)
      toast.info('Render started — this takes several minutes. Slides will appear below as each one finishes.')
      onChanged()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not start the render'))
    } finally {
      setSaving(false)
      setRendering(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-secondary">{job.topic}</div>
          <div className="text-xs text-muted mt-0.5">
            Keyword: <b className="text-ink">{job.comment_keyword || '—'}</b> · {job.platform}
          </div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {job.status === 'draft_ready' && (
        <>
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
          <Button onClick={onApproveAndRender} loading={saving || rendering} disabled={!GENERATION_ENABLED}>
            <Play size={15} /> Approve &amp; Render
          </Button>
        </>
      )}

      {(job.status === 'rendering' || job.status === 'done' || job.status === 'failed') && (
        <>
          {job.status === 'rendering' && (
            <div className="card p-6 flex flex-col items-center gap-3 text-center">
              <Spinner size={22} />
              <div className="text-sm text-secondary">
                Rendering — {doneSlides}/{expectedSlides} slides done…
              </div>
              <div className="w-full max-w-xs h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--fill-tertiary)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${expectedSlides ? Math.round((doneSlides / expectedSlides) * 100) : 0}%`, background: 'var(--accent-blue)' }}
                />
              </div>
              <div className="text-xs text-muted">Renders run one slide at a time right now — a full carousel can take a while. Feel free to check back later.</div>
            </div>
          )}

          {job.status === 'failed' && (
            <Panel className="!p-4 border border-terracotta/30">
              <div className="flex items-center gap-2 text-terracotta text-sm mb-1"><XCircle size={14} /> Render failed</div>
              <div className="text-xs text-muted">{job.error_detail || 'Unknown error.'}</div>
            </Panel>
          )}

          {job.slide_urls.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {job.slide_urls.map((url, i) => (
                <div key={url} className="space-y-1.5">
                  <video src={url} controls className="w-full rounded-lg" style={{ aspectRatio: '4/5', background: 'var(--fill-tertiary)' }} />
                  <a href={url} target="_blank" rel="noreferrer" className="text-xs text-sage flex items-center gap-1">
                    <Download size={12} /> Slide {i + 1}
                  </a>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function CarouselStudio() {
  const { data: profile, isLoading: profileLoading } = useProfile()
  const [jobs, setJobs] = useState<CarouselJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [keyword, setKeyword] = useState('')
  const [generating, setGenerating] = useState(false)
  const toast = useToast()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (profileId: string) => {
    const list = await listCarouselJobs(profileId)
    setJobs(list)
    return list
  }, [])

  useEffect(() => {
    if (profile) load(profile.id)
  }, [profile, load])

  // Poll while any job is actively rendering — mirrors the same shape used for Content
  // Factory/Analytics refresh polling elsewhere in this app.
  useEffect(() => {
    const hasActive = jobs.some((j) => j.status === 'rendering')
    if (!hasActive || !profile) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    if (pollRef.current) return
    pollRef.current = setInterval(() => load(profile.id), 8000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [jobs, profile, load])

  async function onGenerate() {
    if (!profile || !topic.trim()) return
    setGenerating(true)
    try {
      const job = await generateCarouselOutline({ profileId: profile.id, topic: topic.trim(), commentKeyword: keyword.trim() || 'LEARNMORE' })
      setJobs((prev) => [job, ...prev])
      setSelectedId(job.id)
      setTopic('')
      setKeyword('')
      toast.info('Outline drafted — review the slides below, then Approve & Render.')
    } catch (err) {
      toast.error(toastMessage(err, 'Could not draft the outline'))
    } finally {
      setGenerating(false)
    }
  }

  async function onDelete(id: string) {
    await deleteCarouselJob(id)
    setJobs((prev) => prev.filter((j) => j.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  if (profileLoading) {
    return <div className="flex justify-center py-16"><Spinner size={24} /></div>
  }
  if (!profile) {
    return (
      <div>
        <PageHeader accent={<Badge><Clapperboard size={12} /> Carousel Studio</Badge>} title="Carousel Studio" />
        <EmptyState icon={<Clapperboard size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  const selectedJob = jobs.find((j) => j.id === selectedId) ?? null

  return (
    <div>
      <PageHeader
        accent={<Badge><Clapperboard size={12} /> Carousel Studio</Badge>}
        title="Carousel Studio"
        subtitle="Topic in, animated avatar-hosted carousel out. Draft an outline, review it, then render — each slide becomes its own MP4."
      />

      <Panel className="mb-6 space-y-3">
        <div className="font-medium text-sm">New carousel</div>
        <textarea
          className="input"
          rows={2}
          placeholder="Topic — e.g. Why manual CRM entry is dead"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Comment keyword (e.g. AUTOMATE)"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value.toUpperCase())}
          />
          <Button onClick={onGenerate} loading={generating} disabled={!topic.trim() || !GENERATION_ENABLED}>
            <Sparkles size={15} /> Draft outline
          </Button>
        </div>
        {!GENERATION_ENABLED && <div className="text-xs text-terracotta">Generation is currently disabled (GENERATION_ENABLED=false).</div>}
      </Panel>

      {jobs.length === 0 ? (
        <EmptyState icon={<Clapperboard size={28} />} title="No carousels yet" hint="Give it a topic above to draft your first outline." />
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
                  <div className="mt-2"><StatusBadge status={job.status} /></div>
                </Panel>
              </div>
            ))}
          </div>

          <div>
            {selectedJob ? (
              <JobDetail job={selectedJob} onChanged={() => profile && load(profile.id)} />
            ) : (
              <EmptyState icon={<RefreshCw size={24} />} title="Pick a carousel" hint="Select one from the list to review or watch its render." />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
