import { useEffect, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { connectCanva, listCanvaDesigns, importCanvaDesign, importFigmaFrame, type CanvaDesign } from '../lib/designer'
import { Button } from './ui'
import AssetUploader from './AssetUploader'

/**
 * Where a creative comes from: a local file, a Canva design, or a Figma frame. Used both to
 * replace the media on an existing piece and to import a brand-new one into Creative Review —
 * `keyId` only names the storage path (an existing item's id, or a throwaway id for a new
 * import), so the Canva/Figma edge functions never need to know which case this is.
 */
export default function MediaSourcePanel({
  keyId, pathPrefix, uploadLabel, accept, onDone,
}: {
  keyId: string
  pathPrefix: string
  uploadLabel: string
  accept?: string
  onDone: (url: string, file?: File) => void
}) {
  const [tab, setTab] = useState<'upload' | 'canva' | 'figma'>('upload')
  const [designs, setDesigns] = useState<CanvaDesign[] | null>(null)
  const [canvaError, setCanvaError] = useState<string | null>(null)
  const [canvaBusy, setCanvaBusy] = useState<string | null>(null)
  const [figmaFileKey, setFigmaFileKey] = useState('')
  const [figmaNodeId, setFigmaNodeId] = useState('')
  const [figmaBusy, setFigmaBusy] = useState(false)
  const [figmaError, setFigmaError] = useState<string | null>(null)

  useEffect(() => {
    if (tab === 'canva' && designs === null) {
      listCanvaDesigns()
        .then(setDesigns)
        .catch((err) => setCanvaError(err instanceof Error ? err.message : 'Canva not connected yet'))
    }
  }, [tab, designs])

  async function onCanvaPick(d: CanvaDesign) {
    setCanvaBusy(d.id)
    setCanvaError(null)
    try {
      onDone(await importCanvaDesign(d.id, keyId))
    } catch (err) {
      setCanvaError(err instanceof Error ? err.message : 'Canva import failed')
    } finally {
      setCanvaBusy(null)
    }
  }

  async function onFigmaImport() {
    setFigmaBusy(true)
    setFigmaError(null)
    try {
      onDone(await importFigmaFrame(figmaFileKey.trim(), figmaNodeId.trim(), keyId))
    } catch (err) {
      setFigmaError(err instanceof Error ? err.message : 'Figma import failed')
    } finally {
      setFigmaBusy(false)
    }
  }

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {(['upload', 'canva', 'figma'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'badge' : 'badge opacity-40'} style={{ textTransform: 'capitalize' }}>
            {t === 'upload' ? 'From this computer' : t}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <AssetUploader pathPrefix={pathPrefix} accept={accept} label={uploadLabel} onUploaded={(url, file) => onDone(url, file)} />
      )}

      {tab === 'canva' && (
        <div className="space-y-3">
          <Button variant="ghost" onClick={connectCanva}>Connect Canva</Button>
          {canvaError && <div className="text-xs text-muted">{canvaError} — connect Canva above, then reopen this panel.</div>}
          {designs && designs.length === 0 && <div className="text-xs text-muted">No Canva designs found.</div>}
          {designs && designs.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {designs.map((d) => (
                <button
                  key={d.id}
                  onClick={() => onCanvaPick(d)}
                  disabled={canvaBusy !== null}
                  className="panel p-2 hover:border-sage/40 disabled:opacity-50"
                >
                  {d.thumbnailUrl ? <img src={d.thumbnailUrl} alt={d.title} className="w-full h-16 object-cover rounded" /> : <ImageIcon size={20} />}
                  <div className="text-xs mt-1 truncate">{canvaBusy === d.id ? 'Importing…' : d.title}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'figma' && (
        <div className="space-y-3">
          <div>
            <label className="label">Figma file key</label>
            <input className="input mt-1" value={figmaFileKey} onChange={(e) => setFigmaFileKey(e.target.value)} placeholder="from the file URL" />
          </div>
          <div>
            <label className="label">Node ID</label>
            <input className="input mt-1" value={figmaNodeId} onChange={(e) => setFigmaNodeId(e.target.value)} placeholder="e.g. 12:34" />
          </div>
          {figmaError && <div className="text-xs text-[var(--accent-orange)]">{figmaError}</div>}
          <Button onClick={onFigmaImport} loading={figmaBusy} disabled={!figmaFileKey || !figmaNodeId}>Import from Figma</Button>
        </div>
      )}
    </div>
  )
}
