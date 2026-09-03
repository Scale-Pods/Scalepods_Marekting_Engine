import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Wand2, Sparkles, RefreshCw, Check, X, ImageIcon, TrendingUp, Target, Type,
  ArrowRight, Trash2, AlertTriangle, ExternalLink,
} from 'lucide-react'
import { useProfile } from '../lib/queries'
import { listSignalsSince, type TrendSignal } from '../lib/trends'
import {
  generateStudioBrief, triggerStudioGenerate, updateStudioDraft, listStudioJobs, getStudioJob,
  selectStudioVariant, markStudioJobUsed, deleteStudioJob,
  IMAGE_MODELS, getModel, estimateStudioCost, formatUsdInr,
  type StudioJob, type StudioSourceKind, type ImageModelId, type StudioCopy,
} from '../lib/studio'
import {
  STUDIO_STYLES, styleDirection, getStyle, ASPECT_RATIOS, RATIO_VALUE, PLATFORM_DEFAULT_RATIO,
  type AspectRatio,
} from '../lib/studioStyles'
import { createManualItem, GENERATION_ENABLED } from '../lib/content'
import { stampAndUpload } from '../lib/brandStamp'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel, Modal } from '../components/ui'
import { PlatformBadge } from '../components/mediaUi'
import { PostPreviewModal } from '../components/postPreview'
import AssetUploader from '../components/AssetUploader'
import { useToast, toastMessage } from '../components/Toast'

// Quick links to each provider's own billing dashboard — there's no API that can read a real
// credit balance with the keys this app holds (checked both providers' official docs
// 2026-09-03: OpenAI has no balance endpoint reachable with a normal API key at all; Google's
// Gemini API key can't read Cloud Billing either, that needs a separate service-account+BigQuery
// setup). Linking to the real dashboards is the honest version of "show me what's left."
const OPENAI_BILLING_URL = 'https://platform.openai.com/settings/organization/billing/overview'
const GOOGLE_AI_STUDIO_URL = 'https://aistudio.google.com/'

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
  const { usd } = estimateStudioCost(model, ratio, variantCount)
  if (usd == null) return null
  return (
    <span
      className="text-[11px] font-semibold"
      style={{ color: 'var(--accent-orange)' }}
      title="Providers bill by tokens/compute, not a flat per-image rate — this is an estimate, not a guaranteed cost."
    >
      ≈ {formatUsdInr(usd)} for {variantCount} {variantCount === 1 ? 'image' : 'images'} (est.)
    </span>
  )
}

/** What a past job actually cost — same `estimateStudioCost` math the setup screen shows before
 *  Generate is even clickable, but run against what was actually fired: the real image count
 *  once there's a result, not just the requested count, so a job that failed partway or a
 *  Gemini job (capped to 1 regardless of what was requested) shows the real number. `null` before
 *  anything's actually been generated — nothing's been spent yet at that point. */
function jobCostEstimate(j: StudioJob): number | null {
  if (j.status === 'drafting' || j.status === 'draft_ready') return null
  const model = getModel(j.model)
  if (!model) return null
  const count = j.image_urls.length > 0 ? j.image_urls.length : j.variant_count
  return estimateStudioCost(model, (j.aspect_ratio as AspectRatio) ?? '1:1', count).usd
}

/** "3 Sep, 2:41 PM" — compact enough for a grid tile, still unambiguous about date vs. time. */
function formatJobDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
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
  // A job opened from the "Recent" grid opens as its own overlay (RecentJobModal below) rather
  // than replacing this page's state the way the in-flow `job` above does — closing it (✕) just
  // removes the overlay, so the setup screen underneath is exactly as the user left it. That's
  // the "no back option" fix: there's nothing to navigate back from in the first place.
  const [modalJob, setModalJob] = useState<StudioJob | null>(null)
  // Full-size view for a variant in the *inline* generate flow — clicking an image now expands
  // it instead of picking it; picking has its own small checkmark button on the tile.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Local edits to the draft, so typing stays responsive and only persists on generate.
  const [draftCopy, setDraftCopy] = useState<StudioCopy>({})
  const [draftPrompt, setDraftPrompt] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeModel = getModel(model)
  const activeStyle = getStyle(styleId)

  // Deep-linked here rather than running a separate one-shot generator, so there's exactly one
  // generation engine — from Trends' "Create Post" (a specific trend) or from a Recent strategy
  // generation's calendar item (a specific planned post, see StrategyGenerationModal).
  useEffect(() => {
    const state = location.state as { signalId?: string; topic?: string; platform?: string } | null
    if (state?.signalId) {
      setSourceKind('trend')
      setSignalId(state.signalId)
      if (state.topic) setTopic(state.topic)
    } else if (state?.topic) {
      setSourceKind('topic')
      setTopic(state.topic)
      if (state.platform) setPlatform(state.platform)
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
        // AI-written copy + a generated image — this is a draft, not a finished manual post, so
        // it needs an actual human pass in Creative Review before it's publishable. Passing
        // 'approved' (the default) was the bug: it skipped review entirely and landed straight
        // in Publishing's ready list even though we navigate to /review right after.
        status: 'ready',
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

  async function onDeleteJob(id: string) {
    await deleteStudioJob(id)
    setJobs((prev) => prev.filter((j) => j.id !== id))
    if (job?.id === id) setJob(null)
    if (modalJob?.id === id) setModalJob(null)
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

      {/* No API can read a real credit balance with the keys this app holds — these just jump
          straight to each provider's own billing dashboard. See the const comment above. */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-muted text-[11px] font-semibold uppercase tracking-wide">Account credit</span>
        <a
          href={OPENAI_BILLING_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors"
          style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
        >
          OpenAI billing <ExternalLink size={11} />
        </a>
        <a
          href={GOOGLE_AI_STUDIO_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5 transition-colors"
          style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
        >
          Google AI Studio billing <ExternalLink size={11} />
        </a>
      </div>

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
                      title={m.available ? m.blurb : 'Not yet verified against a real generation'}
                    >
                      <div className="text-xs font-semibold">{m.label}</div>
                      <div className="text-muted text-[11px] leading-snug mt-0.5">{m.blurb}</div>
                      <div
                        className="text-[10.5px] font-semibold mt-1"
                        style={{ color: 'var(--accent-green)' }}
                        title={m.priceNote}
                      >
                        {`~${formatUsdInr(m.pricePerImage)} / image (est.)`}
                      </div>
                    </button>
                  )
                })}
              </div>
              {/* Every provider here bills by tokens/compute under the hood, not a flat
                  per-image rate — OpenAI's own price already varies by ratio, and a live test
                  showed Gemini's real output differs from what its docs describe. Said once,
                  here, rather than repeated per model card. */}
              <p className="text-muted text-[10.5px] mt-2">
                Prices are estimates, not a guaranteed rate — check your provider's real invoice for exact cost.
              </p>
              {IMAGE_MODELS.some((m) => !m.available) && (
                <p className="text-muted text-xs mt-2">
                  Greyed-out models are wired in but not yet verified against a real generation — they'll light up once tested.
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
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {jobs.slice(0, 12).map((j) => {
                  const thumb = j.selected_image_url || j.image_urls?.[0] || null
                  const jModel = getModel(j.model)
                  const jCost = jobCostEstimate(j)
                  return (
                    <div
                      key={j.id}
                      className="relative rounded-lg overflow-hidden group text-left"
                      style={{ border: '1px solid var(--border-subtle)', background: 'var(--fill-tertiary)' }}
                    >
                      <button type="button" onClick={() => setModalJob(j)} className="block w-full text-left">
                        <div className="w-full flex items-center justify-center" style={{ aspectRatio: '1 / 1', background: 'var(--fill-tertiary)' }}>
                          {thumb ? (
                            <img src={thumb} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon size={20} className="text-muted" />
                          )}
                        </div>
                        <div className="px-2.5 py-2">
                          <div className="text-xs font-medium truncate">{j.topic || 'Untitled'}</div>
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <Badge tone={j.status === 'done' ? 'green' : j.status === 'failed' ? 'orange' : 'grey'}>{j.status.replace(/_/g, ' ')}</Badge>
                          </div>
                          <div className="text-muted text-[10px] mt-1 truncate">{formatJobDate(j.created_at)}</div>
                          <div className="text-muted text-[10px] truncate" title={jModel?.label ?? j.model}>
                            {jModel?.label ?? j.model}{jCost != null ? ` · ${formatUsdInr(jCost)} (est.)` : ''}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDeleteJob(j.id) }}
                        className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: 'rgba(0,0,0,0.55)' }}
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
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
                    <div
                      key={url}
                      className="relative rounded-lg overflow-hidden transition-all"
                      style={{ border: `2px solid ${picked ? 'var(--accent-green)' : 'var(--border-subtle)'}` }}
                    >
                      {/* Click the image itself to view it full-size — picking is the separate
                          checkmark button below, so "look closer" and "choose this one" don't
                          fight over the same click. */}
                      <button type="button" onClick={() => setLightboxUrl(url)} className="block w-full">
                        <img src={url} alt="Generated option" className="w-full block" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onPick(url)}
                        className="absolute top-2 right-2 h-7 w-7 rounded-full flex items-center justify-center transition-colors"
                        style={{ background: picked ? 'var(--accent-green)' : 'rgba(0,0,0,0.55)', color: picked ? 'var(--bg-primary)' : '#fff' }}
                        title={picked ? 'Selected' : 'Use this one'}
                      >
                        <Check size={14} />
                      </button>
                    </div>
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

      {lightboxUrl && (
        <PostPreviewModal
          img={lightboxUrl}
          platform={platform}
          caption={[draftCopy.hook, draftCopy.body].filter(Boolean).join('\n\n')}
          hashtags={draftCopy.hashtags}
          onClose={() => setLightboxUrl(null)}
          footer={
            <Button
              className="w-full justify-center !py-2 text-xs"
              onClick={() => { onPick(lightboxUrl); setLightboxUrl(null) }}
            >
              <Check size={13} /> Use this image
            </Button>
          }
        />
      )}

      {modalJob && (
        <RecentJobModal
          job={modalJob}
          onClose={() => setModalJob(null)}
          onDelete={onDeleteJob}
          onSentToReview={(jobId, itemId) => {
            setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, content_item_id: itemId } : j)))
          }}
        />
      )}
    </div>
  )
}

// A "Recent" job opened as its own overlay — copy fields, the variant grid (pick + expand), and
// Send to Review, all self-contained so it never touches the setup screen's state underneath.
// Closing it (✕, from the shared Modal component) just removes the overlay; there's nothing to
// navigate "back" from.
function RecentJobModal({
  job, onClose, onDelete, onSentToReview,
}: {
  job: StudioJob
  onClose: () => void
  onDelete: (id: string) => Promise<void>
  onSentToReview: (jobId: string, itemId: string) => void
}) {
  const { data: profile } = useProfile()
  const toast = useToast()
  const navigate = useNavigate()
  const [current, setCurrent] = useState(job)
  const [copy, setCopy] = useState<StudioCopy>(job.copy_json ?? {})
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const activeStyle = current.style_id ? getStyle(current.style_id) : null

  // Same reasoning as the inline poller in the main component — a job can still be mid-generation
  // when opened from Recent (e.g. the user navigated away and came back).
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (current.status === 'generating' && !pollRef.current) {
      pollRef.current = setInterval(() => {
        getStudioJob(current.id).then((fresh) => { if (fresh) setCurrent(fresh) })
      }, 3000)
    } else if (current.status !== 'generating' && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [current.status, current.id])

  async function onPick(url: string) {
    await selectStudioVariant(current.id, url)
    setCurrent((c) => ({ ...c, selected_image_url: url }))
  }

  async function onSend() {
    if (!profile || !current.selected_image_url) return
    setSending(true)
    try {
      const { url, stamped } = await stampAndUpload(current.selected_image_url, `studio/${current.id}/branded`)
      const item = await createManualItem({
        profileId: profile.id,
        platform: current.platform,
        contentType: 'static_image',
        title: (copy.hook || current.topic || '').slice(0, 60) || null,
        body: [copy.body, copy.cta].filter(Boolean).join('\n\n'),
        mediaUrl: url,
        slides: [],
        hashtags: copy.hashtags ?? [],
        cta: copy.cta ?? '',
        scheduledDate: null,
        scheduledTime: null,
        scheduledAt: null,
        linkedinAccount: null,
        status: 'ready',
      })
      await markStudioJobUsed(current.id, item.id)
      setCurrent((c) => ({ ...c, content_item_id: item.id }))
      onSentToReview(current.id, item.id)
      toast.info(stamped ? 'Sent to Creative Review, brand-stamped.' : 'Sent to Creative Review (logo could not be loaded, image is unstamped).')
    } catch (err) {
      toast.error(toastMessage(err, 'Could not send this post to review'))
    } finally {
      setSending(false)
    }
  }

  async function onDeleteClick() {
    if (!window.confirm('Delete this generated post? This cannot be undone.')) return
    setDeleting(true)
    try {
      await onDelete(current.id)
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  const hasCopy = current.status === 'draft_ready' || current.status === 'generating' || current.status === 'done' || current.status === 'failed'
  const activeModel = getModel(current.model)
  const cost = jobCostEstimate(current)

  return (
    <>
      <Modal title={current.topic || 'Generated post'} onClose={onClose} size="xl">
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <PlatformBadge platform={current.platform} />
            <Badge tone="blue">{current.aspect_ratio}</Badge>
            {activeStyle && <Badge tone="orange">{activeStyle.label}</Badge>}
            <Badge tone={current.status === 'done' ? 'green' : current.status === 'failed' ? 'orange' : 'grey'}>
              {current.status.replace(/_/g, ' ')}
            </Badge>
          </div>

          {/* Timestamp, model, and what it actually cost — the info the grid tile only has room
              to abbreviate. */}
          <div
            className="grid gap-x-4 gap-y-1.5 text-xs px-3 py-2.5 rounded-lg"
            style={{ gridTemplateColumns: 'auto 1fr', background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
          >
            <span className="text-muted">Created</span>
            <span title={new Date(current.created_at).toString()}>{formatJobDate(current.created_at)}</span>
            <span className="text-muted">Model</span>
            <span>{activeModel?.label ?? current.model}</span>
            <span className="text-muted">Options</span>
            <span>
              {current.image_urls.length > 0 ? `${current.image_urls.length} generated` : `${current.variant_count} requested`}
            </span>
            <span className="text-muted">Spent (est.)</span>
            <span title="Providers bill by tokens/compute, not a flat per-image rate — this is an estimate, not a guaranteed cost.">
              {cost != null ? formatUsdInr(cost) : 'Not generated yet'}
            </span>
          </div>

          {hasCopy && (
            <div className="space-y-3">
              <div className="label !mb-0">Copy</div>
              <div>
                <label className="label">Hook</label>
                <input className="input mt-1.5" value={copy.hook ?? ''} onChange={(e) => setCopy({ ...copy, hook: e.target.value })} />
              </div>
              <div>
                <label className="label">Body</label>
                <textarea className="input mt-1.5" rows={3} value={copy.body ?? ''} onChange={(e) => setCopy({ ...copy, body: e.target.value })} />
              </div>
              <div>
                <label className="label">CTA</label>
                <input className="input mt-1.5" value={copy.cta ?? ''} onChange={(e) => setCopy({ ...copy, cta: e.target.value })} />
              </div>
              <div>
                <label className="label">Hashtags</label>
                <input
                  className="input mt-1.5"
                  value={(copy.hashtags ?? []).join(' ')}
                  onChange={(e) => setCopy({ ...copy, hashtags: e.target.value.split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean) })}
                />
              </div>
            </div>
          )}

          {current.status === 'generating' && (
            <div className="card p-6 flex flex-col items-center gap-3 text-center">
              <Spinner size={20} />
              <div className="text-sm text-secondary">Still generating…</div>
            </div>
          )}

          {current.status === 'failed' && (
            <Panel className="flex items-start gap-3">
              <AlertTriangle size={18} style={{ color: 'var(--accent-orange)' }} className="shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-medium mb-1">Generation failed</div>
                <div className="text-secondary text-sm">{current.error_detail || 'Unknown error.'}</div>
              </div>
            </Panel>
          )}

          {current.status === 'done' && current.image_urls.length > 0 && (
            <div>
              <div className="label mb-2">Pick one</div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {current.image_urls.map((url) => {
                  const picked = current.selected_image_url === url
                  return (
                    <div key={url} className="relative rounded-lg overflow-hidden" style={{ border: `2px solid ${picked ? 'var(--accent-green)' : 'var(--border-subtle)'}` }}>
                      <button type="button" onClick={() => setLightboxUrl(url)} className="block w-full">
                        <img src={url} alt="Generated option" className="w-full block" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onPick(url)}
                        className="absolute top-2 right-2 h-6 w-6 rounded-full flex items-center justify-center transition-colors"
                        style={{ background: picked ? 'var(--accent-green)' : 'rgba(0,0,0,0.55)', color: picked ? 'var(--bg-primary)' : '#fff' }}
                        title={picked ? 'Selected' : 'Use this one'}
                      >
                        <Check size={13} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-5 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={onDeleteClick} disabled={deleting} className="text-muted hover:text-terracotta text-xs flex items-center gap-1.5">
            <Trash2 size={13} /> Delete
          </button>
          {current.status === 'done' && (
            current.content_item_id ? (
              <Button variant="ghost" onClick={() => { onClose(); navigate('/review') }}>
                Open in Creative Review <ArrowRight size={14} />
              </Button>
            ) : (
              <Button onClick={onSend} loading={sending} disabled={!current.selected_image_url}>
                Send to Review <ArrowRight size={14} />
              </Button>
            )
          )}
        </div>
      </Modal>

      {lightboxUrl && (
        <PostPreviewModal
          img={lightboxUrl}
          platform={current.platform}
          caption={[copy.hook, copy.body].filter(Boolean).join('\n\n')}
          hashtags={copy.hashtags}
          onClose={() => setLightboxUrl(null)}
          footer={
            <Button
              className="w-full justify-center !py-2 text-xs"
              onClick={() => { onPick(lightboxUrl); setLightboxUrl(null) }}
            >
              <Check size={13} /> Use this image
            </Button>
          }
        />
      )}
    </>
  )
}
