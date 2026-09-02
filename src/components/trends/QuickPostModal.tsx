import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wand2, ImageIcon, LayoutGrid, ArrowRight, RotateCcw } from 'lucide-react'
import { Modal, Button, Spinner, Badge } from '../ui'
import { PlatformBadge } from '../mediaUi'
import { triggerQuickPost, getLatestItemForSignal, type ContentItem } from '../../lib/content'
import { useToast, toastMessage } from '../Toast'

type Platform = 'instagram' | 'linkedin'
type ContentType = 'static_image' | 'carousel'

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
]

const CONTENT_TYPES: { value: ContentType; label: string; icon: typeof ImageIcon }[] = [
  { value: 'static_image', label: 'Static Image', icon: ImageIcon },
  { value: 'carousel', label: 'Carousel', icon: LayoutGrid },
]

// Poll budget mirrors Strategy.tsx's waitForNewStrategy (3s x 20 = 60s) with a bit more room —
// this flow also has to wait on an image generation call after the copy call.
const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 30

type Phase = 'form' | 'generating' | 'ready' | 'failed'

export function QuickPostModal({
  profileId, signalId, topic, onClose,
}: {
  profileId: string
  signalId: string
  topic: string
  onClose: () => void
}) {
  const [platform, setPlatform] = useState<Platform>('instagram')
  const [contentType, setContentType] = useState<ContentType>('static_image')
  const [phase, setPhase] = useState<Phase>('form')
  const [item, setItem] = useState<ContentItem | null>(null)
  const navigate = useNavigate()
  const toast = useToast()

  async function run() {
    setPhase('generating')
    try {
      await triggerQuickPost(profileId, signalId, platform, contentType)
      for (let i = 0; i < POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        const latest = await getLatestItemForSignal(profileId, signalId)
        if (latest && latest.status !== 'generating') {
          setItem(latest)
          setPhase(latest.status === 'failed' ? 'failed' : 'ready')
          return
        }
      }
      // Ran out of poll attempts without a terminal status — surface as a soft failure rather
      // than spinning forever; the item is still generating server-side and will show up in
      // Creative Review once it lands.
      setPhase('failed')
    } catch (err) {
      toast.error(toastMessage(err, 'Failed to start quick post generation'))
      setPhase('form')
    }
  }

  return (
    <Modal title="Quick Post" onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-secondary">
          Anchored on: <span className="font-medium text-primary">{topic}</span>
        </div>

        {phase === 'form' && (
          <>
            <div>
              <div className="label mb-1.5">Platform</div>
              <div className="flex gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPlatform(p.value)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      background: platform === p.value ? 'var(--accent-green)' : 'var(--fill-secondary)',
                      color: platform === p.value ? 'var(--bg-primary)' : 'var(--text-primary)',
                      border: `1.5px solid ${platform === p.value ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    <PlatformBadge platform={p.value} size="sm" />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="label mb-1.5">Content Type</div>
              <div className="flex gap-2">
                {CONTENT_TYPES.map((c) => {
                  const Icon = c.icon
                  const active = contentType === c.value
                  return (
                    <button
                      key={c.value}
                      onClick={() => setContentType(c.value)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                      style={{
                        background: active ? 'var(--accent-blue)' : 'var(--fill-secondary)',
                        color: active ? '#fff' : 'var(--text-primary)',
                        border: `1.5px solid ${active ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                      }}
                    >
                      <Icon size={13} /> {c.label}
                    </button>
                  )
                })}
              </div>
              <div className="text-muted text-[11px] mt-1.5">
                Video isn&apos;t generated here yet — manual-only, added later.
              </div>
            </div>

            <Button onClick={run} className="w-full justify-center">
              <Wand2 size={15} /> Generate
            </Button>
          </>
        )}

        {phase === 'generating' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Spinner size={22} />
            <div className="text-sm text-secondary">Writing the hook + generating the image…</div>
          </div>
        )}

        {phase === 'ready' && item && (
          <div className="space-y-3">
            {item.media_url && (
              <img src={item.media_url} alt={item.title || topic} className="w-full rounded-lg" style={{ aspectRatio: '1 / 1', objectFit: 'cover' }} />
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <PlatformBadge platform={item.platform} />
              <Badge tone="orange">{item.content_type.replace(/_/g, ' ')}</Badge>
            </div>
            {item.metadata?.hook && <div className="text-sm font-medium">{item.metadata.hook}</div>}
            {item.body && <div className="text-sm text-secondary">{item.body}</div>}
            {!!item.metadata?.hashtags?.length && (
              <div className="text-xs text-muted">{item.metadata.hashtags.join(' ')}</div>
            )}
            <Button onClick={() => navigate('/review')} className="w-full justify-center">
              Review & approve <ArrowRight size={15} />
            </Button>
          </div>
        )}

        {phase === 'failed' && (
          <div className="space-y-3">
            <div className="text-sm text-secondary">
              {item?.error_message || "Didn't finish in time — it may still land in Creative Review shortly, or try again."}
            </div>
            <Button variant="ghost" onClick={run} className="w-full justify-center">
              <RotateCcw size={15} /> Retry
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
