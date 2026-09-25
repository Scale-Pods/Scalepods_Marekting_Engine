import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckSquare, CheckCircle2, Undo2, Sparkles, Pencil, Replace, Filter, Clock, Plus, Check, Wand2, Send, Upload, User,
} from 'lucide-react'
import { useProfile, useReviewItems } from '../lib/queries'
import {
  approveItem, approveAllItems, sendBackItem, reviseWithAi,
  replaceItemMedia, IMAGE_CONTENT_TYPES, VIDEO_CONTENT_TYPES, GENERATION_ENABLED,
  type ContentItem,
} from '../lib/content'
import { useToast, toastMessage } from '../components/Toast'
import { PageHeader, Badge, Button, EmptyState, Spinner, Modal } from '../components/ui'
import { useGate, useCan } from '../components/Gate'
import { PLATFORM_OPTIONS } from '../components/mediaUi'
import { PostTile, PostPreviewModal, ContentTypeChip, TimeBadge } from '../components/postPreview'
import MediaSourcePanel from '../components/MediaSourcePanel'
import { ReviewItemMenu, ReviewerChip, SendForReviewModal, ItemAttachments, ImportModal } from '../components/reviewHandoff'
import { useAuth } from '../lib/auth'
import { listTeam, TEAM_KEY } from '../lib/team'
import { useQuery } from '@tanstack/react-query'
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
  // Approving and sending back are the two decisions that move somebody else's work forward,
  // which is what `full` means here. Editing copy and replacing media stay open at `edit`.
  const reviewGate = useGate('review')
  const [busy, setBusy] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState('')
  const [sendOpen, setSendOpen] = useState(false)
  const canSend = useCan('review', 'edit')
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
        <Button className="!py-1.5 !px-3 text-xs" loading={busy === 'approve'} onClick={() => run('approve', () => approveItem(item.id), true)} {...reviewGate.props}>
          <CheckCircle2 size={13} /> Approve
        </Button>
        <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={() => setShowNotes((s) => !s)} {...reviewGate.props}>
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
        {canSend && (
          <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={() => setSendOpen(true)}>
            <Send size={13} /> Send for review
          </Button>
        )}
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

      {sendOpen && (
        <SendForReviewModal item={item} onClose={() => setSendOpen(false)} onSent={onUpdated} />
      )}

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
  const pageReviewGate = useGate('review')
  const canStudio = useCan('studio', 'view')
  const canPublish = useCan('publishing', 'full')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [approvingAll, setApprovingAll] = useState(false)
  const [platformFilter, setPlatformFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'revision'>('all')
  const [composerOpen, setComposerOpen] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)
  const toast = useToast()
  const { appUser } = useAuth()
  const canImport = useCan('review', 'edit')
  const { data: team = [] } = useQuery({ queryKey: TEAM_KEY, queryFn: listTeam, staleTime: 60_000 })

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
      (statusFilter === 'all' || i.status === statusFilter) &&
      (!onlyMine || i.reviewer_id === appUser?.id),
  )
  const sentToMeCount = items.filter((i) => i.reviewer_id === appUser?.id).length
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
              <Button onClick={onApproveAll} loading={approvingAll} {...pageReviewGate.props}>
                <CheckCircle2 size={15} /> Approve {selected.size} selected
              </Button>
            )}
            {canImport && (
              <Button variant="ghost" onClick={() => setImportOpen(true)}>
                <Upload size={15} /> Import
              </Button>
            )}
            {canStudio && (
              <Link to="/studio" className="btn-ghost">
                <Wand2 size={15} /> Create Post
              </Link>
            )}
            {/* Composes and posts immediately, so it needs Publishing at full — not merely the
                right to be on this page. Hidden rather than disabled: it is a link to a whole
                other workflow, not an action on the item in front of you. */}
            {canPublish && (
              <Button variant="ghost" onClick={() => setComposerOpen(true)}>
                <Plus size={15} /> Publish Now
              </Button>
            )}
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
          <div className="flex items-start gap-3 flex-wrap">
            <StatusPills value={statusFilter} onChange={setStatusFilter} counts={statusCounts} />
            {appUser && (
              <button
                onClick={() => setOnlyMine((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all mb-5"
                style={{
                  background: onlyMine ? 'var(--accent-green)' : 'var(--fill-secondary)',
                  color: onlyMine ? '#0e1a0a' : 'var(--text-primary)',
                  border: `1.5px solid ${onlyMine ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                }}
              >
                <User size={12} /> Sent to me
                <span className="text-[10px] px-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.12)' }}>{sentToMeCount}</span>
              </button>
            )}
          </div>
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
                    topRight={
                      <div className="flex items-center gap-1">
                        <ReviewerChip reviewerId={item.reviewer_id} />
                        {item.status === 'revision' ? (
                          <Badge tone="orange" className="!text-[10px] !px-1.5 !py-0.5">Sent back</Badge>
                        ) : (
                          <ContentTypeChip type={item.content_type} />
                        )}
                        <ReviewItemMenu item={item} onSent={() => load(profile.id)} />
                      </div>
                    }
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
                    bottomRight={<TimeBadge time={item.created_at} />}
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
            <div className="space-y-3">
              {activeItem.review_notes && <div className="text-xs text-terracotta">Notes: {activeItem.review_notes}</div>}
              {activeItem.reviewer_id && (
                <div className="text-xs text-muted">
                  With <b className="text-ink">{team.find((u) => u.id === activeItem.reviewer_id)?.full_name ?? 'a reviewer'}</b>
                  {activeItem.submitted_by && <> · sent by {team.find((u) => u.id === activeItem.submitted_by)?.full_name ?? 'someone'}</>}
                </div>
              )}
              <ItemAttachments itemId={activeItem.id} />
            </div>
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
          <MediaSourcePanel
            keyId={activeItem.id}
            pathPrefix={`replace/${activeItem.id}`}
            uploadLabel="Upload replacement image"
            onDone={async (url) => {
              await replaceItemMedia(activeItem.id, url)
              setReplaceOpen(false)
              await load(profile.id)
            }}
          />
        </Modal>
      )}

      {importOpen && (
        <ImportModal
          profileId={profile.id}
          onClose={() => setImportOpen(false)}
          onCreated={() => { setImportOpen(false); void load(profile.id) }}
        />
      )}

      {composerOpen && (
        <CreatePostModal profileId={profile.id} onClose={() => setComposerOpen(false)} onCreated={() => setComposerOpen(false)} />
      )}
    </div>
  )
}
