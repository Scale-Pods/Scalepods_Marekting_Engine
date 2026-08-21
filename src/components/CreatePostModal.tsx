import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, CheckCircle2, X, RotateCcw, FileText } from 'lucide-react'
import { getComposerDraft, saveComposerDraft, clearComposerDraft } from '../lib/theme'
import { createManualItem, LINKEDIN_ACCOUNTS, type ContentSlide } from '../lib/content'
import { triggerPublish } from '../lib/publishing'
import { toastMessage } from './Toast'
import { Modal, Button, Spinner } from './ui'
import { PlatformBadge, PlatformMockup, CarouselViewer, PLATFORM_OPTIONS, PLATFORM_ASPECT } from './mediaUi'
import AssetUploader from './AssetUploader'
import { renderPdfPages } from '../lib/pdfPreview'

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
  // >1 image only turns into a real carousel on LinkedIn/Instagram — the only platforms the
  // Publishing Engine knows how to fan a multi-image post out to. Switching to a platform that
  // doesn't support it truncates back to a single cover image below so the composer never
  // implies something it can't actually publish.
  const [images, setImages] = useState<string[]>(restored?.images ?? [])
  // Video is a separate media slot from images, not a 4th image — Facebook-only today (a plain
  // video post; Reels come later and will likely need their own constraints/preview anyway).
  // 'pdf' is LinkedIn-only: posts as a native LinkedIn Document (the real API mechanism behind a
  // "LinkedIn PDF carousel" — a swipeable page viewer, distinct from the multi-image carousel).
  const [mediaKind, setMediaKind] = useState<'image' | 'video' | 'pdf'>(restored?.mediaKind ?? 'image')
  const [videoUrl, setVideoUrl] = useState<string | null>(restored?.videoUrl ?? null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(restored?.pdfUrl ?? null)
  // Rendered client-side (pdfPreview.ts) purely for the "How it'll look" panel below — LinkedIn
  // Document posts really do render as a swipeable page-by-page viewer, so showing the actual
  // pages (not just a filename chip) is what answers "how will this look on LinkedIn" for real.
  const [pdfPages, setPdfPages] = useState<string[]>([])
  const [pdfPagesLoading, setPdfPagesLoading] = useState(false)
  // Story vs feed — Instagram-only today, and only meaningful for a single image (a carousel or
  // video can't be posted as a Story through this composer yet).
  const [postFormat, setPostFormat] = useState<'feed' | 'story'>(restored?.postFormat ?? 'feed')
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
  const isInstagram = platform === 'instagram'
  const isFacebook = platform === 'facebook'
  const isYoutube = platform === 'youtube'
  const supportsCarousel = isLinkedin || isInstagram
  // Instagram video publishes as a Reel (its own media_type on IG's side, distinct from the
  // Story/Feed image toggle below) — the n8n Publishing Engine now has a matching branch that
  // creates a REELS container and polls until it's processed before publishing.
  const supportsVideo = isFacebook || isYoutube || isInstagram
  const supportsStory = isInstagram
  // A LinkedIn Document post (real API: Documents API + /rest/posts, media.id: urn:li:document:…)
  // — the n8n Publishing Engine's matching branch creates the document, waits for it to finish
  // processing, then posts it. Distinct from LinkedIn's multi-image carousel (`isCarousel` below).
  const supportsPdf = isLinkedin
  // YouTube only supports Shorts through this composer — there's no photo/text post type for
  // it, so unlike Facebook it isn't a Photo/Video choice, it's just always video.
  const forcedVideo = isYoutube
  const isCarousel = supportsCarousel && mediaKind === 'image' && images.length > 1

  // Drop whatever the current platform doesn't support the moment you switch to it, so the
  // composer never lets you build something the Publishing Engine can't actually fan out —
  // carousel is LinkedIn/Instagram only, video is Facebook/YouTube only, Story is Instagram
  // only, and Story + carousel together aren't offered (a Story is always a single image here).
  useEffect(() => {
    if (!supportsCarousel && images.length > 1) setImages((prev) => prev.slice(0, 1))
  }, [supportsCarousel, images.length])
  useEffect(() => {
    if (!supportsVideo && mediaKind === 'video') { setMediaKind('image'); setVideoUrl(null) }
  }, [supportsVideo, mediaKind])
  useEffect(() => {
    if (!supportsPdf && mediaKind === 'pdf') { setMediaKind('image'); setPdfUrl(null) }
  }, [supportsPdf, mediaKind])
  useEffect(() => {
    if (!pdfUrl) { setPdfPages([]); return }
    let cancelled = false
    setPdfPagesLoading(true)
    setPdfPages([])
    renderPdfPages(pdfUrl)
      .then((pages) => { if (!cancelled) setPdfPages(pages) })
      .catch(() => { if (!cancelled) setPdfPages([]) })
      .finally(() => { if (!cancelled) setPdfPagesLoading(false) })
    return () => { cancelled = true }
  }, [pdfUrl])
  useEffect(() => {
    if (forcedVideo && mediaKind !== 'video') setMediaKind('video')
  }, [forcedVideo, mediaKind])
  useEffect(() => {
    if (!supportsStory && postFormat === 'story') setPostFormat('feed')
  }, [supportsStory, postFormat])
  useEffect(() => {
    if (isCarousel && postFormat === 'story') setPostFormat('feed')
  }, [isCarousel, postFormat])

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
    saveComposerDraft({
      platform, linkedinAccount, images, mediaKind, videoUrl, pdfUrl, postFormat,
      caption, hashtagsInput, cta, when, scheduledDate, scheduledTime,
    })
  }, [done, platform, linkedinAccount, images, mediaKind, videoUrl, pdfUrl, postFormat, caption, hashtagsInput, cta, when, scheduledDate, scheduledTime])

  function discardDraft() {
    clearComposerDraft()
    setDraftRestored(false)
    setPlatform('instagram')
    setLinkedinAccount(LINKEDIN_ACCOUNTS[0].value)
    setImages([])
    setMediaKind('image')
    setVideoUrl(null)
    setPdfUrl(null)
    setPostFormat('feed')
    setCaption('')
    setHashtagsInput('')
    setCta('')
    setWhen('now')
    setScheduledDate('')
    setScheduledTime('')
  }

  // A video/PDF post without the file isn't a thing — require it explicitly rather than letting
  // caption text alone satisfy "has content" the way it does for an image/text post.
  const hasContent = mediaKind === 'video' ? Boolean(videoUrl) : mediaKind === 'pdf' ? Boolean(pdfUrl) : Boolean(images.length || caption.trim())
  // Previously this ignored `when` entirely, so you could pick "Set a target date", leave the
  // date blank, and save — the empty date was silently coerced to null and the post behaved
  // like an immediate one. That's the bug that made a scheduled post publish instantly.
  const canSave = hasContent && (!scheduling || (targetValid && !targetInPast))

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      const slides: ContentSlide[] = images.map((url, i) => ({ idx: i, title: '', caption: '', url }))
      // 'story' now has to win over the video check — a video Story is content_type:'story'
      // same as a photo Story (the Publishing Engine tells them apart itself, from whether
      // media_url is a video file), not 'ugc_video' (that's specifically a feed Reel).
      const contentType =
        postFormat === 'story' ? 'story' :
        mediaKind === 'pdf' ? 'linkedin_pdf' :
        mediaKind === 'video' ? 'ugc_video' :
        isCarousel ? 'carousel' :
        images[0] ? 'static_image' : 'social_caption'
      const item = await createManualItem({
        profileId,
        platform,
        contentType,
        title: caption.trim() ? caption.trim().slice(0, 60) : null,
        body: caption.trim(),
        mediaUrl: mediaKind === 'video' ? videoUrl : mediaKind === 'pdf' ? pdfUrl : (images[0] ?? null),
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
            {/* Dimming the unselected options to 45% opacity (the old treatment) made every
                platform except the active one look faded and disabled rather than just
                "not chosen" — the opposite of inviting. Every option now stays full-strength
                and is distinguished by its own button frame instead: a filled, ringed card
                when active, a plain outlined one otherwise. Bigger tap targets too. */}
            <div className="flex gap-2 flex-wrap">
              {PLATFORM_OPTIONS.map((p) => {
                const active = platform === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPlatform(p.value)}
                    className="rounded-full transition-all"
                    style={{
                      padding: 4,
                      background: active ? 'var(--fill-primary)' : 'var(--fill-tertiary)',
                      outline: active ? '2px solid var(--accent-green)' : '1px solid var(--border-subtle)',
                      outlineOffset: -1,
                      transform: active ? 'scale(1.05)' : undefined,
                    }}
                  >
                    <PlatformBadge platform={p.value} />
                  </button>
                )
              })}
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

          {(isFacebook || supportsStory || supportsPdf) && (
            <div>
              <div className="label mb-2">Post type</div>
              <div className="flex items-center gap-2 flex-wrap">
                {isFacebook && (
                  <>
                    <button type="button" onClick={() => setMediaKind('image')} className={mediaKind === 'image' ? 'badge' : 'badge opacity-40'} style={{ textTransform: 'none' }}>
                      Photo
                    </button>
                    <button type="button" onClick={() => setMediaKind('video')} className={mediaKind === 'video' ? 'badge badge-blue' : 'badge badge-blue opacity-40'} style={{ textTransform: 'none' }}>
                      Video
                    </button>
                  </>
                )}
                {supportsPdf && (
                  <>
                    <button type="button" onClick={() => setMediaKind('image')} className={mediaKind !== 'pdf' ? 'badge' : 'badge opacity-40'} style={{ textTransform: 'none' }}>
                      Feed post
                    </button>
                    <button type="button" onClick={() => setMediaKind('pdf')} className={mediaKind === 'pdf' ? 'badge badge-blue' : 'badge badge-blue opacity-40'} style={{ textTransform: 'none' }}>
                      PDF document
                    </button>
                  </>
                )}
                {supportsStory && !isCarousel && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setPostFormat('feed'); setMediaKind('image') }}
                      className={postFormat === 'feed' && mediaKind === 'image' ? 'badge' : 'badge opacity-40'}
                      style={{ textTransform: 'none' }}
                    >
                      Feed post
                    </button>
                    <button
                      type="button"
                      // Leaves mediaKind alone (unlike Feed post, which forces it back to
                      // image) — a Story can be either, picked via the Photo/Video sub-toggle
                      // below once Story is selected.
                      onClick={() => setPostFormat('story')}
                      className={postFormat === 'story' ? 'badge badge-blue' : 'badge badge-blue opacity-40'}
                      style={{ textTransform: 'none' }}
                    >
                      Story
                    </button>
                    {isInstagram && (
                      <button
                        type="button"
                        onClick={() => { setMediaKind('video'); setPostFormat('feed') }}
                        className={mediaKind === 'video' && postFormat === 'feed' ? 'badge badge-blue' : 'badge badge-blue opacity-40'}
                        style={{ textTransform: 'none' }}
                      >
                        Reel
                      </button>
                    )}
                  </>
                )}
              </div>
              {/* Story's own Photo/Video choice — Instagram Stories support video (media_type=
                  STORIES + video_url, same container flow as Reels) just as much as a static
                  image, this just wasn't wired up before. */}
              {postFormat === 'story' && (
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <button type="button" onClick={() => setMediaKind('image')} className={mediaKind === 'image' ? 'badge' : 'badge opacity-40'} style={{ textTransform: 'none' }}>
                    Photo
                  </button>
                  <button type="button" onClick={() => setMediaKind('video')} className={mediaKind === 'video' ? 'badge badge-blue' : 'badge badge-blue opacity-40'} style={{ textTransform: 'none' }}>
                    Video
                  </button>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="label mb-2">
              {mediaKind === 'video' ? 'Video' : mediaKind === 'pdf' ? 'PDF' : supportsCarousel ? 'Images' : 'Image'}
              {isCarousel && <span className="text-muted font-normal"> · carousel, {images.length} slides</span>}
            </div>
            {mediaKind === 'video' ? (
              videoUrl ? (
                <div className="relative w-40 mb-2">
                  <video src={videoUrl} controls className="w-40 rounded-lg" />
                  <button
                    type="button"
                    onClick={() => setVideoUrl(null)}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full flex items-center justify-center text-white"
                    style={{ background: 'var(--accent-orange)' }}
                    aria-label="Remove video"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <AssetUploader
                  pathPrefix={`manual/${profileId}`}
                  accept="video/*"
                  label="Upload video"
                  onUploaded={(url) => setVideoUrl(url)}
                />
              )
            ) : mediaKind === 'pdf' ? (
              pdfUrl ? (
                <div className="relative w-fit">
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                    style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
                  >
                    <FileText size={16} className="text-sage shrink-0" />
                    {pdfUrl.split('/').pop()?.replace(/^\d+-/, '') || 'document.pdf'}
                  </a>
                  <button
                    type="button"
                    onClick={() => setPdfUrl(null)}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full flex items-center justify-center text-white"
                    style={{ background: 'var(--accent-orange)' }}
                    aria-label="Remove PDF"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <AssetUploader
                  pathPrefix={`manual/${profileId}`}
                  accept="application/pdf"
                  label="Upload PDF"
                  onUploaded={(url) => setPdfUrl(url)}
                />
              )
            ) : (
              <>
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
                {(images.length === 0 || (supportsCarousel && postFormat !== 'story')) && (
                  <AssetUploader
                    pathPrefix={`manual/${profileId}`}
                    label={images.length ? 'Add another slide' : 'Upload image'}
                    onUploaded={(url) => setImages((prev) => (postFormat === 'story' ? [url] : [...prev, url]))}
                  />
                )}
              </>
            )}
            <p className="text-muted text-xs mt-1.5">
              {mediaKind === 'pdf'
                ? 'Required — posted as a native LinkedIn Document (the same mechanism behind what people call a "LinkedIn PDF carousel" — a swipeable page-by-page viewer). Up to 100MB / 300 pages.'
                : mediaKind === 'video'
                ? isYoutube
                  ? 'Required — vertical video, up to 3 minutes, posted as a YouTube Short.'
                  : isInstagram
                    ? postFormat === 'story'
                      ? 'Required — vertical video, posted as an Instagram Story (expires after 24h). Processing can take up to ~1 minute after you save.'
                      : 'Required — vertical video, posted as an Instagram Reel. Processing can take up to ~1 minute after you save.'
                    : 'Required — upload the video file to post.'
                : postFormat === 'story'
                  ? 'A photo Story is a single image.'
                  : supportsCarousel
                    ? `Optional — leave blank for a text-only post. Add 2 or more to post as a carousel${isLinkedin ? ' (swipeable gallery)' : ''}.`
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
          {mediaKind === 'pdf' ? (
            pdfUrl ? (
              pdfPagesLoading ? (
                <div
                  className="rounded-panel flex flex-col items-center justify-center gap-2 text-muted text-xs py-16"
                  style={{ border: '1px solid var(--border-subtle)', background: 'var(--fill-tertiary)' }}
                >
                  <Spinner size={20} />
                  Rendering pages…
                </div>
              ) : pdfPages.length > 0 ? (
                <div>
                  <CarouselViewer slides={pdfPages.map((url, i) => ({ idx: i, title: '', caption: '', url }))} />
                  <p className="text-muted text-[11px] text-center mt-1.5">
                    Posts as a swipeable LinkedIn Document — swipe through above to see each page.
                  </p>
                </div>
              ) : (
                <div
                  className="rounded-panel flex flex-col items-center justify-center gap-2 text-secondary py-16"
                  style={{ border: '1px solid var(--border-subtle)', background: 'var(--fill-tertiary)' }}
                >
                  <FileText size={28} className="text-sage" />
                  <span className="text-xs font-medium px-4 text-center">{pdfUrl.split('/').pop()?.replace(/^\d+-/, '') || 'document.pdf'}</span>
                  <span className="text-muted text-[11px]">Couldn't render a preview — posts fine regardless.</span>
                </div>
              )
            ) : (
              <div
                className="rounded-panel flex items-center justify-center text-muted text-xs py-16"
                style={{ border: '1px solid var(--border-subtle)', background: 'var(--fill-tertiary)' }}
              >
                Upload a PDF to preview
              </div>
            )
          ) : mediaKind === 'video' ? (
            videoUrl ? (
              <video src={videoUrl} controls className="w-full rounded-panel" style={{ border: '1px solid var(--border-subtle)' }} />
            ) : (
              <div
                className="rounded-panel flex items-center justify-center text-muted text-xs py-16"
                style={{ border: '1px solid var(--border-subtle)', background: 'var(--fill-tertiary)' }}
              >
                Upload a video to preview
              </div>
            )
          ) : isCarousel ? (
            <CarouselViewer slides={images.map((url, i) => ({ idx: i, title: '', caption: '', url }))} />
          ) : (
            <PlatformMockup
              platform={platform}
              img={images[0] ?? null}
              // Stories are vertical, not the square/1.91:1 feed-card ratio — a more accurate
              // preview than pretending it's a normal feed post.
              aspect={postFormat === 'story' ? 9 / 16 : (PLATFORM_ASPECT[platform] ?? 1)}
              caption={[caption, hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n')}
              // PlatformMockup's default "Adjust the crop →" hint is written for MediaEditor,
              // where there's an actual crop panel next to it. This composer has no crop tool at
              // all, and a blank image here is usually a deliberate text-only post (see the help
              // text below), not an unfinished crop — so the empty state needs its own wording.
              emptyHint={postFormat === 'story' ? 'Upload an image to preview the Story' : 'No image — text-only post'}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}
