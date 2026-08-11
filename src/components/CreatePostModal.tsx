import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, CheckCircle2, X } from 'lucide-react'
import { createManualItem } from '../lib/content'
import { Modal, Button } from './ui'
import { PlatformBadge, PlatformMockup, PLATFORM_OPTIONS, PLATFORM_ASPECT } from './mediaUi'
import AssetUploader from './AssetUploader'

export default function CreatePostModal({
  profileId,
  onClose,
  onCreated,
}: {
  profileId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [platform, setPlatform] = useState('instagram')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [hashtagsInput, setHashtagsInput] = useState('')
  const [cta, setCta] = useState('')
  const [when, setWhen] = useState<'now' | 'date'>('now')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const hashtags = hashtagsInput
    .split(/[\s,]+/)
    .map((h) => h.trim().replace(/^#/, ''))
    .filter(Boolean)

  const canSave = Boolean(mediaUrl || caption.trim())

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      await createManualItem({
        profileId,
        platform,
        contentType: mediaUrl ? 'static_image' : 'social_caption',
        title: caption.trim() ? caption.trim().slice(0, 60) : null,
        body: caption.trim(),
        mediaUrl,
        hashtags,
        cta: cta.trim(),
        scheduledDate: when === 'date' && scheduledDate ? scheduledDate : null,
        scheduledTime: when === 'date' && scheduledDate && scheduledTime ? scheduledTime : null,
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this post')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <Modal title="Post created" onClose={onCreated}>
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <CheckCircle2 size={32} className="text-sage" />
          <div className="font-medium">Sent to Publishing</div>
          <p className="text-secondary text-sm max-w-xs">
            Your post is saved and ready — head to Publishing to post it now or schedule it.
          </p>
          <div className="flex gap-2 mt-2">
            <Button variant="ghost" onClick={onCreated}>Close</Button>
            <Link to="/publishing" className="btn-primary" onClick={onCreated}>
              <Send size={15} /> Go to Publishing
            </Link>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Create post" onClose={onClose} size="xl">
      {/* Horizontal layout — form on the left, live "how it'll look" preview pinned on the
          right, same split used by the post-preview modals elsewhere in the app. Stacks to a
          single column on narrow screens. */}
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 min-w-0 space-y-5">
          <div>
            <div className="label mb-2">Platform</div>
            <div className="flex gap-2 flex-wrap">
              {PLATFORM_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPlatform(p.value)}
                  className="rounded-full transition-all"
                  style={{ opacity: platform === p.value ? 1 : 0.45, transform: platform === p.value ? 'scale(1.03)' : undefined }}
                >
                  <PlatformBadge platform={p.value} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label mb-2">Image</div>
            {mediaUrl ? (
              <div className="relative w-40">
                <img src={mediaUrl} alt="Upload preview" className="w-40 h-40 object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={() => setMediaUrl(null)}
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full flex items-center justify-center text-white"
                  style={{ background: 'var(--accent-orange)' }}
                  aria-label="Remove image"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <AssetUploader pathPrefix={`manual/${profileId}`} label="Upload image" onUploaded={(url) => setMediaUrl(url)} />
            )}
            <p className="text-muted text-xs mt-1.5">Optional — leave blank for a text-only post.</p>
          </div>

          <div>
            <label className="label">Caption</label>
            <textarea
              className="input mt-1.5"
              rows={4}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write your post…"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Hashtags</label>
              <input
                className="input mt-1.5"
                value={hashtagsInput}
                onChange={(e) => setHashtagsInput(e.target.value)}
                placeholder="#GrowthOS #B2B"
              />
            </div>
            <div>
              <label className="label">CTA (optional)</label>
              <input className="input mt-1.5" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Book a demo" />
            </div>
          </div>

          <div>
            <div className="label mb-2">When</div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setWhen('now')}
                className={when === 'now' ? 'badge' : 'badge opacity-40'}
                style={{ textTransform: 'none' }}
              >
                Save to Publishing
              </button>
              <button
                type="button"
                onClick={() => setWhen('date')}
                className={when === 'date' ? 'badge badge-blue' : 'badge badge-blue opacity-40'}
                style={{ textTransform: 'none' }}
              >
                Set a target date
              </button>
              {when === 'date' && (
                <>
                  <input
                    type="date"
                    className="input !w-auto !py-1.5 text-xs"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                  />
                  <input
                    type="time"
                    className="input !w-auto !py-1.5 text-xs"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                  />
                </>
              )}
            </div>
            <p className="text-muted text-xs mt-1.5">
              This just tags the post with a target date{when === 'date' && scheduledTime ? ' and time' : ''} — you still post it or schedule it for real from Publishing.
            </p>
          </div>

          {error && <div className="text-sm text-[var(--accent-orange)]">{error}</div>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={onSave} loading={saving} disabled={!canSave}>
              <Send size={15} /> Save post
            </Button>
          </div>
        </div>

        <div className="w-full md:w-[300px] shrink-0">
          <div className="label mb-2 text-center">How it'll look</div>
          <PlatformMockup
            platform={platform}
            img={mediaUrl}
            aspect={PLATFORM_ASPECT[platform] ?? 1}
            caption={[caption, hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n')}
          />
        </div>
      </div>
    </Modal>
  )
}
