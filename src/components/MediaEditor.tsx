import { useState, useCallback, useEffect, useRef } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { RotateCw, Check, X, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button } from './ui'
import { PlatformMockup } from './mediaUi'

const PRESETS: Record<string, { label: string; ratio: number }[]> = {
  instagram: [{ label: '1:1', ratio: 1 }, { label: '4:5', ratio: 4 / 5 }, { label: '9:16', ratio: 9 / 16 }],
  linkedin: [{ label: '1:1', ratio: 1 }, { label: '1.91:1', ratio: 1.91 }],
  facebook: [{ label: '1:1', ratio: 1 }, { label: '1.91:1', ratio: 1.91 }, { label: '9:16', ratio: 9 / 16 }],
  youtube: [{ label: '9:16 (Shorts)', ratio: 9 / 16 }, { label: '16:9', ratio: 16 / 9 }],
}

const LOOKS = [
  { label: 'Original', brightness: 100, contrast: 100, saturate: 100 },
  { label: 'Vivid', brightness: 105, contrast: 115, saturate: 130 },
  { label: 'Mono', brightness: 100, contrast: 110, saturate: 0 },
  { label: 'Warm', brightness: 106, contrast: 104, saturate: 118 },
  { label: 'Cool', brightness: 98, contrast: 106, saturate: 88 },
]

const LOGO_URL = 'https://oyfudqqypvpqsyrjqnfy.supabase.co/storage/v1/object/public/brand/logo-white.png'

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function buildExport(
  imageUrl: string,
  crop: Area,
  rotation: number,
  filter: { brightness: number; contrast: number; saturate: number },
  stampLogo: boolean,
): Promise<Blob> {
  const image = await loadImage(imageUrl)

  // Rotate onto a bounding canvas first (standard two-pass crop+rotate technique).
  const rad = (rotation * Math.PI) / 180
  const sin = Math.abs(Math.sin(rad))
  const cos = Math.abs(Math.cos(rad))
  const boundW = image.width * cos + image.height * sin
  const boundH = image.width * sin + image.height * cos

  const rotCanvas = document.createElement('canvas')
  rotCanvas.width = boundW
  rotCanvas.height = boundH
  const rotCtx = rotCanvas.getContext('2d')!
  rotCtx.translate(boundW / 2, boundH / 2)
  rotCtx.rotate(rad)
  rotCtx.drawImage(image, -image.width / 2, -image.height / 2)

  // Crop to the selected area.
  const outCanvas = document.createElement('canvas')
  outCanvas.width = crop.width
  outCanvas.height = crop.height
  const outCtx = outCanvas.getContext('2d')!
  outCtx.filter = `brightness(${filter.brightness}%) contrast(${filter.contrast}%) saturate(${filter.saturate}%)`
  outCtx.drawImage(rotCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  outCtx.filter = 'none'

  if (stampLogo) {
    try {
      const logo = await loadImage(LOGO_URL)
      const targetW = Math.min(180, Math.round(outCanvas.width * 0.2))
      const targetH = (logo.height / logo.width) * targetW
      outCtx.drawImage(logo, 24, 24, targetW, targetH)
    } catch {
      // Non-fatal — export continues without the stamp if the logo fails to load.
    }
  }

  return new Promise((resolve, reject) => {
    outCanvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/png')
  })
}

export default function MediaEditor({
  imageUrl,
  platform,
  itemId,
  caption,
  onSave,
  onCancel,
}: {
  imageUrl: string
  platform: string
  itemId: string
  caption?: string | null
  onSave: (newUrl: string) => void
  onCancel: () => void
}) {
  const presets = PRESETS[platform?.toLowerCase()] ?? PRESETS.instagram
  const [aspect, setAspect] = useState(presets[0].ratio)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [look, setLook] = useState(LOOKS[0])
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [saturate, setSaturate] = useState(100)
  const [stampLogo, setStampLogo] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'adjust' | 'preview'>('adjust')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewObjectUrl = useRef<string | null>(null)

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => setCroppedArea(areaPixels), [])

  function applyLook(l: typeof LOOKS[number]) {
    setLook(l)
    setBrightness(l.brightness)
    setContrast(l.contrast)
    setSaturate(l.saturate)
  }

  // Regenerate the platform-mockup preview image whenever the Preview tab is open and the
  // crop/rotation/filters change — reuses the same buildExport pipeline as the real save.
  useEffect(() => {
    if (tab !== 'preview' || !croppedArea) return
    let cancelled = false
    buildExport(imageUrl, croppedArea, rotation, { brightness, contrast, saturate }, stampLogo)
      .then((blob) => {
        if (cancelled) return
        if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
        const url = URL.createObjectURL(blob)
        previewObjectUrl.current = url
        setPreviewUrl(url)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tab, croppedArea, rotation, brightness, contrast, saturate, stampLogo, imageUrl])

  useEffect(() => () => { if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current) }, [])

  async function onSaveClick() {
    if (!croppedArea) return
    setSaving(true)
    setError(null)
    try {
      const blob = await buildExport(imageUrl, croppedArea, rotation, { brightness, contrast, saturate }, stampLogo)
      const path = `edited/${itemId}-${Date.now()}.png`
      const { error: upErr } = await supabase.storage.from('content-media').upload(path, blob, { contentType: 'image/png', upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('content-media').getPublicUrl(path)
      onSave(data.publicUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setSaving(false)
    }
  }

  const previewFilter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%)`

  return (
    <div className="space-y-4">
      <div className="relative h-80 panel overflow-hidden">
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onRotationChange={setRotation}
          onCropComplete={onCropComplete}
          style={{ mediaStyle: { filter: previewFilter } }}
        />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => setAspect(p.ratio)}
              className={aspect === p.ratio ? 'badge' : 'badge opacity-40'}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={() => setRotation((r) => (r + 90) % 360)} className="btn-ghost !py-1.5 !px-3 text-xs">
          <RotateCw size={14} /> Rotate 90°
        </button>
      </div>

      <div className="flex" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {(['adjust', 'preview'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 text-xs font-medium capitalize"
            style={{
              color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === t ? 'var(--accent-green)' : 'transparent'}`,
              fontWeight: tab === t ? 650 : 500,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'adjust' ? (
        <>
          <div>
            <div className="label mb-2">Looks</div>
            <div className="flex gap-1.5 flex-wrap">
              {LOOKS.map((l) => (
                <button
                  key={l.label}
                  onClick={() => applyLook(l)}
                  className={look.label === l.label ? 'badge badge-blue' : 'badge badge-blue opacity-40'}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Brightness {brightness}%</label>
              <input type="range" min={50} max={150} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="label">Contrast {contrast}%</label>
              <input type="range" min={50} max={150} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="label">Saturation {saturate}%</label>
              <input type="range" min={0} max={200} value={saturate} onChange={(e) => setSaturate(Number(e.target.value))} className="w-full" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-secondary">
            <input type="checkbox" checked={stampLogo} onChange={(e) => setStampLogo(e.target.checked)} />
            <Sparkles size={14} className="text-sage" /> Add ScalePods logo stamp
          </label>
        </>
      ) : (
        <div className="py-2">
          <div className="label mb-3 text-center">How it looks on {platform || 'the feed'}</div>
          <PlatformMockup platform={platform} img={previewUrl} aspect={aspect} caption={caption} />
        </div>
      )}

      {error && <div className="text-sm text-[var(--accent-orange)]">{error}</div>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          <X size={15} /> Cancel
        </Button>
        <Button onClick={onSaveClick} loading={saving}>
          <Check size={15} /> Save
        </Button>
      </div>
    </div>
  )
}
