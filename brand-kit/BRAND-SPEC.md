# ScalePods Brand Kit — Fill-In Spec

Fill in every `<!-- TODO -->`. Anything you leave blank, I'll substitute with a sensible
default and flag it. Drop binary files into the folders noted in each section.

---

## 1. Logo files  → drop into `brand-kit/logo/`

Provide transparent **SVG** (preferred) or high-res transparent **PNG** for each:

- [ ] Full wordmark — **black** version (for light/green backgrounds)
- [ ] Full wordmark — **white** version (for dark backgrounds)
- [ ] Icon-only mark (the dotted-circle "o" symbol), black + white
- [ ] (Optional) any horizontal / stacked lockups you use

Logo usage rules:
- Default placement per post: Top-center or top-left (depending on template archetype)
- Minimum clear space around logo: 24px (standard margin)
- Which variant on which background: `logo-light.png` (white wordmark) on dark green/navy backgrounds; `scalepods-logo.png` (black wordmark) on cream/light backgrounds; `icon.png` (dotted-circle icon) for profile/avatar/icon-only spots

---

## 2. Fonts  → drop into `brand-kit/fonts/`

Provide the actual **`.ttf` / `.otf` / `.woff2`** files (name alone is not enough).

- [x] **Headline font** (the heavy condensed uppercase one): `InstrumentSerif-Italic.woff2` (Instrument Serif - used for italicized accents) and `Inter-Bold.woff2` (Inter - used in bold/uppercase for solid headlines)
- [x] **Body font** (clean sans; Inter is fine if that's what you use): `Inter-Regular.woff2` / `Inter-Medium.woff2` / `Inter-SemiBold.woff2` (Inter)
- [x] License note (so we're allowed to embed it): Open source SIL Open Font License (OFL) for both Inter and Instrument Serif.

Typography rules:
- Headline: Uppercase for labels and badges (weight = 700), Title Case for main headlines (weight = 700)
- Highlighted words in headline use color: `#B1D997` (Sage Green) for HR/Ops templates, `#63A5E7` (Electric Blue) for Sales/Marketing templates
- Body/label case & weight: Sentence case, Regular (400) or Medium (500) weight

---

## 3. Exact brand colors (hex)

| Role | Hex | When to use |
|---|---|---|
| Primary background green | `#0B1A08` | Solid green post backgrounds, key high-contrast panels (or `#04070D` for standard dark navy-black background) |
| Bright accent / highlight green | `#B1D997` | Sage Green for headlines, highlights, icons, success stats, checkmarks |
| Cream / off-white background | `#F8FAF7` | Mint-Alabaster background for light mode templates |
| Dark text | `#04070D` | High contrast text against cream (`#F8FAF7`) or light green backgrounds |
| Light text | `#FFFFFF` | Default text on dark/navy/green backgrounds |
| Claude orange accent | `#CC6B49` | Terracotta orange (or `#D97757` glow) used for Anthropic/Claude partner badges and highlights |

Background styles:
- Solid green vs cream vs subtle pattern — which for which template? Solid green/navy (`#0B1A08` / `#04070D`) for direct announcements and high-impact stat posts; Cream (`#F8FAF7`) for data comparisons, lists, and detail-heavy posts.
- If there's a background pattern (the faint grid/circuit in img 1), drop the asset in `brand-kit/illustrations/` and describe it: Optional grid/circuit overlay with `0.02` opacity, using radial-gradient patterns.

Pills / badges:
- Badge pill (e.g. "HR POD"): fill = `rgba(177, 217, 151, 0.1)` (semi-transparent glow) or outline `1px solid rgba(177, 217, 151, 0.4)`, text = `#B1D997` (Sage Green)
- CTA pill (e.g. "STOP CHECKING…"): fill = `#B1D997` (Sage Green), text = `#0B1A08` (Dark green)

Icon style (so my SVG icon library matches):
- Line weight: Medium (1.5px or 2px, matches Lucide standard)
- Style: Line-art (clean, modern line-art SVGs)
- Icon color: Sage Green (`#B1D997`) for HR/Ops, Electric Blue (`#63A5E7`) for Sales/Marketing

---

## 4. Products / "Pods"

### Pod: HR Pod
- One-line description: Autonomous hiring engine that automates job campaigns, resume screening, candidate coordination, scheduling, and onboarding.
- Tagline (the 3-word "Screen. Shortlist. Hire." style): Screen. Shortlist. Hire.
- Badge label (as shown on posts): HR POD
- Channels/icons it uses: Email, Calendar, Job Boards, ATS (Greenhouse, Lever, etc.)
- **Approved stats** (exact numbers we're allowed to put on posts):
  - 10x Faster Candidate Screening
  - 80% Less Manual Coordination / 80% Coordination Reduction
  - 5 hrs Saved Per Recruiter / Week
  - 48h Brief to Interview Setup
  - 100% Objective Shortlisting
- Accent color (if this Pod has its own): `#B1D997` (Sage Green)

### Pod: Sales Pod
- One-line description: AI sales outreach and pipeline manager that runs multi-channel campaigns, captures intent data, and books sales calls.
- Tagline (the 3-word "Screen. Shortlist. Hire." style): Outreach. Engage. Book.
- Badge label (as shown on posts): SALES POD
- Channels/icons it uses: LinkedIn, Email, CRM (HubSpot, Salesforce, etc.)
- **Approved stats** (exact numbers we're allowed to put on posts):
  - 500+ CRM Updates/Leads Automated
  - 70% Faster Lead Response Time
  - 8 hrs Saved Per Rep / Week
  - 3s First Contact Response
  - 3x More Replies via Multi-channel Outreach
  - 60% Less Manual Work for Reps
  - 40% More Meetings Booked
- Accent color (if this Pod has its own): `#63A5E7` (Electric Blue)

### Pod: Ops Pod
- One-line description: Autonomous compliance auditor that cross-checks invoices, purchase orders, weights, GSTIN numbers, and transaction schemas.
- Tagline (the 3-word "Screen. Shortlist. Hire." style): Upload. Verify. Approve.
- Badge label (as shown on posts): OPS POD
- Channels/icons it uses: PDF Invoices, E-Way Bills, Purchase Orders, Tax Database (GSTIN)
- **Approved stats** (exact numbers we're allowed to put on posts):
  - 100% Documents Cross-Checked / 100% Audit Coverage
  - 90% Faster Verification
  - Zero Compliance Slippages
  - <60 Sec Upload to Verification (down from 45 min per physical check)
  - 14+ Fields Verified Per Audit
- Accent color (if this Pod has its own): `#B1D997` (Sage Green)

### Pod: Marketing Pod
- One-line description: Autonomous content repurposing and campaign scheduler that turns core assets into cross-platform marketing campaigns.
- Tagline (the 3-word "Screen. Shortlist. Hire." style): Brief. Produce. Publish.
- Badge label (as shown on posts): MARKETING POD
- Channels/icons it uses: LinkedIn, Twitter/X, Instagram, Newsletters
- **Approved stats** (exact numbers we're allowed to put on posts):
  - 10x Faster Content Production / 10x More Content Output
  - 80% Less Manual Coordination
  - 40% Team Efficiency Improved
  - <24 hrs Brief to Publication
  - 3x More Channels Covered
- Accent color (if this Pod has its own): `#63A5E7` (Electric Blue)

---

## 5. Company + content rules

- Company one-liner: We build smart workflows that automate the repetitive, reduce overheads, and keep teams lean.
- Core value propositions:
  - Deploy autonomous Agentic AI ecosystems to scale operations without scaling overhead.
  - Objective, fully documented compliance audits with real-time dashboards and timestamped logs.
  - Seamless multi-channel outreach and pipeline tracking with deep integration across tools.
- Approved CTA phrases (exact wording):
  - "Comment SCALEPODS to evaluate your workflow"
  - "Book an Automation Audit"
  - "Link in bio to book a demo"
- Tone / voice notes: Precise, high-performance, developer-first, professional, results-oriented, clean, and no-fluff.
- Claims / numbers we must NOT invent (i.e. only use approved stats above): Do not invent absolute dollar savings, total hiring counts, or unqualified speed/accuracy claims (e.g. "100% error-free") that are not supported by the official dashboard stats.
- Words / phrases to avoid: "Revolutionary", "magic", "completely replaces human staff", "100% error-free", or generic corporate fluff.

---

## 6. (Optional but very helpful) Source design files

If these posts were made in Canva/Figma, paste view links — I can extract exact
spacing, sizes, and layout proportions instead of eyeballing from screenshots.

- Link(s): None provided (using standard modern spacing grids of 24px/32px margins and standard proportions based on 4:5/9:16 layouts)

---

## 7. Target output formats

- [x] Instagram feed portrait 4:5 (1080×1350) — primary?  Yes
- [x] Instagram story / reel cover 9:16 (1080×1920)?  Yes
- [x] Square 1:1 (1080×1080) for LinkedIn/Facebook?  Yes
- [ ] Other: N/A
