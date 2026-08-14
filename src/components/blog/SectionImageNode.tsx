import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { X } from 'lucide-react'

// One image per section is a hard limit of the site's schema (docs/blog-module.md), not an
// arbitrary editor choice — see blogSerializer.ts's droppedImages count for the rest of the
// enforcement (a 2nd image inserted under the same heading gets dropped on save, with a toast
// warning from the editor page).
function SectionImageView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  return (
    <NodeViewWrapper className="my-3" as="div" contentEditable={false}>
      <div className="relative inline-block">
        <img
          src={node.attrs.src}
          alt={node.attrs.caption || ''}
          className="max-w-xs max-h-56 rounded-lg border object-cover block"
          style={{ borderColor: 'var(--border-subtle)' }}
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
      src: { default: null },
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
