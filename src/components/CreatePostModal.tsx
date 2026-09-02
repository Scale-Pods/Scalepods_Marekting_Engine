import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, CheckCircle2, X, RotateCcw, FileText } from 'lucide-react'
import { getComposerDraft, saveComposerDraft, clearComposerDraft } from '../lib/theme'
import { createManualItem, LINKEDIN_ACCOUNTS, type ContentSlide, type ContentItem } from '../lib/content'
import { triggerPublish } from '../lib/publishing'
import { toastMessage } from './Toast'
import { Modal, Button, Spinner } from './ui'
import { PlatformBadge, PlatformMockup, CarouselViewer, PLATFORM_OPTIONS, PLATFORM_ASPECT } from './mediaUi'
import { PostPreviewModal } from './postPreview'
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

  // One post gets created per selected platform, all sharing the same media — cross-posting an
  // image/carousel/video to e.g. Instagram + LinkedIn at once instead of building each
  // separately. PDF and Story stay single-platform (no other connected platform has an
  // equivalent), enforced by the effects below rather than by restricting the picker itself.
  const [platforms, setPlatforms] = useState<string[]>(restored?.platforms ?? ['instagram'])
  const [linkedinAccount, setLinkedinAccount] = useState(restored?.linkedinAccount ?? LINKEDIN_ACCOUNTS[0].value)
  // Off by default: one caption/hashtag pair goes to every selected platform. On: each platform
  // gets its own editable caption+hashtags (seeded from the shared ones the first time it's
  // edited) — only reachable/relevant with 2+ platforms selected.
  const [perPlatformCaption, setPerPlatformCaption] = useState(restored?.perPlatformCaption ?? false)
  const [captionOverrides, setCaptionOverrides] = useState<Record<string, { caption: string; hashtagsInput: string }>>(restored?.captionOverrides ?? {})
  // Which platform's mockup the "How it'll look" panel is currently showing, when there's more
  // than one to choose from — not persisted, resets to the first selected platform each time the
  // selection changes underneath it (see the clamp below).
  const [previewTab, setPreviewTab] = useState<string | null>(null)
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
  // Which page (if any) is blown up full-size — same click-to-enlarge PostPreviewModal used for
  // every other post type in the app, so a PDF page behaves like any other post thumbnail.
  const [pdfEnlargedIndex, setPdfEnlargedIndex] = useState<number | null>(null)
  // Story vs feed — Instagram-only today, and only meaningful for a single image (a carousel or
  // video can't be posted as a Story through this composer yet).
  const [postFormat, setPostFormat] = useState<'feed' | 'story'>(restored?.postFormat ?? 'feed')
  const [caption, setCaption] = useState(restored?.caption ?? '')
  const [hashtagsInput, setHashtagsInput] = useState(restored?.hashtagsInput ?? '')
  const [cta, setCta] = useState(restored?.cta ?? '')
  // Comment-to-DM automation for this specific post: someone comments `commentKeyword` on it once
  // it's live, they get one Instagram private reply with `commentDmMessage` (+ the asset link).
  // Instagram-only — Meta's Private Replies mechanism is per-platform, and only IG is wired up.
  const [commentAutomationEnabled, setCommentAutomationEnabled] = useState(restored?.commentAutomationEnabled ?? false)
  const [commentKeyword, setCommentKeyword] = useState(restored?.commentKeyword ?? '')
  const [commentDmMessage, setCommentDmMessage] = useState(restored?.commentDmMessage ?? '')
  const [commentAssetUrl, setCommentAssetUrl] = useState(restored?.commentAssetUrl ?? '')
  // Optional follow-gate nested inside the automation above: instead of sending commentDmMessage
  // straight away, ask them to follow first (with a quick-reply button), and only send it once a
  // real server-side check confirms they actually did — see FollowGate in content.ts.
  const [followGateEnabled, setFollowGateEnabled] = useState(restored?.followGateEnabled ?? false)
  const [followGateMessage, setFollowGateMessage] = useState(
    restored?.followGateMessage ?? "Hey! 👋 Follow our account first, then tap \"I've followed\" and I'll send you the link."
  )
  const [followGateButtonText, setFollowGateButtonText] = useState(restored?.followGateButtonText ?? "I've followed")
  const [followGateNotFollowingMessage, setFollowGateNotFollowingMessage] = useState(
    restored?.followGateNotFollowingMessage ?? "It looks like you haven't followed yet. Please follow us and then tap the button again."
  )
  // Public reply-back on the comment itself, independent of the follow-gate above — acknowledges
  // the comment for anyone reading it, e.g. "Sent! Check your DMs".
  const [publicReplyEnabled, setPublicReplyEnabled] = useState(restored?.publicReplyEnabled ?? false)
  const [publicReplyMessage, setPublicReplyMessage] = useState(restored?.publicReplyMessage ?? 'Sent! ✅ Check your DMs 📩')
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

  const hasLinkedin = platforms.includes('linkedin')
  const hasInstagram = platforms.includes('instagram')
  const isMultiPlatform = platforms.length > 1
  // Instagram video publishes as a Reel (its own media_type on IG's side, distinct from the
  // Story/Feed image toggle below) — the n8n Publishing Engine now has a matching branch that
  // creates a REELS container and polls until it's processed before publishing.
  const supportsVideoAll = platforms.every((p) => p === 'facebook' || p === 'youtube' || p === 'instagram')
  // Story only has an Instagram equivalent, and a Document post only has a LinkedIn one — both
  // stay single-platform, so these only ever apply when exactly that one platform is selected
  // alone (not merely present alongside others).
  const supportsStorySingle = platforms.length === 1 && hasInstagram
  // A LinkedIn Document post (real API: Documents API + /rest/posts, media.id: urn:li:document:…)
  // — the n8n Publishing Engine's matching branch creates the document, waits for it to finish
  // processing, then posts it. Distinct from LinkedIn's multi-image carousel (`isCarousel` below).
  const supportsPdfSingle = platforms.length === 1 && hasLinkedin
  // YouTube only supports Shorts through this composer — there's no photo/text post type for
  // it, so unlike Facebook it isn't a Photo/Video choice, it's just always video.
  const forcedVideo = platforms.includes('youtube')
  // Carousel (2+ images) only has an API path on LinkedIn/Instagram — true only when every
  // currently selected platform supports it, same idea as supportsVideoAll below.
  const supportsCarouselAll = platforms.every((p) => p === 'linkedin' || p === 'instagram')
  const isCarousel = supportsCarouselAll && mediaKind === 'image' && images.length > 1
  // Falls back to the first selected platform whenever the tab last clicked isn't (or is no
  // longer) part of the current selection — e.g. right after adding/removing a platform.
  const activePreviewPlatform = previewTab && platforms.includes(previewTab) ? previewTab : platforms[0]
  // Comment-to-DM needs a post that actually has a public comment thread Meta will send us a
  // webhook for. Stories are excluded: they have replies, not comments, and no comments webhook.
  // Instagram-only for now — the same Private Replies mechanism exists for Facebook Pages but
  // that branch isn't built yet.
  const supportsCommentAutomation = hasInstagram && postFormat !== 'story'
  // Guards the *adding* direction — without this, checking an incompatible platform while e.g. a
  // carousel is already active wouldn't get dropped by anything (the drop effects below only
  // fire when media/format changes, not when the platform selection changes), so the carousel
  // would silently break for the still-compatible platforms too, not just refuse the new one.
  function platformCompatible(p: string): boolean {
    if (mediaKind === 'pdf') return p === 'linkedin'
    if (postFormat === 'story') return p === 'instagram'
    if (mediaKind === 'video') return p === 'facebook' || p === 'youtube' || p === 'instagram'
    if (images.length > 1) return p === 'linkedin' || p === 'instagram'
    if (p === 'youtube') return false // YouTube has no photo/text mode in this composer
    return true
  }

  // Drop whatever the current selection doesn't support the moment media/format changes make it
  // invalid, so the composer never lets you build something the Publishing Engine can't actually
  // fan out to every selected platform — carousel is LinkedIn/Instagram only, video excludes
  // LinkedIn, and Story/PDF are single-platform (Instagram/LinkedIn respectively), so picking
  // either collapses the selection down to just that platform.
  useEffect(() => {
    if (images.length > 1) {
      setPlatforms((prev) => {
        const next = prev.filter((p) => p === 'linkedin' || p === 'instagram')
        return next.length ? next : ['instagram']
      })
    }
  }, [images.length])
  useEffect(() => {
    if (mediaKind === 'video') {
      setPlatforms((prev) => {
        const next = prev.filter((p) => p === 'facebook' || p === 'youtube' || p === 'instagram')
        return next.length ? next : ['instagram']
      })
    }
  }, [mediaKind])
  useEffect(() => {
    if (mediaKind === 'pdf') setPlatforms(['linkedin'])
  }, [mediaKind])
  useEffect(() => {
    if (postFormat === 'story') setPlatforms(['instagram'])
  }, [postFormat])
  useEffect(() => {
    if (!supportsPdfSingle && mediaKind === 'pdf') { setMediaKind('image'); setPdfUrl(null) }
  }, [supportsPdfSingle, mediaKind])
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
    if (!supportsStorySingle && postFormat === 'story') setPostFormat('feed')
  }, [supportsStorySingle, postFormat])
  useEffect(() => {
    if (isCarousel && postFormat === 'story') setPostFormat('feed')
  }, [isCarousel, postFormat])
  // Switching to a Story (or dropping Instagram) makes comment automation impossible — turn it
  // off rather than silently saving an automation that could never fire.
  useEffect(() => {
    if (!supportsCommentAutomation && commentAutomationEnabled) setCommentAutomationEnabled(false)
  }, [supportsCommentAutomation, commentAutomationEnabled])

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
      platforms, linkedinAccount, perPlatformCaption, captionOverrides, images, mediaKind, videoUrl, pdfUrl, postFormat,
      caption, hashtagsInput, cta, commentAutomationEnabled, commentKeyword, commentDmMessage, commentAssetUrl,
      followGateEnabled, followGateMessage, followGateButtonText, followGateNotFollowingMessage,
      publicReplyEnabled, publicReplyMessage,
      when, scheduledDate, scheduledTime,
    })
  }, [done, platforms, linkedinAccount, perPlatformCaption, captionOverrides, images, mediaKind, videoUrl, pdfUrl, postFormat, caption, hashtagsInput, cta, commentAutomationEnabled, commentKeyword, commentDmMessage, commentAssetUrl, followGateEnabled, followGateMessage, followGateButtonText, followGateNotFollowingMessage, publicReplyEnabled, publicReplyMessage, when, scheduledDate, scheduledTime])

  function discardDraft() {
    clearComposerDraft()
    setDraftRestored(false)
    setPlatforms(['instagram'])
    setLinkedinAccount(LINKEDIN_ACCOUNTS[0].value)
    setPerPlatformCaption(false)
    setCaptionOverrides({})
    setImages([])
    setMediaKind('image')
    setVideoUrl(null)
    setPdfUrl(null)
    setPostFormat('feed')
    setCaption('')
    setHashtagsInput('')
    setCta('')
    setCommentAutomationEnabled(false)
    setCommentKeyword('')
    setCommentDmMessage('')
    setCommentAssetUrl('')
    setFollowGateEnabled(false)
    setFollowGateMessage("Hey! 👋 Follow our account first, then tap \"I've followed\" and I'll send you the link.")
    setFollowGateButtonText("I've followed")
    setFollowGateNotFollowingMessage("It looks like you haven't followed yet. Please follow us and then tap the button again.")
    setPublicReplyEnabled(false)
    setPublicReplyMessage('Sent! ✅ Check your DMs 📩')
    setWhen('now')
    setScheduledDate('')
    setScheduledTime('')
  }

  // A video/PDF post without the file isn't a thing — require it explicitly rather than letting
  // caption text alone satisfy "has content" the way it does for an image/text post. When
  // per-platform captions are on, the shared `caption` field can legitimately be left blank
  // while every platform still has real text in its own override — check those too, or Save
  // stays disabled despite there being content to save.
  const hasCaptionText = caption.trim() || (isMultiPlatform && perPlatformCaption && platforms.some((p) => captionOverrides[p]?.caption?.trim()))
  const hasContent = mediaKind === 'video' ? Boolean(videoUrl) : mediaKind === 'pdf' ? Boolean(pdfUrl) : Boolean(images.length || hasCaptionText)
  // An automation that's switched on but has no keyword or no message could never do anything
  // useful, so block saving rather than storing a broken config that silently never fires.
  const commentAutomationActive = supportsCommentAutomation && commentAutomationEnabled
  const followGateActive = commentAutomationActive && followGateEnabled
  const followGateValid = !followGateActive || Boolean(followGateMessage.trim() && followGateButtonText.trim() && followGateNotFollowingMessage.trim())
  const publicReplyActive = commentAutomationActive && publicReplyEnabled
  const publicReplyValid = !publicReplyActive || Boolean(publicReplyMessage.trim())
  const commentAutomationValid = !commentAutomationActive || Boolean(commentKeyword.trim() && commentDmMessage.trim() && followGateValid && publicReplyValid)
  // Previously this ignored `when` entirely, so you could pick "Set a target date", leave the
  // date blank, and save — the empty date was silently coerced to null and the post behaved
  // like an immediate one. That's the bug that made a scheduled post publish instantly.
  const canSave = hasContent && commentAutomationValid && (!scheduling || (targetValid && !targetInPast))

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      const slides: ContentSlide[] = images.map((url, i) => ({ idx: i, title: '', caption: '', url }))
      // 'story' now has to win over the video check — a video Story is content_type:'story'
      // same as a photo Story (the Publishing Engine tells them apart itself, from whether
      // media_url is a video file), not 'ugc_video' (that's specifically a feed Reel).
      const mediaUrl = mediaKind === 'video' ? videoUrl : mediaKind === 'pdf' ? pdfUrl : (images[0] ?? null)
      // One content_item per selected platform, all pointing at this same upload — a real
      // "cross-post" is N separate items rather than one multi-platform row, so each fans out
      // through the exact same single-platform pipeline everything else already uses (Post
      // now/Schedule, the Publishing Engine's per-platform branches, etc). Tagged with a shared
      // group id only when there's actually more than one, so a normal single-platform post's
      // metadata looks exactly like it always has.
      const crosspostGroupId = platforms.length > 1 ? crypto.randomUUID() : null
      const createdItems: ContentItem[] = []
      for (const p of platforms) {
        const useOverride = isMultiPlatform && perPlatformCaption
        const pCaption = useOverride ? (captionOverrides[p]?.caption ?? caption) : caption
        const pHashtagsInput = useOverride ? (captionOverrides[p]?.hashtagsInput ?? hashtagsInput) : hashtagsInput
        const pHashtags = pHashtagsInput.split(/[\s,]+/).map((h) => h.trim().replace(/^#/, '')).filter(Boolean)
        const contentType =
          postFormat === 'story' ? 'story' :
          mediaKind === 'pdf' ? 'linkedin_pdf' :
          mediaKind === 'video' ? 'ugc_video' :
          isCarousel ? 'carousel' :
          images[0] ? 'static_image' : 'social_caption'
        const item = await createManualItem({
          profileId,
          platform: p,
          contentType,
          title: pCaption.trim() ? pCaption.trim().slice(0, 60) : null,
          body: pCaption.trim(),
          mediaUrl,
          slides: contentType === 'carousel' ? slides : [],
          hashtags: pHashtags,
          cta: cta.trim(),
          scheduledDate: scheduling && scheduledDate ? scheduledDate : null,
          scheduledTime: scheduling && scheduledTime ? scheduledTime : null,
          scheduledAt: targetInstant ? targetInstant.toISOString() : null,
          linkedinAccount: p === 'linkedin' ? linkedinAccount : null,
          crosspostGroupId,
          // Instagram-only, and only on the Instagram sibling when cross-posting — the other
          // platforms' items must not carry an automation their branch can't honour.
          commentAutomation: commentAutomationActive && p === 'instagram'
            ? {
                enabled: true,
                keyword: commentKeyword.trim(),
                message: commentDmMessage.trim(),
                ...(commentAssetUrl.trim() ? { asset_url: commentAssetUrl.trim() } : {}),
                ...(followGateActive
                  ? {
                      follow_gate: {
                        enabled: true,
                        follow_message: followGateMessage.trim(),
                        button_text: followGateButtonText.trim(),
                        not_following_message: followGateNotFollowingMessage.trim(),
                      },
                    }
                  : {}),
                ...(publicReplyActive
                  ? { public_reply: { enabled: true, message: publicReplyMessage.trim() } }
                  : {}),
              }
            : null,
        })
        createdItems.push(item)
      }
      // A target date now actually schedules. Before this the date was only a tag: the post
      // landed in "Ready to publish" and you still had to click Schedule there — and clicking
      // the adjacent, primary-styled "Post now" silently discarded the date and published
      // immediately, which is exactly what testing hit.
      if (targetInstant) await Promise.all(createdItems.map((item) => triggerPublish(item.id, false)))
      clearComposerDraft()
      setDone(true)
    } catch (err) {
      setError(toastMessage(err, 'Could not save this post'))
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    const n = platforms.length
    return (
      <Modal title={n > 1 ? 'Posts created' : 'Post created'} onClose={onCreated}>
        <div className="flex flex-col items-center text-center gap-3 py-4">
          <CheckCircle2 size={32} className="text-sage" />
          <div className="font-medium">{targetInstant ? 'Scheduled' : 'Sent to Publishing'}</div>
          <p className="text-secondary text-sm max-w-xs">
            {n > 1 && `Created ${n} posts (one per platform) sharing this media. `}
            {targetInstant
              ? `${n > 1 ? 'They are' : 'Your post is'} scheduled for ${targetInstant.toLocaleString()} and will publish automatically. You can see ${n > 1 ? 'them' : 'it'} under Publishing → Scheduled.`
              : `${n > 1 ? 'They are' : 'Your post is'} saved and ready — head to Publishing to post ${n > 1 ? 'them' : 'it'} now or schedule ${n > 1 ? 'them' : 'it'}.`}
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
            <div className="label mb-2">Platform{platforms.length > 1 ? 's' : ''}</div>
            {/* Dimming the unselected options to 45% opacity (the old treatment) made every
                platform except the active one look faded and disabled rather than just
                "not chosen" — the opposite of inviting. Every option now stays full-strength
                and is distinguished by its own button frame instead: a filled, ringed card
                when active, a plain outlined one otherwise. Bigger tap targets too.
                Multi-select: click toggles a platform in/out of the set (the last one can't be
                unchecked — a post needs somewhere to go). Switching mediaKind/postFormat to
                something an already-selected platform doesn't support drops that platform (see
                the effects above); the reverse — trying to ADD a platform that doesn't support
                the *current* media — is blocked right here instead, dimmed with a tooltip
                explaining why, so checking Facebook mid-carousel can't silently break the
                carousel for Instagram/LinkedIn too. */}
            <div className="flex gap-2 flex-wrap">
              {PLATFORM_OPTIONS.map((p) => {
                const active = platforms.includes(p.value)
                const disabled = !active && !platformCompatible(p.value)
                return (
                  <button
                    key={p.value}
                    type="button"
                    disabled={disabled}
                    title={disabled ? `${p.label} doesn't support this post type — change the media/post type first.` : undefined}
                    onClick={() => setPlatforms((prev) => {
                      if (active) return prev.length > 1 ? prev.filter((x) => x !== p.value) : prev
                      if (!platformCompatible(p.value)) return prev
                      return [...prev, p.value]
                    })}
                    className="rounded-full transition-all disabled:cursor-not-allowed"
                    style={{
                      padding: 4,
                      background: active ? 'var(--fill-primary)' : 'var(--fill-tertiary)',
                      outline: active ? '2px solid var(--accent-green)' : '1px solid var(--border-subtle)',
                      outlineOffset: -1,
                      transform: active ? 'scale(1.05)' : undefined,
                      opacity: disabled ? 0.35 : 1,
                    }}
                  >
                    <PlatformBadge platform={p.value} />
                  </button>
                )
              })}
            </div>
            {isMultiPlatform && (
              <p className="text-muted text-xs mt-1.5">
                Posting to {platforms.length} platforms at once — one post is created for each, sharing this media.
              </p>
            )}
          </div>

          {hasLinkedin && (
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

          {(supportsVideoAll || supportsStorySingle || supportsPdfSingle) && (
            <div>
              <div className="label mb-2">Post type</div>
              <div className="flex items-center gap-2 flex-wrap">
                {supportsPdfSingle ? (
                  <>
                    <button type="button" onClick={() => setMediaKind('image')} className={mediaKind !== 'pdf' ? 'badge' : 'badge opacity-40'} style={{ textTransform: 'none' }}>
                      Feed post
                    </button>
                    <button type="button" onClick={() => setMediaKind('pdf')} className={mediaKind === 'pdf' ? 'badge badge-blue' : 'badge badge-blue opacity-40'} style={{ textTransform: 'none' }}>
                      PDF document
                    </button>
                  </>
                ) : supportsStorySingle && !isCarousel ? (
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
                    <button
                      type="button"
                      onClick={() => { setMediaKind('video'); setPostFormat('feed') }}
                      className={mediaKind === 'video' && postFormat === 'feed' ? 'badge badge-blue' : 'badge badge-blue opacity-40'}
                      style={{ textTransform: 'none' }}
                    >
                      Reel
                    </button>
                  </>
                ) : supportsVideoAll && !isCarousel ? (
                  <>
                    <button type="button" onClick={() => setMediaKind('image')} className={mediaKind !== 'video' ? 'badge' : 'badge opacity-40'} style={{ textTransform: 'none' }}>
                      Photo{isMultiPlatform ? '/carousel' : ''}
                    </button>
                    <button type="button" onClick={() => setMediaKind('video')} className={mediaKind === 'video' ? 'badge badge-blue' : 'badge badge-blue opacity-40'} style={{ textTransform: 'none' }}>
                      Video{isMultiPlatform ? ' (Reel/Short where supported)' : ''}
                    </button>
                  </>
                ) : null}
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
              {mediaKind === 'video' ? 'Video' : mediaKind === 'pdf' ? 'PDF' : supportsCarouselAll ? 'Images' : 'Image'}
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
                {(images.length === 0 || (supportsCarouselAll && postFormat !== 'story')) && (
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
                ? isMultiPlatform
                  ? `Required — one video, posted as ${platforms.map((p) => (p === 'instagram' ? 'a Reel on Instagram' : p === 'youtube' ? 'a Short on YouTube' : 'a video on Facebook')).join(', ')}. Processing can take up to ~1 minute per platform after you save.`
                  : platforms[0] === 'youtube'
                    ? 'Required — vertical video, up to 3 minutes, posted as a YouTube Short.'
                    : platforms[0] === 'instagram'
                      ? postFormat === 'story'
                        ? 'Required — vertical video, posted as an Instagram Story (expires after 24h). Processing can take up to ~1 minute after you save.'
                        : 'Required — vertical video, posted as an Instagram Reel. Processing can take up to ~1 minute after you save.'
                      : 'Required — upload the video file to post.'
                : postFormat === 'story'
                  ? 'A photo Story is a single image.'
                  : supportsCarouselAll
                    ? `Optional — leave blank for a text-only post. Add 2 or more to post as a carousel${hasLinkedin ? ' (swipeable gallery)' : ''}.`
                    : 'Optional — leave blank for a text-only post.'}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label !mb-0">Caption{isMultiPlatform ? ' & hashtags' : ''}</label>
              {isMultiPlatform && (
                <label className="flex items-center gap-1.5 text-xs text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={perPlatformCaption}
                    onChange={(e) => setPerPlatformCaption(e.target.checked)}
                  />
                  Different per platform
                </label>
              )}
            </div>
            {isMultiPlatform && perPlatformCaption ? (
              // One block per selected platform — each starts out showing the shared caption/
              // hashtags below until edited, so switching this on never blanks anything out.
              <div className="space-y-3">
                {platforms.map((p) => (
                  <div key={p} className="p-3 rounded-lg" style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}>
                    <div className="mb-2"><PlatformBadge platform={p} size="sm" /></div>
                    <textarea
                      className="input"
                      rows={3}
                      value={captionOverrides[p]?.caption ?? caption}
                      onChange={(e) => setCaptionOverrides((prev) => ({ ...prev, [p]: { caption: e.target.value, hashtagsInput: prev[p]?.hashtagsInput ?? hashtagsInput } }))}
                      placeholder="Write your post…"
                    />
                    <input
                      className="input mt-2"
                      value={captionOverrides[p]?.hashtagsInput ?? hashtagsInput}
                      onChange={(e) => setCaptionOverrides((prev) => ({ ...prev, [p]: { caption: prev[p]?.caption ?? caption, hashtagsInput: e.target.value } }))}
                      placeholder="#GrowthOS #B2B"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <textarea
                  className="input"
                  rows={4}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Write your post…"
                />
                <div className="mt-3">
                  <label className="label">Hashtags</label>
                  <input
                    className="input mt-1.5"
                    value={hashtagsInput}
                    onChange={(e) => setHashtagsInput(e.target.value)}
                    placeholder="#GrowthOS #B2B"
                  />
                </div>
              </>
            )}
          </div>

          <div>
            <label className="label">CTA (optional)</label>
            <input className="input mt-1.5" value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Book a demo" />
          </div>

          {supportsCommentAutomation && (
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={commentAutomationEnabled}
                  onChange={(e) => setCommentAutomationEnabled(e.target.checked)}
                />
                <span className="label !mb-0">Auto-DM people who comment a keyword</span>
              </label>
              {commentAutomationEnabled ? (
                <div
                  className="mt-2 p-3 rounded-lg space-y-3"
                  style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
                >
                  <div>
                    <label className="label">Trigger keyword</label>
                    <input
                      className="input mt-1.5"
                      value={commentKeyword}
                      onChange={(e) => setCommentKeyword(e.target.value)}
                      placeholder="SALES"
                    />
                    <p className="text-muted text-xs mt-1.5">
                      Case-insensitive. Fires when a comment contains this word — put the same word in your caption
                      ("Comment SALES to get…") so people know what to type.
                    </p>
                  </div>
                  <div>
                    <label className="label">DM to send{followGateEnabled ? ' (after they follow)' : ''}</label>
                    <textarea
                      className="input mt-1.5"
                      rows={3}
                      value={commentDmMessage}
                      onChange={(e) => setCommentDmMessage(e.target.value)}
                      placeholder="Thanks for commenting! Here's the guide you asked for:"
                    />
                  </div>
                  <div>
                    <label className="label">Link or file (optional)</label>
                    <input
                      className="input mt-1.5"
                      value={commentAssetUrl}
                      onChange={(e) => setCommentAssetUrl(e.target.value)}
                      placeholder="https://scalepods.co/guide.pdf"
                    />
                    <div className="mt-2">
                      <AssetUploader
                        pathPrefix={`manual/${profileId}`}
                        accept="application/pdf,image/*"
                        label="Upload a file instead"
                        onUploaded={(url) => setCommentAssetUrl(url)}
                      />
                    </div>
                  </div>
                  <p className="text-muted text-xs">
                    Instagram allows exactly one automated reply per comment, sent within 7 days of it — so the first
                    message is always a single reply, not a conversation. Everything after that (including the
                    follow-gate check below) happens over the DM thread that reply opens.
                  </p>

                  <div className="pt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <label className="flex items-center gap-2 cursor-pointer mt-3">
                      <input type="checkbox" checked={followGateEnabled} onChange={(e) => setFollowGateEnabled(e.target.checked)} />
                      <span className="label !mb-0">Require them to follow us before sending the link</span>
                    </label>
                    {followGateEnabled ? (
                      <div className="mt-2 space-y-3">
                        <div>
                          <label className="label">Follow request message</label>
                          <textarea
                            className="input mt-1.5"
                            rows={2}
                            value={followGateMessage}
                            onChange={(e) => setFollowGateMessage(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="label">Button text</label>
                          <input className="input mt-1.5" value={followGateButtonText} onChange={(e) => setFollowGateButtonText(e.target.value)} />
                        </div>
                        <div>
                          <label className="label">If they haven't followed yet</label>
                          <textarea
                            className="input mt-1.5"
                            rows={2}
                            value={followGateNotFollowingMessage}
                            onChange={(e) => setFollowGateNotFollowingMessage(e.target.value)}
                          />
                        </div>
                        <p className="text-muted text-xs">
                          They get the message above with an "{followGateButtonText || 'I’ve followed'}" button instead of the
                          link. Tapping it triggers a real server-side follow check (Meta's Instagram API) before the DM above is
                          sent — a tap alone is never trusted as proof.
                        </p>
                      </div>
                    ) : (
                      <p className="text-muted text-xs mt-1.5">Off — the DM and link above go out immediately once they comment the keyword.</p>
                    )}
                  </div>

                  <div className="pt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <label className="flex items-center gap-2 cursor-pointer mt-3">
                      <input type="checkbox" checked={publicReplyEnabled} onChange={(e) => setPublicReplyEnabled(e.target.checked)} />
                      <span className="label !mb-0">Also reply on the comment publicly</span>
                    </label>
                    {publicReplyEnabled ? (
                      <div className="mt-2">
                        <label className="label">Public reply</label>
                        <textarea
                          className="input mt-1.5"
                          rows={2}
                          value={publicReplyMessage}
                          onChange={(e) => setPublicReplyMessage(e.target.value)}
                        />
                        <p className="text-muted text-xs mt-1.5">
                          Posted as a reply to their comment: "@{'{'}their username{'}'} {publicReplyMessage || '…'}" — visible to
                          anyone, in addition to the private DM above.
                        </p>
                      </div>
                    ) : (
                      <p className="text-muted text-xs mt-1.5">Off — only the private DM goes out, nothing shows in the comments.</p>
                    )}
                  </div>

                  {!commentAutomationValid && (
                    <p className="text-[var(--accent-orange)] text-xs">
                      {!(commentKeyword.trim() && commentDmMessage.trim())
                        ? 'Add both a trigger keyword and a DM message, or switch this off.'
                        : !followGateValid
                          ? 'Fill in the follow request message, button text, and not-followed message, or turn the follow gate off.'
                          : 'Add a public reply message, or turn that off.'}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted text-xs mt-1.5">
                  Someone comments your keyword on this post → they get a DM with your link or file, automatically.
                </p>
              )}
            </div>
          )}

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
                  <CarouselViewer
                    slides={pdfPages.map((url, i) => ({ idx: i, title: '', caption: '', url }))}
                    fit="contain"
                    onEnlarge={setPdfEnlargedIndex}
                  />
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
            <CarouselViewer
              slides={images.map((url, i) => ({ idx: i, title: '', caption: '', url }))}
              aspect={PLATFORM_ASPECT[activePreviewPlatform] ?? 1}
            />
          ) : (
            <>
              {/* Which platform's mockup is showing — only matters here, since this is the one
                  view whose chrome/aspect ratio actually differs per platform (a video/PDF/
                  carousel post is single-platform or looks the same regardless in this
                  composer). */}
              {isMultiPlatform && (
                <div className="flex gap-1.5 justify-center mb-2">
                  {platforms.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPreviewTab(p)}
                      className="rounded-full"
                      style={{
                        padding: 3,
                        outline: activePreviewPlatform === p ? '2px solid var(--accent-green)' : '1px solid var(--border-subtle)',
                        outlineOffset: -1,
                      }}
                      aria-label={`Preview ${p}`}
                    >
                      <PlatformBadge platform={p} size="sm" />
                    </button>
                  ))}
                </div>
              )}
              <PlatformMockup
                platform={activePreviewPlatform}
                img={images[0] ?? null}
                // Stories are vertical, not the square/1.91:1 feed-card ratio — a more accurate
                // preview than pretending it's a normal feed post.
                aspect={postFormat === 'story' ? 9 / 16 : (PLATFORM_ASPECT[activePreviewPlatform] ?? 1)}
                caption={
                  isMultiPlatform && perPlatformCaption
                    ? [captionOverrides[activePreviewPlatform]?.caption ?? caption, captionOverrides[activePreviewPlatform]?.hashtagsInput ?? hashtagsInput].filter(Boolean).join('\n\n')
                    : [caption, hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n')
                }
                // PlatformMockup's default "Adjust the crop →" hint is written for MediaEditor,
                // where there's an actual crop panel next to it. This composer has no crop tool at
                // all, and a blank image here is usually a deliberate text-only post (see the help
                // text below), not an unfinished crop — so the empty state needs its own wording.
                emptyHint={postFormat === 'story' ? 'Upload an image to preview the Story' : 'No image — text-only post'}
              />
            </>
          )}
        </div>
      </div>
      {pdfEnlargedIndex !== null && (
        <PostPreviewModal
          // `slides` drives the multi-page swipeable view, but PostPreviewModal only treats it
          // as a carousel when there's more than one — a single-page PDF needs `img` too, as the
          // plain-image fallback for that case. PDF is always single-platform LinkedIn, so
          // platforms[0] is always 'linkedin' here.
          img={pdfPages[pdfEnlargedIndex] ?? null}
          platform={platforms[0]}
          slides={pdfPages.map((url, i) => ({ idx: i, title: `Page ${i + 1}`, caption: '', url }))}
          initialSlideIndex={pdfEnlargedIndex}
          onClose={() => setPdfEnlargedIndex(null)}
        />
      )}
    </Modal>
  )
}
