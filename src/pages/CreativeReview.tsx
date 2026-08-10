import { useEffect, useState } from 'react'
import {
  CheckSquare, CheckCircle2, Undo2, Sparkles, Pencil, Replace, Image as ImageIcon,
} from 'lucide-react'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import {
  listReviewItems, approveItem, approveAllItems, sendBackItem, reviseWithAi,
  replaceItemMedia, IMAGE_CONTENT_TYPES, VIDEO_CONTENT_TYPES, GENERATION_ENABLED,
  type ContentItem,
} from '../lib/content'
import { connectCanva, listCanvaDesigns, importCanvaDesign, importFigmaFrame, type CanvaDesign } from '../lib/designer'
import { PageHeader, Badge, Button, EmptyState, Spinner, Modal } from '../components/ui'
import { PlatformBadge, CarouselViewer } from '../components/mediaUi'
import AssetUploader from '../components/AssetUploader'
import MediaEditor from '../components/MediaEditor'

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

function ReviewCard({ item, selected, onToggle, onChanged }: {
  item: ContentItem
  selected: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)

  const isImage = IMAGE_CONTENT_TYPES.includes(item.content_type)
  const isVideo = VIDEO_CONTENT_TYPES.includes(item.content_type)
  const slides = item.metadata?.slides

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action)
    try {
      await fn()
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <PlatformBadge platform={item.platform} />
        <Badge tone="orange">{item.content_type.replace(/_/g, ' ')}</Badge>
        {item.status === 'revision' && <Badge tone="orange">Sent back</Badge>}
      </div>

      {slides && slides.length > 0 ? (
        <CarouselViewer slides={slides} />
      ) : item.media_url ? (
        <img src={item.media_url} alt={item.title ?? ''} className="w-full h-48 object-cover rounded-lg mb-3" />
      ) : isVideo ? (
        <div className="w-full h-32 rounded-lg panel flex items-center justify-center text-muted text-xs mb-3">Manual video — n8n trigger only</div>
      ) : null}

      <div className="font-medium text-sm mt-3">{item.title}</div>
      <div className="text-secondary text-sm line-clamp-3 mt-1">{item.body}</div>
      {item.review_notes && <div className="text-xs text-terracotta mt-2">Notes: {item.review_notes}</div>}

      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <Button className="!py-1.5 !px-3 text-xs" loading={busy === 'approve'} onClick={() => run('approve', () => approveItem(item.id))}>
          <CheckCircle2 size={13} /> Approve
        </Button>
        <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={() => setShowNotes((s) => !s)}>
          <Undo2 size={13} /> Send back
        </Button>
        {(isImage || isVideo) && (
          <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={() => setEditOpen(true)} disabled={!item.media_url}>
            <Pencil size={13} /> Edit
          </Button>
        )}
        <Button variant="ghost" className="!py-1.5 !px-3 text-xs" onClick={() => setReplaceOpen(true)}>
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
        <div className="mt-3 space-y-2">
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What needs to change?" />
          <Button
            className="!py-1.5 !px-3 text-xs"
            loading={busy === 'sendback'}
            onClick={() => run('sendback', async () => { await sendBackItem(item.id, notes); setShowNotes(false) })}
          >
            Confirm send back
          </Button>
        </div>
      )}

      {editOpen && item.media_url && (
        <Modal title="Edit creative" onClose={() => setEditOpen(false)} wide>
          <MediaEditor
            imageUrl={item.media_url}
            platform={item.platform}
            itemId={item.id}
            caption={item.body}
            onCancel={() => setEditOpen(false)}
            onSave={async (url) => {
              await replaceItemMedia(item.id, url)
              setEditOpen(false)
              onChanged()
            }}
          />
        </Modal>
      )}

      {replaceOpen && (
        <Modal title="Replace creative" onClose={() => setReplaceOpen(false)}>
          <ReplacePanel
            item={item}
            onDone={async (url) => {
              await replaceItemMedia(item.id, url)
              setReplaceOpen(false)
              onChanged()
            }}
          />
        </Modal>
      )}
    </div>
  )
}

export default function CreativeReview() {
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [items, setItems] = useState<ContentItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [approvingAll, setApprovingAll] = useState(false)

  async function load(profileId: string) {
    setItems(await listReviewItems(profileId))
  }

  useEffect(() => {
    listProfiles().then(async (profiles) => {
      const p = profiles[0] ?? null
      setProfile(p)
      if (p) await load(p.id)
    })
  }, [])

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
    setApprovingAll(true)
    await approveAllItems(Array.from(selected))
    setSelected(new Set())
    await load(profile.id)
    setApprovingAll(false)
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
        <PageHeader accent={<Badge><CheckSquare size={12} /> Creative Review</Badge>} title="Creative Review" />
        <EmptyState icon={<CheckSquare size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        accent={<Badge><CheckSquare size={12} /> Creative Review</Badge>}
        title={`Creative Review — ${profile.business_name}`}
        subtitle="Approve, send back, replace, or edit each piece. Designer replace/edit tools and Canva/Figma import live here too."
        actions={
          selected.size > 0 ? (
            <Button onClick={onApproveAll} loading={approvingAll}>
              <CheckCircle2 size={15} /> Approve {selected.size} selected
            </Button>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={<CheckSquare size={28} />} title="Nothing to review" hint="Generate content from the Content Factory — it lands here once ready." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              onToggle={() => toggle(item.id)}
              onChanged={() => load(profile.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
