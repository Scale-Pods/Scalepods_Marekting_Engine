import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { JSONContent } from '@tiptap/react'
import { Send, FileText, X, ExternalLink, AlertTriangle, Eye } from 'lucide-react'
import { useBlogPost, queryClient, qk } from '../lib/queries'
import {
  createBlogPost, updateBlogPost, triggerBlogPublish, slugify,
  BLOG_PUBLISH_ENABLED, BLOG_CATEGORY_SUGGESTIONS, type BlogPost,
} from '../lib/blog'
import { sectionsToTiptapDoc, tiptapDocToSections } from '../lib/blogSerializer'
import { PageHeader, Button, Spinner } from '../components/ui'
import { useToast, toastMessage } from '../components/Toast'
import AssetUploader from '../components/AssetUploader'
import RichTextEditor from '../components/blog/RichTextEditor'
import { BlogPreviewModal } from '../components/blog/BlogPreview'

function BannerSlot({
  label, url, onUploaded, onRemove, storagePrefix,
}: {
  label: string
  url: string | null
  onUploaded: (url: string) => void
  onRemove: () => void
  storagePrefix: string
}) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      {url ? (
        <div className="relative">
          <img src={url} alt={label} className="w-full h-auto rounded-lg" />
          <button
            type="button"
            onClick={onRemove}
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full flex items-center justify-center text-white"
            style={{ background: 'var(--accent-orange)' }}
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="w-full h-24 rounded-lg flex flex-col items-center justify-center gap-2" style={{ background: 'var(--fill-tertiary)' }}>
          <FileText size={18} className="text-muted" />
          <AssetUploader pathPrefix={storagePrefix} label="Upload" onUploaded={onUploaded} />
        </div>
      )}
    </div>
  )
}

export default function BlogPostEditor() {
  const params = useParams<{ id: string }>()
  const isNew = !params.id || params.id === 'new'
  const navigate = useNavigate()
  const toast = useToast()

  const { data: existing, isLoading } = useBlogPost(isNew ? undefined : params.id)

  const [postId, setPostId] = useState<string | null>(isNew ? null : params.id ?? null)
  const [tempId] = useState(() => crypto.randomUUID())
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [category, setCategory] = useState('Article')
  const [excerpt, setExcerpt] = useState('')
  const [bannerUrlDark, setBannerUrlDark] = useState<string | null>(null)
  const [bannerUrlLight, setBannerUrlLight] = useState<string | null>(null)
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [doc, setDoc] = useState<JSONContent>(() => sectionsToTiptapDoc([]))
  const [ready, setReady] = useState(isNew)
  const [saving, setSaving] = useState<'draft' | 'publish' | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Full-field hydration runs ONCE per post, guarded by this ref rather than re-running on
  // every `existing` change — Realtime (queries.ts) refetches this row whenever n8n updates it
  // post-publish, and re-running the full sync on that refetch would stomp any edit the user
  // made to title/slug/etc. in the meantime. Status/slug are tracked separately below because
  // those two ARE meant to react live to that refetch.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (existing && !hydratedRef.current) {
      hydratedRef.current = true
      setPostId(existing.id)
      setTitle(existing.title)
      setSlug(existing.slug)
      setSlugEdited(true)
      setCategory(existing.category)
      setExcerpt(existing.excerpt)
      setBannerUrlDark(existing.banner_url_dark ?? existing.banner_url)
      setBannerUrlLight(existing.banner_url_light)
      setCtaLabel(existing.cta_label ?? '')
      setCtaUrl(existing.cta_url ?? '')
      setDoc(sectionsToTiptapDoc(existing.sections))
      setReady(true)
    }
  }, [existing])

  // Reacts live to n8n flipping status after a publish attempt completes (success or failure),
  // via the same Realtime subscription that refetches `existing`. Doesn't touch any other field.
  const publishedSlug = existing?.status === 'published' ? existing.slug : null
  const publishFailed = existing?.status === 'failed'
  useEffect(() => {
    if (existing?.status === 'published' || existing?.status === 'failed') setPublishing(false)
  }, [existing?.status])

  useEffect(() => {
    if (!slugEdited) setSlug(slugify(title))
  }, [title, slugEdited])

  async function onSave(publish: boolean) {
    if (!title.trim()) return toast.error('Add a title before saving.')
    if (!slug.trim()) return toast.error('Add a URL slug before saving.')

    setSaving(publish ? 'publish' : 'draft')
    try {
      const { sections, droppedImages } = tiptapDocToSections(doc)
      if (droppedImages > 0) {
        toast.info(`${droppedImages} extra image${droppedImages > 1 ? 's were' : ' was'} removed — only one image per section reaches the site.`)
      }

      const payload = {
        title: title.trim(),
        slug: slug.trim(),
        category: category.trim() || 'Article',
        excerpt: excerpt.trim(),
        bannerUrlDark,
        bannerUrlLight,
        sections,
        ctaLabel: ctaLabel.trim() || null,
        ctaUrl: ctaUrl.trim() || null,
      }

      let saved: BlogPost
      if (postId) {
        saved = await updateBlogPost(postId, payload)
      } else {
        saved = await createBlogPost(payload)
        setPostId(saved.id)
        navigate(`/blog/${saved.id}`, { replace: true })
      }
      queryClient.invalidateQueries({ queryKey: qk.blogPosts })
      queryClient.invalidateQueries({ queryKey: qk.blogPost(saved.id) })

      if (publish) {
        setPublishing(true)
        await triggerBlogPublish(saved.id)
        // n8n owns the status flip from here — Realtime picks up 'published' or 'failed' on
        // this row automatically (see the effect above), no polling needed.
        toast.info('Publishing to scalepods.co…')
      } else {
        toast.success('Draft saved')
      }
    } catch (err) {
      toast.error(toastMessage(err, 'Could not save this post'))
    } finally {
      setSaving(null)
    }
  }

  if (!isNew && isLoading) {
    return <div className="flex justify-center py-16"><Spinner size={24} /></div>
  }

  const storagePrefix = `blog/${postId ?? tempId}`

  return (
    <div>
      <PageHeader
        title={isNew ? 'New post' : title || 'Untitled post'}
        subtitle="Draft here, then publish straight to scalepods.co."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => navigate('/blog')}>
              <X size={15} /> Close
            </Button>
            <Button variant="ghost" onClick={() => setPreviewOpen(true)}>
              <Eye size={15} /> Preview
            </Button>
            <Button variant="ghost" loading={saving === 'draft'} disabled={saving !== null} onClick={() => onSave(false)}>
              Save draft
            </Button>
            <Button
              loading={saving === 'publish' || publishing}
              disabled={saving !== null || publishing || !BLOG_PUBLISH_ENABLED}
              title={BLOG_PUBLISH_ENABLED ? undefined : 'Publishing to scalepods.co is not wired up yet — see docs/blog-module.md'}
              onClick={() => onSave(true)}
            >
              <Send size={15} /> Publish
            </Button>
          </div>
        }
      />

      {!BLOG_PUBLISH_ENABLED && (
        <div className="text-xs px-3 py-2 rounded-lg mb-5" style={{ background: 'var(--fill-tertiary)', color: 'var(--text-secondary)' }}>
          Publishing to scalepods.co isn't wired up yet (see docs/blog-module.md) — drafts save fine, Publish is disabled until then.
        </div>
      )}

      {publishing && (
        <div className="text-xs px-3 py-2 rounded-lg mb-4 w-fit" style={{ background: 'var(--fill-tertiary)', color: 'var(--text-secondary)' }}>
          Publishing to scalepods.co — this updates live once the site confirms, no need to reload.
        </div>
      )}

      {publishFailed && (
        <div className="text-xs px-3 py-2 rounded-lg mb-4 w-fit flex items-center gap-1.5" style={{ background: 'var(--fill-tertiary)', color: 'var(--accent-orange)' }}>
          <AlertTriangle size={13} /> The last publish attempt failed on the site's side — check the n8n execution, then try Publish again.
        </div>
      )}

      {publishedSlug && (
        <a
          href={`https://www.scalepods.co/blog/${publishedSlug}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-sage flex items-center gap-1 hover:underline mb-4 w-fit"
        >
          View live <ExternalLink size={11} />
        </a>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div>
            <label className="label">Title</label>
            <input className="input mt-1.5 text-lg font-medium" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Post title" />
          </div>

          <div>
            <label className="label">URL slug</label>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-muted text-xs shrink-0">scalepods.co/blog/</span>
              <input
                className="input text-xs !py-1.5"
                value={slug}
                onChange={(e) => { setSlug(slugify(e.target.value)); setSlugEdited(true) }}
              />
            </div>
          </div>

          <div>
            <label className="label">Excerpt</label>
            <textarea
              className="input mt-1.5"
              rows={2}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="One or two sentences shown on the blog listing card"
            />
          </div>

          <div>
            <label className="label mb-2 block">Body</label>
            {ready && (
              <RichTextEditor content={doc} onChange={setDoc} imagePathPrefix={storagePrefix} />
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">CTA button text (optional)</label>
              <input className="input mt-1.5" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Book a demo" />
            </div>
            <div>
              <label className="label">CTA button link</label>
              <input className="input mt-1.5" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://scalepods.co/contact" />
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <BannerSlot
            label="Banner — dark mode"
            url={bannerUrlDark}
            onUploaded={setBannerUrlDark}
            onRemove={() => setBannerUrlDark(null)}
            storagePrefix={storagePrefix}
          />
          <BannerSlot
            label="Banner — light mode (optional)"
            url={bannerUrlLight}
            onUploaded={setBannerUrlLight}
            onRemove={() => setBannerUrlLight(null)}
            storagePrefix={storagePrefix}
          />
          <p className="text-muted text-xs -mt-3">
            Both are saved, but the live site currently only renders one banner — see docs/blog-module.md.
            The dark version is used until that's fixed on the site's side.
          </p>

          <div>
            <label className="label">Category</label>
            <input
              className="input mt-1.5"
              list="blog-category-suggestions"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <datalist id="blog-category-suggestions">
              {BLOG_CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
        </div>
      </div>

      {previewOpen && (
        <BlogPreviewModal
          title={title}
          category={category}
          excerpt={excerpt}
          bannerUrlDark={bannerUrlDark}
          bannerUrlLight={bannerUrlLight}
          sections={tiptapDocToSections(doc).sections}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  )
}
