import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen, Building2, TrendingUp, Target, Wand2, Clapperboard, CheckSquare,
  CalendarDays, Send, Newspaper, BarChart3, BrainCircuit, Settings as SettingsIcon,
  ArrowRight, ShieldCheck, Lightbulb,
} from 'lucide-react'
import { PageHeader, Badge, Panel } from '../components/ui'

// The in-app manual. Every step here describes what the screens actually do today — it's written
// from the real pages, not from the spec, so if a flow changes the matching entry below has to
// change with it. Kept as data (MANUAL_GROUPS) rather than free-form JSX so a section can be
// added or reworded without touching layout.

type ManualEntry = {
  id: string
  label: string
  to: string
  icon: ReactNode
  what: string
  steps: string[]
  tip?: string
}

const MANUAL_GROUPS: { section: string; blurb: string; entries: ManualEntry[] }[] = [
  {
    section: 'Marketing Strategy',
    blurb: 'Teach the system about the business, then decide what to talk about.',
    entries: [
      {
        id: 'business',
        label: 'Business',
        to: '/clients',
        icon: <Building2 size={17} />,
        what: 'The brand knowledge base. One profile feeds every other engine on this list.',
        steps: [
          'Open Business and pick a profile, or create a new one.',
          'Fill in the business details, brand guidelines, brand voice and target platforms.',
          'Add competitors by hand, or use "Search using AI" to find real ones automatically.',
          'Save. That alone fires the AI business analysis — you do not need to start it separately.',
        ],
        tip: 'Everything downstream reads from here. Vague answers on this page produce vague content everywhere else.',
      },
      {
        id: 'trends',
        label: 'Trends',
        to: '/trends',
        icon: <TrendingUp size={17} />,
        what: 'What people are actually talking about right now, ranked by relevance to your business.',
        steps: [
          'Signals come from real Reddit, Instagram, YouTube, Google Search and Google Trends data.',
          'A scan runs automatically every night at midnight IST. To run one immediately, use "Run manual scan" and pick which platforms to scan.',
          'Read the ranked list — each card links out to the real source so you can check it yourself.',
          'Click the checkmark on any trend to select it — from the latest scan, a date-range view, or History, and mixing across all three is fine.',
          'With one or more selected, use the "Generate Strategy" bar at the bottom to pick a scope (a full month, one week, or a single post), and optionally narrow to one platform or content type.',
          'Or click "Create Post" on a single trend to build one image/carousel straight away in AI Studio instead.',
        ],
        tip: 'A trend-anchored generation never touches your current active strategy on the Strategy page — it always lands as its own separate entry under "Recent" there, never a replacement.',
      },
      {
        id: 'strategy',
        label: 'Strategy',
        to: '/strategy',
        icon: <Target size={17} />,
        what: 'The plan: built from the business analysis, the trend signals, and how your past posts actually performed.',
        steps: [
          'The active plan at the top is what content generation is gated on — read the AI insights, the content-pillar mix and the platform mix, edit any section by hand or regenerate just that one section, then approve it.',
          '"Generate Strategy" (top right) builds a new, standalone plan — pick one or more trends right here or from the Trends page, choose a scope (a full month, one week, or a single post), and optionally narrow to one platform or content type.',
          '"Recent" further down the page holds every one of these generations — click one to see the full plan it produced and which trend(s) it came from, and "Create Post" on any of its calendar entries to build that specific post in AI Studio.',
        ],
        tip: 'A "Recent" generation is always a separate, saved reference — it never replaces the active plan at the top, and there is no way to regenerate the active plan wholesale from this page anymore (only section-by-section edits/regenerates, or approving it).',
      },
    ],
  },
  {
    section: 'Content Generation',
    blurb: 'Make the actual posts, then get a human to sign them off.',
    entries: [
      {
        id: 'ai-studio',
        label: 'AI Studio',
        to: '/studio',
        icon: <Wand2 size={17} />,
        what: 'One post at a time — image and copy together, with the cost shown before you spend anything.',
        steps: [
          'Pick what the post is about: a live trend, the strategy, or your own topic.',
          'Pick a look. The 15 styles are art direction (photo, poster, 3D render…), not the subject.',
          'Choose the platform, shape, image model and how many options you want. The price updates as you change them.',
          'Click "Write the brief". AI writes the copy and the image prompt — nothing has been spent yet at this point.',
          'Edit the copy or the prompt however you like, check the estimated cost, then click Generate.',
          'Click an image to see it full size; click the checkmark in its corner to pick it.',
          'Click "Send to Review" — the image gets brand-stamped automatically and lands in Creative Review.',
        ],
        tip: 'The "Recent" grid keeps every past job with its date, the model used and what it cost. Video is never generated automatically — that stays manual on purpose.',
      },
      {
        id: 'carousel-studio',
        label: 'Carousel Studio',
        to: '/carousel-studio',
        icon: <Clapperboard size={17} />,
        what: 'Topic in, animated avatar-hosted carousel out — each slide is rendered as its own video.',
        steps: [
          'Click "New carousel" and give it a topic.',
          'Review the outline it drafts before anything renders.',
          'Start the render. Each slide is rendered separately, so a long carousel takes a few minutes.',
          'When it is done, send it on to review and publishing like any other post.',
        ],
        tip: 'The render keeps running if you navigate away — come back to this page and the job will still be there.',
      },
      {
        id: 'creative-review',
        label: 'Creative Review',
        to: '/review',
        icon: <CheckSquare size={17} />,
        what: 'The approval gate. Nothing reaches Publishing without passing through this screen.',
        steps: [
          'Filter by platform, content type, or status (everything / ready / sent back).',
          'Open a piece to read the caption and see the image the way it will actually post.',
          'Approve it, or send it back with a note saying what needs to change.',
          'Wrong image? Edit it in place, or replace it — including importing a design straight from Canva or Figma.',
        ],
        tip: 'Approved items appear immediately in Publishing under "Ready to publish".',
      },
    ],
  },
  {
    section: 'Publishing Engine',
    blurb: 'Decide when things go out, and send them.',
    entries: [
      {
        id: 'calendar',
        label: 'Calendar',
        to: '/calendar',
        icon: <CalendarDays size={17} />,
        what: 'Every post that has a target date — draft, ready, scheduled or already published — on one month grid.',
        steps: [
          'Click any day to create a post for that date.',
          'Click an existing post to open it, then view, schedule or edit it there.',
        ],
        tip: 'This is a view across the whole pipeline, so a post can show up here before it has been approved.',
      },
      {
        id: 'publishing',
        label: 'Publishing',
        to: '/publishing',
        icon: <Send size={17} />,
        what: 'Where posts actually go live to Instagram, Facebook and LinkedIn.',
        steps: [
          '"Ready to publish" lists everything approved and waiting.',
          'Open a post, then either "Post now" or "Schedule" it for the AI-predicted best time.',
          'Watch "Recent activity" for the live status, the link to the published post, and any error message.',
          'A scheduled post can still be edited or cancelled from Recent activity before it fires.',
        ],
        tip: '"Post now" is public and cannot be undone, so it always asks you to confirm first. YouTube video stays manual-only by design.',
      },
      {
        id: 'blog',
        label: 'Blog',
        to: '/blog',
        icon: <Newspaper size={17} />,
        what: 'Long-form posts that publish to the scalepods.co website rather than to a social platform.',
        steps: [
          'Create a new post and write it in the editor.',
          'Publish it straight to the live site when it is ready.',
        ],
      },
    ],
  },
  {
    section: 'Insight',
    blurb: 'See what worked, and keep the system tuned.',
    entries: [
      {
        id: 'analytics',
        label: 'Analytics',
        to: '/analytics',
        icon: <BarChart3 size={17} />,
        what: 'What actually happened after publishing — and the numbers that feed back into the system.',
        steps: [
          'Engagement by platform and Top posts show real performance from the live accounts.',
          '"Leads" is the comment-level list: the real username, what they commented, and whether the auto-DM was sent.',
          '"Generate insights" produces content scores, winning hooks, audience behaviour, best posting time and the top creatives worth reusing.',
        ],
        tip: 'Likes and shares only ever come back as totals — Meta, LinkedIn and YouTube all restrict that data. Comments are the one place real usernames are available, which is why leads come from there.',
      },
      {
        id: 'intelligence',
        label: 'Intelligence',
        to: '/intelligence',
        icon: <BrainCircuit size={17} />,
        what: 'The AI business analysis: 7 sub-analyses (website, Instagram, Facebook, LinkedIn, competitors, SEO, audience) compiled into one report.',
        steps: [
          'It runs on its own every time the business profile is saved — there is no separate button to press.',
          'Open the latest report to read it, or use History to compare it against older runs.',
        ],
      },
      {
        id: 'settings',
        label: 'Settings',
        to: '/settings',
        icon: <SettingsIcon size={17} />,
        what: 'Your account, the look of the app, connected platforms, and the safety switches.',
        steps: [
          'See which account and role you are signed in as.',
          'Switch between the dark and light theme.',
          'Connect Instagram, and check whether each platform is live.',
          'Manage comment automations — auto-DM anyone who comments a keyword — and track an existing Instagram post by pasting its URL.',
        ],
        tip: 'Credit-safety status lives here too: generation and publishing each have a master switch, so nothing spends money or posts publicly before you turn it on.',
      },
    ],
  },
]

// The order somebody should actually do things in the first time they log in. Deliberately
// separate from the grouped reference below — a new user needs a path, not a table of contents.
const QUICK_START: { label: string; to: string; text: string }[] = [
  { label: 'Business', to: '/clients', text: 'Fill in the brand profile and save it. That kicks off the AI analysis by itself.' },
  { label: 'Intelligence', to: '/intelligence', text: 'Read the report it just produced so you know what the system thinks of the business.' },
  { label: 'Trends', to: '/trends', text: 'Run a scan to see what is worth talking about this week.' },
  { label: 'Strategy', to: '/strategy', text: 'Generate the plan, edit anything you disagree with, then approve it.' },
  { label: 'AI Studio', to: '/studio', text: 'Make your first post: source, look, prompt, generate, pick one, send to review.' },
  { label: 'Creative Review', to: '/review', text: 'Approve the post, or send it back with a note.' },
  { label: 'Publishing', to: '/publishing', text: 'Post it now, or schedule it for the best predicted time.' },
  { label: 'Analytics', to: '/analytics', text: 'Come back after a few days to see what worked. The system learns from it.' },
]

export default function UserManual() {
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Instant, not `behavior: 'smooth'` — smooth scrolling is a no-op in some engines and
  // reduced-motion setups (verified live: a smooth scrollIntoView/scrollTo moved nothing at all
  // while the instant one worked), and a jump link that silently does nothing is worse than one
  // that jumps. Same behavior as a plain anchor link, which is what these chips are.
  function jumpTo(id: string) {
    sectionRefs.current[id]?.scrollIntoView({ block: 'start' })
  }

  const allEntries = MANUAL_GROUPS.flatMap((g) => g.entries)

  return (
    <div>
      <PageHeader
        accent={<Badge><BookOpen size={12} /> User manual</Badge>}
        title="How to use Growth OS"
        subtitle="Every screen in the sidebar, what it is for, and the steps to actually use it. Start with the eight steps below if this is your first time here."
      />

      {/* --- Quick start ---------------------------------------------------- */}
      <Panel className="mb-5">
        <div className="flex items-center gap-2 mb-1 font-medium">
          <Lightbulb size={16} className="text-sage" /> Start here — the whole thing in eight steps
        </div>
        <p className="text-muted text-xs mb-4">
          Do these once, in this order. Each one feeds the next, which is why the sidebar is arranged the same way.
        </p>
        <ol className="space-y-2.5">
          {QUICK_START.map((s, i) => (
            <li key={s.to} className="flex items-start gap-3">
              <span
                className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold mt-0.5"
                style={{ background: 'var(--accent-green)', color: 'var(--bg-primary)' }}
              >
                {i + 1}
              </span>
              <div className="text-sm">
                <Link to={s.to} className="font-semibold hover:text-sage">{s.label}</Link>
                <span className="text-secondary"> — {s.text}</span>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {/* --- Jump links ------------------------------------------------------ */}
      <div className="flex gap-2 flex-wrap mb-5">
        {allEntries.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => jumpTo(e.id)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5"
            style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
          >
            {e.label}
          </button>
        ))}
      </div>

      {/* --- Section reference ----------------------------------------------- */}
      <div className="space-y-6">
        {MANUAL_GROUPS.map((group) => (
          <div key={group.section}>
            <div className="mb-1 text-muted text-[10px] font-semibold uppercase tracking-wide">{group.section}</div>
            <p className="text-secondary text-sm mb-3">{group.blurb}</p>
            <div className="space-y-3">
              {group.entries.map((entry) => (
                <div
                  key={entry.id}
                  ref={(el) => { sectionRefs.current[entry.id] = el }}
                  style={{ scrollMarginTop: 16 }}
                >
                  <Panel>
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 text-sage"
                          style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
                        >
                          {entry.icon}
                        </span>
                        <div>
                          <div className="font-semibold">{entry.label}</div>
                          <div className="text-muted text-xs">{entry.what}</div>
                        </div>
                      </div>
                      <Link to={entry.to} className="btn-ghost !py-1.5 !px-3 text-xs shrink-0">
                        Open <ArrowRight size={13} />
                      </Link>
                    </div>

                    <ol className="space-y-1.5 mt-3">
                      {entry.steps.map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-secondary">
                          <span
                            className="shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-semibold mt-0.5"
                            style={{ background: 'var(--fill-secondary)', color: 'var(--text-primary)' }}
                          >
                            {i + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>

                    {entry.tip && (
                      <div
                        className="mt-3 text-xs px-3 py-2 rounded-lg flex items-start gap-2"
                        style={{ background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)' }}
                      >
                        <Lightbulb size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--accent-orange)' }} />
                        <span className="text-secondary">{entry.tip}</span>
                      </div>
                    )}
                  </Panel>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* --- Safety rules ----------------------------------------------------- */}
      <Panel className="mt-6">
        <div className="flex items-center gap-2 mb-3 font-medium">
          <ShieldCheck size={16} className="text-sage" /> Two things that cannot happen by accident
        </div>
        <ul className="space-y-2 text-sm text-secondary">
          <li className="flex items-start gap-2.5">
            <span className="shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-green)' }} />
            <span>
              <span className="text-primary font-medium">Nothing spends money without showing you the price first.</span>{' '}
              AI Studio prices every generation in dollars and rupees before the button is clickable, and video generation is
              never automatic — it stays a manual step on purpose.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-green)' }} />
            <span>
              <span className="text-primary font-medium">Nothing goes public without a human approving it.</span>{' '}
              Every generated post has to pass Creative Review before Publishing will touch it, and "Post now" asks you to
              confirm because it cannot be undone.
            </span>
          </li>
        </ul>
      </Panel>
    </div>
  )
}
