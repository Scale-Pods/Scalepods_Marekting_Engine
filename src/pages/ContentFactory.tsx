import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, RefreshCw, ImageIcon, Video, FileText, CheckCircle2, XCircle, Copy, Check, Filter, Megaphone, Plus } from 'lucide-react'
import { getLatestStrategy, type MarketingStrategy } from '../lib/strategy'
import { useProfile, useLatestRun, useRunItems } from '../lib/queries'
import {
  triggerContentGeneration, triggerCarousel,
  IMAGE_CONTENT_TYPES, VIDEO_CONTENT_TYPES, GENERATION_ENABLED, isActivePlatform,
  type ContentItem,
} from '../lib/content'
import { PageHeader, Badge, Button, EmptyState, Spinner, Panel } from '../components/ui'
import { PLATFORM_OPTIONS } from '../components/mediaUi'
import { useToast, toastMessage } from '../components/Toast'
import { PostTile, PostPreviewModal, ContentTypeChip, typeColor } from '../components/postPreview'
import CreatePostModal from '../components/CreatePostModal'

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

// Footer actions inside the click-through preview — copy caption+hashtags, and generate
// carousel slides for items that need it. Same actions ItemCard used to run inline.
function ItemPreviewFooter({ item, onCarousel }: { item: ContentItem; onCarousel: (id: string) => void }) {
  const [copied, setCopied] = useState(false)
  const [firingCarousel, setFiringCarousel] = useState(false)
  const isCarousel = item.content_type === 'carousel'
  const hashtags = item.metadata?.hashtags ?? []
  const needsSlides = isCarousel && !item.metadata?.slides?.length

  async function onCopy() {
    const tags = hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')
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
    <div className="flex gap-2">
      <Button variant="ghost" className="flex-1 justify-center !py-2 text-xs" onClick={onCopy}>
        {copied ? <Check size={13} className="text-sage" /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy caption'}
      </Button>
      {needsSlides && (
        <Button
          variant="ghost"
          className="flex-1 justify-center !py-2 text-xs"
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
  )
}

export default function ContentFactory() {
  const [strategy, setStrategy] = useState<MarketingStrategy | null>(null)
  const [generating, setGenerating] = useState(false)
  const [platformFilter, setPlatformFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [composerOpen, setComposerOpen] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const toast = useToast()

  const { data: profile, isLoading: profileLoading } = useProfile()
  const { data: run = null, refetch: refetchRun } = useLatestRun(profile?.id)
  // Kept unfiltered — items.length is compared against run.total_items to know when text
  // generation is done, and total_items counts every calendar slot including any historical
  // youtube/facebook ones from before Content Text Engine stopped generating them. Filtering
  // here would make that comparison never resolve for older runs. Youtube/facebook items are
  // filtered out only where they're actually displayed, in filteredItems below.
  const { data: items = [], refetch: refetchItems } = useRunItems(run?.id)

  // Replaces the old 4s setInterval: Realtime pushes each content_items insert/update as the
  // Text and Image engines write them, so the grid fills in live with no polling at all.
  const load = useCallback(async (_profileId?: string) => {
    await Promise.all([refetchRun(), refetchItems()])
  }, [refetchRun, refetchItems])

  useEffect(() => {
    if (profile) getLatestStrategy(profile.id).then(setStrategy)
  }, [profile])

  async function onGenerate() {
    if (!profile) return
    setGenerating(true)
    try {
      await triggerContentGeneration(profile.id)
      toast.info('Generating content — posts will fill in as they are written.')
      setTimeout(() => load(profile.id), 2000)
    } catch (err) {
      toast.error(toastMessage(err, 'Could not start content generation'))
    } finally {
      setGenerating(false)
    }
  }

  async function onCarousel(itemId: string) {
    try {
      await triggerCarousel(itemId)
      toast.info('Generating carousel slides…')
      if (profile) setTimeout(() => load(profile.id), 2000)
    } catch (err) {
      toast.error(toastMessage(err, 'Could not generate carousel slides'))
    }
  }

  if (profileLoading) {
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
        <PageHeader
          accent={<Badge><Sparkles size={12} /> Content Factory</Badge>}
          title="Content Factory"
          actions={
            <Button variant="ghost" onClick={() => setComposerOpen(true)}>
              <Plus size={15} /> Create post
            </Button>
          }
        />
        <EmptyState
          icon={<Sparkles size={28} />}
          title="Approve a strategy first"
          hint="The Content Factory reads the approved calendar. Go to Strategy and approve one before generating content — or create a post manually with the button above."
        />
        <div className="flex justify-center mt-4">
          <Link to="/strategy" className="btn-primary">Go to Strategy</Link>
        </div>
        {composerOpen && (
          <CreatePostModal profileId={profile.id} onClose={() => setComposerOpen(false)} onCreated={() => setComposerOpen(false)} />
        )}
      </div>
    )
  }

  const textDone = run ? items.length >= run.total_items : false
  const pendingCount = run ? Math.max(run.total_items - items.length, 0) : 0
  // Content-type options are scoped to whichever platform is currently selected, so the
  // dropdown never offers a type that platform doesn't actually have (e.g. no "linkedin
  // article" while "Instagram" is selected).
  const typeOptions = Array.from(
    new Set(
      items
        .filter((i) => isActivePlatform(i.platform))
        .filter((i) => platformFilter === 'all' || i.platform?.toLowerCase() === platformFilter)
        .map((i) => i.content_type),
    ),
  ).sort()
  const filteredItems = items.filter(
    (i) =>
      isActivePlatform(i.platform) &&
      (platformFilter === 'all' || i.platform?.toLowerCase() === platformFilter) &&
      (typeFilter === 'all' || i.content_type === typeFilter),
  )
  const activeItem = previewIndex !== null ? filteredItems[previewIndex] : null

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
            <Button variant="ghost" onClick={() => setComposerOpen(true)}>
              <Plus size={15} /> Create post
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
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-1.5">
              {filteredItems.map((item, i) => {
                const isImage = IMAGE_CONTENT_TYPES.includes(item.content_type)
                const isVideo = VIDEO_CONTENT_TYPES.includes(item.content_type)
                const waitingOnImage = isImage && !item.media_url && item.status !== 'failed'
                const thumb = item.media_url || item.metadata?.slides?.[0]?.url || null
                return (
                  <PostTile
                    key={item.id}
                    img={thumb}
                    platform={item.platform}
                    topRight={<ContentTypeChip type={item.content_type} />}
                    busyNote={
                      waitingOnImage ? (
                        <>
                          <Spinner size={18} />
                          <span className="text-muted text-[10px]">Generating…</span>
                        </>
                      ) : undefined
                    }
                    placeholder={
                      isVideo ? (
                        <div className="flex flex-col items-center gap-1.5">
                          <Video size={18} className="text-terracotta" />
                          <span className="text-muted text-[10px] text-center px-2">Manual video</span>
                        </div>
                      ) : item.status === 'failed' ? (
                        <div className="flex flex-col items-center gap-1.5">
                          <XCircle size={18} className="text-terracotta" />
                          <span className="text-terracotta text-[10px]">Failed</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1.5">
                          <FileText size={18} className="text-muted" />
                          <span className="line-clamp-3">{item.title || item.body?.slice(0, 60)}</span>
                        </div>
                      )
                    }
                    onClick={() => setPreviewIndex(i)}
                  />
                )
              })}
            </div>
          )}
        </>
      )}

      {activeItem && (
        <PostPreviewModal
          img={activeItem.media_url || activeItem.metadata?.slides?.[0]?.url || null}
          slides={activeItem.metadata?.slides}
          hashtags={activeItem.metadata?.hashtags}
          platform={activeItem.platform}
          caption={activeItem.body}
          headerExtra={<ContentTypeChip type={activeItem.content_type} />}
          body={
            <>
              {activeItem.metadata?.cta && (
                <div className="text-xs text-secondary panel !p-2 flex items-center gap-1.5">
                  <Megaphone size={13} className="shrink-0" style={{ color: typeColor(activeItem.content_type) }} />
                  <span><b className="text-ink">CTA:</b> {activeItem.metadata.cta}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs">
                {activeItem.status === 'failed' ? (
                  <><XCircle size={13} className="text-terracotta" /> <span className="text-terracotta">Failed</span></>
                ) : activeItem.status === 'ready' ? (
                  <><CheckCircle2 size={13} className="text-sage" /> <span className="text-muted">Ready for review</span></>
                ) : (
                  <span className="text-muted capitalize">{activeItem.status}</span>
                )}
              </div>
            </>
          }
          footer={<ItemPreviewFooter item={activeItem} onCarousel={onCarousel} />}
          onClose={() => setPreviewIndex(null)}
          hasPrev={(previewIndex ?? 0) > 0}
          hasNext={(previewIndex ?? 0) < filteredItems.length - 1}
          onPrev={() => setPreviewIndex((i) => (i !== null ? i - 1 : i))}
          onNext={() => setPreviewIndex((i) => (i !== null ? i + 1 : i))}
        />
      )}

      {composerOpen && (
        <CreatePostModal profileId={profile.id} onClose={() => setComposerOpen(false)} onCreated={() => setComposerOpen(false)} />
      )}
    </div>
  )
}
