import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckSquare, CheckCircle2, Undo2, Sparkles, Pencil, Replace, Image as ImageIcon, Filter, Clock, Plus, Check, Wand2,
} from 'lucide-react'
import { useProfile, useReviewItems } from '../lib/queries'
import {
  approveItem, approveAllItems, sendBackItem, reviseWithAi,
  replaceItemMedia, IMAGE_CONTENT_TYPES, VIDEO_CONTENT_TYPES, GENERATION_ENABLED,
  type ContentItem,
} from '../lib/content'
import { connectCanva, listCanvaDesigns, importCanvaDesign, importFigmaFrame, type CanvaDesign } from '../lib/designer'
import { useToast, toastMessage } from '../components/Toast'
import { PageHeader, Badge, Button, EmptyState, Spinner, Modal } from '../components/ui'
import { PLATFORM_OPTIONS } from '../components/mediaUi'
import { PostTile, PostPreviewModal, ContentTypeChip } from '../components/postPreview'
import AssetUploader from '../components/AssetUploader'
import MediaEditor from '../components/MediaEditor'
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

function StatTile({ icon: Icon, label, value, accent }: { icon: typeof Clock; label: string; value: number; accent: string }) {
  return (
    <div className="card metric-tile p-4 flex-1" style={{ ['--tile-accent' as string]: accent }}>
      <div className="flex items-center gap-2 mb-2" style={{ position: 'relative', zIndex: 1 }}>
        <Icon size={15} style={{ color: accent }} />
        <span className="text-muted text-xs">{label}</span>
      </div>
      <div className="text-2xl font-light tabular-nums tracking-tightest" style={{ position: 'relative', zIndex: 1 }}>{value}</div>
    </div>
  )
}

const STATUS_OPTIONS: { value: 'all' | 'ready' | 'revision'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready for review' },
  { value: 'revision', label: 'Sent back' },
]

function StatusPills({
  value, onChange, counts,
}: {
  value: 'all' | 'ready' | 'revision'
  onChange: (v: 'all' | 'ready' | 'revision') => void
  counts: Record<'all' | 'ready' | 'revision', number>
}) {
  return (
    <div className="flex gap-2 flex-wrap mb-5">
      {STATUS_OPTIONS.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
            style={{
              background: active ? 'var(--accent-blue)' : 'var(--fill-secondary)',
              color: active ? '#fff' : 'var(--text-primary)',
              border: `1.5px solid ${active ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
            }}
          >
            {opt.label}
            <span
              className="text-[10px] px-1.5 rounded-full"
              style={{ background: active ? 'rgba(255,255,255,0.25)' : 'var(--fill-tertiary)' }}
            >
              {counts[opt.value]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ReplacePanel({ item, onDone }: { item: ContentItem; onDone: (url: string) => void }) {
  const [tab, setTab] = useState<'upload' | 'canva' | 'figma'>('upload')
  const [designs, setDesigns] = useState<CanvaDesign[] | null>(null)
  const [canvaError, setCanvaError] = useState<string | null>(null)
  const [figmaFileKey, setFigmaFileKey] = useState('')
  const [figmaNodeId, setFigmaNodeId] = useState('')
  const [figmaBusy, setFigmaBusy] = useState(false)
  const [figmaError, setFigmaError] = useState<string | null>(null)

  useEffect(() => {
    if (tab === 'canva' && designs === null) {
      listCanvaDesigns()
        .then(setDesigns)
        .catch((err) => setCanvaError(err instanceof Error ? err.message : 'Canva not connected yet'))
    }
  }, [tab, designs])

  async function onFigmaImport() {
    setFigmaBusy(true)
    setFigmaError(null)
    try {
      const url = await importFigmaFrame(figmaFileKey.trim(), figmaNodeId.trim(), item.id)
      onDone(url)
    } catch (err) {
      setFigmaError(err instanceof Error ? err.message : 'Figma import failed')
    } finally {
      setFigmaBusy(false)
    }
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {(['upload', 'canva', 'figma'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'badge' : 'badge opacity-40'} style={{ textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <AssetUploader pathPrefix={`replace/${item.id}`} label="Upload replacement image" onUploaded={(url) => onDone(url)} />
      )}

      {tab === 'canva' && (
        <div className="space-y-3">
          <Button variant="ghost" onClick={connectCanva}>Connect Canva</Button>
          {canvaError && <div className="text-xs text-muted">{canvaError} — connect Canva above, then reopen this panel.</div>}
          {designs && designs.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {designs.map((d) => (
                <button key={d.id} onClick={() => importCanvaDesign(d.id, item.id).then(onDone)} className="panel p-2 hover:border-sage/40">
                  {d.thumbnailUrl ? <img src={d.thumbnailUrl} alt={d.title} className="w-full h-16 object-cover rounded" /> : <ImageIcon size={20} />}
                  <div className="text-xs mt-1 truncate">{d.title}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'figma' && (
        <div className="space-y-3">
          <div>
            <label className="label">Figma file key</label>
            <input className="input mt-1" value={figmaFileKey} onChange={(e) => setFigmaFileKey(e.target.value)} placeholder="from the file URL" />
          </div>
          <div>
            <label className="label">Node ID</label>
            <input className="input mt-1" value={figmaNodeId} onChange={(e) => setFigmaNodeId(e.target.value)} placeholder="e.g. 12:34" />
          </div>
          {figmaError && <div className="text-xs text-[var(--accent-orange)]">{figmaError}</div>}
          <Button onClick={onFigmaImport} loading={figmaBusy} disabled={!figmaFileKey || !figmaNodeId}>Import from Figma</Button>
        </div>
      )}
    </div>
  )
}

// Footer actions inside the click-through preview. `onDismiss` (approve / send back) reloads
// AND closes the preview, since the item leaves the current filtered list either way and
// leaving the modal open risks silently swapping to whichever item shifts into the same index.
// `onUpdated` (edit / replace / revise) just reloads — the item stays put, updated in place,
// matching the old inline-card behaviour.
function ReviewPreviewActions({
  item, onUpdated, onDismiss, onEdit, onReplace,
}: {
  item: ContentItem
  onUpdated: () => void
  onDismiss: () => void
  onEdit: () => void
  onReplace: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState('')
  const toast = useToast()
  const isImage = IMAGE_CONTENT_TYPES.includes(item.content_type)
  const isVideo = VIDEO_CONTENT_TYPES.includes(item.content_type)

  // Single choke point for approve / send back / revise. Without the catch these failed
  // silently: the spinner stuck on and the user got no indication anything went wrong.
  async function run(action: string, fn: () => Promise<void>, dismiss = false) {
    setBusy(action)
    try {
      await fn()
      if (dismiss) onDismiss()
      else onUpdated()
    } catch (err) {
      toast.error(toastMessage(err, `Could not ${action} this item`))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <Button className="!py-1.5 !px-3 text-xs" loading={busy === 'approve'} onClick={() => run('approve', () => approveItem(item.id), true)}>
          <CheckCircle2 size={13} /> Approve
        </Button>
        <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={() => setShowNotes((s) => !s)}>
          <Undo2 size={13} /> Send back
        </Button>
        {(isImage || isVideo) && (
          <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={onEdit} disabled={!item.media_url}>
            <Pencil size={13} /> Edit
          </Button>
        )}
        <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={onReplace}>
          <Replace size={13} /> Replace
        </Button>
        <Button
          variant="ghost"
          className="!py-1.5 !px-3 text-xs"
          loading={busy === 'revise'}
          disabled={!GENERATION_ENABLED}
          onClick={() => run('revise', () => reviseWithAi(item.id, item.review_notes ?? ''))}
        >
          <Sparkles size={13} /> Revise with AI
        </Button>
      </div>

      {showNotes && (
        <div className="space-y-2">
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What needs to change?" />
          <Button
            className="!py-1.5 !px-3 text-xs w-full justify-center"
            loading={busy === 'sendback'}
            onClick={() => run('sendback', async () => { await sendBackItem(item.id, notes) }, true)}
          >
            Confirm send back
          </Button>
        </div>
      )}
    </>
  )
}

export default function CreativeReview() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [approvingAll, setApprovingAll] = useState(false)
  const [platformFilter, setPlatformFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'revision'>('all')
  const [composerOpen, setComposerOpen] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const toast = useToast()

  const { data: profile, isLoading: profileLoading } = useProfile()
  const { data: items = [], refetch } = useReviewItems(profile?.id)

  // Realtime keeps this list current on its own; load() stays as an explicit nudge for the
  // actions that mutate an item so the UI doesn't wait on the round trip.
  const load = useCallback(async (_profileId?: string) => { await refetch() }, [refetch])

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onApproveAll() {
    if (!profile || selected.size === 0) return
    const count = selected.size
    setApprovingAll(true)
    // Previously had no try/finally at all — a throw here left `approvingAll` stuck true and
    // the button spinning forever with nothing shown to the user.
    try {
      await approveAllItems(Array.from(selected))
      setSelected(new Set())
      await load(profile.id)
      toast.success(`Approved ${count} item${count === 1 ? '' : 's'}.`)
    } catch (err) {
      toast.error(toastMessage(err, 'Could not approve the selected items'))
    } finally {
      setApprovingAll(false)
    }
  }

  function navPreview(i: number | null) {
    setPreviewIndex(i)
    setEditOpen(false)
    setReplaceOpen(false)
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
        <PageHeader accent={<Badge><CheckSquare size={12} /> Creative Review</Badge>} title="Creative Review" />
        <EmptyState icon={<CheckSquare size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  // Content-type options are scoped to whichever platform is currently selected, so the
  // dropdown never offers a type that platform doesn't actually have (e.g. no "linkedin
  // article" while "Instagram" is selected).
  const typeOptions = Array.from(
    new Set(items.filter((i) => platformFilter === 'all' || i.platform?.toLowerCase() === platformFilter).map((i) => i.content_type)),
  ).sort()
  const filteredItems = items.filter(
    (i) =>
      (platformFilter === 'all' || i.platform?.toLowerCase() === platformFilter) &&
      (typeFilter === 'all' || i.content_type === typeFilter) &&
      (statusFilter === 'all' || i.status === statusFilter),
  )
  const statusCounts = {
    all: items.length,
    ready: items.filter((i) => i.status === 'ready').length,
    revision: items.filter((i) => i.status === 'revision').length,
  } as const
  const activeItem = previewIndex !== null ? filteredItems[previewIndex] : null

  function onPlatformFilterChange(v: string) {
    setPlatformFilter(v)
    const nextOptions = new Set<string>(items.filter((i) => v === 'all' || i.platform?.toLowerCase() === v).map((i) => i.content_type))
    if (typeFilter !== 'all' && !nextOptions.has(typeFilter)) setTypeFilter('all')
  }

  return (
    <div>
      <PageHeader
        accent={<Badge><CheckSquare size={12} /> Creative Review</Badge>}
        title={`Creative Review — ${profile.business_name}`}
        subtitle="Approve, send back, replace, or edit each piece. Designer replace/edit tools and Canva/Figma import live here too."
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {items.length > 0 && (
              <FilterBar
                platform={platformFilter}
                onPlatform={onPlatformFilterChange}
                type={typeFilter}
                onType={setTypeFilter}
                typeOptions={typeOptions}
              />
            )}
            {selected.size > 0 && (
              <Button onClick={onApproveAll} loading={approvingAll}>
                <CheckCircle2 size={15} /> Approve {selected.size} selected
              </Button>
            )}
            <Link to="/studio" className="btn-ghost">
              <Wand2 size={15} /> Create Post
            </Link>
            <Button variant="ghost" onClick={() => setComposerOpen(true)}>
              <Plus size={15} /> Publish Now
            </Button>
          </div>
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={<CheckSquare size={28} />} title="Nothing to review" hint="Generate content from the Content Factory, or create a post manually with the button above." />
      ) : (
        <>
          <div className="flex gap-3 mb-5">
            <StatTile icon={Clock} label="Ready for review" value={statusCounts.ready} accent="var(--accent-orange)" />
            <StatTile icon={Undo2} label="Sent back" value={statusCounts.revision} accent="var(--accent-blue)" />
          </div>
          <StatusPills value={statusFilter} onChange={setStatusFilter} counts={statusCounts} />
          {filteredItems.length === 0 ? (
            <EmptyState icon={<Filter size={28} />} title="No items match these filters" hint="Try a different platform or content type." />
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-1.5">
              {filteredItems.map((item, i) => {
                const thumb = item.media_url || item.metadata?.slides?.[0]?.url || null
                const isSelected = selected.has(item.id)
                return (
                  <PostTile
                    key={item.id}
                    img={thumb}
                    platform={item.platform}
                    placeholder={item.title || item.body?.slice(0, 80)}
                    topRight={item.status === 'revision' ? (
                      <Badge tone="orange" className="!text-[10px] !px-1.5 !py-0.5">Sent back</Badge>
                    ) : (
                      <ContentTypeChip type={item.content_type} />
                    )}
                    bottomLeft={
                      <button
                        onClick={(e) => { e.stopPropagation(); toggle(item.id) }}
                        className="h-6 w-6 rounded-md flex items-center justify-center transition-colors"
                        style={{
                          background: isSelected ? 'var(--accent-green)' : 'rgba(0,0,0,0.55)',
                          border: isSelected ? 'none' : '1.5px solid rgba(255,255,255,0.7)',
                        }}
                        aria-label={isSelected ? 'Deselect' : 'Select'}
                      >
                        {isSelected && <Check size={14} className="text-white" />}
                      </button>
                    }
                    onClick={() => navPreview(i)}
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
          headerExtra={activeItem.status === 'revision' ? <Badge tone="orange">Sent back</Badge> : <ContentTypeChip type={activeItem.content_type} />}
          body={
            <>
              {activeItem.review_notes && <div className="text-xs text-terracotta">Notes: {activeItem.review_notes}</div>}
            </>
          }
          footer={
            <ReviewPreviewActions
              item={activeItem}
              onUpdated={() => load(profile.id)}
              onDismiss={() => { navPreview(null); load(profile.id) }}
              onEdit={() => setEditOpen(true)}
              onReplace={() => setReplaceOpen(true)}
            />
          }
          onClose={() => navPreview(null)}
          hasPrev={(previewIndex ?? 0) > 0}
          hasNext={(previewIndex ?? 0) < filteredItems.length - 1}
          onPrev={() => navPreview((previewIndex ?? 0) - 1)}
          onNext={() => navPreview((previewIndex ?? 0) + 1)}
        />
      )}

      {activeItem && editOpen && activeItem.media_url && (
        <Modal title="Edit creative" onClose={() => setEditOpen(false)} wide>
          <MediaEditor
            imageUrl={activeItem.media_url}
            platform={activeItem.platform}
            itemId={activeItem.id}
            caption={activeItem.body}
            onCancel={() => setEditOpen(false)}
            onSave={async (url) => {
              await replaceItemMedia(activeItem.id, url)
              setEditOpen(false)
              await load(profile.id)
            }}
          />
        </Modal>
      )}

      {activeItem && replaceOpen && (
        <Modal title="Replace creative" onClose={() => setReplaceOpen(false)}>
          <ReplacePanel
            item={activeItem}
            onDone={async (url) => {
              await replaceItemMedia(activeItem.id, url)
              setReplaceOpen(false)
              await load(profile.id)
            }}
          />
        </Modal>
      )}

      {composerOpen && (
        <CreatePostModal profileId={profile.id} onClose={() => setComposerOpen(false)} onCreated={() => setComposerOpen(false)} />
      )}
    </div>
  )
}
