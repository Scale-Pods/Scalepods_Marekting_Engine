import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Building2, Sparkles, UploadCloud, X, Pencil, Plus, Trash2, Globe,
  Instagram, Facebook, Linkedin, Youtube, Wand2, Check,
} from 'lucide-react'
import {
  getProfile, createProfile, updateProfile, triggerAiAnalysis, type BusinessProfileInput, type Competitor,
} from '../lib/clients'
import { startCompetitorSearch, getSearchRun, getLatestSearchRun, getSeenRunId, markRunSeen, type CompetitorSearchRun } from '../lib/competitors'
import { supabase, sanitizeStorageFilename } from '../lib/supabase'
import { qk } from '../lib/queries'
import { PageHeader, Button, Panel, Badge, Spinner } from '../components/ui'

const PLATFORMS = ['instagram', 'youtube', 'facebook', 'linkedin'] as const

const EMPTY: BusinessProfileInput = {
  business_name: '', tagline: '', industry: '', description: '',
  products_services: '', target_audience: '', business_goals: '',
  brand_guidelines: '', brand_voice: '',
  target_platforms: ['linkedin', 'instagram'],
  competitors: '', competitor_profiles: [], website_url: '',
  social_media_urls: {}, assets: [], additional_notes: '',
  phone: '', email: '', address: '', hours: '', service_areas: [],
  fb_page_id: '', logo_url: null, cover_url: null, status: 'active',
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const COMPETITOR_SOCIAL_FIELDS: { key: keyof Competitor['socials']; label: string }[] = [
  { key: 'instagram', label: 'Instagram URL' },
  { key: 'facebook', label: 'Facebook URL' },
  { key: 'linkedin', label: 'LinkedIn URL' },
  { key: 'youtube', label: 'YouTube URL' },
]

/** One-at-a-time add/edit form for a structured competitor entry — mirrors the "Social URLs &
 *  platform IDs" grid pattern already on this page, scoped to a single competitor. */
function CompetitorForm({ initial, onSave, onCancel }: { initial?: Competitor; onSave: (c: Competitor) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [website, setWebsite] = useState(initial?.website ?? '')
  const [socials, setSocials] = useState<Competitor['socials']>(initial?.socials ?? {})

  return (
    <div className="panel p-4 space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Competitor name</label>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Acme Agency" />
        </div>
        <div>
          <label className="label">Official website</label>
          <input className="input mt-1" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {COMPETITOR_SOCIAL_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="label">{label}</label>
            <input
              className="input mt-1"
              value={socials[key] ?? ''}
              onChange={(e) => setSocials((s) => ({ ...s, [key]: e.target.value }))}
              placeholder="https://"
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          type="button"
          onClick={() => name.trim() && onSave({ id: initial?.id ?? uid(), name: name.trim(), website: website.trim() || null, socials, source: initial?.source ?? 'manual' })}
          disabled={!name.trim()}
        >
          Save competitor
        </Button>
      </div>
    </div>
  )
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
  const qc = useQueryClient()

  const [form, setForm] = useState<BusinessProfileInput>(EMPTY)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<'asset' | 'logo' | 'cover' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [addingCompetitor, setAddingCompetitor] = useState(false)
  const [editingCompetitorId, setEditingCompetitorId] = useState<string | null>(null)
  const [aiRun, setAiRun] = useState<CompetitorSearchRun | null>(null)
  const [aiSelected, setAiSelected] = useState<Set<number>>(new Set())
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    if (isNew) return
    getProfile(id!).then((p) => {
      setForm(p)
      setLoading(false)
    })
  }, [id, isNew])

  // Rehydrate an in-flight or unreviewed-completed AI search on mount. A search takes 1-2
  // minutes — long enough that a page refresh or just navigating away and back is the norm, not
  // the exception. Without this, the plain useState aiRun below is wiped on every remount even
  // though the backend finished the run fine, and results silently "don't show" on the FE with
  // no way to see them short of clicking Search using AI all over again.
  useEffect(() => {
    if (isNew) return
    getLatestSearchRun(id!).then((run) => {
      if (!run) return
      if (run.status === 'pending' || run.status === 'processing') {
        setAiRun(run)
      } else if (run.status === 'completed' && getSeenRunId(id!) !== run.id) {
        setAiRun(run)
      }
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

  // Poll the AI competitor-search run until it lands on completed/failed. Same fallback-polling
  // approach as Trends.tsx uses for trend_runs — a plain interval is simpler than wiring another
  // Realtime channel for a run that only ever takes one shot, not a recurring job.
  useEffect(() => {
    if (!aiRun || aiRun.status === 'completed' || aiRun.status === 'failed') return
    const runId = aiRun.id
    const t = setInterval(async () => {
      try {
        const fresh = await getSearchRun(runId)
        if (fresh) setAiRun(fresh)
      } catch {
        // transient network hiccup — next tick retries
      }
    }, 4000)
    return () => clearInterval(t)
  }, [aiRun])

  // Pre-check every candidate GPT didn't flag as low-confidence, once a run completes.
  useEffect(() => {
    if (aiRun?.status === 'completed') {
      setAiSelected(new Set(aiRun.results.map((_, i) => i).filter((i) => aiRun.results[i].confidence !== 'low')))
    }
  }, [aiRun?.id, aiRun?.status])

  async function onSearchAI() {
    if (isNew) return
    setAiError(null)
    try {
      const run = await startCompetitorSearch(id!)
      setAiRun(run)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI search failed to start')
    }
  }

  function addSelectedCandidates() {
    if (!aiRun) return
    const existingNames = new Set((form.competitor_profiles || []).map((c) => c.name.trim().toLowerCase()))
    const toAdd: Competitor[] = aiRun.results
      .filter((_, i) => aiSelected.has(i))
      .filter((c) => !existingNames.has(c.name.trim().toLowerCase()))
      .map((c) => ({ id: uid(), name: c.name, website: c.website, socials: c.socials, source: 'ai' as const }))
    set('competitor_profiles', [...(form.competitor_profiles || []), ...toAdd])
    if (!isNew) markRunSeen(id!, aiRun.id)
    setAiRun(null)
    setAiSelected(new Set())
  }

  function dismissAiRun() {
    if (aiRun && !isNew) markRunSeen(id!, aiRun.id)
    setAiRun(null)
    setAiSelected(new Set())
  }

  async function uploadToStorage(file: File, tag: string): Promise<string> {
    const path = `brand-assets/${id}/${tag}-${Date.now()}-${sanitizeStorageFilename(file.name)}`
    const { error: upErr } = await supabase.storage.from('content-media').upload(path, file, { upsert: true })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('content-media').getPublicUrl(path)
    return data.publicUrl
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || isNew) return
    setUploading('asset')
    setError(null)
    try {
      const url = await uploadToStorage(file, 'asset')
      set('assets', [...(form.assets || []), { name: file.name, url }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(null)
      e.target.value = ''
    }
  }

  // Unlike every other field on this page, logo/cover persist to the DB immediately on upload
  // rather than waiting for "Save & run analysis" — a profile picture/cover is expected to save
  // the moment you pick it (LinkedIn, GitHub, etc. all work this way), not get silently
  // discarded on a reload just because you didn't also fill out the rest of the form and hit
  // one big Save button. Still updates local form state too, so the preview reflects it without
  // a refetch.
  async function onUploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || isNew) return
    setUploading('logo')
    setError(null)
    try {
      const url = await uploadToStorage(file, 'logo')
      await updateProfile(id!, { logo_url: url })
      set('logo_url', url)
      qc.invalidateQueries({ queryKey: qk.profiles })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(null)
      e.target.value = ''
    }
  }

  async function onUploadCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || isNew) return
    setUploading('cover')
    setError(null)
    try {
      const url = await uploadToStorage(file, 'cover')
      await updateProfile(id!, { cover_url: url })
      set('cover_url', url)
      qc.invalidateQueries({ queryKey: qk.profiles })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(null)
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
      // The Trend Intelligence n8n workflow still reads `competitors` as a plain comma-separated
      // name list for its growth-keyword queries — derive it from the structured entries instead
      // of asking the user to keep two competitor fields in sync.
      const competitorNames = (form.competitor_profiles || []).map((c) => c.name).join(', ')
      const payload: BusinessProfileInput = { ...form, competitors: competitorNames || form.competitors }
      const profile = isNew ? await createProfile(payload) : await updateProfile(id!, payload)
      await triggerAiAnalysis(profile.id)
      // Otherwise the sidebar switcher and /clients list would keep the previous 5-minute-old
      // profile list until their own staleTime expired — a just-created or just-renamed profile
      // wouldn't show up (or show its old name) until then.
      qc.invalidateQueries({ queryKey: qk.profiles })
      qc.invalidateQueries({ queryKey: qk.navCounts })
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
          {/* Cover banner — per-profile now (cover_url), falls back to the generic ScalePods
              placeholder when unset rather than always showing it regardless of which profile
              this is. */}
          <div
            className="relative w-full group"
            style={{
              aspectRatio: '1709 / 285',
              backgroundImage: `url('${form.cover_url || '/brand/profile-banner.png'}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: '#04070D',
            }}
          >
            <label
              className="absolute top-3 right-3 h-9 w-9 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'rgba(0,0,0,0.6)' }}
              title="Change cover image"
            >
              {uploading === 'cover' ? <Spinner size={16} /> : <Pencil size={15} className="text-white" />}
              <input type="file" accept="image/*" className="hidden" onChange={onUploadCover} disabled={uploading !== null} />
            </label>
          </div>
          <div className="px-6 pb-5">
            {/* Logo tile overlapping the banner, LinkedIn-page style. Needs an explicit
                z-index: the banner div is `position: relative`, and per CSS stacking rules
                any positioned element (even z-index:auto) paints above static in-flow
                content regardless of DOM order — without this the banner covered the logo. */}
            <div className="-mt-12 mb-3 relative z-10 w-fit group/logo">
              <div
                className="h-24 w-24 rounded-xl overflow-hidden"
                style={{ background: 'var(--bg-layer3)', border: '4px solid var(--bg-card)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}
              >
                <img src={form.logo_url || '/brand/logo-square.jpg'} alt={form.business_name || 'Business logo'} className="h-full w-full object-cover" />
              </div>
              <label
                className="absolute bottom-1 right-1 h-7 w-7 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover/logo:opacity-100 transition-opacity"
                style={{ background: 'rgba(0,0,0,0.7)' }}
                title="Change profile picture"
              >
                {uploading === 'logo' ? <Spinner size={13} /> : <Pencil size={13} className="text-white" />}
                <input type="file" accept="image/*" className="hidden" onChange={onUploadLogo} disabled={uploading !== null} />
              </label>
            </div>

            <h1 className="text-2xl font-semibold">{form.business_name || 'Business profile'}</h1>
            {form.tagline && <p className="text-secondary text-sm mt-1">{form.tagline}</p>}

            {/* LinkedIn-style single meta line: Industry · Service areas · Platforms · Status */}
            <div className="text-muted text-sm mt-2 flex items-center gap-1.5 flex-wrap">
              {form.industry && <span>{form.industry}</span>}
              {form.industry && <span>·</span>}
              <span>{(form.service_areas || []).length ? `${form.service_areas!.length} region${form.service_areas!.length === 1 ? '' : 's'}` : 'Global'}</span>
              <span>·</span>
              <span>{(form.target_platforms || []).length} platform{(form.target_platforms || []).length === 1 ? '' : 's'}</span>
              <span>·</span>
              <span className="capitalize" style={{ color: form.status === 'active' ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                {form.status}
              </span>
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
          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
            <div className="font-medium">Competitors</div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onSearchAI}
                loading={aiRun?.status === 'pending' || aiRun?.status === 'processing'}
                disabled={isNew}
                title={isNew ? 'Save the profile first' : 'Have AI find real competitors from your business info'}
              >
                <Wand2 size={15} /> Search using AI
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAddingCompetitor(true)}>
                <Plus size={15} /> Add competitor
              </Button>
            </div>
          </div>
          {isNew && <div className="text-muted text-xs mb-3">Save the profile once, then AI search can look up real competitors for you.</div>}

          {aiError && <div className="text-sm text-[var(--accent-orange)] mb-3">{aiError}</div>}

          {(aiRun?.status === 'pending' || aiRun?.status === 'processing') && (
            <div className="panel p-3 mb-3 flex items-center gap-2 text-sm text-muted">
              <Spinner size={14} /> Searching the web for real competitors — this can take a minute…
            </div>
          )}

          {aiRun?.status === 'failed' && (
            <div className="panel p-3 mb-3 text-sm text-[var(--accent-orange)] flex items-center justify-between gap-2 flex-wrap">
              <span>AI search failed{aiRun.error_message ? `: ${aiRun.error_message}` : '.'}</span>
              <Button type="button" variant="ghost" onClick={onSearchAI}>Try again</Button>
            </div>
          )}

          {aiRun?.status === 'completed' && (
            <div className="panel p-4 mb-3 space-y-2">
              <div className="text-sm font-medium mb-1">
                {aiRun.results.length
                  ? `Found ${aiRun.results.length} possible competitor${aiRun.results.length === 1 ? '' : 's'} — review and add:`
                  : 'No confident competitors turned up from the search. Try adding more detail (industry, description) and search again.'}
              </div>
              {aiRun.results.map((c, i) => (
                <label key={`${c.name}-${i}`} className="flex items-start gap-3 p-2 rounded cursor-pointer hover:bg-white/5">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={aiSelected.has(i)}
                    onChange={(e) => setAiSelected((s) => {
                      const next = new Set(s)
                      if (e.target.checked) next.add(i); else next.delete(i)
                      return next
                    })}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{c.name}</span>
                      <span className="badge text-[10px] capitalize">{c.confidence} confidence</span>
                    </div>
                    <div className="text-xs text-muted flex items-center gap-2.5 flex-wrap mt-0.5">
                      {c.website && (
                        <a href={c.website} target="_blank" rel="noreferrer" className="hover:text-sage inline-flex items-center gap-1">
                          <Globe size={11} />{c.website.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                      {c.socials.instagram && <a href={c.socials.instagram} target="_blank" rel="noreferrer" className="hover:text-sage"><Instagram size={12} /></a>}
                      {c.socials.facebook && <a href={c.socials.facebook} target="_blank" rel="noreferrer" className="hover:text-sage"><Facebook size={12} /></a>}
                      {c.socials.linkedin && <a href={c.socials.linkedin} target="_blank" rel="noreferrer" className="hover:text-sage"><Linkedin size={12} /></a>}
                      {c.socials.youtube && <a href={c.socials.youtube} target="_blank" rel="noreferrer" className="hover:text-sage"><Youtube size={12} /></a>}
                    </div>
                  </div>
                </label>
              ))}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={dismissAiRun}>Dismiss</Button>
                {aiRun.results.length > 0 && (
                  <Button type="button" onClick={addSelectedCandidates} disabled={aiSelected.size === 0}>
                    <Check size={15} /> Add {aiSelected.size || ''} selected
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {(form.competitor_profiles || []).map((c) =>
              editingCompetitorId === c.id ? (
                <CompetitorForm
                  key={c.id}
                  initial={c}
                  onSave={(updated) => {
                    set('competitor_profiles', (form.competitor_profiles || []).map((x) => (x.id === updated.id ? updated : x)))
                    setEditingCompetitorId(null)
                  }}
                  onCancel={() => setEditingCompetitorId(null)}
                />
              ) : (
                <div key={c.id} className="panel p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{c.name}</span>
                      {c.source === 'ai' && <span className="badge text-[10px]">Found by AI</span>}
                    </div>
                    <div className="text-xs text-muted flex items-center gap-2.5 flex-wrap mt-0.5">
                      {c.website && (
                        <a href={c.website} target="_blank" rel="noreferrer" className="hover:text-sage inline-flex items-center gap-1">
                          <Globe size={11} />{c.website.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                      {c.socials.instagram && <a href={c.socials.instagram} target="_blank" rel="noreferrer" className="hover:text-sage"><Instagram size={12} /></a>}
                      {c.socials.facebook && <a href={c.socials.facebook} target="_blank" rel="noreferrer" className="hover:text-sage"><Facebook size={12} /></a>}
                      {c.socials.linkedin && <a href={c.socials.linkedin} target="_blank" rel="noreferrer" className="hover:text-sage"><Linkedin size={12} /></a>}
                      {c.socials.youtube && <a href={c.socials.youtube} target="_blank" rel="noreferrer" className="hover:text-sage"><Youtube size={12} /></a>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => setEditingCompetitorId(c.id)} className="p-1.5 hover:text-sage" title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => set('competitor_profiles', (form.competitor_profiles || []).filter((x) => x.id !== c.id))}
                      className="p-1.5 hover:text-[var(--accent-orange)]"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            )}
            {addingCompetitor && (
              <CompetitorForm
                onSave={(c) => {
                  set('competitor_profiles', [...(form.competitor_profiles || []), c])
                  setAddingCompetitor(false)
                }}
                onCancel={() => setAddingCompetitor(false)}
              />
            )}
            {!addingCompetitor && (form.competitor_profiles || []).length === 0 && (
              <div className="text-muted text-sm">No competitors added yet.</div>
            )}
          </div>
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
                {uploading === 'asset' ? <Spinner size={15} /> : <UploadCloud size={16} />}
                Upload asset
                <input type="file" className="hidden" onChange={onUpload} disabled={uploading !== null} />
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
