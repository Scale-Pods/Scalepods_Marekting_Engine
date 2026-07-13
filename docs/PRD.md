# ScalePods Growth OS — Product Requirements Document (PRD)

**Version:** 1.0
**Owner:** ScalePods (marketing.self)
**Status:** Ready for build
**Basis:** Direct replication of the proven **Victory Growth OS / Marketing Engine** (built & validated end-to-end), re-scoped and re-branded for ScalePods' own brand.

---

## 1. Vision

ScalePods sells AI automation. **ScalePods Growth OS is ScalePods running its own marketing on the exact system it sells** — an end-to-end, AI-driven marketing operating system that takes a business from raw brand knowledge → market intelligence → strategy → content → publishing → analytics → self-improvement, with a human approval gate at the creative step.

The product doubles as the ultimate sales asset: **"we market ourselves with the same OS we'd build for you."** Every screen, every generated post, every analytics chart is a live demo.

## 2. Goals & Success Metrics

| Goal | Metric |
|---|---|
| Automate ScalePods' organic social output | ≥ 20 approved posts/month generated with < 15 min human time each |
| Prove the product live | 100% of pipeline stages demoable from the FE in one sitting |
| Data-driven posting | Best-time + winning-hook insights feeding next content cycle |
| Zero accidental spend | No paid AI (video/image) fires without explicit human trigger |
| Brand consistency | Every visual auto-stamped with ScalePods logo + tagline |

## 3. Scope

### In scope — 4 platforms ONLY
**Instagram · YouTube · Facebook · LinkedIn**

> LinkedIn is the **primary** channel (B2B agency audience); Instagram + YouTube for reach; Facebook secondary.

### Explicitly OUT of scope (do not build)
- ❌ TikTok (and the Buffer integration used for it)
- ❌ Website / WordPress blog publishing
- ❌ Google Business Profile publishing
- ❌ GA4 & CRM/lead analytics (Phase-later; stub only)
- ❌ Multi-tenant client billing (ScalePods is the single self-marketed entity — but keep the schema multi-profile-capable, see TRD)

## 4. Personas & Roles

Single Supabase auth identity, three role views (localStorage-switchable, same as VE):

| Role | Who | Can do |
|---|---|---|
| **Admin** | ScalePods founder/ops (Adnan / marketing@scalepods.co) | Everything: onboarding, trigger all engines, approve, publish, view analytics |
| **Client** | (self / stakeholder view) | Review + approve/reject content, view analytics |
| **Designer** | ScalePods designer | Replace/edit creative (Canva/Figma/upload), submit for approval |

## 5. Feature Requirements — pipeline modules

Each module = one stage of the flow. FE button → n8n webhook → Supabase → FE reflects result. **Video generation is the only manual-only step** (credit safety).

### M1 — Authentication
- Email/password (Supabase Auth), single account `marketing@scalepods.co`.
- Role selector on login (Admin/Client/Designer) → stored in `localStorage`.
- Dark/light theme toggle. ScalePods-branded split login (brand panel + form).
- **US:** *As a user I sign in and land on a role-appropriate dashboard.*

### M2 — Business Onboarding (Discovery Form)
- Single ScalePods business profile with 12 fields: business details, products/services, target audience, business goals, brand guidelines, brand voice, target platforms (IG/YT/FB/LI), competitors, website URL, social URLs, asset uploads, additional notes.
- Saving the profile auto-fires M3 (AI Business Analysis).
- **US:** *As Admin I fill/edit the ScalePods profile once; it seeds every downstream engine.*

### M3 — AI Business Analysis → Business Intelligence Report
- GPT-4o produces 7 sub-analyses: Website, Instagram, Facebook, LinkedIn, Competitor, SEO, Audience → one `full_report`.
- Uses scraping (Apify/Serper) for real signals where possible.
- FE shows loading state + section badges + rendered markdown; re-run button.
- **US:** *On save I get a real BI report about ScalePods in ~30–60s.*

### M4 — Trend Intelligence Engine
- **8 sources** (TikTok dropped): Google Trends, Google News, Reddit, Instagram, YouTube, LinkedIn, SEO keywords, Competitor campaigns.
- GPT-4o ranks signals by ScalePods relevance → `trend_signals`.
- FE: client selector, "Refresh trends", ranked signal cards, source filter chips, run status.
- **US:** *I click Refresh and see this week's AI/automation trends ranked for us.*

### M5 — AI Marketing Strategy Engine + Approval Gate
- GPT-4o generates 7 components from BI report + trends: Campaign Planning, Weekly Content Strategy, Content Pillars, Content Calendar (12–16 dated posts across 4 wks), Platform Strategy, Lead-Gen Strategy, CTA Strategy.
- **Approve / Regenerate** gate. Approved strategy feeds M6.
- **US:** *I review the AI strategy and approve it before any content is made.*

### M6 — AI Content Factory
Reads approved strategy's calendar; generates per-post copy + creative.
- **Text Engine** (GPT-4o): body, hashtags, CTA, keywords, SEO notes per post → `content_items`. **Auto-chains** →
- **Image Engine** (gpt-image-1): static images + carousel slides. **Auto-chains** →
- **Branding Overlay**: stamps ScalePods logo + tagline + handles footer.
- **Carousel Generator** (multi-slide).
- **Video (MANUAL ONLY):** UGC avatar (HeyGen — founder Adnan avatar), Motion graphics (Veo/Seedance via fal.ai). Placeholder items are created but **never auto-generated** — human triggers in n8n only.
- Master switch `GENERATION_ENABLED` gates all FE generation triggers.
- **Content types per platform** — see §6.
- **Brand-safe copy (hard requirement):** every GPT prompt embeds the brand-kit content rules — developer-first no-fluff tone, ONLY approved Pod stats (HR/Sales/Ops/Marketing metrics in `brand-kit/BRAND-REPORT.md`), approved CTA phrases, banned-words list. The 4 "Pods" (HR, Sales, Ops, Marketing) are the content pillars.
- **US:** *One click turns the approved calendar into ready-to-review posts (video I trigger manually).*

### M7 — Designer Workspace
- Replace creative via: Local upload, **Canva import** (Connect API OAuth), **Figma import** (PAT).
- **Media Editor**: per-platform crop/resize (IG/YT/FB/LI aspect presets), filters (brightness/contrast/saturation + one-tap looks), rotate — canvas-baked export.
- Submit-for-approval transitions status + fires notification.
- **US:** *As Designer I swap in a Canva/Figma asset or edit crops, then submit.*

### M8 — Creative Review
- Approve / Send-back / Approve-all / Revise-with-AI.
- Revision loop routes back to Content Factory regenerate.
- Notifications fire on approval-needed / approved.
- **US:** *I approve or bounce each piece; approvals notify me by email.*

### M9 — Publishing Engine
- **AI Best-Time Prediction** (GPT-4o-mini, fed by learned insights).
- **Post now** or **Schedule (AI best time)** from FE on approved items.
- Publishes to **IG, FB, LinkedIn, YouTube** with correct content-type handling:
  - IG: image, carousel, reel, story (image + video), normal video
  - FB: text, photo, video, carousel, reel
  - LinkedIn: text, photo, video, document/article
  - YouTube: Shorts (9:16) + standard video
- Scheduler workflow fires due posts at predicted time.
- Notifications on publish success/fail; error-handler catches crashes.
- **US:** *I hit Post Now or Schedule and it goes live on the right platform.*

### M10 — Analytics Engine + Performance Dashboard
- Collector pulls per-post metrics every 12h (+ manual "Refresh now"):
  - **Meta Insights** (IG likes/comments/reach; FB reactions/comments)
  - **LinkedIn** socialActions (company page — real org metrics)
  - **YouTube** statistics (views/likes/comments)
- Dashboard: engagement/likes/comments/views tiles, engagement-by-platform chart, posts-by-platform, top posts, "last refreshed" timestamp.
- **US:** *I see how every published post performs, refreshed automatically.*

### M11 — AI Insights + Learning Engine
- GPT-4o over analytics + content → Content Scores, Winning Hooks, Audience Behaviour, Best Posting Time/platform, Top Creatives → `ai_insights`.
- **Learning loop:** best-time feeds M9 scheduling; winning-hooks feed M6 copy prompts.
- FE panel on Analytics page + Regenerate.
- **US:** *The system tells me what's working and automatically makes next month's content smarter.*

### M12 — Notifications
- Amazon SES branded HTML emails on: approval-needed, approved, published, publish-failed.
- Error-handler workflow emails crash alerts.
- Send from `marketing@scalepods.co` (or `info@scalepods.co`) → ScalePods ops inbox.

## 6. Content-type matrix (build/publish targets)

| Platform | Content types to support |
|---|---|
| **LinkedIn** (primary) | Text post, Photo, Native video, Document/Article carousel |
| **Instagram** | Image post, Carousel, Reel, Story (image + video), Video |
| **YouTube** | Shorts (9:16), Standard video |
| **Facebook** | Text, Photo, Video, Carousel, Reel |

## 7. Non-functional requirements
- **Credit safety:** `GENERATION_ENABLED` flag + video engines have NO FE trigger/auto-chain. `PUBLISHING_ENABLED` flag gates all publish webhooks.
- **Security:** Supabase RLS `authenticated`-only on all tables; OAuth secrets in Edge Functions (service role), never anon FE.
- **Brand:** every generated visual auto-stamped; FE strictly ScalePods brand tokens from **`brand-kit/`** (Deep Cyber Navy `#04070D` / Sage Green `#B1D997` / Electric Blue `#63A5E7` / Cream `#F8FAF7`; Inter + Instrument Serif Italic; full spec in TRD §9).
- **Responsiveness:** desktop-first internal tool; no horizontal overflow at ≥1024px.
- **Resilience:** retry-on-fail on binary transfers; error-handler workflow on crash.

## 8. Phasing / milestones

| Phase | Modules | Outcome |
|---|---|---|
| P0 | Repo, Supabase, brand system, Auth, Onboarding | Login + profile + BI report |
| P1 | Trend + Strategy + approval | Approved strategy from live trends |
| P2 | Content Factory (text+image+brand) + Designer + Review | Ready, reviewed content |
| P3 | Publishing (IG/FB/LI/YT) + Scheduler + Notifications | Live posting from FE |
| P4 | Analytics + AI Insights + Learning loop | Self-improving dashboard |

## 9. Out of scope (restate)
TikTok · WordPress blog · Google Business Profile · GA4/CRM lead analytics · paid multi-tenant billing.

---
*Companion doc: `TRD.md` — full technical spec, schema, workflows, API scopes, brand tokens, and the Claude Code build sequence.*
