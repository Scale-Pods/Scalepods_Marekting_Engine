# ScalePods Growth OS — Technical Requirements Document (TRD)

**Version:** 1.0 (original build) + §14 added 2026-09-11 · Companion to `PRD.md`
**Basis:** Replication of the validated Victory Growth OS stack, scoped to IG/YT/FB/LinkedIn, re-branded ScalePods.

> **Drift notice:** §§1-13 describe the app as it was at initial build. Every module shipped since
> (Trends, the Strategy redesign, AI Studio, Carousel Studio, Video Studio, Blog, Comment-to-DM,
> and — documented properly for the first time in §14 — Team Collaboration & Access Control) has
> been keeping its own memory file and, for Team Collaboration, its own dedicated
> `docs/team-collaboration-prd.md` rather than folding every change back into this document. §14
> is scoped to correcting the specific claims below that Team Collaboration made outright false
> (single-login auth, blanket RLS, the role selector) and to summarizing what replaced them — it
> is not a full modernization of §§1-13 for everything else that has drifted since v1.0.

---

## 1. Architecture overview

```
                         ┌──────────────────────────┐
   React FE (Vercel) ───▶│  Supabase (Postgres/Auth/ │◀──── n8n workflows
   liquid-glass UI        │  Storage/Edge Functions)  │      (self-hosted)
        │                └──────────────────────────┘            │
        │  fire webhook            ▲     ▲                        │ read/write DB
        └──────────────────────────┘     └────────────────────────┘
                                     external APIs:
        OpenAI (GPT-4o, gpt-image-1) · Meta Graph · LinkedIn · YouTube Data v3
        · Apify/Serper (scrape) · Amazon SES (email) · Canva/Figma (designer)
        · [manual] HeyGen (avatar UGC) · fal.ai Veo/Seedance (motion)
```

**Pattern (every module):** FE button → `fetch(n8n webhook)` → workflow responds 200 immediately → does async work → writes Supabase → FE polls table for result. Identical to VE.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite + React Router v6 + Tailwind + Framer Motion + Recharts + lucide-react + lottie-react + react-easy-crop@5 |
| Hosting (FE) | Vercel (SPA rewrite to /index.html) |
| Backend/DB | Supabase (Postgres + Auth + Storage + Edge Functions in Deno) |
| Automation | n8n (self-hosted). Reuse existing instance or stand up new project/folder |
| AI (text) | OpenAI GPT-4o (strategy/copy/insights/BI), GPT-4o-mini (best-time) |
| AI (image) | OpenAI gpt-image-1 |
| AI (video, MANUAL) | HeyGen (founder avatar UGC), fal.ai Veo/Seedance (motion graphics) |
| Publishing | Meta Graph API v22 (FB+IG), LinkedIn API, YouTube Data API v3 |
| Analytics | Meta Insights, LinkedIn socialActions, YouTube videos.list |
| Email | Amazon SES (SMTP node) |
| Scrape | Apify + Serper (BI + trends) |

## 3. Repository structure

```
scalepods-growth-os/                 (new GitHub repo)
├─ CLAUDE.md                          # build rules for Claude Code (provided)
├─ docs/ PRD.md TRD.md
├─ .env.example                       # VITE_SUPABASE_URL / ANON_KEY
├─ vercel.json                        # { rewrites: [{ source:/(.*), dest:/index.html }] }
├─ src/
│  ├─ App.tsx                         # routes + Protected wrapper
│  ├─ index.css                       # brand tokens + liquid-glass system
│  ├─ lib/
│  │   ├─ supabase.ts  auth.tsx
│  │   ├─ clients.ts   content.ts  strategy.ts  trends.ts  analytics.ts
│  ├─ components/  AppShell.tsx  ui.tsx  mediaUi.tsx  MediaEditor.tsx  AssetUploader.tsx
│  ├─ pages/  Login.tsx  ResetPassword.tsx  Dashboard.tsx  Clients.tsx
│  │          BusinessProfile.tsx  Trends.tsx  Strategy.tsx  ContentFactory.tsx
│  │          CreativeReview.tsx  Calendar.tsx  Publishing.tsx  Analytics.tsx
│  │          Intelligence.tsx  IntelligenceReport.tsx  Settings.tsx
│  └─ assets/  login-animation.json (Lottie)
└─ supabase/functions/  canva-oauth-start  canva-oauth-callback
                        canva-list-designs  canva-import  figma-import  brand-overlay
```

## 4. Database schema (Supabase Postgres)

> New Supabase project (do NOT reuse Victory's `jjtdbbdzidycgdzjkvvf`). All tables: `RLS enabled`, policy `ALL to authenticated using(true)`. Storage-heavy media in `content-media` bucket (public read).

```sql
-- business_profiles (keep multi-profile-capable; ScalePods = one row)
id uuid pk, business_name, tagline, industry, description, products_services,
target_audience, business_goals, brand_guidelines, brand_voice,
target_platforms text[], competitors, website_url, social_media_urls, assets,
additional_notes, phone, email, address, hours, service_areas text[],
status text, fb_page_id text, created_at, updated_at

-- business_intelligence_reports
id, profile_id fk, status (pending|processing|completed|failed),
website_analysis, instagram_analysis, facebook_analysis, linkedin_analysis,
competitor_analysis, seo_analysis, audience_analysis, full_report,
error_message, created_at, updated_at

-- trend_runs / trend_signals
runs: id, profile_id, status, sources_completed, ai_summary, created_at
signals: id, run_id, profile_id, source, topic, relevance_score, relevance_reason,
         url, meta jsonb, created_at

-- marketing_strategies
id, profile_id, status (processing|completed|approved), ai_summary,
campaign_planning jsonb, weekly_content_strategy jsonb, content_pillars jsonb,
content_calendar jsonb, platform_strategy jsonb, lead_generation_strategy jsonb,
cta_strategy jsonb, created_at, updated_at

-- content_runs / content_items
runs: id, profile_id, strategy_id, status, total_items, completed_items,
      ai_summary, created_at, updated_at
items: id, run_id, profile_id, strategy_id, calendar_index,
       content_type (enum: static_image|carousel|ugc_video|motion_graphics|
         product_video|blog|social_caption|linkedin_article|website_content|email|story),
       status (enum: pending|generating|ready|in_review|approved|revision|failed|
         published|scheduled|publishing),
       platform, scheduled_date, title, body, media_url, thumbnail_url,
       metadata jsonb (hashtags[],cta,keywords[],seo_notes,topic,hook,slides[]),
       review_notes, revision_count, error_message, approved_at, created_at, updated_at

-- scheduled_posts (publish log)
id, content_item_id, profile_id, platform, caption, media_url, title,
platform_post_id, post_url, post_type, status, scheduled_time, published_at,
error, buffer_post_id(unused), publish_id, retry_count, ai_best_time, created_at

-- post_analytics (one row per platform_post_id, UNIQUE)
id, content_item_id, scheduled_post_id, profile_id, platform, content_type,
platform_post_id UNIQUE, post_url, impressions, reach, likes, comments, shares,
saves, video_views, clicks, engagement, engagement_rate, raw jsonb, fetched_at, created_at

-- analytics_state (single row id=1)
id, last_refreshed_at, last_run_status, posts_synced

-- ai_insights
id, profile_id, generated_at, posts_analyzed, overall_summary,
content_scores jsonb, winning_hooks jsonb, audience_behaviour jsonb,
best_posting_time jsonb, top_creatives jsonb, raw jsonb

-- canva_connections (OAuth token store — service-role only, NO anon policy)
key pk, state, code_verifier, access_token, refresh_token, token_expires_at, status
```

## 5. Supabase setup
- **Auth:** Google OAuth restricted to `@scalepods.co` (a Postgres trigger on `auth.users`
  enforces the domain, not just Google's spoofable `hd` hint) — see §14. The original
  `marketing@scalepods.co` email/password login still works as a fallback. A signed-in account
  with no matching `app_users` row, or one still `invited`/`suspended`, is walled off before it
  reaches any route — see §14.
- **Storage buckets:** `content-media` (public read), plus `brand/scalepods-logo.png` uploaded for overlay + FE.
- **RLS: NOT a blanket `authenticated`-all policy anymore** — every app table now carries
  per-feature, per-action policies keyed to the signed-in person's role and permissions, plus a
  handful of trigger-enforced rules RLS can't express on its own (maker-checker on tickets, status
  transitions on content/blog). §14 and `docs/team-collaboration-prd.md` (§6-§7, §13) are the
  actual source of truth for the current policy set — this line is intentionally not re-itemized
  here to avoid two documents drifting out of sync with each other.
  `canva_connections`/`instagram_connections` = `settings: full` only (was, and still is, never
  open to `anon`).
- **Edge Functions** (Deno, `verify_jwt=false`, CORS): `canva-oauth-start`, `canva-oauth-callback`, `canva-list-designs`, `canva-import`, `figma-import`, `brand-overlay` (stamps ScalePods logo/tagline/socials footer onto generated images).

## 6. n8n workflows (create in a new ScalePods project/folder)

| Workflow | Trigger | Flow summary | Creds needed |
|---|---|---|---|
| **AI Analysis** | `POST /webhook/sp-ai-analysis {profileId}` | fetch profile → scrape (Apify/Serper) → GPT-4o 7 sub-analyses → write BI report | OpenAI, Supabase, Apify, Serper |
| **Trend Intelligence** | `POST /webhook/sp-trends {profileId}` | 8 sources (no TikTok) → GPT-4o rank → trend_signals | OpenAI, Apify, Serper, Supabase |
| **Marketing Strategy** | `POST /webhook/sp-strategy {profileId}` | profile+BI+trends → GPT-4o 7 components → marketing_strategies | OpenAI, Supabase |
| **Content Text Engine** | `POST /webhook/sp-content-text {profileId}` | approved calendar → GPT-4o copy per post → content_items → **auto-fire Image Engine** (feed winning-hooks from ai_insights) | OpenAI, Supabase |
| **Content Image Engine** | `POST /webhook/sp-content-image {profileId}` | filter static_image/carousel/social_caption (NOT video) → gpt-image-1 → upload → **auto-fire Branding** | OpenAI, Supabase |
| **Branding Overlay** | `POST /webhook/sp-content-brand {profileId}` | per unbranded image → brand-overlay edge fn → update media_url | Supabase |
| **Carousel Generator** | `POST /webhook/sp-carousel {itemId}` | GPT-4o plan 4 slides → gpt-image-1 ×4 → upload → metadata.slides | OpenAI, Supabase |
| **Publishing Engine** | `POST /webhook/sp-publish {itemId, scheduleNow}` | context → best-time (insights-fed) → platform router (IG/FB/LI/YT) → publish → log scheduled_posts → notify | Meta Graph, LinkedIn, YouTube(Google OAuth), Supabase, SES |
| **Publishing Scheduler** | Schedule every 10 min | due scheduled_posts → fire publish | Supabase |
| **Analytics Collector** | `POST /webhook/sp-analytics-refresh` + every 12h | published posts → per-platform fetch (Meta/LI/YT) → upsert post_analytics (`on_conflict=platform_post_id`, per-item mode) | Meta Graph, LinkedIn, Google OAuth, Supabase |
| **AI Insights** | `POST /webhook/sp-ai-insights {profileId}` | analytics+items → GPT-4o → ai_insights | OpenAI, Supabase |
| **Notifications** | `POST /webhook/sp-notify {type,itemId,...}` | fetch item → render branded HTML → SES send | SES(smtp), Supabase |
| **Error Handler** | errorTrigger | on crash → POST sp-notify | — (set as Error Workflow on all above) |

### n8n gotchas (carried from VE — bake in from day 1)
- After any MCP/API workflow edit you **must publish** or the active version stays stale.
- MCP `setNodeCredential` **cannot** bind predefined cred types (facebookGraphApi, googleOAuth2Api, linkedInOAuth2Api, supabaseApi, httpBearerAuth) to httpRequest nodes → **assign manually in n8n UI**. Document each.
- Supabase upsert needs `?on_conflict=<uniquecol>` in URL **and** `Prefer: resolution=merge-duplicates`.
- Normalize/Code nodes that write one row per input **must run in "Run Once for Each Item"** mode and `return {json:{...}}` (not `[{json}]`) — else all-but-first row is silently dropped.
- GPT JSON replies may be wrapped in ```json fences — strip fences before `JSON.parse`.
- Meta deprecated organic post-level reach on FB (v22) — FB reach stays 0; IG reach works via `insights.metric(reach).period(lifetime)`.

## 7. External API integrations & scopes (ScalePods' own accounts)

| Platform | Publish | Analytics | Auth/scopes required |
|---|---|---|---|
| **Facebook Page** | `/{page}/feed`,`/photos`,`/videos`,`/video_reels` | reactions/comments summary | Page access token via `/me/accounts`; `pages_manage_posts`, `pages_read_engagement`, `read_insights` |
| **Instagram** (linked IG biz acct) | `/media`→`/media_publish` (image/video/STORIES/REELS/CAROUSEL) | `like_count,comments_count,insights(reach)` | `instagram_content_publish`, `instagram_manage_insights`, `instagram_basic` |
| **LinkedIn** (Company Page) | `ugcPosts` (text/photo/video/document) | `/v2/socialActions/{urn}` (org page = real metrics) | Marketing Developer Platform partner app; `w_organization_social`, `r_organization_social`, `rw_organization_admin` |
| **YouTube** | resumable upload (Shorts + standard) | `videos.list?part=statistics` | Google OAuth `youtube.upload`, `youtube.readonly` |

> **LinkedIn note:** unlike VE (which used a personal profile with limited analytics), ScalePods should register the **Company Page + Marketing Developer Platform app** up front — that unlocks real org analytics from day one.

## 8. Frontend architecture
- **Routing:** `App.tsx` — `Protected` wrapper gates all app routes behind a Supabase session
  AND, since Team Collaboration (§14), a real `app_users` row in `active` status and (per route) a
  `feature` prop checked against that person's permissions; `/login`, `/reset-password` stay
  public. The route list below is illustrative, not exhaustive — this TRD predates most of the
  pages that now exist (the Studios, Board, Blog, Team & access, and others); `App.tsx` itself is
  the actual source of truth for what's routed. Team Collaboration specifically added `/board`,
  `/board/:key` and `/settings/team` (admin-only).
- **lib/** thin data layer over Supabase + webhook fire helpers. Master flags `GENERATION_ENABLED`, `PUBLISHING_ENABLED`, `VIDEO_GENERATION_ENABLED` in `content.ts`.
- **AppShell:** sidebar nav with live counts, theme toggle, the signed-in person's real name/photo/role
  (from the team directory — see §14, not a role you can pick). Nav items are filtered by feature
  permission, not shown-then-hidden. Logo in white pill on dark theme.
- **Reusable:** `MediaEditor` (per-platform crop presets — IG 1:1/4:5/9:16, LI 1:1/1.91:1, YT 9:16, FB variants), `PlatformBadge` + `CarouselViewer` in `mediaUi.tsx`, `AssetUploader`.

## 9. Brand design system — ScalePods tokens (OFFICIAL, from `brand-kit/`)

> Source of truth: **`brand-kit/BRAND-REPORT.md` + `BRAND-SPEC.md`** (copied into this repo).
> Assets: `brand-kit/logo/` (black wordmark, white wordmark, dotted-circle icon) ·
> `brand-kit/fonts/` (Inter 400/500/600/700 + Instrument Serif Italic, both OFL-licensed woff2).

```css
:root {                                   /* DARK (default) — "cyber navy" system */
  --bg-page:        #04070D;              /* Deep Cyber Navy-Black page background */
  --bg-card:        #080A0E;              /* cards/panels (use at ~55% alpha for glass) */
  --bg-panel:       #10131C;              /* Deep Slate Navy secondary containers */
  --accent-green:   #B1D997;              /* Sage Green — PRIMARY accent (headlines, icons, success, checkmarks, CTAs) */
  --accent-blue:    #63A5E7;              /* Electric Blue — secondary accent (sales/marketing contexts, charts) */
  --accent-orange:  #CC6B49;              /* Terracotta — Claude/Anthropic partner badges + warnings only */
  --text-light:     #FFFFFF;              /* default text on dark */
  --alt-bg-green:   #0B1A08;              /* solid dark-green high-impact panels */
}
:root[data-theme="light"] {
  --bg-page:        #F8FAF7;              /* Mint-Alabaster cream */
  --text-dark:      #04070D;
  --accent-green:   #8FBC6A;              /* accessibility-optimized green on light */
  --accent-blue:    #408CD6;              /* accessibility-optimized blue on light */
}
```

**Typography (self-hosted from `brand-kit/fonts/`):**
- Body/labels: **Inter** 400/500 (sentence case); numbers/lists 500/600.
- Headlines: **Inter Bold 700** — Title Case for headings, UPPERCASE for badges/labels.
- Editorial accent: **Instrument Serif Italic 400** — italicized accent words inside hero headings only (login hero, dashboard welcome).
- Mono fallback: Menlo/Monaco/Consolas/Fira Code for technical strings.

**Component rules:**
- Badge pill: fill `rgba(177,217,151,.1)` or `1px solid rgba(177,217,151,.4)`, text `#B1D997`.
- CTA pill/button: fill `#B1D997`, text `#0B1A08` (dark green) — this is the primary button style.
- Icons: Lucide line-art, 1.5–2px stroke, colored `--accent-green` (default) / `--accent-blue`.
- Logo usage: **white wordmark** (`Scalepods White text logo.png`) on dark, **black wordmark** on cream/light, **icon.png** for avatar/small square spots; ≥24px clear space; top-left/top-center placement.
- Optional faint grid/circuit background overlay at `0.02` opacity on hero panels.
- Login: split brand panel + form, dark/light toggle, Lottie animation, **ambient looping brand video** behind theme-aware gradient overlay + "generated by ScalePods Growth OS AI" badge (Instrument Serif italic accent in the hero headline).
- ~~Role selector~~ removed with Team Collaboration (§14) — there is no longer a role you pick,
  only the one an admin assigned you. `ROLE_ACCENT` in `lib/team.ts` now colors a person's real
  role badge (owner/admin/designer/writer/client), sage-green-led per the accent hierarchy above.
- Every generated image auto-stamped via `brand-overlay` edge fn: **ScalePods wordmark + one-liner ("We build smart workflows that automate the repetitive…") + @handles footer**, using white wordmark on dark imagery / black on light.

**Content-generation brand rules (feed into every GPT copy prompt):**
- Tone: developer-first, precise, data-driven, no fluff/hyperbole.
- Only use **approved Pod stats** (see `brand-kit/BRAND-REPORT.md §3` — HR/Sales/Ops/Marketing Pod metrics). Never invent dollar savings, hiring counts, or "100% error-free" claims.
- Banned words: "Revolutionary", "magic", "completely replaces human staff", generic corporate fluff.
- Approved CTAs: "Comment SCALEPODS to evaluate your workflow" · "Book an Automation Audit" · "Link in bio to book a demo".
- Post output formats: IG portrait 4:5 (1080×1350, primary), story/reel 9:16 (1080×1920), square 1:1 for LinkedIn/FB.

## 10. Environment / secrets checklist (user must provide)

| Secret | For |
|---|---|
| New Supabase project URL + anon key + service role | FE + edge fns + n8n |
| OpenAI API key | text + image engines |
| Meta app + Page/IG tokens (ScalePods FB Page + IG biz) | publish + analytics |
| LinkedIn Marketing Developer app + Company Page token | publish + analytics |
| Google OAuth (ScalePods YouTube channel) | YT upload + stats |
| Amazon SES verified sender + SMTP creds | notifications |
| Apify + Serper keys | BI + trends scraping |
| Canva Connect app (client id/secret) + Figma PAT | designer imports |
| HeyGen key + fal.ai key (**manual video only**) | UGC/motion (not FE-wired) |
| ScalePods brand kit: exact hex, logo SVG/PNG, tagline, fonts | design system + overlay |

## 11. Safety & credit control (mandatory)
- `GENERATION_ENABLED` (content.ts) gates text/image FE triggers.
- `PUBLISHING_ENABLED` gates publish webhooks.
- **No video engine is wired to any FE button or auto-chain.** Image Engine filter must only match `static_image|carousel|social_caption`.
- Error-handler workflow set as Error Workflow on every n8n workflow.

## 12. Deployment
- FE → Vercel, env vars in dashboard, SPA rewrite.
- Edge functions → `supabase functions deploy`.
- n8n → workflows in dedicated ScalePods project/folder; all creds assigned manually; each published + Error Workflow set.

## 13. Claude Code build sequence (execute in order)

1. **Scaffold:** Vite React-TS repo, install deps, `index.css` brand tokens, `CLAUDE.md`. Supabase project + apply schema (§4) via migrations. Auth user + storage buckets.
2. **Auth + Shell:** `supabase.ts`, `auth.tsx`, `App.tsx` Protected, `AppShell`, branded `Login` + theme toggle.
3. **Onboarding + BI:** `Clients`, `BusinessProfile` form (12 fields) → build **AI Analysis** workflow → verify BI report renders.
4. **Trends + Strategy:** `trends.ts`+`Trends`, `strategy.ts`+`Strategy` → build Trend + Strategy workflows → verify approve gate.
5. **Content Factory:** `content.ts` (+flags), `ContentFactory` → build Text→Image→Brand chain + Carousel → verify non-video generation; stub video items.
6. **Designer + Review:** `MediaEditor`, `mediaUi`, Canva/Figma edge fns, `CreativeReview` → verify replace/edit/approve.
7. **Publishing:** Publishing Engine (IG/FB/LI/YT) + Scheduler + Notifications + Error Handler → verify Post-now/Schedule per platform.
8. **Analytics + Insights:** Analytics Collector + `analytics.ts`+`Analytics` dashboard + AI Insights + learning loop.
9. **Polish:** brand pass, responsive check, seed memory, final QA sweep (mirror the 13-point VE sweep).

> **Verification discipline:** for each module, test the full FE→n8n→DB→FE round-trip with a real login (RLS applies), exactly as the VE build was validated. Use a throwaway test profile, clean it up after.

## 14. Team collaboration & access control (added 2026-09-11)

Full spec, data model, and the build-log record of every decision that changed during
implementation: **`docs/team-collaboration-prd.md`** (§13 there is the detailed equivalent of
this TRD's own build sequence). This section is the compact summary — read the PRD for anything
this doesn't answer.

**Identity.** Google OAuth restricted to `@scalepods.co`, enforced by a Postgres trigger on
`auth.users` (the `hd` query param on the OAuth request is a UX hint only, not the real
boundary — it's spoofable). Seven people were seeded by hand (owner, 3 admins, 2 designers, 1
writer); a new admin creates further accounts from `/settings/team`, which the person then claims
on first sign-in. An `@scalepods.co` sign-in from someone nobody added lands as
`role: designer, status: suspended` rather than being refused outright, and every active
owner/admin is notified so someone can give them a real role.

**Authorization.** Four levels — `none < view < edit < full` — per person, per one of 16 feature
keys (`app_users.role` for owner/admin short-circuits to `full` everywhere; everyone else reads
`user_permissions`). Enforced twice: in the UI (nav items, routes, and individual buttons hide or
disable rather than trusting a screen never to be reached) and, the part that actually matters,
in Postgres — every table's RLS policies are keyed to a feature and a minimum level, with a small
number of `BEFORE UPDATE` triggers covering column-level authority RLS can't express (approving
content, publishing, unpublishing, the ticket maker-checker gate). `service_role` (what n8n's
Supabase credential uses) has `BYPASSRLS`, so none of this touches n8n's own reads/writes.

**New tables:** `app_users`, `user_permissions`, `board_columns`, `tickets`, `ticket_comments`,
`ticket_activity` (append-only, no write policy at all — only a trigger can add to it),
`spend_events`. `notifications` gained a real `user_id` column (it previously only had a
*business* `profile_id`, which nothing filtered on).

**The board.** `/board` — a Jira-shaped Kanban (`Backlog → Not Started → In Progress → Selected
for Development → In Review → On Hold → Done`) with fractional-position drag-and-drop ordering. A
ticket can optionally point at a real content item/video/carousel/blog post job. The maker-checker
rule — an assignee cannot move their own ticket into Done — is a Postgres trigger, not a UI
convention, so it holds regardless of how the move is attempted.

**Notifications.** In-app (the existing bell/`notifications` table, now filtered by `user_id`) and
email, via a new n8n workflow (`ScalePods · Team Notifications`, webhook `sp-team-notify`) fired
by a trigger on `notifications` itself rather than on any one source table — anything that ever
inserts a notification gets email for free. @-mentions in ticket comments, and one daily
due/overdue digest per person (`pg_cron`, anchored to 09:00 IST) round it out.

**Spend caps.** `monthly_spend_cap_usd` per person (owner/admin uncapped by default). Enforced by
a trigger on `spend_events`, not on the job tables themselves — `studio_jobs`/`video_jobs` are
written by n8n via the service-role key, which carries no JWT, so a trigger there could never
know who fired a generation. The browser logs the spend, with its own real session, in the moment
before the paid webhook fires; a refused insert means the webhook is never called. Wired into AI
Studio and Video Studio's real per-call AI costs; deliberately not wired into `/carousel-studio`
(Puppeteer + ffmpeg rendering, no metered AI cost to enforce against).

---
*This TRD is a faithful re-scope of the shipped Victory Growth OS. Where a decision isn't specified, mirror the VE implementation.*
