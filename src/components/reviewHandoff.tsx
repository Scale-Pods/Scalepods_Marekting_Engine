import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Link2, MoreHorizontal, Paperclip, Send, Trash2, UserCheck } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { listTeam, initialsOf, TEAM_KEY, ROLE_LABEL } from '../lib/team'
import type { TeamRole } from '../lib/team'
import {
  listReviewApprovers, sendForReview, createManualItem, listItemAttachments, addItemAttachment,
  deleteItemAttachment, REVIEW_APPROVERS_KEY,
  type ContentItem, type ReviewApprover, type ContentItemAttachment,
} from '../lib/content'
import { useToast, toastMessage } from './Toast'
import { useCan } from './Gate'
import { Button, Modal, Spinner } from './ui'
import AssetUploader from './AssetUploader'
import MediaSourcePanel from './MediaSourcePanel'
import { PLATFORM_OPTIONS } from './mediaUi'

// The maker's side of Creative Review: hand a piece to a named reviewer, share proof with them
// (a file or a live link such as a Google Doc), and bring a creative in from Canva, Figma or a
// local file. Approving and sending back stay with the people who hold `review: full` — nothing
// here lets a maker approve their own work.

type HandoffItem = Pick<ContentItem, 'id' | 'title' | 'profile_id' | 'status' | 'reviewer_id'>

function Initials({ name, email }: { name: string; email?: string }) {
  return (
    <span
      className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
      style={{ background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-green))' }}
    >
      {initialsOf(name, email)}
    </span>
  )
}

/** The people a piece can be handed to, with the one it is currently with ticked. */
export function ReviewerList({ item, onSent }: { item: HandoffItem; onSent: (to: ReviewApprover) => void }) {
  const { appUser } = useAuth()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const { data: approvers = [], isLoading, error } = useQuery({
    queryKey: REVIEW_APPROVERS_KEY, queryFn: listReviewApprovers, staleTime: 60_000,
  })
  // Never yourself: handing work to the person who made it defeats the point of the hand-off.
  const list = approvers.filter((a) => a.id !== appUser?.id)

  async function pick(a: ReviewApprover) {
    if (!appUser) return
    setBusyId(a.id)
    try {
      await sendForReview(item, a, { id: appUser.id, full_name: appUser.full_name })
      toast.success(`Sent to ${a.full_name} for review.`)
      onSent(a)
    } catch (err) {
      toast.error(toastMessage(err, 'Could not send that for review'))
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading) return <div className="flex justify-center py-4"><Spinner size={16} /></div>
  if (error) return <div className="text-xs text-[var(--accent-orange)] px-1 py-2">Could not load reviewers.</div>
  if (list.length === 0) return <div className="text-muted text-xs px-1 py-2">No one else can approve yet.</div>

  return (
    <div className="space-y-0.5">
      {list.map((a) => (
        <button
          key={a.id}
          disabled={busyId !== null}
          onClick={() => pick(a)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-panel text-left disabled:opacity-60"
        >
          <Initials name={a.full_name} email={a.email} />
          <span className="truncate flex-1">{a.full_name}</span>
          <span className="text-muted text-[11px] shrink-0">{ROLE_LABEL[a.role as TeamRole] ?? a.role}</span>
          {busyId === a.id ? <Spinner size={13} /> : item.reviewer_id === a.id ? <Check size={13} className="text-sage shrink-0" /> : null}
        </button>
      ))}
    </div>
  )
}

/** The ⋯ on a tile. A portal, because a tile clips its own overflow and a menu drawn inside it
 *  would be cut off at the tile edge. */
export function ReviewItemMenu({ item, onSent }: { item: HandoffItem; onSent: () => void }) {
  const canSend = useCan('review', 'edit')
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') setOpen(false); return }
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if ((t as HTMLElement).closest?.('[data-review-menu]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])

  if (!canSend) return null

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - 248, window.innerWidth - 256)) })
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="h-6 w-6 rounded-md flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
        aria-label="More actions"
        title="More actions"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && createPortal(
        <div
          data-review-menu
          className="fixed z-[60] w-60 card p-1.5"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-muted text-[11px] font-semibold uppercase tracking-wide px-2 py-1.5 flex items-center gap-1.5">
            <Send size={11} /> Send for review to
          </div>
          <ReviewerList item={item} onSent={() => { setOpen(false); onSent() }} />
        </div>,
        document.body,
      )}
    </>
  )
}

/** The same picker as a small window, for the button inside the preview. */
export function SendForReviewModal({ item, onClose, onSent }: { item: HandoffItem; onClose: () => void; onSent: () => void }) {
  return (
    <Modal title="Send for review" onClose={onClose}>
      <p className="text-muted text-xs mb-3">Pick who should review this. They get a notification, and an email unless they have turned that off.</p>
      <ReviewerList item={item} onSent={() => { onClose(); onSent() }} />
    </Modal>
  )
}

/** A small "with Palki" marker for a tile — who the piece was handed to, if anyone. */
export function ReviewerChip({ reviewerId }: { reviewerId: string | null }) {
  const { data: team = [] } = useQuery({ queryKey: TEAM_KEY, queryFn: listTeam, staleTime: 60_000 })
  if (!reviewerId) return null
  const who = team.find((u) => u.id === reviewerId)
  if (!who) return null
  return (
    <span title={`With ${who.full_name} for review`} className="flex items-center">
      <Initials name={who.full_name} email={who.email} />
    </span>
  )
}

/** Files and live links the maker shares with the reviewer. Anyone who can work here may add one;
 *  removing needs to be the person who added it, or `review: full`. */
export function ItemAttachments({ itemId }: { itemId: string }) {
  const { appUser } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const canAdd = useCan('review', 'edit')
  const canModerate = useCan('review', 'full')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const key = useMemo(() => ['review', 'attachments', itemId] as const, [itemId])
  const { data: team = [] } = useQuery({ queryKey: TEAM_KEY, queryFn: listTeam, staleTime: 60_000 })
  const { data: attachments = [] } = useQuery({ queryKey: key, queryFn: () => listItemAttachments(itemId) })

  async function add(kind: 'file' | 'url', url: string, fileName: string | null) {
    if (!appUser) return
    setBusy(true)
    try {
      await addItemAttachment(itemId, appUser.id, kind, url, fileName)
      setLink('')
      await qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      toast.error(toastMessage(err, 'Could not attach that'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(a: ContentItemAttachment) {
    try {
      await deleteItemAttachment(a.id)
      await qc.invalidateQueries({ queryKey: key })
    } catch (err) {
      toast.error(toastMessage(err, 'Could not remove that attachment'))
    }
  }

  if (!canAdd && attachments.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="label flex items-center gap-1.5"><Paperclip size={12} /> Attachments for the reviewer {attachments.length > 0 && `(${attachments.length})`}</div>
      {attachments.map((a) => {
        const author = team.find((u) => u.id === a.author_id)
        return (
          <div key={a.id} className="flex items-center gap-2 text-xs">
            {a.kind === 'file' ? <Paperclip size={13} className="text-muted shrink-0" /> : <Link2 size={13} className="text-muted shrink-0" />}
            <a href={a.url} target="_blank" rel="noreferrer" className="truncate flex-1 min-w-0 text-secondary hover:text-sage">{a.file_name ?? a.url}</a>
            <span className="text-muted shrink-0">{author?.full_name ?? ''}</span>
            {(a.author_id === appUser?.id || canModerate) && (
              <button onClick={() => remove(a)} className="btn-ghost !p-1 shrink-0" title="Remove attachment"><Trash2 size={12} /></button>
            )}
          </div>
        )
      })}
      {canAdd && (
        <div className="flex items-center gap-2">
          <AssetUploader
            pathPrefix={`review-attachments/${itemId}`}
            accept=""
            label="Attach file"
            onUploaded={(url, file) => add('file', url, file.name)}
          />
          <input
            className="input flex-1 !py-1.5 text-xs"
            placeholder="Or paste a link (Google Doc, Drive, Figma…) and press Enter"
            value={link}
            disabled={busy}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && /^https?:\/\//i.test(link.trim())) void add('url', link.trim(), null) }}
          />
        </div>
      )}
    </div>
  )
}

/** Import a creative from a local file, Canva or Figma straight into Creative Review, optionally
 *  handing it to a reviewer in the same step. */
export function ImportModal({
  profileId, onClose, onCreated,
}: {
  profileId: string
  onClose: () => void
  onCreated: () => void
}) {
  const { appUser } = useAuth()
  const toast = useToast()
  // A throwaway id that only names the storage path — the piece doesn't exist yet.
  const importId = useMemo(() => crypto.randomUUID(), [])
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState(false)
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [platform, setPlatform] = useState('instagram')
  const [reviewerId, setReviewerId] = useState('')
  const [saving, setSaving] = useState(false)
  const { data: approvers = [] } = useQuery({
    queryKey: REVIEW_APPROVERS_KEY, queryFn: listReviewApprovers, staleTime: 60_000,
  })
  const others = approvers.filter((a) => a.id !== appUser?.id)

  async function save() {
    if (!mediaUrl) return
    setSaving(true)
    try {
      const item = await createManualItem({
        profileId, platform,
        contentType: isVideo ? 'ugc_video' : 'static_image',
        title: title.trim() || null,
        body: caption,
        mediaUrl,
        slides: [], hashtags: [], cta: '',
        scheduledDate: null, scheduledTime: null, scheduledAt: null, linkedinAccount: null,
        // Lands in the review queue like any other draft — never straight to approved.
        status: 'ready',
      })
      const reviewer = others.find((a) => a.id === reviewerId)
      if (reviewer && appUser) {
        await sendForReview(item, reviewer, { id: appUser.id, full_name: appUser.full_name })
        toast.success(`Imported and sent to ${reviewer.full_name} for review.`)
      } else {
        toast.success('Imported into Creative Review.')
      }
      onCreated()
    } catch (err) {
      toast.error(toastMessage(err, 'Could not import that creative'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Import a creative" onClose={onClose}>
      {!mediaUrl ? (
        <>
          <p className="text-muted text-xs mb-4">Bring a design in from your computer, Canva or Figma. It joins the review queue as a draft.</p>
          <MediaSourcePanel
            keyId={importId}
            pathPrefix={`import/${importId}`}
            accept="image/*,video/*"
            uploadLabel="Choose an image or video"
            onDone={(url, file) => { setMediaUrl(url); setIsVideo(!!file?.type.startsWith('video/')) }}
          />
        </>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg overflow-hidden flex justify-center" style={{ background: 'var(--fill-tertiary)' }}>
            {isVideo
              ? <video src={mediaUrl} controls className="max-h-56" />
              : <img src={mediaUrl} alt="Imported creative" className="max-h-56 object-contain" />}
          </div>
          <div>
            <label className="label">Title</label>
            <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Platform</label>
              <select className="input mt-1" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {PLATFORM_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label flex items-center gap-1"><UserCheck size={12} /> Send for review to</label>
              <select className="input mt-1" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
                <option value="">Nobody yet</option>
                {others.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Caption (optional)</label>
            <textarea className="input mt-1" rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="The post copy that goes with it" />
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={save} loading={saving}>Add to Creative Review</Button>
            <Button variant="ghost" onClick={() => setMediaUrl(null)}>Choose a different file</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
