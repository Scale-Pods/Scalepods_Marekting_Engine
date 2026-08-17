import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, CheckCircle2, X, RotateCcw } from 'lucide-react'
import { getComposerDraft, saveComposerDraft, clearComposerDraft } from '../lib/theme'
import { createManualItem, LINKEDIN_ACCOUNTS, type ContentSlide } from '../lib/content'
import { triggerPublish } from '../lib/publishing'
import { toastMessage } from './Toast'
import { Modal, Button } from './ui'
import { PlatformBadge, PlatformMockup, CarouselViewer, PLATFORM_OPTIONS, PLATFORM_ASPECT } from './mediaUi'
import AssetUploader from './AssetUploader'

export default function CreatePostModal({
  profileId,
  onClose,
  onCreated,
  initialDate,
}: {
  profileId: string
  onClose: () => void
  onCreated: () => void
  /** Pre-fills "Set a target date" with this day (YYYY-MM-DD) — used by Calendar when the
   *  composer is opened from a specific day cell, so scheduling from there is a single field
   *  (just pick a time) instead of re-entering the date already clicked. Ignored if a draft was
   *  restored, so resuming an in-progress post never silently overwrites what was already there. */
  initialDate?: string
}) {
  // Restore any in-progress draft up front so an accidental dismiss (backdrop click, X, or
  // navigating away) isn't destructive.
  const [restored] = useState(() => getComposerDraft())
  const [draftRestored, setDraftRestored] = useState(Boolean(restored))

  const [platform, setPlatform] = useState(restored?.platform ?? 'instagram')
  const [linkedinAccount, setLinkedinAccount] = useState(restored?.linkedinAccount ?? LINKEDIN_ACCOUNTS[0].value)
  // >1 image only turns into a real carousel on LinkedIn — that's the only platform the
  // Publishing Engine knows how to fan a multi-image post out to (see n8n's "Is Carousel?"
  // branch). Switching away from LinkedIn truncates back to a single cover image below so the
  // composer never implies a carousel it can't actually publish.
  const [images, setImages] = useState<string[]>(restored?.images ?? [])
  const [caption, setCaption] = useState(restored?.caption ?? '')
  const [hashtagsInput, setHashtagsInput] = useState(restored?.hashtagsInput ?? '')
  const [cta, setCta] = useState(restored?.cta ?? '')
  const [when, setWhen] = useState<'now' | 'date'>(restored?.when ?? (initialDate ? 'date' : 'now'))
  const [scheduledDate, setScheduledDate] = useState(restored?.scheduledDate ?? initialDate ?? '')
  const [scheduledTime, setScheduledTime] = useState(restored?.scheduledTime ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const hashtags = hashtagsInput
    .split(/[\s,]+/)
    .map((h) => h.trim().replace(/^#/, ''))
    .filter(Boolean)

  const isLinkedin = platform === 'linkedin'
  const isCarousel = isLinkedin && images.length > 1

  // Carousel posting is LinkedIn-only today — see the "in the linkedin pipeline add the
  // carousel option" build. Drop extra slides the moment the platform isn't LinkedIn so the
  // composer never lets you build something the pipeline can't publish.
  useEffect(() => {
    if (!isLinkedin && images.length > 1) setImages((prev) => prev.slice(0, 1))
  }, [isLinkedin, images.length])

  const scheduling = when === 'date'
  // Built from the date+time inputs as LOCAL time (no trailing Z), then converted to an
  // absolute UTC instant — the browser is the only place that knows the composer's timezone.
  const targetInstant = scheduling && scheduledDate && scheduledTime
    ? new Date(`${scheduledDate}T${scheduledTime}`)
    : null
  const targetValid = Boolean(targetInstant && !Number.isNaN(targetInstant.getTime()))
  const targetInPast = targetValid && targetInstant!.getTime() <= Date.now()

  // Autosave on every change (cheap — it's a handful of strings in localStorage).
  useEffect(() => {
    if (done) return
    saveComposerDraft({ platform, linkedinAccount, images, caption, hashtagsInput, cta, when, scheduledDate, scheduledTime })
  }, [done, platform, linkedinAccount, images, caption, hashtagsInput, cta, when, scheduledDate, scheduledTime])

  function discardDraft() {
    clearComposerDraft()
    setDraftRestored(false)
    setPlatform('instagram')
    setLinkedinAccount(LINKEDIN_ACCOUNTS[0].value)
    setImages([])
    setCaption('')
    setHashtagsInput('')
    setCta('')
    setWhen('now')
    setScheduledDate('')
    setScheduledTime('')
  }

  const hasContent = Boolean(images.length || caption.trim())
  // Previously this ignored `when` entirely, so you could pick "Set a target date", leave the
  // date blank, and save — the empty date was silently coerced to null and the post behaved
  // like an immediate one. That's the bug that made a scheduled post publish instantly.
  const canSave = hasContent && (!scheduling || (targetValid && !targetInPast))

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      const slides: ContentSlide[] = images.map((url, i) => ({ idx: i, title: '', caption: '', url }))
      const item = await createManualItem({
        profileId,
        platform,
        contentType: isCarousel ? 'carousel' : images[0] ? 'static_image' : 'social_caption',
        title: caption.trim() ? caption.trim().slice(0, 60) : null,
        body: caption.trim(),
        mediaUrl: images[0] ?? null,
        slides,
        hashtags,
        cta: cta.trim(),
        scheduledDate: scheduling && scheduledDate ? scheduledDate : null,
        scheduledTime: scheduling && scheduledTime ? scheduledTime : null,
        scheduledAt: targetInstant ? targetInstant.toISOString() : null,
        linkedinAccount: platform === 'linkedin' ? linkedinAccount : null,
      })
      // A target date now actually schedules. Before this the date was only a tag: the post
      // landed in "Ready to publish" and you still had to click Schedule there — and clicking
      // the adjacent, primary-styled "Post now" silently discarded the date and published
      // immediately, which is exactly what testing hit.
      if (targetInstant) await triggerPublish(item.id, false)
      clearComposerDraft()
      setDone(true)
    } catch (err) {
      setError(toastMessage(err, 'Could not save this post'))
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <Modal title="Post created" onClose={onCreated}>
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <CheckCircle2 size={32} className="text-sage" />
          <div className="font-medium">{targetInstant ? 'Scheduled' : 'Sent to Publishing'}</div>
          <p className="text-secondary text-sm max-w-xs">
            {targetInstant
              ? `Your post is scheduled for ${targetInstant.toLocaleString()} and will publish automatically. You can see it under Publishing → Scheduled.`
              : 'Your post is saved and ready — head to Publishing to post it now or schedule it.'}
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
          {draftRestored && (
            <div
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
              style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
            >
              <RotateCcw size={13} className="text-sage shrink-0" />
              <span className="text-secondary flex-1">Unsaved draft restored.</span>
              <button onClick={discardDraft} className="text-muted hover:text-sage underline">
                Discard
              </button>
            </div>
          )}

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

          {platform === 'linkedin' && (
            <div>
              <label className="label">LinkedIn account</label>
              <select
                className="input mt-1.5"
                value={linkedinAccount}
                onChange={(e) => setLinkedinAccount(e.target.value)}
              >
                {LINKEDIN_ACCOUNTS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
              {linkedinAccount === 'company_page' && (
                <p className="text-muted text-xs mt-1.5">
                  Page posting is still pending LinkedIn's Community Management API approval — this option is ready for once that's live.
                </p>
              )}
            </div>
          )}

          <div>
            <div className="label mb-2">
              {isLinkedin ? 'Images' : 'Image'}
              {isCarousel && <span className="text-muted font-normal"> · carousel, {images.length} slides</span>}
            </div>
            {images.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-2">
                {images.map((url, i) => (
                  <div key={url + i} className="relative w-20 h-20">
                    <img src={url} alt={`Slide ${i + 1}`} className="w-20 h-20 object-cover rounded-lg" />
                    {isCarousel && (
                      <span
                        className="absolute bottom-1 left-1 text-[10px] font-semibold text-white rounded px-1.5"
                        style={{ background: 'rgba(0,0,0,0.6)' }}
                      >
                        {i + 1}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full flex items-center justify-center text-white"
                      style={{ background: 'var(--accent-orange)' }}
                      aria-label={`Remove slide ${i + 1}`}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {(isLinkedin || images.length === 0) && (
              <AssetUploader
                pathPrefix={`manual/${profileId}`}
                label={images.length ? 'Add another slide' : 'Upload image'}
                onUploaded={(url) => setImages((prev) => [...prev, url])}
              />
            )}
            <p className="text-muted text-xs mt-1.5">
              {isLinkedin
                ? 'Optional — leave blank for a text-only post. Add 2 or more to post as a LinkedIn carousel (swipeable gallery).'
                : 'Optional — leave blank for a text-only post.'}
            </p>
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
            {scheduling && !targetValid && (
              <p className="text-[var(--accent-orange)] text-xs mt-1.5">
                Pick both a date and a time to schedule this post.
              </p>
            )}
            {targetInPast && (
              <p className="text-[var(--accent-orange)] text-xs mt-1.5">
                That time has already passed — pick a time in the future.
              </p>
            )}
            <p className="text-muted text-xs mt-1.5">
              {scheduling
                ? 'The post will publish automatically at this time — no further action needed.'
                : 'The post goes to Publishing, where you decide when to post it.'}
            </p>
          </div>

          {error && <div className="text-sm text-[var(--accent-orange)]">{error}</div>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={onSave} loading={saving} disabled={!canSave}>
              <Send size={15} /> {scheduling ? 'Schedule post' : 'Save post'}
            </Button>
          </div>
        </div>

        <div className="w-full md:w-[300px] shrink-0">
          <div className="label mb-2 text-center">How it'll look</div>
          {isCarousel ? (
            <CarouselViewer slides={images.map((url, i) => ({ idx: i, title: '', caption: '', url }))} />
          ) : (
            <PlatformMockup
              platform={platform}
              img={images[0] ?? null}
              aspect={PLATFORM_ASPECT[platform] ?? 1}
              caption={[caption, hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n')}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
