import { Construction } from 'lucide-react'
import { PageHeader, EmptyState, Badge } from '../components/ui'

// Temporary stub for pipeline pages not yet built. Each is replaced by its real
// implementation in the corresponding TRD §13 build step.
export default function Placeholder({ title, step }: { title: string; step: string }) {
  return (
    <div>
      <PageHeader accent={<Badge tone="blue">{step}</Badge>} title={title} />
      <EmptyState
        icon={<Construction size={28} />}
        title={`${title} — coming in ${step}`}
        hint="This module is scaffolded and routed. Its engine (FE → n8n → Supabase → FE) is built in the matching build-sequence step."
      />
    </div>
  )
}
