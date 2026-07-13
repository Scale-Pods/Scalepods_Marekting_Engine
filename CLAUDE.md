# ScalePods Growth OS — build rules for Claude Code

You are building **ScalePods Growth OS**: ScalePods' own marketing operating system, a
re-scoped, re-branded replication of the shipped **Victory Growth OS**. Read
`docs/PRD.md` and `docs/TRD.md` first — they are the source of truth.

## Non-negotiables
- **Platforms: Instagram, YouTube, Facebook, LinkedIn ONLY.** No TikTok, no website/WordPress
  blog, no Google Business Profile, no GA4/CRM lead analytics.
- **LinkedIn is the primary channel** (B2B agency audience). Register the Company Page +
  Marketing Developer Platform app for real analytics.
- **Video generation is MANUAL-ONLY.** HeyGen (founder avatar) and fal.ai Veo/Seedance
  (motion) are never wired to an FE button or an auto-chain. The Image Engine filter must
  match only `static_image | carousel | social_caption`.
- **Credit safety flags** `GENERATION_ENABLED` and `PUBLISHING_ENABLED` live in
  `src/lib/content.ts`. Keep them false until a stage is being demoed/used.
- **Brand:** use ONLY the official tokens in `brand-kit/` (TRD §9): dark bg `#04070D`,
  cards `#080A0E`, panels `#10131C`, Sage Green accent `#B1D997` (primary), Electric Blue
  `#63A5E7` (secondary), Terracotta `#CC6B49` (Claude-partner badges only), cream light-mode
  `#F8FAF7` with `#8FBC6A`/`#408CD6` accessible accents. Fonts: Inter (body/headlines) +
  Instrument Serif Italic (hero accent words) — self-host the woff2 files from
  `brand-kit/fonts/`. Primary button = sage fill + dark-green text. Every generated visual is
  auto-stamped (logo + one-liner + handles) via the `brand-overlay` edge function.
- **Copy rules:** GPT prompts must embed brand tone (developer-first, no fluff), ONLY
  approved Pod stats from `brand-kit/BRAND-REPORT.md`, approved CTAs, and the banned-words
  list. The 4 Pods (HR/Sales/Ops/Marketing) are the content pillars.

## Working method (matches how VE was validated)
- Build one module at a time following the §13 build sequence in the TRD.
- For every module, verify the full **FE button → n8n webhook → Supabase → FE reflects it**
  round-trip with a REAL login (so RLS applies). Use a throwaway test profile; clean it up.
- After any n8n workflow edit, **publish** it (active version goes stale otherwise). Predefined
  credential types must be **assigned manually in the n8n UI** — document each assignment.
- Supabase upsert = `?on_conflict=<col>` in URL + `Prefer: resolution=merge-duplicates`.
  Row-per-item Code nodes = "Run Once for Each Item" + `return {json:{...}}`.
- Strip ```json code fences before `JSON.parse` on GPT replies.

## Stack
React 18 + TS + Vite + Tailwind + Framer Motion + Recharts + lucide-react + lottie-react +
react-easy-crop · Supabase (Postgres/Auth/Storage/Edge Fns) · n8n · OpenAI GPT-4o + gpt-image-1
· Meta Graph v22 / LinkedIn / YouTube Data v3 · Amazon SES · Vercel.

## Credentials the user provides (see TRD §10)
New Supabase project; OpenAI; Meta (FB Page + IG biz); LinkedIn Company Page + Marketing app;
Google OAuth (YouTube); SES sender; Apify + Serper; Canva Connect + Figma PAT; HeyGen + fal.ai
(manual video); ScalePods brand kit (hex, logo, tagline, fonts).
