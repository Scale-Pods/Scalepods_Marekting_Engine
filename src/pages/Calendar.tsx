import { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { listProfiles, type BusinessProfile } from '../lib/clients'
import type { ContentItem, ContentStatus } from '../lib/content'
import { PageHeader, Badge, EmptyState, Spinner } from '../components/ui'
import { PlatformBadge } from '../components/mediaUi'

const STATUS_TONE: Record<ContentStatus, 'green' | 'blue' | 'orange'> = {
  pending: 'blue', generating: 'blue', ready: 'blue', in_review: 'blue',
  approved: 'blue', revision: 'orange', failed: 'orange',
  published: 'green', scheduled: 'green', publishing: 'blue',
}

function formatDateHeader(dateStr: string) {
  const date = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000)
  const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  if (diffDays === 0) return `Today · ${label}`
  if (diffDays === 1) return `Tomorrow · ${label}`
  if (diffDays < 0) return `${label} (past)`
  return label
}

export default function Calendar() {
  const [profile, setProfile] = useState<BusinessProfile | null | undefined>(undefined)
  const [items, setItems] = useState<ContentItem[]>([])

  useEffect(() => {
    listProfiles().then(async (profiles) => {
      const p = profiles[0] ?? null
      setProfile(p)
      if (p) {
        const { data, error } = await supabase
          .from('content_items')
          .select('*')
          .eq('profile_id', p.id)
          .not('scheduled_date', 'is', null)
          .order('scheduled_date', { ascending: true })
        if (!error) setItems((data ?? []) as ContentItem[])
      }
    })
  }, [])

  if (profile === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size={24} />
      </div>
    )
  }

  if (!profile) {
    return (
      <div>
        <PageHeader accent={<Badge><CalendarDays size={12} /> Calendar</Badge>} title="Calendar" />
        <EmptyState icon={<CalendarDays size={28} />} title="No business profile yet" hint="Create the business profile first." />
      </div>
    )
  }

  const grouped = items.reduce<Record<string, ContentItem[]>>((acc, item) => {
    const key = item.scheduled_date!
    ;(acc[key] ??= []).push(item)
    return acc
  }, {})
  const dates = Object.keys(grouped).sort()

  return (
    <div>
      <PageHeader
        accent={<Badge><CalendarDays size={12} /> Calendar</Badge>}
        title={`Content Calendar — ${profile.business_name}`}
        subtitle="Every generated post, grouped by its scheduled date."
      />

      {dates.length === 0 ? (
        <EmptyState icon={<CalendarDays size={28} />} title="Nothing scheduled yet" hint="Generate content from the Content Factory — dated items land here." />
      ) : (
        <div className="space-y-6">
          {dates.map((date) => (
            <div key={date}>
              <div className="text-sm font-medium text-secondary mb-2">{formatDateHeader(date)}</div>
              <div className="space-y-2">
                {grouped[date].map((item) => (
                  <div key={item.id} className="card p-3 flex items-center gap-3">
                    {item.media_url && <img src={item.media_url} alt={item.title ?? ''} className="h-12 w-12 object-cover rounded-md shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <PlatformBadge platform={item.platform} />
                        <span className="text-muted text-xs">{item.content_type.replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                    <Badge tone={STATUS_TONE[item.status] ?? 'blue'}>{item.status.replace(/_/g, ' ')}</Badge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
