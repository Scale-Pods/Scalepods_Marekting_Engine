import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { X, Plus, LayoutGrid } from 'lucide-react'

export interface CardItem {
  title: string
  content: string
}

export type TagMode = 'auto' | 'custom' | 'none'

// One accordionItems array per section is the site's data model (BlogSection.accordionItems on
// scalepods.co — see blog.ts's comment) — a 2nd sectionCards node under the same heading gets
// dropped on save, same rule as sectionImage's one-slot limit (blogSerializer.ts).
function CardRow({
  item, onChange, onRemove, canRemove,
}: { item: CardItem; onChange: (patch: Partial<CardItem>) => void; onRemove: () => void; canRemove: boolean }) {
  return (
    <div className="relative flex flex-col gap-1.5 p-2.5 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
      <input
        className="input !py-1.5 text-sm font-medium"
        placeholder="Card title (e.g. Audit Your Current Workflow)"
        value={item.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <textarea
        className="input text-xs"
        rows={2}
        placeholder="Card body — plain text, or **bold**"
        value={item.content}
        onChange={(e) => onChange({ content: e.target.value })}
      />
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-2 -right-2 h-5 w-5 rounded-full flex items-center justify-center text-white"
          style={{ background: 'var(--accent-orange)' }}
          aria-label="Remove card"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

// Was unconditional auto-detection from the section heading (still the default — "Auto" keeps
// that exact behavior) — this makes it a real choice instead. "Custom" needs the site to actually
// honor accordionTagPrefix (BlogBodyClient.tsx on scalepods.co); until that ships, Custom/None
// here won't change what the live site shows, only what this composer's own preview shows.
function TagModeControl({
  tagMode, tagText, onModeChange, onTextChange,
}: { tagMode: TagMode; tagText: string; onModeChange: (m: TagMode) => void; onTextChange: (t: string) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-muted text-[11px]">Tag label:</span>
      <select
        className="input !py-1 !w-auto text-xs"
        value={tagMode}
        onChange={(e) => onModeChange(e.target.value as TagMode)}
      >
        <option value="auto">Auto (guess from heading)</option>
        <option value="custom">Custom text</option>
        <option value="none">None</option>
      </select>
      {tagMode === 'custom' && (
        <input
          className="input !py-1 !w-auto text-xs"
          style={{ maxWidth: 140 }}
          placeholder="e.g. STEP, PHASE"
          value={tagText}
          onChange={(e) => onTextChange(e.target.value)}
        />
      )}
      {tagMode === 'custom' && tagText.trim() && (
        <span className="text-muted text-[11px]">→ &ldquo;{tagText.trim().toUpperCase()} 01&rdquo;, &ldquo;{tagText.trim().toUpperCase()} 02&rdquo;…</span>
      )}
    </div>
  )
}

function SectionCardsView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const items: CardItem[] = node.attrs.items ?? []
  const tagMode: TagMode = node.attrs.tagMode ?? 'auto'
  const tagText: string = node.attrs.tagText ?? ''

  function setItem(i: number, patch: Partial<CardItem>) {
    updateAttributes({ items: items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) })
  }
  function removeItem(i: number) {
    updateAttributes({ items: items.filter((_, idx) => idx !== i) })
  }
  function addItem() {
    updateAttributes({ items: [...items, { title: '', content: '' }] })
  }

  return (
    <NodeViewWrapper className="my-3" as="div" contentEditable={false}>
      <div className="relative flex flex-col gap-2 p-2.5 rounded-lg" style={{ background: 'var(--fill-tertiary)' }}>
        <div className="flex items-center gap-1.5 text-muted text-[11px] font-medium uppercase tracking-wide">
          <LayoutGrid size={12} /> Cards
        </div>
        <TagModeControl
          tagMode={tagMode}
          tagText={tagText}
          onModeChange={(m) => updateAttributes({ tagMode: m })}
          onTextChange={(t) => updateAttributes({ tagText: t })}
        />
        {items.map((item, i) => (
          <CardRow key={i} item={item} onChange={(patch) => setItem(i, patch)} onRemove={() => removeItem(i)} canRemove={items.length > 1} />
        ))}
        <button type="button" onClick={addItem} className="btn-ghost !py-1.5 text-xs justify-center">
          <Plus size={13} /> Add card
        </button>
        <button
          type="button"
          onClick={deleteNode}
          className="absolute -top-2 -right-2 h-6 w-6 rounded-full flex items-center justify-center text-white"
          style={{ background: 'var(--accent-orange)' }}
          aria-label="Remove cards block"
        >
          <X size={13} />
        </button>
      </div>
    </NodeViewWrapper>
  )
}

export const SectionCards = Node.create({
  name: 'sectionCards',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      items: { default: [{ title: '', content: '' }] },
      tagMode: { default: 'auto' },
      tagText: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-section-cards]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-section-cards': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SectionCardsView)
  },
})
