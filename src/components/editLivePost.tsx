import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import type { ScheduledPost } from '../lib/publishing'
import {
  EDIT_LIMITS, POST_EDITS_KEY, isOpenEdit, listPostEdits, requestPostEdit, retryPostEditWebhook,
  type PostEdit,
} from '../lib/postEdits'
import { listTeam, TEAM_KEY } from '../lib/team'
import { relativeTime } from '../lib/time'
import { useToast, toastMessage } from './Toast'
import { Badge, Button, Modal } from './ui'

const STATUS_TONE: Record<PostEdit['status'], 'green' | 'blue' | 'orange' | 'grey'> = {
  succeeded: 'green', running: 'blue', pending: 'grey', failed: 'orange',
}

/**
 * "Edit live post" — change the caption (and, for YouTube, the title) of a post that is already
 * out. Only ever opened by an admin or the owner. Saving records the request and hands it to n8n;
 * this dialog then watches the row until it settles, so a rejection from the platform is shown here
 * in plain words instead of vanishing.
 */
export default function EditLivePostModal({
  post, onClose, onChanged,
}: {
  post: ScheduledPost
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const isYouTube = post.platform === 'youtube'
  const isFacebook = post.platform === 'facebook'
  const platformName = isYouTube ? 'YouTube' : isFacebook ? 'Facebook' : 'LinkedIn'
  const [caption, setCaption] = useState(post.caption ?? '')
  const [title, setTitle] = useState(post.title ?? '')
  const [saving, setSaving] = useState(false)
  // The edit this dialog started. Kept separate from the history list so "sending…" and the
  // outcome show at the top even before the list has refetched.
  const [mine, setMine] = useState<string | null>(null)

  const { data: team = [] } = useQuery({ queryKey: TEAM_KEY, queryFn: listTeam, staleTime: 60_000 })
  const { data: edits = [] } = useQuery({
    queryKey: [...POST_EDITS_KEY, post.id],
    queryFn: () => listPostEdits(post.id),
    // Poll only while something is in flight.
    refetchInterval: (q) => ((q.state.data ?? []).some(isOpenEdit) ? 2500 : false),
  })

  const current = mine ? edits.find((e) => e.id === mine) ?? null : null
  const open = edits.find(isOpenEdit) ?? null
  const captionLimit = isYouTube ? EDIT_LIMITS.youtube.caption : isFacebook ? EDIT_LIMITS.facebook.caption : EDIT_LIMITS.linkedin.caption
  const titleTooLong = isYouTube && title.trim().length > EDIT_LIMITS.youtube.title
  const captionTooLong = caption.length > captionLimit
  const changed = caption.trim() !== (post.caption ?? '').trim() || (isYouTube && title.trim() !== (post.title ?? '').trim())
  const invalid = !caption.trim() || captionTooLong || (isYouTube && (!title.trim() || titleTooLong))

  async function save() {
    setSaving(true)
    try {
      const edit = await requestPostEdit(post, { caption: caption.trim(), title: isYouTube ? title.trim() : post.title })
      setMine(edit.id)
      await qc.invalidateQueries({ queryKey: [...POST_EDITS_KEY, post.id] })
    } catch (err) {
      toast.error(toastMessage(err, 'Could not save that edit'))
    } finally {
      setSaving(false)
    }
  }

  function finish() {
    toast.success(`${platformName} post updated.`)
    onChanged()
    onClose()
  }

  async function retry(id: string) {
    try {
      await retryPostEditWebhook(id)
      await qc.invalidateQueries({ queryKey: [...POST_EDITS_KEY, post.id] })
    } catch (err) {
      toast.error(toastMessage(err, 'Could not reach the publishing service'))
    }
  }

  const who = (id: string | null) => team.find((u) => u.id === id)?.full_name ?? 'Someone'

  return (
    <Modal title={`Edit live ${platformName} post`} onClose={onClose} size="lg">
      <div className="space-y-4">
        {current?.status === 'succeeded' ? (
          <div className="space-y-3">
            <div className="flex gap-2.5 px-4 py-3 rounded-xl text-sm" style={{ background: 'rgba(177,217,151,0.12)', border: '1px solid rgba(177,217,151,0.35)' }}>
              <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-sage" />
              <span>
                {platformName} accepted the change.
                {!isYouTube && ' The post now shows an "Edited" label, and the image or video is unchanged.'}
              </span>
            </div>
            <Button className="w-full justify-center" onClick={finish}>Done</Button>
          </div>
        ) : current && isOpenEdit(current) ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm panel">
              <Loader2 size={16} className="animate-spin text-sage shrink-0" />
              <span>Sending your change to {platformName}…</span>
            </div>
            {current.status === 'pending' && Date.now() - new Date(current.created_at).getTime() > 45_000 && (
              <div className="text-xs text-muted flex items-center gap-2">
                Still waiting on the publishing service.
                <button className="underline" onClick={() => retry(current.id)}>Try again</button>
              </div>
            )}
          </div>
        ) : (
          <>
            {current?.status === 'failed' && (
              <div
                className="flex gap-2.5 px-4 py-3 rounded-xl text-sm"
                style={{ background: 'rgb(var(--accent-orange-rgb) / 0.12)', border: '1px solid rgb(var(--accent-orange-rgb) / 0.3)', color: 'var(--accent-orange)' }}
              >
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span><b>{platformName} did not accept it.</b> {current.error ?? 'Unknown error.'} The live post is unchanged.</span>
              </div>
            )}

            {isYouTube && (
              <div>
                <label className="label">Title</label>
                <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} />
                <div className="text-xs mt-1" style={{ color: titleTooLong ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                  {title.trim().length} / {EDIT_LIMITS.youtube.title}
                </div>
              </div>
            )}

            <div>
              <label className="label">{isYouTube ? 'Description' : 'Caption'}</label>
              <textarea className="input mt-1" rows={10} value={caption} onChange={(e) => setCaption(e.target.value)} />
              <div className="text-xs mt-1" style={{ color: captionTooLong ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
                {caption.length} / {captionLimit}
              </div>
            </div>

            <p className="text-muted text-xs">
              {isYouTube
                ? 'Only the title and description change — the video stays as it is. "#Shorts" is added to the end of the description for you.'
                : `Hashtags are part of the caption, so change them right in the text. ${platformName} marks an edited post "Edited" for everyone, and the image or video cannot be changed.`}
            </p>

            <Button className="w-full justify-center" loading={saving} disabled={!changed || invalid || !!open} onClick={save}>
              Update the live post
            </Button>
          </>
        )}

        {edits.length > 0 && (
          <div className="pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className="label mb-2">Edit history</div>
            <div className="space-y-2">
              {edits.slice(0, 5).map((e) => (
                <div key={e.id} className="flex items-start gap-2 text-xs">
                  <Clock size={12} className="text-muted mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-secondary">{who(e.requested_by)}</span>{' '}
                    <span className="text-muted">{relativeTime(e.created_at)}</span>
                    {e.error && <div className="text-muted truncate" title={e.error}>{e.error}</div>}
                  </div>
                  <Badge tone={STATUS_TONE[e.status]} className="!text-[10px] !px-1.5 !py-0.5">{e.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
