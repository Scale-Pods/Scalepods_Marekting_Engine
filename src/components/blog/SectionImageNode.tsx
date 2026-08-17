import { createContext, useContext, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { X, ImagePlus } from 'lucide-react'
import { uploadBlogImage } from '../../lib/blogUpload'

// Node views render outside the normal React tree Tiptap is mounted in, so they can't receive
// props directly — RichTextEditor provides the storage path prefix through this context instead.
export const BlogImagePathContext = createContext('blog/unfiled')

// One image SLOT per section is a hard limit of the site's schema (docs/blog-module.md) — see
// blogSerializer.ts's droppedImages count for the enforcement (a 2nd sectionImage node under the
// same heading gets dropped on save). Within that one slot, dark/light are two variants of the
// same image, not two separate images — mirrors BlogSection.image/imageDark/imageLight on the
// live site, which already theme-swaps per-section images for both static AND CMS-published
// posts (unlike the hero banner, this needs no site-side change to work).
function ImageSlot({
  label, url, onUpload, onRemove,
}: { label: string; url: string | null; onUpload: (url: string) => void; onRemove: () => void }) {
  const pathPrefix = useContext(BlogImagePathContext)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      onUpload(await uploadBlogImage(file, pathPrefix))
    } catch {
      // Non-fatal — the slot just stays empty. Matches RichTextEditor's own image upload,
      // which is similarly low-stakes to fail silently on (Save surfaces real errors).
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted text-[11px]">{label}</span>
      {url ? (
        <div className="relative w-32 h-32">
          <img src={url} alt={label} className="w-32 h-32 object-cover rounded-lg border block" style={{ borderColor: 'var(--border-subtle)' }} />
          <button
            type="button"
            onClick={onRemove}
            className="absolute -top-2 -right-2 h-5 w-5 rounded-full flex items-center justify-center text-white"
            style={{ background: 'var(--accent-orange)' }}
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <X size={11} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-32 h-32 rounded-lg border border-dashed flex flex-col items-center justify-center gap-1 text-muted text-[11px]"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <ImagePlus size={16} />
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onChange} />
    </div>
  )
}

function SectionImageView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  return (
    <NodeViewWrapper className="my-3" as="div" contentEditable={false}>
      <div className="relative inline-flex gap-3 p-2 rounded-lg" style={{ background: 'var(--fill-tertiary)' }}>
        <ImageSlot
          label="Dark mode"
          url={node.attrs.srcDark}
          onUpload={(url) => updateAttributes({ srcDark: url })}
          onRemove={() => updateAttributes({ srcDark: null })}
        />
        <ImageSlot
          label="Light mode (optional)"
          url={node.attrs.srcLight}
          onUpload={(url) => updateAttributes({ srcLight: url })}
          onRemove={() => updateAttributes({ srcLight: null })}
        />
        <button
          type="button"
          onClick={deleteNode}
          className="absolute -top-2 -right-2 h-6 w-6 rounded-full flex items-center justify-center text-white"
          style={{ background: 'var(--accent-orange)' }}
          aria-label="Remove image"
        >
          <X size={13} />
        </button>
      </div>
      <input
        className="input mt-1.5 text-xs !py-1.5 max-w-xs"
        placeholder="Image caption (optional)"
        value={node.attrs.caption || ''}
        onChange={(e) => updateAttributes({ caption: e.target.value })}
      />
    </NodeViewWrapper>
  )
}

export const SectionImage = Node.create({
  name: 'sectionImage',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      srcDark: { default: null },
      srcLight: { default: null },
      caption: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-section-image]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-section-image': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SectionImageView)
  },
})
