import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type JSONContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Heading2, List, ImageIcon, Link2, Check, X } from 'lucide-react'
import { uploadBlogImage } from '../../lib/blogUpload'
import { SectionImage, BlogImagePathContext } from './SectionImageNode'

// The whole extension set is deliberately capped at exactly what scalepods.co's renderer
// understands (docs/blog-module.md) — H2-only headings mark section boundaries, bold + link are
// the only inline marks, bullet lists only. Anything richer (italic, tables, nested lists,
// H1/H3...) would look right here and render as plain/broken text on the live site, so it's
// simplest to just not offer it.
function useBlogEditor(content: JSONContent, onChange: (doc: JSONContent) => void) {
  return useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        orderedList: false,
      }),
      Link.configure({ openOnClick: false, autolink: false }),
      Placeholder.configure({ placeholder: 'Start with a heading, or just write…' }),
      SectionImage,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: { class: 'blog-editor-prose' },
    },
  })
}

function ToolbarButton({
  active, onClick, label, children,
}: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="h-8 w-8 rounded-md flex items-center justify-center transition-colors"
      style={{
        background: active ? 'var(--accent-green)' : 'transparent',
        color: active ? 'var(--cta-text)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </button>
  )
}

/** Small inline URL prompt used both by the toolbar's Link button and the selection bubble
 *  menu — kept as one component so "add a hyperlink" behaves identically whichever way you
 *  trigger it. */
function LinkPrompt({ initialUrl, onConfirm, onCancel }: { initialUrl: string; onConfirm: (url: string) => void; onCancel: () => void }) {
  const [url, setUrl] = useState(initialUrl)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--fill-tertiary)' }}>
      <input
        ref={ref}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm(url)
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="https://…"
        className="text-xs !py-1 !px-2 rounded outline-none"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', width: 200 }}
      />
      <button type="button" onClick={() => onConfirm(url)} className="h-6 w-6 rounded flex items-center justify-center text-sage">
        <Check size={13} />
      </button>
      <button type="button" onClick={onCancel} className="h-6 w-6 rounded flex items-center justify-center text-muted">
        <X size={13} />
      </button>
    </div>
  )
}

export default function RichTextEditor({
  content,
  onChange,
  imagePathPrefix,
}: {
  content: JSONContent
  onChange: (doc: JSONContent) => void
  /** Storage path prefix for images inserted via the toolbar, e.g. `blog/<postId>`. */
  imagePathPrefix: string
}) {
  const editor = useBlogEditor(content, onChange)
  const [linkPromptOpen, setLinkPromptOpen] = useState<'toolbar' | 'bubble' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  if (!editor) return null

  function applyLink(url: string) {
    if (!editor) return
    if (url.trim()) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    }
    setLinkPromptOpen(null)
  }

  // First upload fills the dark slot — matches the banner's dark-first convention. The node
  // itself (SectionImageNode.tsx) offers a second slot to add the light variant afterward.
  async function onImageChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !editor) return
    setUploading(true)
    try {
      const url = await uploadBlogImage(file, imagePathPrefix)
      editor.chain().focus().insertContent({ type: 'sectionImage', attrs: { srcDark: url, srcLight: null, caption: '' } }).run()
    } catch {
      // Non-fatal — the editor just won't gain an image node. Caller's save flow surfaces
      // real errors; a failed inline upload here is low-stakes enough not to need its own toast.
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-lg" style={{ border: '1px solid var(--border-subtle)' }}>
      <div
        className="flex items-center gap-0.5 px-2 py-1.5 flex-wrap"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <ToolbarButton label="Heading" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 size={15} />
        </ToolbarButton>
        <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={15} />
        </ToolbarButton>
        <div className="relative">
          <ToolbarButton label="Link" active={editor.isActive('link')} onClick={() => setLinkPromptOpen(linkPromptOpen === 'toolbar' ? null : 'toolbar')}>
            <Link2 size={15} />
          </ToolbarButton>
          {linkPromptOpen === 'toolbar' && (
            <div className="absolute top-full left-0 mt-1 z-10">
              <LinkPrompt initialUrl={editor.getAttributes('link').href ?? ''} onConfirm={applyLink} onCancel={() => setLinkPromptOpen(null)} />
            </div>
          )}
        </div>
        <ToolbarButton label="Insert image" onClick={() => fileInputRef.current?.click()}>
          <ImageIcon size={15} />
        </ToolbarButton>
        {uploading && <span className="text-muted text-xs ml-1">Uploading…</span>}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onImageChosen} />
      </div>

      {editor && (
        <BubbleMenu editor={editor} options={{ placement: 'top' }}>
          {linkPromptOpen === 'bubble' ? (
            <LinkPrompt initialUrl={editor.getAttributes('link').href ?? ''} onConfirm={applyLink} onCancel={() => setLinkPromptOpen(null)} />
          ) : (
            <div className="flex items-center gap-0.5 rounded-lg p-1 shadow-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
              <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
                <Bold size={14} />
              </ToolbarButton>
              <ToolbarButton label="Add hyperlink" active={editor.isActive('link')} onClick={() => setLinkPromptOpen('bubble')}>
                <Link2 size={14} />
              </ToolbarButton>
            </div>
          )}
        </BubbleMenu>
      )}

      <BlogImagePathContext.Provider value={imagePathPrefix}>
        <EditorContent editor={editor} className="px-4 py-3 min-h-[280px]" />
      </BlogImagePathContext.Provider>
    </div>
  )
}
