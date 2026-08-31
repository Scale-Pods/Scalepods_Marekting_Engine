# Carousel Studio → ScalePods Growth OS integration plan

**Status (2026-08-31): planning only, nothing built server-side yet.** The engine itself is done
and proven inside Claude Code (`carousel-studio/` at repo root) — a real 5-slide test carousel
rendered to 5 correct MP4s end-to-end. This doc is the plan for making that a button in the
actual product instead of something only Claude Code can run. Full build history (every bug hit
and fixed along the way) lives in this session's Claude memory, not in this repo — the short
version relevant to integration is below.

## 1. What actually exists today, and why it's built the way it is

`carousel-studio/` is a self-contained Node project (its own `package.json`, decoupled from this
app's Vite build):

- **Avatar**: 5 cartoon poses of a real person, generated once via Higgsfield (image-to-image
  from a real photo), background-removed with a custom local script, saved as transparent PNGs.
  This is a **one-time per-person setup step**, not something that runs per carousel.
- **`base.css`**: the design system. 6 CSS variables control the whole rebrand.
- **`gen.js`**: takes a JSON slide outline (cover / step / stat / cta slides), writes one
  self-contained HTML file per slide. Each slide has a GSAP timeline built `paused: true`, with a
  small bootstrap script that reads `?frame=N&fps=F` from the URL and calls
  `tl.progress(p).pause()` **before** the page is screenshotted — that's what makes the render
  deterministic (frame 47 always renders identical pixels, no animation-timing race).
- **`render.sh` / `render.js`**: for every slide, launches **real headless Chrome** once per
  frame (`chrome.exe --headless=new --screenshot=... "url?frame=N&fps=30"`), then **ffmpeg**
  stitches that slide's PNG sequence into an H.264 MP4 (`-c:v libx264 -pix_fmt yuv420p`). One
  MP4 per slide (matches how Instagram carousels actually work — separate slide assets, not one
  merged video).

**The one fact that drives every decision below**: rendering a slide is a real, sustained CPU
job — headless Chrome launches ~100 times per slide (one per animation frame) and ffmpeg encodes
the result. A full 5-slide carousel took **11 minutes** end-to-end on a normal dev machine. That
is categorically not something that can run:
- in the user's browser (FE can't launch headless Chrome or ffmpeg at all),
- in a Supabase Edge Function (Deno runtime, no Chrome, execution time limits in seconds),
- in a normal Vercel serverless function (execution time limits — even Vercel's longest tiers
  cap well under 11 minutes, and don't ship Chrome/ffmpeg binaries by default),
- or in n8n itself (n8n orchestrates and calls things, it doesn't run arbitrary long CPU jobs
  well, and doesn't have Chrome/ffmpeg installed).

So the honest answer to "do we need a server for this" is **yes** — some kind of compute that
can run Node + headless Chrome + ffmpeg for 10+ minutes at a time, without a request timeout
cutting it off. Everything else in this plan follows from that.

## 2. Proposed architecture

```
FE (React)                n8n                      Render Worker              Supabase
─────────────────────────────────────────────────────────────────────────────────────────
Topic + requirements  →  sp-carousel-outline    (GPT-4o drafts outline,
  form                    webhook                 brand rules embedded
                                                    same as existing prompts)
                              │
                              ▼
                         writes outline_json  ──────────────────────────►  carousel_jobs row
                                                                            (status: draft)
FE shows outline for
  user to edit/approve
        │
        ▼
"Approve & Render"  →  sp-carousel-render     ──trigger (HTTP)──────►  POST /render
  webhook                webhook                                        { job_id, outline }
                                                                              │
                                                                    gen.js → render.sh
                                                                    (~10-15 min real work)
                                                                              │
                                                              uploads MP4s ───┤
                                                              per slide       ▼
                                                                        Supabase Storage
                                                                        (carousel-media bucket)
                                                                              │
                                                              PATCH job  ─────┘
                                                              status: done,
                                                              slide_urls: [...]
FE polls carousel_jobs   ◄──────────────────────────────────────────────────┘
  (same pattern already
  used for Analytics
  refresh / AI Insights)
        │
        ▼
Gallery of finished MP4s → "Send to Publishing"
  (reuses the existing multi-platform composer/
  carousel upload flow already built)
```

This deliberately reuses two patterns already proven in this codebase rather than inventing new
ones:
- **n8n-as-orchestrator + Supabase-row-as-job-state + FE-polls-Supabase**, exactly like
  `triggerAnalyticsRefresh()`/`triggerInsights()` in `Analytics.tsx` already do.
- **Publishing integration**: once slide MP4s exist, they drop into the *existing* multi-platform
  composer/carousel-upload flow (already built and verified live for Instagram carousels) —
  no new publishing code needed, just point it at the new files.

## 3. Component by component

### 3a. Render worker — the actual new piece of infrastructure

This is the only genuinely new piece of infra. It's a small HTTP service wrapping
`gen.js`+`render.sh`: `POST /render {job_id, outline}` → runs the pipeline → uploads results to
Supabase Storage → `PATCH`es the `carousel_jobs` row when done (or failed, with the specific
error — reuse `render.js`'s existing "which frame, why" failure detail, don't swallow it).

**Where does this run?** Three real options, in the order I'd actually pick:

| Option | What it is | Why / why not |
|---|---|---|
| **Fly.io or Railway (recommended)** | A Docker container (Node + Chrome + ffmpeg preinstalled) on a small always-on or scale-to-zero machine | Cheapest and least ops overhead for a small team — no AWS account/IAM setup, a `Dockerfile` + `fly deploy` (or Railway's git-push deploy) is the whole ops story. Both support persistent volumes if you want to cache anything, and give you a plain HTTPS URL automatically (no custom domain or DNS setup needed). |
| **AWS Fargate (containers, no EC2 to manage)** | Same Docker image, run as an ECS Fargate task/service instead | The "if it must be AWS" answer — no server patching, scales, but meaningfully more setup (VPC, ECS cluster/service, task definitions, ECR for the image, IAM roles) for the same result Fly.io gives you in an afternoon. Worth it only if there's an existing AWS org/billing reason to consolidate there. |
| **A plain VM (EC2 / DigitalOcean Droplet)** | One box, install Chrome+ffmpeg+Node directly, run the service under a process manager (pm2/systemd) | Not recommended — you own patching, restarts, and scaling by hand for no real benefit over the container options above. |

**Decision: Railway.** Step-by-step build plan for it is in §7.

**Auth**: the render worker's endpoint must **not** be public/unauthenticated — n8n calls it with
a shared secret header (same pattern as every other n8n→external-service call already used in
this project, e.g. the `httpHeaderAuth` credential pattern already set up for Instagram).

### 3b. Outline generation (n8n + GPT-4o)

New workflow `ScalePods · Carousel Outline`: webhook receives `{topic, commentKeyword,
platform}`, calls GPT-4o with a prompt that embeds the same brand-safety constraints already
required elsewhere in this project (**the literal approved Pod-stats list, not just a rule
reference** — this project hit that exact bug before with an earlier GPT prompt and had to fix
it by embedding the literal list — banned words, approved CTAs, developer-first tone), asking
for a JSON array matching `gen.js`'s outline schema (cover, 4-6 content slides, cta). Strip
```json fences before `JSON.parse`, same as every other GPT-JSON call in this repo.
Writes the draft into a new `carousel_jobs` row.

### 3c. Supabase schema

New table `carousel_jobs`:
```
id, business_profile_id, topic, comment_keyword, status
  ('drafting' | 'draft_ready' | 'rendering' | 'done' | 'failed'),
outline_json, slide_urls (jsonb array, filled in as each slide finishes — lets the FE show
  slides landing one at a time during an 11-minute render instead of an opaque wait),
error_detail, created_at, updated_at
```
RLS `authenticated`-all, matching every other table in this project. New Storage bucket
`carousel-media` (public read, same shape as the existing `content-media`/`brand` buckets).

### 3d. Frontend

New section (Content Factory sub-tab or its own nav item — Content Factory fits better, it's
already "topic in, content out"):
1. **Topic + requirements form**: topic, comment keyword (feeds the CTA slide, same field
   concept the Comment-to-DM automation already uses), platform, avatar pose overrides per slide
   (optional — sensible defaults from the template).
2. **Outline review**: shows the drafted outline slide-by-slide (plain text/cards, not a full
   preview — rendering a live preview would mean running the same Chrome pipeline just to show a
   picture, defeats the purpose; a fast static mockup using the same `base.css` tokens in plain
   React/CSS is enough for a "does this read right" check) with inline edit + "Approve & Render".
3. **Render progress**: polls `carousel_jobs`, same polling shape as `onRefresh`/
   `onGenerateInsights` already in `Analytics.tsx` — a spinner plus "slide 3/5 done" using
   `slide_urls.length`.
4. **Finished gallery**: the rendered MP4s, each with a "Send to Publishing" button that hands
   off to the existing composer.

## 4. Answers to the specific open questions

- **Do we need a server?** Yes — a small container running Node+Chrome+ffmpeg, because the
  render itself is a real ~10 minute CPU job. Nothing about that changes regardless of hosting
  choice.
- **Do we need AWS?** No, not specifically. Fly.io or Railway do the same job with far less
  setup. AWS (Fargate) is a reasonable choice only if there's already an AWS bill to consolidate
  into — not because the workload needs anything AWS-specific.
- **Do we need a CDN?** No separate one. Supabase Storage's public buckets are already served
  through a CDN edge layer — the same setup this project already relies on for
  `content-media`/`brand`. A dedicated video CDN (Cloudflare Stream, Mux) only becomes worth it
  for heavy video *streaming* at scale; these are short social-media carousel clips being
  downloaded/embedded, not a video platform.
- **Do we need our own domain/DNS?** No. Fly.io/Railway hand you a working HTTPS URL
  automatically; n8n calls that URL directly with a shared-secret header, the same way it already
  calls every other external service in this project. A custom domain would be cosmetic only.

## 5. What's genuinely new work vs. reuse

**New**: the render worker service (Dockerfile + thin HTTP wrapper around the existing
`gen.js`/`render.sh`, ~1 day), the outline-generation n8n workflow (~half a day, mirrors existing
GPT-JSON workflows), the `carousel_jobs` table + Storage bucket (~1 hour), the FE flow (~1-2 days
for form + polling + gallery, all patterns already proven elsewhere in this app).

**Reused as-is**: `base.css`, `gen.js`, `render.sh` (the worker just calls them, doesn't rewrite
them), the async-job-polling UI pattern, the multi-platform publishing/composer flow, the
brand-safety prompt-construction pattern, the n8n shared-secret auth pattern.

**Not automated, and shouldn't be**: avatar creation. It's a one-time per-person setup (5 poses,
picked once, approved once) — there's no product reason to regenerate it per carousel, so it
stays a manual Claude Code step (or a simple one-off admin flow later) rather than something the
render pipeline does per request.

## 6. Suggested build order

Matches this project's existing "one module at a time, verify the round-trip" convention:
1. Render worker as a standalone service, tested by curl before any FE/n8n exists.
2. `carousel_jobs` table + Storage bucket.
3. n8n outline-generation workflow, tested standalone.
4. n8n render-trigger workflow, wired to the real worker.
5. FE: form → outline review → approve → poll → gallery, verified with a real login end to end.
6. Wire "Send to Publishing" into the existing composer.

## 7. Railway implementation — step by step

Same 6 phases as §6, expanded to the concrete Railway actions. Each phase ends with something
independently verifiable — don't start the next phase on faith.

### Phase 0 — turn the local pipeline into an HTTP service (before touching Railway at all)

`render.js` today is a CLI (`node render.js <slug>`) that assumes `gen.js` already wrote the
slide HTML files. The worker needs both steps behind one HTTP call:

1. Write `carousel-studio/server.js` (new file) — a small Node `http` server (no framework
   needed, same style as `serve.js`) exposing:
   - `POST /render` — body `{ job_id, outline }`. **Returns `202 Accepted` immediately** (don't
     hold the HTTP connection open for an 11-minute job — Railway's edge proxy, like most
     platforms, has a request timeout well under that). Kicks off `gen.js`'s `generateCarousel()`
     then `render.js`'s render logic in the background (both are already `module.exports`-able —
     `gen.js` exports `generateCarousel`, `render.js`'s per-slide logic just needs the same
     treatment), uploads each finished slide MP4 to Supabase Storage as it completes, and
     `PATCH`es the `carousel_jobs` row (service-role key) with `slide_urls` growing slide-by-slide
     and finally `status: 'done'` (or `'failed'` + `error_detail` on the specific failure —
     reuse the existing "which frame, why" message, don't swallow it).
   - `GET /health` — plain `200 ok`, used by Railway's health check and by you, once deployed,
     to confirm the container actually came up before wiring anything else to it.
   - Reads `RENDER_WORKER_SECRET` from env; every request must carry a matching
     `X-Worker-Secret` header or gets `401` — this is what stands in for "not AWS IAM, not a VPC,
     just a shared secret," which is fine because n8n is the only caller.
2. Test it **locally first**, exactly like every other module in this project gets verified
   before deploying: `node server.js`, then `curl -X POST localhost:8080/render -H
   "X-Worker-Secret: ..." -d '{"job_id":"test","outline":[...]}'`, confirm frames render and an
   MP4 lands, using the existing `_qa-outline.json` outline as the test payload.

**✅ Phase 0 done (2026-08-31)** — `render.js` refactored to export a reusable `renderCarousel()`
(CLI still verified working after the refactor), `server.js` built and tested end-to-end against
a local mock Supabase: real slide render → real upload → `slide_urls` updated after each slide
→ final `status: 'done'`, plus every error path (bad/missing secret, bad body, unknown route).

### Phase 1 — containerize

3. Write `carousel-studio/Dockerfile`:
   - Base: `node:20-bookworm-slim`.
   - `apt-get install chromium ffmpeg fonts-liberation ca-certificates` (Debian's `chromium`
     package, not Google's `google-chrome-stable` — avoids adding Google's apt repo/signing key
     just for this; functionally identical for headless screenshotting).
   - `COPY` in `base.css`, `gen.js`, `render.js`, `server.js`, `serve.js`, `vendor/`, `assets/`,
     `icons/` — **not** `node_modules` or `package.json`: `gen.js`/`render.js`/`serve.js` only
     use Node's built-ins at runtime (the earlier `npm install gsap` was only ever a one-time way
     to extract `vendor/gsap.min.js`, never a runtime dependency), so there's nothing to install.
   - `ENV CHROME_BIN=/usr/bin/chromium` — `render.js` already reads this from the environment,
     so no code change needed, just don't rely on its Windows-path default.
   - `EXPOSE 8080`, `CMD ["node", "server.js"]`.
4. Build and run it **locally with Docker Desktop before pushing anywhere** — this is where
   Linux-specific Chromium sandboxing issues actually show up (missing `--no-sandbox`, missing
   shared-memory size, etc.), and it's much faster to debug on your own machine than through
   Railway's remote build logs. Re-run the same `curl` test from Phase 0 against the
   containerized version.

**✅ Phase 1 done (2026-08-31)** — built and ran the real image locally (`docker build` + `docker
run`), re-verified against a real full-length slide (3.2s / 96 frames, not just the quick 0.5s
smoke test) with the same mock-Supabase setup as Phase 0: clean render, zero dropped frames,
valid MP4 (`ffprobe`-confirmed 1080×1350/30fps/3.2s), cleanup confirmed inside the container.
Debian's `chromium` package worked with no sandboxing issues — the `--no-sandbox` flag already
in `render.js`'s Chrome args (added for local-Windows cold-start speed, not for this) turned out
to also be exactly what running as root inside a container needs. One real resource finding:
CPU, not RAM, is the constraint — see the updated Phase 2 resource guidance below.

### Phase 2 — Railway project

5. Create/log into a Railway account, new empty project.
6. Connect this GitHub repo, set the service's **root directory to `carousel-studio/`** (Railway
   supports monorepo subdirectory deploys) so it only ever builds/redeploys off changes under
   that path — set **Watch Paths** to `carousel-studio/**` explicitly so an unrelated FE commit
   elsewhere in this repo doesn't trigger a rebuild.
7. Railway auto-detects the `Dockerfile` and builds from it — confirm the build succeeds and
   `GET /health` responds before doing anything else.
8. **Environment variables** (Railway dashboard → Variables): `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (backend-only secret — never exposed to the FE, same handling
   discipline as every other service-role key in this project), `RENDER_WORKER_SECRET` (generate
   a random one, this is the value n8n's credential will also hold), `CHROME_BIN` (matches the
   Dockerfile's `ENV`, redundant but explicit is fine).
9. **Resources**: measured for real on a local Docker run of a full-length slide at concurrency
   5 — **CPU is the real constraint, not RAM**: usage spiked to ~950% (roughly 9-10 cores at
   once across the 5 concurrent Chromium processes + ffmpeg), while memory only reached ~1.3GB.
   Start Railway at **4+ vCPU** with 2GB RAM (not the RAM-heavy assumption a "headless Chrome"
   workload might suggest) — if logs show dropped frames once real renders run there, the fix is
   dialing `--concurrency` down in the request or raising vCPU, not a code change either way.
10. **Networking**: Settings → Generate Domain — gives a working `*.up.railway.app` HTTPS URL
    with zero DNS work. No custom domain needed (cosmetic only, skip it for now).
11. **Sleep behavior**: enable "sleep when idle" — renders are infrequent and take minutes
    regardless, so a few extra seconds of cold-start on a sleeping container costs nothing
    against an 11-minute job, and this keeps cost near-zero between uses.
12. Verify from *outside* Railway: `curl https://<your-app>.up.railway.app/health` from your own
    machine, then the same `/render` smoke test as Phase 0, now against the real deployed URL.

### Phase 3 — Supabase

13. `carousel_jobs` table + `carousel-media` Storage bucket, exactly as in §3c — apply via the
    Supabase MCP/migration the way every other table in this project has been.
14. Confirm the worker's service-role key can actually write to the new bucket and `PATCH` the
    new table — a quick manual insert + the worker's own test render from Phase 2 step 12 is the
    real check, not just "the migration ran."

### Phase 4 — n8n

15. `ScalePods · Carousel Outline` workflow: webhook → GPT-4o (brand-safety prompt per §3b) →
    write draft row.
16. `ScalePods · Carousel Render Trigger` workflow: webhook (fired by the FE's "Approve &
    Render") → one HTTP POST to `https://<your-app>.up.railway.app/render` with the
    `X-Worker-Secret` header from a manually-assigned n8n credential (per this project's own
    convention: predefined credential types get assigned in the n8n UI, documented here — record
    the credential name once it's created) → responds to the FE immediately (worker already
    returns `202` fast, so n8n doesn't need to wait either) with `status: 'rendering'`.
17. **Publish both workflows** (draft workflows go stale, per this project's standing rule).
18. Test each workflow standalone via n8n's own execution history before wiring the FE to them.

### Phase 5 — Frontend

19. `src/lib/carousels.ts` (or similar): `createCarouselJob`, `listCarouselJobs`,
    `pollCarouselJob` — same shape as `src/lib/leads.ts`/the `Analytics.tsx` polling functions
    already in this codebase.
20. Build the form → outline review/edit → "Approve & Render" → progress (poll `carousel_jobs`,
    show `slide_urls.length`/expected count) → finished gallery flow, in Content Factory.
21. Wire "Send to Publishing" to the existing composer.

### Phase 6 — real end-to-end verification

22. **With a real login (RLS applies), not a synthetic test**: submit an actual topic through
    the FE, confirm the outline drafts, approve it, confirm the Railway service's logs show the
    request land, confirm slides appear in the gallery as they finish (not just at the very end),
    confirm the finished MP4s actually play and match what static-frame QA would show, confirm
    "Send to Publishing" hands off correctly. Clean up the test job/row afterward, same as every
    other feature in this project gets verified.
