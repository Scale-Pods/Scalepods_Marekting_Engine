# First prompt for the new Claude Code session

> Open Claude Code in `G:\1 Scalepods Client Projects\ScalePods Growth OS\` and paste the
> prompt below as the first message. Fill in the `<CREDENTIALS>` block first (or say
> "ask me for each credential when you reach it").

---

## THE PROMPT (copy everything below this line)

I'm building **ScalePods Growth OS** — ScalePods' own AI marketing operating system. It is a
re-scoped, re-branded replication of a system we already shipped and validated end-to-end for
a client (Victory Growth OS), so every architectural decision is already proven — your job is
faithful execution, not invention.

**Read these three files in this folder before writing any code — they are the source of truth:**
1. `docs/PRD.md` — product scope: vision, 3 roles (Admin/Client/Designer), 12 pipeline
   modules (M1 Auth → M12 Notifications), content-type matrix, phasing.
2. `docs/TRD.md` — technical spec: architecture, full Supabase schema, all 13 n8n workflows,
   API scopes per platform, official brand tokens (§9), secrets checklist (§10), and the
   **exact build sequence to follow (§13)**.
3. `CLAUDE.md` — non-negotiable rules (scope limits, video-manual-only, credit-safety flags,
   n8n gotchas, brand + copy rules).

**Context you need:**
- **What it does:** brand knowledge → AI business analysis (BI report) → trend intelligence
  (8 sources) → AI marketing strategy (7 components, human approve gate) → AI content factory
  (GPT-4o copy + gpt-image-1 images + brand overlay; video is manual-only) → designer
  workspace (Canva/Figma/upload + media editor) → creative review (approve/revise loop) →
  publishing engine (Post Now / AI best-time Schedule) → analytics collector (12h) →
  AI insights + learning loop (best-time + winning hooks feed back into scheduling and copy).
- **Platforms: Instagram, YouTube, Facebook, LinkedIn ONLY.** LinkedIn is primary (B2B).
  No TikTok, no blog/WordPress, no Google Business Profile, no GA4/CRM analytics.
- **Stack:** React 18 + TS + Vite + Tailwind + Recharts + lucide-react + lottie-react +
  react-easy-crop (FE, deploy Vercel) · Supabase new project (Postgres/Auth/Storage/Edge
  Functions) · n8n for all automation (webhook-triggered workflows; FE fires webhook, workflow
  writes Supabase, FE polls) · OpenAI GPT-4o + gpt-image-1 · Amazon SES notifications.
- **Brand:** the official kit is in `brand-kit/` (colors, Inter + Instrument Serif fonts,
  black/white wordmarks + icon, tone rules, approved Pod stats, banned words, approved CTAs).
  Dark "cyber navy" `#04070D` default theme, Sage Green `#B1D997` primary accent, Electric
  Blue `#63A5E7` secondary, cream `#F8FAF7` light mode. Follow TRD §9 exactly. All generated
  copy must embed the brand content rules; the 4 Pods (HR/Sales/Ops/Marketing) are the
  content pillars.
- **Safety:** `GENERATION_ENABLED` and `PUBLISHING_ENABLED` master flags in
  `src/lib/content.ts`; video engines (HeyGen avatar, fal.ai Veo/Seedance) must never be
  wired to an FE button or auto-chain — n8n manual trigger only.

**Credentials** (I'll provide as you need them):
```
<CREDENTIALS>
Supabase: project URL / anon key / service-role key = 
OpenAI API key = 
Meta: FB Page ID / Page token (with instagram_content_publish, instagram_manage_insights,
      pages_manage_posts, pages_read_engagement, read_insights) = 
LinkedIn: Company Page URN / Marketing-app token (w_organization_social, r_organization_social) = 
Google OAuth for YouTube channel (youtube.upload, youtube.readonly) = 
Amazon SES SMTP creds + verified sender = 
Apify key =    Serper key = 
Canva Connect client id/secret =    Figma PAT = 
n8n instance URL + how you'll create workflows (MCP or I paste JSON) = 
GitHub repo to push to =    Vercel project = 
</CREDENTIALS>
```

**How to work:**
- Execute **TRD §13 build sequence strictly in order** (scaffold → auth/shell → onboarding+BI
  → trends+strategy → content factory → designer+review → publishing → analytics+insights →
  polish). One module at a time.
- After each module, **verify the full round-trip live**: log in with the real Supabase user
  (RLS applies), click the FE button, confirm the n8n execution succeeded, confirm the DB
  rows, confirm the FE renders the result. Use a throwaway test profile; clean up after.
- Track progress with a task list. Commit + push per completed module with clear messages.
- Heed every gotcha in TRD §6 (publish-after-edit, manual credential binding on httpRequest
  nodes, `on_conflict` upserts, run-once-per-item Code nodes, GPT ```json fence stripping).
- Ask me only when a decision is genuinely mine (account credentials, brand judgment calls,
  anything that spends money or posts publicly). Everything else: decide per the docs and the
  VE precedent, and keep moving.

Start now with **build sequence step 1** (scaffold + Supabase schema + brand tokens), and give
me a short status report after each completed step.

---
*(end of prompt)*
