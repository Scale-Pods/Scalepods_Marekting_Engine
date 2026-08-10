import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Building2, Sparkles, UploadCloud, X } from 'lucide-react'
import {
  getProfile, createProfile, updateProfile, triggerAiAnalysis, type BusinessProfileInput,
} from '../lib/clients'
import { supabase } from '../lib/supabase'
import { PageHeader, Button, Panel, Badge, Spinner } from '../components/ui'

const PLATFORMS = ['instagram', 'youtube', 'facebook', 'linkedin'] as const

const EMPTY: BusinessProfileInput = {
  business_name: '', tagline: '', industry: '', description: '',
  products_services: '', target_audience: '', business_goals: '',
  brand_guidelines: '', brand_voice: '',
  target_platforms: ['linkedin', 'instagram'],
  competitors: '', website_url: '',
  social_media_urls: {}, assets: [], additional_notes: '',
  phone: '', email: '', address: '', hours: '', service_areas: [],
  fb_page_id: '', status: 'active',
}

function TagsEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  function commit() {
    const v = draft.trim()
    if (v && !value.includes(v)) onChange([...value, v])
    setDraft('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map((tag) => (
          <span key={tag} className="badge inline-flex items-center gap-1">
            {tag}
            <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))} className="hover:text-[var(--accent-orange)]">
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() }
        }}
        onBlur={commit}
      />
    </div>
  )
}

export default function BusinessProfile() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()

  const [form, setForm] = useState<BusinessProfileInput>(EMPTY)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (isNew) return
    getProfile(id!).then((p) => {
      setForm(p)
      setLoading(false)
    })
  }, [id, isNew])

  function set<K extends keyof BusinessProfileInput>(key: K, value: BusinessProfileInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function togglePlatform(p: string) {
    const cur = form.target_platforms || []
    set('target_platforms', cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p])
  }

  function setSocial(key: string, value: string) {
    set('social_media_urls', { ...(form.social_media_urls || {}), [key]: value })
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || isNew) return
    setUploading(true)
    setError(null)
    try {
      const path = `brand-assets/${id}/${Date.now()}-${file.name}`
      const { error: upErr } = await supabase.storage.from('content-media').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('content-media').getPublicUrl(path)
      set('assets', [...(form.assets || []), { name: file.name, url: data.publicUrl }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function removeAsset(url: string) {
    set('assets', (form.assets || []).filter((a) => a.url !== url))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const profile = isNew ? await createProfile(form) : await updateProfile(id!, form)
      await triggerAiAnalysis(profile.id)
      setSaved(true)
      setTimeout(() => navigate('/intelligence'), 900)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <div>
      {isNew ? (
        <PageHeader
          accent={<Badge><Building2 size={12} /> Business</Badge>}
          title="New business profile"
          subtitle="Saving fires the AI Business Analysis engine automatically."
        />
      ) : (
        <div className="card overflow-hidden mb-6 p-0">
          <div
            className="h-24 relative"
            style={{
              backgroundImage: "url('/brand/profile-banner.png')",
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="px-6 pb-5">
            <div className="flex items-end justify-between -mt-8 mb-3">
              <div
                className="h-16 w-16 rounded-2xl overflow-hidden shrink-0"
                style={{ background: 'var(--bg-layer3)', border: '3px solid var(--glass-fill)' }}
              >
                <img src="/brand/logo-square.jpg" alt="ScalePods" className="h-full w-full object-cover" />
              </div>
            </div>
            <h1 className="text-xl font-semibold">{form.business_name || 'Business profile'}</h1>
            {form.tagline && <p className="text-muted text-sm italic mt-0.5">"{form.tagline}"</p>}
            <div className="flex flex-wrap items-center gap-2 mt-3 mb-4">
              <Badge tone={form.status === 'active' ? 'green' : 'orange'}>{form.status}</Badge>
              {form.industry && <Badge tone="blue">{form.industry}</Badge>}
            </div>
            <div className="grid grid-cols-4 rounded-panel overflow-hidden panel !p-0">
              {[
                { label: 'Service areas', value: (form.service_areas || []).length || '—' },
                { label: 'Platforms', value: (form.target_platforms || []).length || '—' },
                { label: 'Website', value: form.website_url ? 'Linked' : '—' },
                { label: 'Status', value: (form.status || '').charAt(0).toUpperCase() + (form.status || '').slice(1) },
              ].map((s, i) => (
                <div key={s.label} className="text-center py-3 px-2" style={i > 0 ? { borderLeft: '1px solid var(--border-subtle)' } : undefined}>
                  <div className="text-lg font-semibold tracking-tightest">{s.value}</div>
                  <div className="text-muted text-[10px] uppercase tracking-wide mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5 max-w-3xl">
        <Panel>
          <div className="font-medium mb-4">Business details</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Business name</label>
              <input className="input mt-1" value={form.business_name ?? ''} onChange={(e) => set('business_name', e.target.value)} required />
            </div>
            <div>
              <label className="label">Tagline</label>
              <input className="input mt-1" value={form.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} />
            </div>
            <div>
              <label className="label">Industry</label>
              <input className="input mt-1" value={form.industry ?? ''} onChange={(e) => set('industry', e.target.value)} />
            </div>
            <div>
              <label className="label">Website URL</label>
              <input className="input mt-1" type="url" value={form.website_url ?? ''} onChange={(e) => set('website_url', e.target.value)} placeholder="https://" />
            </div>
          </div>
          <div className="mt-4">
            <label className="label">Description</label>
            <textarea className="input mt-1" rows={3} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </div>
        </Panel>

        <Panel>
          <div className="font-medium mb-4">Products &amp; services</div>
          <textarea className="input" rows={3} value={form.products_services ?? ''} onChange={(e) => set('products_services', e.target.value)} placeholder="The 4 Pods: HR, Sales, Ops, Marketing automation..." />
        </Panel>

        <Panel>
          <div className="font-medium mb-4">Audience &amp; goals</div>
          <div className="space-y-4">
            <div>
              <label className="label">Target audience</label>
              <textarea className="input mt-1" rows={2} value={form.target_audience ?? ''} onChange={(e) => set('target_audience', e.target.value)} />
            </div>
            <div>
              <label className="label">Business goals</label>
              <textarea className="input mt-1" rows={2} value={form.business_goals ?? ''} onChange={(e) => set('business_goals', e.target.value)} />
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="font-medium mb-4">Brand</div>
          <div className="space-y-4">
            <div>
              <label className="label">Brand guidelines</label>
              <textarea className="input mt-1" rows={2} value={form.brand_guidelines ?? ''} onChange={(e) => set('brand_guidelines', e.target.value)} />
            </div>
            <div>
              <label className="label">Brand voice</label>
              <textarea className="input mt-1" rows={2} value={form.brand_voice ?? ''} onChange={(e) => set('brand_voice', e.target.value)} placeholder="Developer-first, precise, no fluff..." />
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="font-medium mb-4">Target platforms</div>
          <div className="flex gap-2 flex-wrap">
            {PLATFORMS.map((p) => {
              const active = (form.target_platforms || []).includes(p)
              return (
                <button
                  type="button"
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={active ? 'badge' : 'badge opacity-40'}
                  style={{ textTransform: 'capitalize' }}
                >
                  {p}
                </button>
              )
            })}
          </div>
        </Panel>

        <Panel>
          <div className="font-medium mb-4">Competitors</div>
          <textarea className="input" rows={2} value={form.competitors ?? ''} onChange={(e) => set('competitors', e.target.value)} placeholder="Competitor names / URLs, comma-separated" />
        </Panel>

        <Panel>
          <div className="font-medium mb-1">Social URLs &amp; platform IDs</div>
          <div className="text-muted text-xs mb-4">Platform IDs are required later for publishing (Instagram business user ID, LinkedIn org URN, Facebook Page ID).</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Instagram URL</label>
              <input className="input mt-1" value={form.social_media_urls?.instagram ?? ''} onChange={(e) => setSocial('instagram', e.target.value)} />
            </div>
            <div>
              <label className="label">Facebook URL</label>
              <input className="input mt-1" value={form.social_media_urls?.facebook ?? ''} onChange={(e) => setSocial('facebook', e.target.value)} />
            </div>
            <div>
              <label className="label">LinkedIn URL</label>
              <input className="input mt-1" value={form.social_media_urls?.linkedin ?? ''} onChange={(e) => setSocial('linkedin', e.target.value)} />
            </div>
            <div>
              <label className="label">YouTube URL</label>
              <input className="input mt-1" value={form.social_media_urls?.youtube ?? ''} onChange={(e) => setSocial('youtube', e.target.value)} />
            </div>
            <div>
              <label className="label">Instagram business user ID</label>
              <input className="input mt-1 font-mono text-xs" value={form.social_media_urls?.ig_user_id ?? ''} onChange={(e) => setSocial('ig_user_id', e.target.value)} />
            </div>
            <div>
              <label className="label">LinkedIn org URN</label>
              <input className="input mt-1 font-mono text-xs" value={form.social_media_urls?.li_org_urn ?? ''} onChange={(e) => setSocial('li_org_urn', e.target.value)} placeholder="urn:li:organization:..." />
            </div>
            <div>
              <label className="label">Facebook Page ID</label>
              <input className="input mt-1 font-mono text-xs" value={form.fb_page_id ?? ''} onChange={(e) => set('fb_page_id', e.target.value)} />
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="font-medium mb-4">Contact &amp; location</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Phone</label>
              <input className="input mt-1" type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input mt-1" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input mt-1" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div>
              <label className="label">Operating hours</label>
              <input className="input mt-1" value={form.hours ?? ''} onChange={(e) => set('hours', e.target.value)} placeholder="Mon–Fri, 9am–6pm IST" />
            </div>
          </div>
          <div className="mt-4">
            <label className="label">Service areas</label>
            <div className="mt-1">
              <TagsEditor value={form.service_areas ?? []} onChange={(v) => set('service_areas', v)} placeholder="Add a region, press Enter…" />
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="font-medium mb-4">Asset uploads</div>
          {isNew ? (
            <div className="text-muted text-sm">Save the profile first, then come back to upload brand assets.</div>
          ) : (
            <>
              <label className="btn-ghost w-fit cursor-pointer">
                {uploading ? <Spinner size={15} /> : <UploadCloud size={16} />}
                Upload asset
                <input type="file" className="hidden" onChange={onUpload} disabled={uploading} />
              </label>
              {form.assets && form.assets.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  {form.assets.map((a) => (
                    <div key={a.url} className="relative panel p-2">
                      <img src={a.url} alt={a.name} className="w-full h-20 object-cover rounded" />
                      <button type="button" onClick={() => removeAsset(a.url)} className="absolute top-1 right-1 bg-black/60 rounded-full p-1">
                        <X size={12} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Panel>

        <Panel>
          <div className="font-medium mb-4">Additional notes</div>
          <textarea className="input" rows={2} value={form.additional_notes ?? ''} onChange={(e) => set('additional_notes', e.target.value)} />
        </Panel>

        {error && <div className="text-sm text-[var(--accent-orange)]">{error}</div>}
        {saved && <div className="text-sm text-sage">Saved — AI Business Analysis started.</div>}

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Save &amp; run analysis <Sparkles size={16} />
          </Button>
        </div>
      </form>
    </div>
  )
}
