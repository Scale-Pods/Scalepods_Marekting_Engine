import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen, Building2, TrendingUp, Target, Wand2, Clapperboard, Film, CheckSquare,
  CalendarDays, Send, Newspaper, BarChart3, BrainCircuit, Settings as SettingsIcon,
  ArrowRight, ShieldCheck, Lightbulb, LogIn, Users, KanbanSquare,
} from 'lucide-react'
import { PageHeader, Badge, Panel } from '../components/ui'
import { useAuth } from '../lib/auth'
import { isAdminRole } from '../lib/team'
import type { FeatureKey } from '../lib/permissions'

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
  /** Same feature key AppShell gates its nav item on. Omitted for the two entries everyone reaches
   *  regardless of role (Signing in, Settings) — those aren't behind a permission. */
  feature?: FeatureKey
  /** Team & access only — mirrors AppShell's own `adminOnly`, checked against the role directly
   *  rather than a permission (see PRD §13.6: "users" was deliberately never a feature key). */
  adminOnly?: boolean
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
        feature: 'business',
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
        feature: 'trends',
        what: 'What people are actually talking about right now, ranked by relevance to your business.',
        steps: [
          'Signals come from real Reddit, Instagram, YouTube, Google Search and Google Trends data.',
          'A scan runs automatically every night at midnight IST. To run one immediately, use "Run manual scan" and pick which platforms to scan.',
          'Read the ranked list — each card links out to the real source so you can check it yourself.',
          'Click the checkmark on any trend to select it — from the latest scan, a date-range view, or History, and mixing across all three is fine.',
          'With one or more selected, use the "Generate Strategy" bar at the bottom to pick a scope (a full month, one week, or a single post), and optionally narrow to one platform or content type.',
          'Or click "Create Post" on a single trend to build one image/carousel straight away in AI Studio instead.',
        ],
        tip: 'A trend-anchored generation shows up as a new entry in the list on the Strategy page — nothing there is overwritten, so past generations stay browsable.',
      },
      {
        id: 'strategy',
        label: 'Strategy',
        to: '/strategy',
        icon: <Target size={17} />,
        feature: 'strategy',
        what: 'The plan: built from the business analysis, the trend signals, and how your past posts actually performed.',
        steps: [
          'Landing here shows a numbered list of every strategy you have ever generated — timestamp, scope, and status for each.',
          '"Generate Strategy" builds a new one — pick one or more trends right here or from the Trends page (or none, for a general strategy), choose a scope (a full month, one week, or a single post), and optionally narrow to one platform or content type.',
          'Click any strategy in the list to open the full plan: AI insights, the content-pillar mix, the platform mix, and the content calendar. Edit any section by hand, or regenerate just that one section.',
          '"Create Post" in the header — pick which planned post to build (or it jumps straight to AI Studio if there is only one, e.g. a single-post "Day" strategy) — is the fastest way in; clicking a calendar entry directly works too.',
          'Approve whichever strategy should drive content generation — approving one automatically un-approves whichever was approved before, so exactly one is ever active.',
        ],
        tip: 'Content generation stays locked until a strategy is approved — this is a real gate, not a formality.',
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
        feature: 'studio',
        what: 'One post at a time — image and copy together, with the cost shown before you spend anything. Single image or a multi-slide carousel.',
        steps: [
          'Pick what the post is about: a live trend, the strategy, or your own topic.',
          'Pick a look. The 15 styles are art direction (photo, poster, 3D render…), not the subject.',
          'Pick a post type: a single image, or a carousel (3-8 slides — each slide gets its own real image, no picking between variants).',
          'Choose the platform, shape, image model and how many options (or slides) you want. The price updates as you change them.',
          'Have an existing poster or post whose look you want to match? Upload it as a reference image — the generated image (or every slide, for a carousel) follows its style and layout, not its actual content.',
          'Click "Write the brief". AI writes the copy and the image prompt — for a carousel, one prompt per slide — nothing has been spent yet at this point.',
          'Edit the copy, or any slide\'s title/caption/prompt, then click Generate.',
          'Single image: click an image to see it full size, click the checkmark in its corner to pick it. Carousel: every slide generates once — click "Regenerate this slide" on any tile that came out wrong, no need to redo the rest. Rate a slide with the thumbs beneath it and optionally say what is wrong; the note gets folded into that slide\'s own prompt the next time you regenerate it.',
          'Click "Send to Review" — the image (or every slide) gets brand-stamped automatically and lands in Creative Review.',
        ],
        tip: 'The "Recent" grid keeps every past job with its date, the model used and what it cost. Video is never generated automatically — that stays manual on purpose. If you have a monthly generation budget, it shows next to Generate and the button greys out with an explanation once a click would go over it — an admin raises it from Team & access.',
      },
      {
        id: 'carousel-studio',
        label: 'Carousel Studio',
        to: '/carousel-studio',
        icon: <Clapperboard size={17} />,
        feature: 'carousel_studio',
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
        id: 'video-studio',
        label: 'Video Studio',
        to: '/video-studio',
        icon: <Film size={17} />,
        feature: 'video_studio',
        what: 'A trend or a topic in, a branded short-form video out — either real AI-generated footage (Veo) or an animated motion-graphics explainer. Every shot and its exact price is reviewable before anything is charged.',
        steps: [
          'Pick how it is made: "AI video (Veo)" for real generated footage, or "Motion graphics" for animated on-screen text (no AI model, effectively free).',
          'For AI video, pick what kind of video it is — Problem → Fix, Workplace b-roll, Abstract automation, Founder POV, Macro detail, Time-lapse transformation, Cinematic hook, or Product in context. Each one carries its own camera direction and story arc, and sets sensible defaults for you.',
          'Pick what it is about: a live trend from the Trends page, the current strategy, or your own topic. Anchoring on a real trend is what stops the video being generic.',
          'Set platform, shape, model (Lite / Fast / Standard), resolution, how many shots and how long each one is. The live price bar shows the per-second rate, total seconds and total cost in dollars and rupees, and updates as you change anything.',
          'Click "Write the storyboard" — this is free. AI writes a full Veo prompt for every shot (camera, subject, action, setting, lighting), the on-screen text, and the post caption. Nothing is generated or charged yet.',
          'Read every shot prompt and edit anything you want — this is the moment to fix it, because the next click costs money. The on-screen text is added by us afterwards, not by Veo, so it is always spelled correctly.',
          'Reorder shots with the up/down arrows next to each one\'s number — this just changes the sequence, so it\'s free both before and after generation. After generating, reordering already-made shots costs nothing to apply: the next "Rebuild video" click only re-stitches them in the new order, it doesn\'t regenerate anything.',
          'Turn on the voiceover and the music bed if you want them. Veo only gives each shot its own unrelated audio, so a continuous narration and score are generated separately and laid across the whole finished video — that is what makes the cuts stop sounding disjointed.',
          'Pick the narrator from the voice grid and press play on any voice to hear it read a sample line before you commit. Six are shortlisted for B2B reads; "Show all 30 voices" opens the full set. The voiceover costs a fraction of a cent; the music bed is a flat $0.04.',
          'Click "Generate video" — a confirmation box restates the exact amount before anything is charged. Videos over $5 are blocked outright.',
          'Each shot generates separately (a few minutes each). If one shot comes out wrong, regenerate just that shot — you only pay for that one, not the whole video.',
          'Once it is done, the finished video and its full storyboard stay together — open it any time to watch it or keep editing. Change a shot\'s prompt and the button below it updates to say what redoing it will actually cost; leave shots untouched and it just says "Rebuild video" (free) because every already-generated shot is reused, never re-paid for.',
          'The voiceover and music checkboxes work on ANY video, not just ones you turned them on for at the start — tick either one later and Rebuild will record it. If a take just does not land even though the script or brief is right, the small redo icon next to it re-records the exact same one rather than making you retype it.',
          'Rate a finished shot, voiceover, or music bed with the thumbs next to it, and optionally say what is wrong. The rating alone is a record for later; the note goes further — the next time you regenerate that specific shot or redo that audio, your note is folded straight into its prompt or script as a revision instruction, then cleared, so the same click that flags the problem also tries to fix it. The same rating-and-note works on AI Studio\'s carousel slides.',
          'When you are happy with it, click "Send to Review" to hand it to Creative Review like any other post.',
        ],
        tip: 'Recent videos sit in an Instagram-style grid at the top of the page, with "New video" opposite the heading — click any past video to open its full storyboard on its own rather than merging it into the create form. If Google runs out of credits the page tells you plainly and links straight to the top-up page; nothing is charged when a generation fails. Same monthly-budget line and greyed-out button as AI Studio if you have a cap — it is a second, per-person limit on top of the $5-per-video ceiling, not instead of it.',
      },
      {
        id: 'creative-review',
        label: 'Creative Review',
        to: '/review',
        icon: <CheckSquare size={17} />,
        feature: 'review',
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
    section: 'Team',
    blurb: 'Hand work out, track it, and check it when it comes back.',
    entries: [
      {
        id: 'board',
        label: 'Board',
        to: '/board',
        icon: <KanbanSquare size={17} />,
        feature: 'board',
        what: 'The Jira-style board: every task the team is working on, and who it belongs to.',
        steps: [
          '"Create" raises a ticket. Give it a summary, a type, a priority, an assignee (who does the work) and a reviewer (who checks it).',
          'Drag a card between columns to move it. Click one to open it — description, people, dates, comments and full history.',
          'Click any avatar along the top to see only that person’s tickets. Click it again to clear.',
          'When the assignee finishes, they press "Submit for review" — the ticket moves to In Review and the reviewer is notified.',
          'The reviewer then presses "Accept", which moves it to Done, or "Send back" with a note saying what needs to change. Either way the assignee is told.',
          'Anyone with Board access can raise their own tickets, not just admins.',
          'Type @ in a comment to pull up the team and mention someone directly — they get notified even if the ticket is not theirs.',
        ],
        tip: 'An assignee cannot drag their own work into Done — that is the whole point of the reviewer. The rule lives in the database, so it holds however the move is attempted. Only the named reviewer (or an admin) can close a ticket. Every assignment, comment, @-mention, accept and send-back reaches the right person as a bell notification and, unless they have turned it off in Settings, an email too — plus one daily email if they have anything due tomorrow or overdue.',
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
        feature: 'calendar',
        what: 'Every post that has a target date — draft, ready, scheduled or already published — on one month grid.',
        steps: [
          'Click any day to create a post for that date.',
          'Click an existing post to open it, then view, schedule or edit it there.',
          'For LinkedIn, pick which account it goes out as — Adnan, Raunak, or the ScalePods Page. The Page publishes via Buffer instead of LinkedIn directly (LinkedIn\'s own Company Page API is still pending approval), so it can\'t do a PDF/Document post — that option only shows up for Adnan\'s or Raunak\'s account.',
        ],
        tip: 'This is a view across the whole pipeline, so a post can show up here before it has been approved.',
      },
      {
        id: 'publishing',
        label: 'Publishing',
        to: '/publishing',
        icon: <Send size={17} />,
        feature: 'publishing',
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
        feature: 'blog',
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
        feature: 'analytics',
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
        feature: 'intelligence',
        what: 'The AI business analysis: 7 sub-analyses (website, Instagram, Facebook, LinkedIn, competitors, SEO, audience) compiled into one report.',
        steps: [
          'It runs on its own every time the business profile is saved — there is no separate button to press.',
          'Open the latest report to read it, or use History to compare it against older runs.',
        ],
      },
      {
        id: 'team',
        label: 'Team & access',
        to: '/settings/team',
        icon: <Users size={17} />,
        adminOnly: true,
        what: 'Admin only. Who is on the team, and exactly which screens each person can reach.',
        steps: [
          'Settings → Team & access, or "Team & access" in the sidebar. Only Owners and Admins see it.',
          '"Add person" creates someone from their @scalepods.co email. Pick a role to give them a starting set of permissions, then adjust any of them individually.',
          'Open anyone to change their name, role, monthly generation budget, or any single permission. Their spend so far this month shows right there too, so you know whether raising the cap is actually warranted before you do it.',
          'Each feature has four levels and each one includes the ones before it: None (hidden entirely), View (read-only), Edit (change drafts and prompts — nothing that costs money), Full (the consequential action: spend, publish, approve).',
          'A new person stays "Invited" until you press "Activate account". Until then they can sign in but only see the "Almost there" screen.',
          'Suspend keeps someone\'s history and blocks them; Remove deletes their team record.',
          'If a @scalepods.co address you never added signs in on its own, every active owner/admin gets notified so someone can give them a role.',
        ],
        tip: 'The owner account cannot be demoted, suspended or deleted, you cannot strip your own admin access or suspend yourself, and the last remaining admin cannot be removed. Those rules live in the database, not just in this screen — so they hold no matter how the change is attempted.',
      },
      {
        id: 'signing-in',
        label: 'Signing in',
        to: '/settings',
        icon: <LogIn size={17} />,
        what: 'How you and the rest of the team get into the Growth OS.',
        steps: [
          'Use "Continue with Google" with your @scalepods.co account. There is no password to remember.',
          'What you can see depends on your access. Screens you have not been given simply are not in the sidebar, opening one by URL shows a short explanation rather than the page, and the data behind it is refused too — the restriction is in the database, not just the interface.',
          'Some buttons stay visible but greyed out — that means you can work on the thing but not take the final step (generating, publishing or approving). Hover the button and it tells you what access you would need.',
          'Only @scalepods.co addresses can create an account. A personal Gmail is refused at the door, not after signing in.',
          'Signing in is not the same as being let in: a new account has to be switched on by an admin before it can reach anything. Until then you land on an "Almost there" screen.',
          'Your name, photo and role come from your Google account and the team directory. An admin sets the role; you cannot pick your own.',
        ],
        tip: 'The email and password box is still there as a fallback for the original marketing@scalepods.co account. Everyone else should use the Google button.',
      },
      {
        id: 'settings',
        label: 'Settings',
        to: '/settings',
        icon: <SettingsIcon size={17} />,
        feature: 'settings',
        what: 'Your account, the look of the app, connected platforms, and the safety switches.',
        steps: [
          'See which account and role you are signed in as. Your name and role come from the team directory now — they are set by an admin, not chosen by you.',
          'Turn email notifications on or off for yourself — assignments, @-mentions and your daily due/overdue digest. The bell in the top bar keeps working either way; this only controls email.',
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
  const { can, appUser } = useAuth()

  // Instant, not `behavior: 'smooth'` — smooth scrolling is a no-op in some engines and
  // reduced-motion setups (verified live: a smooth scrollIntoView/scrollTo moved nothing at all
  // while the instant one worked), and a jump link that silently does nothing is worse than one
  // that jumps. Same behavior as a plain anchor link, which is what these chips are.
  function jumpTo(id: string) {
    sectionRefs.current[id]?.scrollIntoView({ block: 'start' })
  }

  // Same predicate AppShell filters its sidebar on — walking someone through steps for a screen
  // they will land on NoAccess for is worse than not mentioning it. Signing in / Settings have no
  // `feature` and always show, since they apply regardless of what else you can reach.
  const visible = (e: ManualEntry) =>
    (!e.feature || can(e.feature, 'view')) && (!e.adminOnly || isAdminRole(appUser?.role))
  const admin = isAdminRole(appUser?.role)
  const visibleGroups = MANUAL_GROUPS
    .map((g) => ({ ...g, entries: g.entries.filter(visible) }))
    .filter((g) => g.entries.length > 0)

  const allEntries = visibleGroups.flatMap((g) => g.entries)

  return (
    <div>
      <PageHeader
        accent={<Badge><BookOpen size={12} /> User manual</Badge>}
        title="How to use Growth OS"
        subtitle={
          admin
            ? 'Every screen in the sidebar, what it is for, and the steps to actually use it. Start with the eight steps below if this is your first time here.'
            : 'What your account can reach, what each screen is for, and the steps to actually use it. An admin sees the rest.'
        }
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
        {visibleGroups.map((group) => (
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
