import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, RefreshCw, ImageIcon, Video, FileText, CheckCircle2, XCircle, Copy, Check, Filter, Hash, Megaphone } from 'lucide-react'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import { getLatestStrategy, type MarketingStrategy } from '../lib/strategy'
import {
  getLatestRun, listItemsForRun, triggerContentGeneration, triggerCarousel,
  IMAGE_CONTENT_TYPES, VIDEO_CONTENT_TYPES, GENERATION_ENABLED,
  type ContentRun, type ContentItem,
} from '../lib/content'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel } from '../components/ui'

const PLATFORM_TONE: Record<string, 'green' | 'blue' | 'orange'> = {
  linkedin: 'blue', instagram: 'green', facebook: 'blue', youtube: 'orange',
}

const PLATFORM_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'youtube', label: 'YouTube' },
]

// Per-type badge tint — ScalePods' own accent tokens rotated across the generic types, plus
// LinkedIn's real brand blue for the one type actually tied to that platform (already used
// this same way in mediaUi.tsx's PlatformBadge — not a new invented color).
const CONTENT_TYPE_COLOR: Record<string, string> = {
  static_image: 'var(--accent-green)',
  carousel: 'var(--accent-blue)',
  social_caption: 'var(--accent-orange)',
  linkedin_article: '#0A66C2',
  story: 'var(--accent-green)',
  ugc_video: 'var(--accent-orange)',
  motion_graphics: 'var(--accent-blue)',
  product_video: 'var(--accent-green)',
}

function typeColor(type: string) {
  return CONTENT_TYPE_COLOR[type] ?? 'var(--fill-tertiary)'
}

function FilterBar({
  platform, onPlatform, type, onType, typeOptions,
}: {
  platform: string
  onPlatform: (v: string) => void
  type: string
  onType: (v: string) => void
  typeOptions: string[]
}) {
  const hasFilter = platform !== 'all' || type !== 'all'
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter size={14} className="text-muted shrink-0" />
      <select className="input !w-auto !py-1.5 text-xs" value={platform} onChange={(e) => onPlatform(e.target.value)}>
        <option value="all">All platforms</option>
        {PLATFORM_OPTIONS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      <select className="input !w-auto !py-1.5 text-xs" value={type} onChange={(e) => onType(e.target.value)}>
        <option value="all">All content types</option>
        {typeOptions.map((t) => (
          <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
        ))}
      </select>
      {hasFilter && (
        <button
          onClick={() => { onPlatform('all'); onType('all') }}
          className="text-xs text-muted hover:text-sage"
        >
          Clear
        </button>
      )}
    </div>
  )
}

function ItemCard({ item, onCarousel }: { item: ContentItem; onCarousel: (id: string) => void }) {
  const isImage = IMAGE_CONTENT_TYPES.includes(item.content_type)
  const isVideo = VIDEO_CONTENT_TYPES.includes(item.content_type)
  const isCarousel = item.content_type === 'carousel'
  const waitingOnImage = isImage && !item.media_url && item.status !== 'failed'
  const [firingCarousel, setFiringCarousel] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const color = typeColor(item.content_type)
  const hashtags = item.metadata?.hashtags ?? []
  const bodyLong = (item.body?.length ?? 0) > 240

  async function onCopy() {
    const tags = hashtags.join(' ')
    const text = [item.body, tags].filter(Boolean).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — silently no-op.
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Badge tone={PLATFORM_TONE[item.platform?.toLowerCase()] ?? 'blue'}>{item.platform}</Badge>
        <span
          className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white capitalize"
          style={{ background: color }}
        >
          {item.content_type.replace(/_/g, ' ')}
        </span>
        {item.scheduled_date && <span className="text-muted text-xs">{item.scheduled_date}</span>}
        <button
          onClick={onCopy}
          className="ml-auto text-muted hover:text-sage transition-colors"
          title="Copy caption + hashtags"
        >
          {copied ? <Check size={14} className="text-sage" /> : <Copy size={14} />}
        </button>
      </div>

      {item.media_url ? (
        <img src={item.media_url} alt={item.title ?? ''} className="w-full h-40 object-cover rounded-lg mb-3" />
      ) : waitingOnImage ? (
        <div className="w-full h-40 rounded-lg panel flex flex-col items-center justify-center gap-2 mb-3">
          <Spinner size={18} />
          <span className="text-muted text-xs">Generating image…</span>
        </div>
      ) : isVideo ? (
        <div className="w-full h-40 rounded-lg panel flex flex-col items-center justify-center gap-2 mb-3">
          <Video size={20} className="text-terracotta" />
          <span className="text-muted text-xs text-center px-4">Manual video — trigger HeyGen/fal.ai in n8n</span>
        </div>
      ) : (
        <div className="w-full h-24 rounded-lg panel flex items-center justify-center gap-2 mb-3">
          <FileText size={18} className="text-muted" />
        </div>
      )}

      {isCarousel && item.metadata?.slides && item.metadata.slides.length > 0 && (
        <div className="flex gap-1.5 mb-3 overflow-x-auto">
          {item.metadata.slides.map((s) => (
            <img key={s.idx} src={s.url} alt={s.title} className="h-14 w-14 object-cover rounded shrink-0" />
          ))}
        </div>
      )}

      <div className="font-medium text-sm mb-1">{item.title}</div>
      <div className={expanded ? 'text-secondary text-sm whitespace-pre-wrap' : 'text-secondary text-sm line-clamp-3'}>
        {item.body}
      </div>
      {bodyLong && (
        <button onClick={() => setExpanded((e) => !e)} className="text-xs text-sage hover:underline mt-1">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {hashtags.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-2">
          {hashtags.slice(0, 8).map((h, i) => (
            <span key={i} className="text-xs flex items-center" style={{ color }}>
              <Hash size={10} className="shrink-0" />{h.replace(/^#/, '')}
            </span>
          ))}
        </div>
      )}

      {item.metadata?.cta && (
        <div className="text-xs text-secondary panel !p-2 mt-2.5 flex items-center gap-1.5">
          <Megaphone size={13} style={{ color }} className="shrink-0" />
          <span><b className="text-ink">CTA:</b> {item.metadata.cta}</span>
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-1.5 text-xs">
          {item.status === 'failed' ? (
            <><XCircle size={13} className="text-terracotta" /> <span className="text-terracotta">Failed</span></>
          ) : item.status === 'ready' ? (
            <><CheckCircle2 size={13} className="text-sage" /> <span className="text-muted">Ready for review</span></>
          ) : (
            <span className="text-muted capitalize">{item.status}</span>
          )}
        </div>
        {isCarousel && !item.metadata?.slides?.length && (
          <Button
            variant="ghost"
            className="!py-1 !px-2 text-xs"
            loading={firingCarousel}
            onClick={async () => {
              setFiringCarousel(true)
              await onCarousel(item.id)
              setFiringCarousel(false)
            }}
          >
            <ImageIcon size={13} /> Generate slides
          </Button>
        )}
      </div>
    </div>
  )
}

export default function ContentFactory() {
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [strategy, setStrategy] = useState<MarketingStrategy | null>(null)
  const [run, setRun] = useState<ContentRun | null>(null)
  const [items, setItems] = useState<ContentItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [platformFilter, setPlatformFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (profileId: string) => {
    const r = await getLatestRun(profileId)
    setRun(r)
    setItems(r ? await listItemsForRun(r.id) : [])
    return r
  }, [])

  useEffect(() => {
    listProfiles().then(async (profiles) => {
      const p = profiles[0] ?? null
      setProfile(p)
      if (p) {
        setStrategy(await getLatestStrategy(p.id))
        await load(p.id)
      }
    })
  }, [load])

  // Poll while text generation is still filling in items, or any image-eligible item
  // is still waiting on its gpt-image-1 render.
  useEffect(() => {
    if (!profile || !run) return
    const stillWaitingOnText = items.length < run.total_items
    const stillWaitingOnImages = items.some(
      (it) => IMAGE_CONTENT_TYPES.includes(it.content_type) && !it.media_url && it.status !== 'failed',
    )
    const active = stillWaitingOnText || stillWaitingOnImages
    if (active && !pollRef.current) {
      pollRef.current = setInterval(() => load(profile.id), 4000)
    } else if (!active && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [profile, run, items, load])

  async function onGenerate() {
    if (!profile) return
    setGenerating(true)
    await triggerContentGeneration(profile.id)
    setTimeout(() => load(profile.id), 2000)
    setGenerating(false)
  }

  async function onCarousel(itemId: string) {
    await triggerCarousel(itemId)
    if (profile) setTimeout(() => load(profile.id), 2000)
  }

  if (profile === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    )
  }

  if (!profile) {
    return (
      <div>
        <PageHeader accent={<Badge><Sparkles size={12} /> Content Factory</Badge>} title="Content Factory" />
        <EmptyState icon={<Sparkles size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  if (!strategy || strategy.status !== 'approved') {
    return (
      <div>
        <PageHeader accent={<Badge><Sparkles size={12} /> Content Factory</Badge>} title="Content Factory" />
        <EmptyState
          icon={<Sparkles size={28} />}
          title="Approve a strategy first"
          hint="The Content Factory reads the approved calendar. Go to Strategy and approve one before generating content."
        />
        <div className="flex justify-center mt-4">
          <Link to="/strategy" className="btn-primary">Go to Strategy</Link>
        </div>
      </div>
    )
  }

  const textDone = run ? items.length >= run.total_items : false
  const pendingCount = run ? Math.max(run.total_items - items.length, 0) : 0
  // Content-type options are scoped to whichever platform is currently selected, so the
  // dropdown never offers a type that platform doesn't actually have (e.g. no "linkedin
  // article" while "Instagram" is selected).
  const typeOptions = Array.from(
    new Set(items.filter((i) => platformFilter === 'all' || i.platform?.toLowerCase() === platformFilter).map((i) => i.content_type)),
  ).sort()
  const filteredItems = items.filter(
    (i) =>
      (platformFilter === 'all' || i.platform?.toLowerCase() === platformFilter) &&
      (typeFilter === 'all' || i.content_type === typeFilter),
  )

  function onPlatformFilterChange(v: string) {
    setPlatformFilter(v)
    const nextOptions = new Set<string>(items.filter((i) => v === 'all' || i.platform?.toLowerCase() === v).map((i) => i.content_type))
    if (typeFilter !== 'all' && !nextOptions.has(typeFilter)) setTypeFilter('all')
  }

  return (
    <div>
      <PageHeader
        accent={<Badge><Sparkles size={12} /> Content Factory</Badge>}
        title={`Content Factory — ${profile.business_name}`}
        subtitle="GPT-4o copy + gpt-image-1 images + brand overlay, generated from the approved calendar. Video is manual-only — never auto-generated."
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {textDone && items.length > 0 && (
              <FilterBar
                platform={platformFilter}
                onPlatform={onPlatformFilterChange}
                type={typeFilter}
                onType={setTypeFilter}
                typeOptions={typeOptions}
              />
            )}
            <Button variant="ghost" onClick={onGenerate} loading={generating} disabled={!GENERATION_ENABLED}>
              <RefreshCw size={15} /> {run ? 'Regenerate' : 'Generate content'}
            </Button>
          </div>
        }
      />

      {!run ? (
        <EmptyState icon={<Sparkles size={28} />} title="No content yet" hint="Click Generate content to turn the approved calendar into ready-to-review posts." />
      ) : !textDone ? (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <Spinner size={22} />
          <div className="text-sm text-secondary">
            Writing copy — {items.length}/{run.total_items} posts{pendingCount > 0 ? ` (${pendingCount} remaining)` : ''}…
          </div>
          <div className="w-full max-w-xs h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--fill-tertiary)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${run.total_items ? Math.round((items.length / run.total_items) * 100) : 0}%`,
                background: 'var(--accent-green)',
              }}
            />
          </div>
        </div>
      ) : (
        <>
          <Panel className="mb-5 flex items-center gap-3">
            <CheckCircle2 size={18} className="text-sage" />
            <span className="text-sm text-secondary">
              {items.length} posts generated. Images and brand overlay fill in automatically — video items are stubbed for manual generation.
            </span>
          </Panel>
          {filteredItems.length === 0 ? (
            <EmptyState icon={<Filter size={28} />} title="No posts match these filters" hint="Try a different platform or content type." />
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => (
                <ItemCard key={item.id} item={item} onCarousel={onCarousel} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
