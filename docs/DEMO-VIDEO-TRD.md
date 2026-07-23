# TRD — ScalePods Demo Video (Remotion + Claude Code)

Companion to `DEMO-VIDEO-PRD.md`. Source of truth for how the video is built.

## 1. Stack

- **Remotion 4.x** (React 18 + TypeScript) — every frame rendered from code.
- **Remotion Agent Skills** (`npx remotion skills add`) — teaches Claude Code correct
  animation patterns (springs, easing, `<TransitionSeries>`, timing).
- **Claude Code** (existing Pro plan) — writes/edits all scene code from prompts.
- Tailwind is NOT required inside the video project; styles are plain inline/CSS with
  brand tokens (keeps renders deterministic).
- **Renderer:** `npx remotion render` (local, Chrome headless). No cloud costs.

## 2. Project layout

Separate sibling repo/folder (keeps Growth OS app clean):

```
scalepods-demo-video/
├─ src/
│  ├─ Root.tsx                 # compositions: FullDemo (1920×1080), HeroLoop, Square
│  ├─ brand/
│  │  ├─ tokens.ts             # single source: colors, radii, spacing (copied from app)
│  │  └─ fonts.ts              # @remotion/fonts loadFont() for the 5 woff2 files
│  ├─ scenes/                  # one file per scene (Hook, ProductIntro, Feature1..3, Proof, CTA)
│  ├─ components/              # BrowserFrame, StatCard, CalloutLabel, AnimatedNumber, LogoReveal
│  └─ assets/                  # logos, UI screenshots, bg pattern
├─ public/audio/               # VO .mp3 per scene + music bed
└─ package.json
```

## 3. Brand integration (pixel-perfect requirement)

### 3.1 Tokens
`src/brand/tokens.ts` mirrors the app exactly:

```ts
export const C = {
  bg: '#04070D', card: '#080A0E', panel: '#10131C',
  sage: '#B1D997', blue: '#63A5E7', terracotta: '#CC6B49',
  cream: '#F8FAF7', darkGreen: '#0B1A08', text: '#FFFFFF',
  sagePill: 'rgba(177,217,151,0.1)', sagePillBorder: 'rgba(177,217,151,0.4)',
};
```

### 3.2 Fonts
Copy `brand-kit/fonts/*.woff2` into the video project; load with `@remotion/fonts`
(`Inter-Regular/Medium/SemiBold/Bold`, `InstrumentSerif-Italic`). Hero accent words =
Instrument Serif Italic in sage, matching landing headline style.

### 3.3 Real product UI — two-tier approach

**Product featured: Expense Tracker** (not Growth OS). Real production screenshots
already exist and are the source of truth — no live capture/login needed:

```
F:\Scalepods.co\scalepods-website-nextjs\public\images\carousel\expense-tracker\
```

Used (copied into `public/screenshots/` in the video project):
`dashboard.png` (dashboard-overview.png), `category-analysis.png`,
`revenue-tracking.png`, `financial-reports.png`, `investment-portfolio.png`,
`action-center.png`, `monthly-payments.png`.

**Excluded:** `invoice-system.png` — shows a real ScalePods LLP bank account number +
IFSC code. Do not copy it into the video project. If invoicing needs a scene later, a
masked/dummy-data screenshot must be supplied first.

**Tier A — screenshots (default, fastest, exact):**
The 7 approved screenshots above, imported with `<Img>` inside a `BrowserFrame`
component; camera moves (pan/zoom/parallax) are animated via
`interpolate()`/`spring()` transforms on the image. Callouts/highlight rings are drawn
as overlays at fixed coordinates.

**Tier B — rebuilt live components (for hero moments):**
For 2–3 "money shots" that need internal animation (numbers counting, chart bars
growing, rows appearing one by one), the specific card/panel is re-created as a small
Remotion component using the same tokens + Recharts-style SVG. Only the pieces on
screen get rebuilt — never whole pages. (Directly importing the app's components is
possible but drags in Supabase/router deps; rebuilding the 2–3 cards is cheaper and
render-safe.)

### 3.4 Logos
`Scalepods White text logo.png` on dark scenes; `icon.png` for the loop end-frame.

## 4. Scene engineering conventions

- One composition per deliverable; scenes are `<Sequence>` blocks inside
  `<TransitionSeries>` (fade/slide/wipe, 12–20 frame transitions).
- 30 fps. All timing in frames via constants file so global pacing edits are one-line.
- Motion language: springs with `damping: 200`-style smooth settles (no bounce),
  ease-out zooms, 300–500 ms element entrances, subtle parallax on UI screenshots.
- No `AnimatedNumber`/`StatCard` counters for Expense Tracker — no approved numeric
  stats exist for this product (`BRAND-REPORT.md` only covers the 4 Pods). The
  highlights beat uses static/entrance-animated feature pills instead (see
  `CalloutLabel`-style component), text lifted verbatim from the product's own feature
  description.
- Audio: v1 has no voiceover (music + on-screen text only, per user decision). Music
  bed at −18 dB with 2 s fade in/out. VO can be added later as an additional audio
  layer without touching scene code.

## 5. Build sequence

1. **B0 Scaffold** — `npx create-video --yes --blank scalepods-demo-video`, install,
   `npx remotion skills add`, commit.
2. **B1 Brand layer** — tokens.ts, fonts.ts, logo assets, BrowserFrame + StatCard +
   LogoReveal components. Verify in Remotion Studio.
3. **B2 G2 test scene** — 15 s: logo reveal → dashboard slide-in with zoom. Render MP4
   → user approval gate.
4. **B3 Screens capture** — seed demo profile, capture 2× screenshots of the 4 pages,
   crop/clean in-repo.
5. **B4 Full demo scenes** — build Hook → CTA per approved script; iterate in Studio.
6. **B5 Audio** — VO generation (ElevenLabs or supplied recording), music bed, mix.
7. **B6 Renders** — D1 1080p H.264; D2 hero loop (seamless: first/last frame match);
   optional D3 cutdowns reuse scenes at different composition sizes.

## 6. Render & QA checklist

- [ ] Fonts render (no fallback sans) — check Instrument Serif italic glyphs.
- [ ] Colors match tokens exactly (eyedropper spot-check on rendered frames).
- [ ] No unapproved stats/words; CTAs from approved list.
- [ ] No real client data visible in any screenshot.
- [ ] Hero loop is seamless at loop point; muted-autoplay-safe (no audio track in D2).
- [ ] 1080p bitrate ≥ 8 Mbps; file size acceptable for web (<20 MB for D2 via WebM).

## 7. Costs & licensing

- Remotion: free license at current company size (recheck if >3 employees on the
  license definition — company license would then apply).
- Claude Code: existing Pro plan. Rendering: local, free.
- VO: ElevenLabs (~$5/mo tier) or founder-recorded. Music: royalty-free with
  commercial license (Uppbeat/Artlist/Pixabay-audio).
- Fonts: OFL — embedding in video permitted.
