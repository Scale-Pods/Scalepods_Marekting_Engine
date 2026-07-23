import { useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Spinner } from './ui'

export default function AssetUploader({
  bucket = 'content-media',
  pathPrefix,
  accept = 'image/*',
  label = 'Upload',
  onUploaded,
}: {
  bucket?: string
  pathPrefix: string
  accept?: string
  label?: string
  onUploaded: (url: string, file: File) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const path = `${pathPrefix}/${Date.now()}-${file.name}`
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from(bucket).getPublicUrl(path)
      onUploaded(data.publicUrl, file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div>
      <label className="btn-ghost w-fit cursor-pointer">
        {uploading ? <Spinner size={15} /> : <UploadCloud size={16} />}
        {label}
        <input type="file" accept={accept} className="hidden" onChange={onChange} disabled={uploading} />
      </label>
      {error && <div className="text-xs text-[var(--accent-orange)] mt-1">{error}</div>}
    </div>
  )
}
