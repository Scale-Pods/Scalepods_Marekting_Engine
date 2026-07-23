# PRD — ScalePods Expense Tracker Product Demo Video

**Status:** In progress · **Owner:** ScalePods (info@scalepods.co) · **Date:** 2026-07-16
**Product featured:** ScalePods **Expense Tracker** (a separate ScalePods tool, not
Growth OS) — the black/gold-inspired financial management app covering expense
tracking, invoicing, revenue/P&L, investments, and renewal reminders.

## 1. Purpose

Produce a professional motion-graphics product demo video for the ScalePods Expense
Tracker, for use on the ScalePods SaaS landing page, in the style of agency-made
fintech SaaS demos (animated UI mockups, kinetic typography, smooth zooms/transitions).
Built in-house with **Remotion + Claude Code** instead of hiring an editor/agency.

## 2. Goals & success criteria

- Visitors understand what the product does within the first 15 seconds.
- Quality is indistinguishable from an agency-produced motion-graphics demo:
  no stock-template look, no AI-video artifacts.
- 100% on-brand: only official tokens, fonts, and logo from `brand-kit/`; approved
  CTAs; banned-words list respected. No fabricated performance stats — Expense Tracker
  has no approved-stats entry in `brand-kit/BRAND-REPORT.md` (that file only covers the
  4 Pods), so the proof beat uses qualitative feature highlights, not invented numbers.
- The "product UI" shown is pixel-perfect real UI — actual product screenshots from
  `F:\Scalepods.co\scalepods-website-nextjs\public\images\carousel\expense-tracker\`,
  not illustrative fakes.
- No sensitive data on screen. `invoice-system.png` was excluded from this project
  entirely — it exposes a real ScalePods LLP bank account number + IFSC code. Do not
  reintroduce it without a masked/dummy-data version.
- Deliverable embeds cleanly on the landing page (autoplay-muted hero loop and/or
  full demo with voiceover).

## 3. Audience

B2B decision-makers (founders, ops/HR/sales/marketing leads) landing on scalepods.co —
developer-first tone, no fluff.

## 4. Deliverables

| # | Asset | Length | Format | Use |
|---|---|---|---|---|
| D1 | Full product demo | 60–90 s | 1920×1080 MP4 (H.264), with VO + music | Landing page "Watch demo", YouTube, LinkedIn |
| D2 | Hero loop (cutdown) | 10–15 s | 1080p MP4/WebM, muted, seamless loop | Landing hero background/inline |
| D3 | Square/vertical cutdowns (optional, later) | 15–30 s | 1080×1080 / 1080×1920 | LinkedIn/IG posts |

## 5. Narrative structure (D1 — approved 2026-07-16)

Real screenshot used per beat noted in brackets. All from the expense-tracker carousel
folder except the hook/CTA (pure motion graphics).

1. **Hook (0–7 s)** — pain statement, kinetic type on dark `#04070D` bg, logo reveal.
2. **Product intro (7–19 s)** — `dashboard-overview.png` slides into a browser frame;
   zoom on the Monthly Spend / Annual Commitments / Active Services KPI cards.
3. **Feature — Spend Intelligence (19–31 s)** — `category-analysis.png`; callout on
   the merchant/category breakdown charts.
4. **Feature — Client Revenue & P&L (31–43 s)** — `revenue-tracking.png`; callout on
   pending receivables tracking.
5. **Feature — Financial Reports (43–53 s)** — `financial-reports.png`; callout on
   the Profitability card.
6. **Feature — Investment Portfolio (53–63 s)** — `investment-portfolio.png`; callout
   on cumulative growth chart.
7. **Feature — Smart Reminders (63–73 s)** — `action-center.png`; callout on renewal
   tracking.
8. **Highlights (73–80 s)** — qualitative pills, no numeric stat claims: "10+
   Currencies", "India + UAE Invoicing", "Real-Time n8n Sync", "Dark & Light Mode" —
   all lifted verbatim from the product's own feature description, not invented.
9. **CTA (80–87 s)** — approved CTA, logo + handles end card.

Total target runtime: ~85–90 s (within D1's 60–90 s budget).

## 6. Brand constraints (non-negotiable, from CLAUDE.md / TRD §9)

- Backgrounds `#04070D` (dark) / cards `#080A0E` / panels `#10131C`; Sage Green
  `#B1D997` primary accent; Electric Blue `#63A5E7` secondary; Terracotta `#CC6B49`
  only for Claude-partner badges; cream `#F8FAF7` only if a light scene is wanted.
- Fonts: Inter (body/headlines) + Instrument Serif Italic (hero accent words),
  self-hosted woff2 from `brand-kit/fonts/` (OFL licensed — embedding allowed).
- Stats: only approved numbers from `brand-kit/BRAND-REPORT.md`. Copy: no banned words.
- Logos: white wordmark on dark, black on cream, `icon.png` for icon-only.

## 7. Out of scope

- AI-generated video footage (Veo/Seedance/HeyGen motion) — the demo is 100%
  code-rendered motion graphics. (Optional founder-avatar intro via HeyGen is a
  separate, later decision.)
- Live screen recordings with cursor (may be added later as a scene type).
- Publishing/embedding on the landing page itself (separate task after delivery).

## 8. Approval gates

1. **G1 — Script/storyboard** approved (scene-by-scene text) before animation starts.
2. **G2 — 15 s brand test scene** (logo reveal + dashboard slide-in) approved before
   building the full demo.
3. **G3 — Full draft review** (watermark-free render) → revision round → final render.

## 9. Risks

- Voiceover: none for v1 (music + on-screen text only, per user decision 2026-07-16).
  ElevenLabs narration can be added later as an audio-only layer without rebuilding
  scenes.
- Music licensing must be royalty-free with commercial rights.
- Real screenshots show the actual "Adnan / adnan@scalepods.co" account identity in
  the sidebar on every screen. Accepted as low-risk (founder's own product demo) —
  revisit if it should read as a generic demo account instead.
- `invoice-system.png` (real bank details) is excluded — do not add an Invoicing
  System scene unless a masked-data screenshot is supplied.
