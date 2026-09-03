import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Wand2, Sparkles, RefreshCw, Check, X, ImageIcon, TrendingUp, Target, Type,
  ArrowRight, Trash2, AlertTriangle,
} from 'lucide-react'
import { useProfile } from '../lib/queries'
import { listSignalsSince, type TrendSignal } from '../lib/trends'
import {
  generateStudioBrief, triggerStudioGenerate, updateStudioDraft, listStudioJobs, getStudioJob,
  selectStudioVariant, markStudioJobUsed, deleteStudioJob,
  IMAGE_MODELS, getModel, HIGGSFIELD_ENABLED, estimateStudioCost,
  type StudioJob, type StudioSourceKind, type ImageModelId, type StudioCopy,
} from '../lib/studio'
import {
  STUDIO_STYLES, styleDirection, getStyle, ASPECT_RATIOS, RATIO_VALUE, PLATFORM_DEFAULT_RATIO,
  type AspectRatio,
} from '../lib/studioStyles'
import { createManualItem, GENERATION_ENABLED } from '../lib/content'
import { stampAndUpload } from '../lib/brandStamp'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel } from '../components/ui'
import { PlatformBadge } from '../components/mediaUi'
import AssetUploader from '../components/AssetUploader'
import { useToast, toastMessage } from '../components/Toast'

const SOURCES: { value: StudioSourceKind; label: string; icon: typeof TrendingUp; hint: string }[] = [
  { value: 'trend', label: 'A live trend', icon: TrendingUp, hint: 'Anchor the post on something actually happening right now' },
  { value: 'strategy', label: 'The strategy', icon: Target, hint: 'Pull the angle from the current approved strategy' },
  { value: 'topic', label: 'My own topic', icon: Type, hint: 'Write the subject yourself' },
]

const STUDIO_PLATFORMS = ['instagram', 'linkedin', 'facebook'] as const

/** Chip row used for platform / ratio / variant count — same pill treatment as the tabs on
 *  Strategy and the view toggle on the content calendar, so the page doesn't invent a new one. */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
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

/** Live "this is what clicking Generate will cost" line — shown both at the setup stage (so a
 *  variant-count/model choice is priced before the brief is even written) and, more importantly,
 *  right next to the actual Generate button, since that's the step that spends real money. */
function CostEstimate({ model, ratio, variantCount }: { model: ReturnType<typeof getModel>; ratio: AspectRatio; variantCount: number }) {
  const { usd, note } = estimateStudioCost(model, ratio, variantCount)
  if (usd == null) {
    return note ? <span className="text-muted text-[11px]">{note}</span> : null
  }
  return (
    <span className="text-[11px] font-semibold" style={{ color: 'var(--accent-orange)' }}>
      ≈ ${usd.toFixed(3)} for {variantCount} {variantCount === 1 ? 'image' : 'images'}
    </span>
  )
}

export default function AIStudio() {
  const { data: profile, isLoading: profileLoading } = useProfile()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  // --- Brief inputs -------------------------------------------------------
  const [sourceKind, setSourceKind] = useState<StudioSourceKind>('topic')
  const [signalId, setSignalId] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [platform, setPlatform] = useState<string>('instagram')
  const [ratio, setRatio] = useState<AspectRatio>('4:5')
  const [styleId, setStyleId] = useState<string>(STUDIO_STYLES[0].id)
  const [model, setModel] = useState<ImageModelId>('gpt-image-1')
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null)
  const [characterId, setCharacterId] = useState('')
  const [variantCount, setVariantCount] = useState(2)

  const [signals, setSignals] = useState<TrendSignal[]>([])
  const [jobs, setJobs] = useState<StudioJob[]>([])
  const [job, setJob] = useState<StudioJob | null>(null)
  const [briefing, setBriefing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)

  // Local edits to the draft, so typing stays responsive and only persists on generate.
  const [draftCopy, setDraftCopy] = useState<StudioCopy>({})
  const [draftPrompt, setDraftPrompt] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeModel = getModel(model)
  const activeStyle = getStyle(styleId)

  // Trends arriving from the Trends page's "Create with AI" button — deep-linked rather than
  // running a separate one-shot generator, so there's exactly one generation engine.
  useEffect(() => {
    const state = location.state as { signalId?: string; topic?: string } | null
    if (state?.signalId) {
      setSourceKind('trend')
      setSignalId(state.signalId)
      if (state.topic) setTopic(state.topic)
    }
  }, [location.state])

  useEffect(() => {
    if (!profile) return
    // 30 days back is plenty — trend signals older than that have usually been superseded by a
    // later scan anyway.
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    listSignalsSince(profile.id, since).then(setSignals).catch(() => setSignals([]))
    listStudioJobs(profile.id).then(setJobs).catch(() => setJobs([]))
  }, [profile])

  // Platform drives the default ratio, but only until the user overrides it themselves.
  const [ratioTouched, setRatioTouched] = useState(false)
  useEffect(() => {
    if (!ratioTouched) setRatio(PLATFORM_DEFAULT_RATIO[platform] ?? '1:1')
  }, [platform, ratioTouched])

  // A style is composed for a shape — picking one moves the ratio with it, again only while the
  // user hasn't taken manual control of the ratio.
  useEffect(() => {
    if (!ratioTouched && activeStyle) setRatio(activeStyle.defaultRatio)
  }, [styleId, ratioTouched, activeStyle])

  // Keep the ratio legal for the chosen model.
  useEffect(() => {
    if (activeModel && !activeModel.aspectRatios.includes(ratio)) setRatio(activeModel.aspectRatios[0])
  }, [model, ratio, activeModel])

  const refreshJob = useCallback(async (id: string) => {
    const fresh = await getStudioJob(id)
    if (fresh) setJob(fresh)
    return fresh
  }, [])

  // Poll while the image models are working.
  //
  // Deliberately driven by the local `generating` flag as well as the row's status, not by the
  // status alone: the webhook returns before n8n's "Mark Generating" PATCH lands, so a poller
  // that waited for status==='generating' would look once, still see 'draft_ready', and never
  // start — leaving the page frozen on the draft even after the images arrived. (Verified: the
  // first live run did exactly that.) Terminal statuses clear the flag and stop the loop.
  useEffect(() => {
    const jobId = job?.id
    const isActive = generating || job?.status === 'generating'
    if (isActive && jobId && !pollRef.current) {
      pollRef.current = setInterval(() => {
        refreshJob(jobId).then((fresh) => {
          if (fresh && (fresh.status === 'done' || fresh.status === 'failed')) setGenerating(false)
        })
      }, 3000)
    } else if (!isActive && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [generating, job?.id, job?.status, refreshJob])

  const selectedSignal = signals.find((s) => s.id === signalId) ?? null
  const effectiveTopic = sourceKind === 'trend' ? (selectedSignal?.topic ?? '') : topic
  const canBrief = Boolean(
    profile && GENERATION_ENABLED && styleId &&
    (sourceKind === 'trend' ? signalId : sourceKind === 'strategy' ? true : topic.trim()),
  )

  async function onBrief() {
    if (!profile || !activeStyle) return
    setBriefing(true)
    try {
      const created = await generateStudioBrief({
        profileId: profile.id,
        sourceKind,
        signalId: sourceKind === 'trend' ? signalId : null,
        topic: sourceKind === 'strategy' ? (topic.trim() || 'The current marketing strategy') : topic.trim(),
        platform,
        aspectRatio: ratio,
        styleId,
        model,
        referenceImageUrl,
        characterId: characterId.trim() || null,
        variantCount,
        // Art direction travels with the request so the wording stays versioned in this repo
        // rather than drifting inside an n8n node — see studioStyles.ts.
        styleLabel: activeStyle.label,
        styleDirection: styleDirection(activeStyle),
        styleRendersText: Boolean(activeStyle.rendersText),
      })
      setJob(created)
      setDraftCopy(created.copy_json ?? {})
      setDraftPrompt(created.image_prompt ?? '')
      setJobs((prev) => [created, ...prev])
    } catch (err) {
      toast.error(toastMessage(err, 'Could not write the brief'))
    } finally {
      setBriefing(false)
    }
  }

  async function onGenerate() {
    if (!job) return
    setGenerating(true)
    try {
      // Persist whatever was edited in the review step first — the whole point of that step is
      // that the prompt actually sent is the one on screen.
      await updateStudioDraft(job.id, {
        copy_json: draftCopy,
        image_prompt: draftPrompt,
        aspect_ratio: ratio,
        model,
        variant_count: variantCount,
      })
      await triggerStudioGenerate(job.id)
      await refreshJob(job.id)
    } catch (err) {
      toast.error(toastMessage(err, 'Could not start generation'))
      setGenerating(false)
    }
  }

  async function onPick(url: string) {
    if (!job) return
    await selectStudioVariant(job.id, url)
    setJob({ ...job, selected_image_url: url })
  }

  async function onSendToReview() {
    if (!job || !profile || !job.selected_image_url) return
    setSending(true)
    try {
      // Stamp in the browser before handing off. The brand-overlay edge function is a
      // pass-through on this Supabase tier, so this is the only place the logo actually gets
      // applied to a generated image.
      const { url, stamped } = await stampAndUpload(job.selected_image_url, `studio/${job.id}/branded`)
      const item = await createManualItem({
        profileId: profile.id,
        platform,
        contentType: 'static_image',
        title: (draftCopy.hook || job.topic || '').slice(0, 60) || null,
        body: [draftCopy.body, draftCopy.cta].filter(Boolean).join('\n\n'),
        mediaUrl: url,
        slides: [],
        hashtags: draftCopy.hashtags ?? [],
        cta: draftCopy.cta ?? '',
        scheduledDate: null,
        scheduledTime: null,
        scheduledAt: null,
        linkedinAccount: null,
      })
      await markStudioJobUsed(job.id, item.id)
      setJob({ ...job, content_item_id: item.id })
      toast.info(stamped ? 'Sent to Creative Review, brand-stamped.' : 'Sent to Creative Review (logo could not be loaded, image is unstamped).')
      navigate('/review')
    } catch (err) {
      toast.error(toastMessage(err, 'Could not send this post to review'))
    } finally {
      setSending(false)
    }
  }

  async function onOpenJob(j: StudioJob) {
    setJob(j)
    setDraftCopy(j.copy_json ?? {})
    setDraftPrompt(j.image_prompt ?? '')
    setPlatform(j.platform)
    setRatio((j.aspect_ratio as AspectRatio) ?? '1:1')
    setRatioTouched(true)
    if (j.style_id) setStyleId(j.style_id)
    setModel(j.model)
  }

  async function onDeleteJob(id: string) {
    await deleteStudioJob(id)
    setJobs((prev) => prev.filter((j) => j.id !== id))
    if (job?.id === id) setJob(null)
  }

  if (profileLoading) {
    return <div className="flex justify-center py-16"><Spinner size={24} /></div>
  }

  if (!profile) {
    return (
      <div>
        <PageHeader accent={<Badge><Wand2 size={12} /> AI Studio</Badge>} title="AI Studio" />
        <EmptyState icon={<Wand2 size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  // Same reason as the poller above: trust the local flag too, so the spinner appears the moment
  // Generate is clicked rather than one poll tick after n8n gets round to the status write.
  const isGenerating = generating || job?.status === 'generating'
  const isDone = job?.status === 'done' && !generating
  const isFailed = job?.status === 'failed' && !generating

  return (
    <div>
      <PageHeader
        accent={<Badge><Wand2 size={12} /> AI Studio</Badge>}
        title={`AI Studio — ${profile.business_name}`}
        subtitle="Pick a source and a look, review the prompt before it costs anything, then generate a few options and send the best one to review. Images only — video generation stays manual."
        actions={job ? <Button variant="ghost" onClick={() => setJob(null)}><Sparkles size={15} /> New post</Button> : undefined}
      />

      {!job ? (
        <div className="space-y-5">
          {/* --- Source ---------------------------------------------------- */}
          <Panel>
            <div className="label mb-2">What is this post about?</div>
            <div className="flex gap-2 flex-wrap mb-3">
              {SOURCES.map((s) => {
                const Icon = s.icon
                return (
                  <Chip key={s.value} active={sourceKind === s.value} onClick={() => setSourceKind(s.value)}>
                    <span className="flex items-center gap-1.5"><Icon size={13} /> {s.label}</span>
                  </Chip>
                )
              })}
            </div>
            <p className="text-muted text-xs mb-3">{SOURCES.find((s) => s.value === sourceKind)?.hint}</p>

            {sourceKind === 'trend' && (
              signals.length === 0 ? (
                <div className="text-muted text-sm">No trend signals in the last 30 days — run a scan on the Trends page first.</div>
              ) : (
                <select className="input" value={signalId ?? ''} onChange={(e) => setSignalId(e.target.value || null)}>
                  <option value="">Pick a trend…</option>
                  {signals.map((s) => (
                    <option key={s.id} value={s.id}>{s.source} · {s.topic.slice(0, 90)}</option>
                  ))}
                </select>
              )
            )}
            {sourceKind === 'topic' && (
              <input
                className="input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Why recruiters lose 5 hours a week to scheduling"
              />
            )}
            {sourceKind === 'strategy' && (
              <p className="text-secondary text-sm">
                The brief will be written from the latest strategy's summary and pillars. Add an optional steer:
                <input
                  className="input mt-2"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Optional — e.g. focus on the Ops Pod"
                />
              </p>
            )}
          </Panel>

          {/* --- Style gallery --------------------------------------------- */}
          <Panel>
            <div className="flex items-center justify-between mb-1">
              <div className="label !mb-0">Look</div>
              {activeStyle && <div className="text-muted text-xs">{activeStyle.bestFor}</div>}
            </div>
            <p className="text-muted text-xs mb-3">
              This is the art direction, not the subject — it decides whether the image reads as a photograph, a poster, or a render.
            </p>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {STUDIO_STYLES.map((s) => {
                const active = styleId === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyleId(s.id)}
                    className="text-left rounded-lg overflow-hidden transition-all"
                    style={{
                      border: `1.5px solid ${active ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                      background: active ? 'var(--fill-secondary)' : 'var(--fill-tertiary)',
                    }}
                  >
                    <div
                      className="w-full flex items-center justify-center"
                      style={{ aspectRatio: '4 / 3', background: 'var(--fill-tertiary)' }}
                    >
                      {s.thumbnail ? (
                        <img src={s.thumbnail} alt={s.label} className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon size={18} className="text-muted" />
                      )}
                    </div>
                    <div className="px-2.5 py-2">
                      <div className="text-xs font-semibold">{s.label}</div>
                      <div className="text-muted text-[10.5px] leading-snug mt-0.5">{s.bestFor}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </Panel>

          {/* --- Output settings -------------------------------------------- */}
          <Panel className="space-y-4">
            <div>
              <div className="label mb-2">Platform</div>
              <div className="flex gap-2 flex-wrap">
                {STUDIO_PLATFORMS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className="rounded-full"
                    style={{
                      padding: 4,
                      background: platform === p ? 'var(--fill-primary)' : 'var(--fill-tertiary)',
                      outline: platform === p ? '2px solid var(--accent-green)' : '1px solid var(--border-subtle)',
                      outlineOffset: -1,
                    }}
                  >
                    <PlatformBadge platform={p} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="label mb-2">Shape</div>
              <div className="flex gap-2 flex-wrap items-center">
                {(activeModel?.aspectRatios ?? ASPECT_RATIOS).map((r) => (
                  <Chip key={r} active={ratio === r} onClick={() => { setRatio(r); setRatioTouched(true) }}>{r}</Chip>
                ))}
                <span
                  className="ml-1 rounded"
                  style={{ width: 26 * RATIO_VALUE[ratio], height: 26, background: 'var(--fill-secondary)', border: '1px solid var(--border-subtle)' }}
                  aria-hidden
                />
              </div>
            </div>

            <div>
              <div className="label mb-2">Model</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
                {IMAGE_MODELS.map((m) => {
                  const active = model === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!m.available}
                      onClick={() => setModel(m.id)}
                      className="text-left px-3 py-2 rounded-lg transition-all disabled:cursor-not-allowed"
                      style={{
                        border: `1.5px solid ${active ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                        background: active ? 'var(--fill-secondary)' : 'var(--fill-tertiary)',
                        opacity: m.available ? 1 : 0.45,
                      }}
                      title={m.available ? m.blurb : 'Needs the Higgsfield API key'}
                    >
                      <div className="text-xs font-semibold">{m.label}</div>
                      <div className="text-muted text-[11px] leading-snug mt-0.5">{m.blurb}</div>
                      <div className="text-[10.5px] font-semibold mt-1" style={{ color: 'var(--accent-green)' }}>
                        {m.pricePerImage != null ? `~$${m.pricePerImage.toFixed(3)} / image` : m.priceNote}
                      </div>
                    </button>
                  )
                })}
              </div>
              {!HIGGSFIELD_ENABLED && (
                <p className="text-muted text-xs mt-2">
                  Higgsfield models unlock once its API key is added — create one at cloud.higgsfield.ai (it issues a Key ID + Secret) and send both over.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="label !mb-0">How many options</div>
                <CostEstimate model={activeModel} ratio={ratio} variantCount={variantCount} />
              </div>
              <div className="flex gap-2">
                {[1, 2, 3, 4].filter((n) => n <= (activeModel?.maxVariants ?? 4)).map((n) => (
                  <Chip key={n} active={variantCount === n} onClick={() => setVariantCount(n)}>{n}</Chip>
                ))}
              </div>
            </div>

            {activeModel?.supportsReference && (
              <div>
                <div className="label mb-2">Reference image</div>
                {referenceImageUrl ? (
                  <div className="relative w-24 h-24">
                    <img src={referenceImageUrl} alt="Reference" className="w-24 h-24 object-cover rounded-lg" />
                    <button
                      type="button"
                      onClick={() => setReferenceImageUrl(null)}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full flex items-center justify-center text-white"
                      style={{ background: 'var(--accent-orange)' }}
                      aria-label="Remove reference image"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <AssetUploader pathPrefix={`studio-refs/${profile.id}`} label="Upload a reference" onUploaded={setReferenceImageUrl} />
                )}
                <p className="text-muted text-xs mt-1.5">The generated image copies this one's look, not its content.</p>
              </div>
            )}

            {activeModel?.supportsCharacter && (
              <div>
                <div className="label mb-2">Character</div>
                <input
                  className="input"
                  value={characterId}
                  onChange={(e) => setCharacterId(e.target.value)}
                  placeholder="Higgsfield character id (UUID)"
                />
                <p className="text-muted text-xs mt-1.5">
                  Characters are created in Higgsfield itself; paste the id here to keep the same person across posts.
                </p>
              </div>
            )}
          </Panel>

          <div className="flex justify-end">
            <Button onClick={onBrief} loading={briefing} disabled={!canBrief}>
              <Sparkles size={15} /> Write the brief
            </Button>
          </div>

          {/* --- Recent jobs ------------------------------------------------ */}
          {jobs.length > 0 && (
            <Panel>
              <div className="label mb-3">Recent</div>
              <div className="space-y-2">
                {jobs.slice(0, 10).map((j) => (
                  <div key={j.id} className="flex items-center gap-3 text-sm">
                    <button onClick={() => onOpenJob(j)} className="flex-1 text-left truncate hover:text-sage">
                      {j.topic}
                    </button>
                    <Badge tone={j.status === 'done' ? 'green' : j.status === 'failed' ? 'orange' : 'grey'}>{j.status.replace(/_/g, ' ')}</Badge>
                    <button onClick={() => onDeleteJob(j.id)} className="text-muted hover:text-terracotta" title="Delete"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      ) : (
        // --- Draft review + results ---------------------------------------
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <PlatformBadge platform={job.platform} />
            <Badge tone="blue">{job.aspect_ratio}</Badge>
            {activeStyle && <Badge tone="orange">{activeStyle.label}</Badge>}
            <span className="text-muted text-xs">{job.topic}</span>
          </div>

          <Panel className="space-y-4">
            <div className="label !mb-0">Copy</div>
            <div>
              <label className="label">Hook</label>
              <input className="input mt-1.5" value={draftCopy.hook ?? ''} onChange={(e) => setDraftCopy({ ...draftCopy, hook: e.target.value })} />
            </div>
            <div>
              <label className="label">Body</label>
              <textarea className="input mt-1.5" rows={4} value={draftCopy.body ?? ''} onChange={(e) => setDraftCopy({ ...draftCopy, body: e.target.value })} />
            </div>
            <div>
              <label className="label">CTA</label>
              <input className="input mt-1.5" value={draftCopy.cta ?? ''} onChange={(e) => setDraftCopy({ ...draftCopy, cta: e.target.value })} />
            </div>
            <div>
              <label className="label">Hashtags</label>
              <input
                className="input mt-1.5"
                value={(draftCopy.hashtags ?? []).join(' ')}
                onChange={(e) => setDraftCopy({ ...draftCopy, hashtags: e.target.value.split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean) })}
              />
            </div>
          </Panel>

          <Panel>
            <div className="label mb-1">Image prompt</div>
            <p className="text-muted text-xs mb-2">
              The subject was written by AI from your source; the look comes from the style you picked. Edit either half before generating — nothing has been spent yet.
            </p>
            <textarea className="input" rows={5} value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)} />
            <div className="flex items-center justify-end gap-3 mt-3">
              <CostEstimate model={activeModel} ratio={ratio} variantCount={variantCount} />
              <Button onClick={onGenerate} loading={generating || isGenerating} disabled={!draftPrompt.trim()}>
                <Wand2 size={15} /> Generate {variantCount} {variantCount === 1 ? 'image' : 'images'}
              </Button>
            </div>
          </Panel>

          {isGenerating && (
            <div className="card p-8 flex flex-col items-center gap-3 text-center">
              <Spinner size={22} />
              <div className="text-sm text-secondary">Generating {job.variant_count} {job.variant_count === 1 ? 'option' : 'options'}…</div>
            </div>
          )}

          {isFailed && (
            <Panel className="flex items-start gap-3">
              <AlertTriangle size={18} style={{ color: 'var(--accent-orange)' }} className="shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium mb-1">Generation failed</div>
                <div className="text-secondary text-sm">{job.error_detail || 'Unknown error.'}</div>
              </div>
            </Panel>
          )}

          {isDone && job.image_urls.length > 0 && (
            <Panel>
              <div className="flex items-center justify-between mb-3">
                <div className="label !mb-0">Pick one</div>
                <button onClick={onGenerate} className="btn-ghost !py-1 !px-2 text-xs" disabled={generating}>
                  <RefreshCw size={12} /> Re-roll
                </button>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {job.image_urls.map((url) => {
                  const picked = job.selected_image_url === url
                  return (
                    <button
                      key={url}
                      type="button"
                      onClick={() => onPick(url)}
                      className="relative rounded-lg overflow-hidden transition-all"
                      style={{ border: `2px solid ${picked ? 'var(--accent-green)' : 'var(--border-subtle)'}` }}
                    >
                      <img src={url} alt="Generated option" className="w-full block" />
                      {picked && (
                        <span
                          className="absolute top-2 right-2 h-6 w-6 rounded-full flex items-center justify-center"
                          style={{ background: 'var(--accent-green)', color: 'var(--bg-primary)' }}
                        >
                          <Check size={14} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="flex justify-end mt-4">
                <Button onClick={onSendToReview} loading={sending} disabled={!job.selected_image_url || Boolean(job.content_item_id)}>
                  {job.content_item_id ? 'Already sent' : <>Send to Review <ArrowRight size={15} /></>}
                </Button>
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}
