# TRD — Video Studio (`/video-studio`), Phase 1

**Status:** Draft for review · **Date:** 2026-09-08 · **Author:** Claude Code
**Scope:** Phase 1 only, per [video-studio-prd.md](video-studio-prd.md)'s locked decisions —
motion-graphics video, no AI video model, FFmpeg on the existing Railway worker.
**Relates to:** [carousel-studio-integration.md](carousel-studio-integration.md) (the actual
precedent this reuses) · [AI Studio](../src/pages/AIStudio.tsx) (the FE pattern this copies) ·
`docs/PRD.md` §M6

---

## 1. What already exists, read from the real code (not assumed)

Phase 1 is cheap specifically because most of it is already built and running in production for
Carousel Studio. Confirmed by reading the actual files, not inferred:

- **`carousel-studio/gen.js`** turns a plain JSON *outline* (an array of `{type, ...fields}`
  slide specs) into self-contained HTML files with a deterministic, seekable GSAP timeline per
  slide (`window.__seekFrame(frame, fps)`), plus a `manifest.json` (`{slug, fps, slides:
  [{file, durationS}]}`). Four templates exist today, dispatched by `TEMPLATES` at gen.js:300:
  `cover` (headline/subhead/eyebrow, avatar pose), `step` (a heading + 1-3 bullet items),
  `stat` (a big GSAP count-up number), `cta` (end card with a keyword prompt). This is a
  **direct, unmodified fit** for the PRD's "motion graphics / kinetic text" video type — the
  templates are already exactly hook → point(s) → proof-stat → CTA, which is the shape most
  short-form marketing video takes anyway.
- **`carousel-studio/render.js`** launches one persistent headless Chrome (`puppeteer-core`,
  `CHROME_BIN` env), loads each slide's HTML once, seeks + screenshots every frame
  (`page.evaluate(() => window.__seekFrame(...))`), then ffmpeg-encodes that slide's frame
  sequence into `libx264`/`yuv420p`/`+faststart` MP4 (`ffmpegEncode()`, render.js:~90).
  **Confirmed limitation that matters most for this TRD**: `renderCarousel()` produces **one
  MP4 per slide**, uploaded and reported individually — there is no concatenation step
  anywhere in this codebase today. Carousel Studio doesn't need one (Instagram carousels post
  as separate slide videos). Video Studio does — see §3c.
- **`carousel-studio/server.js`** is the Railway worker's HTTP entry point: `POST /render`
  (header `X-Worker-Secret`, body `{job_id, outline}`) returns `202` immediately and does the
  actual render in the background, reporting all progress/results by PATCHing the
  **`carousel_jobs`** row (hardcoded table name, `patchJob()`) — never through the HTTP
  response. Uploads go to the **`carousel-media`** bucket (`CAROUSEL_STORAGE_BUCKET` env,
  confirmed as one of exactly 3 real buckets: `brand`, `carousel-media`, `content-media`).
- **n8n `ScalePods · Carousel Render Trigger`** (`NIGy4sEGr0vFzfM9`, 4 nodes): webhook
  `sp-carousel-render {jobId}` → fetches the `carousel_jobs` row → POSTs
  `{job_id, outline: outline_json}` to `https://scalepodsmarektingengine-production.up.railway.app/render`
  with credential **"Carousel Render Worker Secret"** (`httpTemplatedCustomAuth`,
  `rEnYxXdXAAcJR01b`) → responds immediately. This exact shape is what §4 reuses.
- **`src/lib/carousels.ts`** is the FE data/job-status layer this TRD's `videoStudio.ts` copies
  almost line for line: sync brief webhook (`generateCarouselOutline` → `sp-carousel-outline`,
  responds with the row directly) + async render webhook (`triggerCarouselRender` →
  `sp-carousel-render`, fire-and-poll) + a `RenderProgress` shape + `describeProgress()`/
  `overallProgress()` helpers already written to turn the worker's throttled progress writes
  into a human sentence and a 0..1 bar.
- **Branding**: `public/brand/logo-white.png` / `logo-black.png` are the real overlay assets
  (already used this way in `BlogPreview.tsx`'s CTA card). `src/lib/brandStamp.ts` is
  browser-canvas-only and cannot be reused for video — confirmed in the PRD (§7) and still true.
- **Publishing**: `content_items.content_type` already has `'motion_graphics'` as a real enum
  value, `VIDEO_CONTENT_TYPES` in `src/lib/content.ts` already includes it, and the Publishing
  Engine's Instagram Reels / YouTube Shorts branches already exist and handle real MP4 uploads.
  **This TRD makes zero changes to Creative Review or the Publishing Engine** — a Video Studio
  output becomes an ordinary `content_items` row with a real `.mp4` `media_url`, same as any
  other video today.

## 2. What's genuinely new work vs. reuse

| Piece | Reuse as-is | New work |
|---|---|---|
| Slide templates (cover/step/stat/cta) | ✅ `gen.js`, unmodified | — |
| Per-slide frame capture + encode | ✅ `render.js`'s `renderSlide()`, unmodified | — |
| Worker auth, job pattern, progress throttling | ✅ same shapes as `server.js` | — |
| **Stitching N slide MP4s into ONE continuous video** | — | ✅ new `stitchVideo()` (§3c) |
| **Optional voiceover mux** | — | ✅ new, ffmpeg `-map`/amix (§3c) |
| **Brand logo overlay burned into the video** | — | ✅ new, ffmpeg `overlay` filter (§3c) |
| **Aspect-ratio crop/pad** (1:1/4:5/9:16/16:9) | — | ✅ new, ffmpeg `crop`/`pad` (§3c) |
| Railway worker HTTP scaffolding | ✅ same `server.js` process | new `/render-video` route (§3c) |
| Outline-writing GPT call | ~70% reuse of the Carousel Studio prompt shape | new brief framing (§3b) |
| `carousel_jobs` job-status table pattern | ✅ same status machine/shape | new `video_jobs` table (§3a) |
| `carousels.ts`'s FE job-status pattern | ✅ same functions/shapes | new `videoStudio.ts` (§3d) |
| Creative Review / Publishing Engine | ✅ zero changes needed | — |

## 3. Component by component

### 3a. Supabase schema

New table, deliberately shaped like `studio_jobs` (source picker: trend/strategy/topic, same as
AI Studio) crossed with `carousel_jobs` (render-progress machine, since this reuses that worker):

```sql
create table public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.business_profiles(id) on delete cascade,
  source_kind text not null,              -- 'trend' | 'strategy' | 'topic', matches StudioSourceKind
  source_signal_id uuid,                  -- trend_signals.id, when source_kind='trend'
  topic text not null,
  platform text not null,
  aspect_ratio text not null default '9:16',  -- AspectRatio (studioStyles.ts) — reused, not redefined
  video_type text not null default 'motion_graphics', -- PRD's 6 types; Phase 1 ships this one only
  status text not null default 'drafting',    -- drafting | draft_ready | rendering | done | failed
  outline_json jsonb,                     -- CarouselSlide[] (lib/carousels.ts) -- SAME shape, imported not redefined
  copy_json jsonb,                        -- {hook, body, hashtags, cta} -- same shape as StudioCopy
  voiceover_script text,                  -- editable VO text; null = no voiceover for this video
  voiceover_url text,                     -- set once ElevenLabs (or silence) has produced the track
  render_progress jsonb,                  -- RenderProgress (lib/carousels.ts) -- same shape, reused type
  final_video_url text,                   -- the ONE stitched, branded, cropped MP4 -- what gets published
  error_detail text,
  content_item_id uuid references public.content_items(id), -- set once "Send to Review" fires, mirrors studio_jobs
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.video_jobs enable row level security;
create policy auth_all on public.video_jobs for all to authenticated using (true) with check (true);
```

No migration needed for anything existing — this is a new, standalone table, same non-destructive
pattern as `studio_jobs`/`carousel_jobs` before it.

### 3b. n8n workflows

**`ScalePods · Video Brief`** (new, sync — mirrors `ScalePods · Studio Brief`'s "respond with the
row directly" pattern, not `Carousel Outline`'s, since this needs to write BOTH an outline
*and* post copy in one call):

```
POST /webhook/sp-video-brief
{ profileId, sourceKind, signalId?, topic, platform, aspectRatio,
  videoType: 'motion_graphics', wantsVoiceover: boolean }
```
1. Fetch context exactly like `ScalePods · Studio Brief` does today (trend signal /
   `strategy_generations` approved row / winning hooks — reuse that node chain verbatim, it
   was fixed 2026-09-04 to point at the live table).
2. One GPT-4o call returns **both** `{hook, body, hashtags, cta}` (the post caption — same
   shape `StudioCopy` already uses) **and** `slides: CarouselSlide[]` (3-6 slides, `cover` →
   1-3 `step`/`stat` → `cta`, using the exact same field names `gen.js` templates read — the
   prompt can crib the *field contract* directly from `carousel-studio/gen.js`'s template
   functions since that's the literal downstream consumer). When `wantsVoiceover`, also return
   a `voiceover_script` (a short VO track — a beat per slide, written to match the on-screen
   text rather than duplicate it word-for-word).
3. Insert `video_jobs` row, `status: 'draft_ready'`. Respond with the row.

**`ScalePods · Video Render`** (new, async — a near-exact copy of `ScalePods · Carousel Render
Trigger`, same worker, same secret credential, new endpoint):

```
POST /webhook/sp-video-render  { jobId }
```
1. `Normalize Input` → `Fetch Job` (`video_jobs?id=eq.{jobId}`) — same two nodes, new table.
2. **If `voiceover_script` is set and `voiceover_url` isn't yet**: call ElevenLabs TTS first
   (new node, new credential — Phase 1 needs this only when a user actually opts into a
   voiceover; motion-graphics videos work with on-screen text alone, so this stays optional and
   is genuinely the only brand-new external vendor Phase 1 touches), upload the audio to
   `content-media`, PATCH `voiceover_url` before continuing.
3. `Trigger Render Worker` — same node shape as Carousel's, new URL:
   `POST https://scalepodsmarektingengine-production.up.railway.app/render-video`
   `{ job_id, outline: outline_json, aspect_ratio, voiceover_url }`, same
   `httpTemplatedCustomAuth` credential (`Carousel Render Worker Secret`) — **reused directly,
   no new credential needed for the render call itself.**
4. Respond immediately (worker renders async, same as Carousel Studio).

### 3c. Render worker changes (`carousel-studio/server.js` + `render.js`)

New route, new job-runner function, alongside (not replacing) the existing `/render`:

```js
// server.js — new alongside runJob()
if (req.method === 'POST' && req.url === '/render-video') {
  // same X-Worker-Secret check, same 202-then-background-work pattern as /render
  const { job_id, outline, aspect_ratio, voiceover_url } = parsed;
  res.writeHead(202, ...); res.end(...);
  runVideoJob(job_id, outline, aspect_ratio, voiceover_url).catch(...);
}
```

`runVideoJob()` calls the SAME `generateCarousel()` + `renderCarousel()` from gen.js/render.js
completely unmodified (this is what makes Phase 1 cheap) to produce the per-slide MP4s exactly
as Carousel Studio does today, then adds one new step:

```js
// render.js — new, alongside renderSlide()/renderCarousel()
async function stitchVideo({ slideFiles, aspectRatio, voiceoverPath, logoPath, outfile }) {
  // 1. Concat demuxer -- the standard, re-encode-free way to join same-codec MP4s.
  //    Writes a "file '<path>'" list, one line per slide, in outline order.
  const listFile = ...; // ffmpeg -f concat -safe 0 -i list.txt -c copy concatenated.mp4

  // 2. Crop/pad to the target AspectRatio (RATIO_VALUE already defines every ratio's real
  //    number in studioStyles.ts -- the worker computes the same target w:h from it so the FE
  //    and the render agree on what e.g. "9:16" actually means).

  // 3. Burn in the brand logo (corner-anchored overlay filter, safe-area padded) --
  //    public/brand/logo-white.png, same asset BlogPreview.tsx already uses for dark surfaces.

  // 4. If voiceoverPath is set: amix the concatenated video's own (silent -- Chrome frames
  //    carry no audio) track with the voiceover, `-shortest` so the video's real duration wins
  //    (the VO script is written to roughly match slide count x duration, but this guarantees
  //    no silent tail or cut-off narration either way).

  // Single ffmpeg invocation chaining concat -> scale/crop -> overlay -> (amix); the concat
  // demuxer step must run first/separately since concat's `-c copy` is incompatible with any
  // re-encoding filter in the same pass.
}
```

This is real, scoped new work — not hand-waved. Concretely: one new ffmpeg concat-demuxer call,
one new filter_complex chain (scale+crop+overlay(+amix)), reusing `execFile('ffmpeg', ...)` and
the exact thread-cap/`-movflags +faststart` lessons already learned and documented in the
current `ffmpegEncode()`.

`runVideoJob()` uploads the ONE final file to **`content-media`** (not `carousel-media` — this
output is a finished, publishable asset like every other Studio's output, not an intermediate
carousel-slide file) at `video-studio/<jobId>/final.mp4`, and PATCHes **`video_jobs`**
(`final_video_url`, `status`) — a parallel `patchVideoJob()` next to the existing `patchJob()`,
table name as the only real difference.

**Per-slide progress reporting is reused verbatim** (`onProgress`/`onSlideDone` callbacks
already exist in `renderCarousel()`) — `runVideoJob()` just points them at `video_jobs` instead
of `carousel_jobs`, plus one more `render_progress.phase: 'stitching'` write during the new step.

### 3d. Frontend

**`src/lib/videoStudio.ts`** (new) — copies `carousels.ts`'s shape closely enough that this is
mostly a rename pass, not new design:

```ts
export type VideoJobStatus = 'drafting' | 'draft_ready' | 'rendering' | 'done' | 'failed'
export interface VideoJob {
  id: string; profile_id: string; source_kind: StudioSourceKind; source_signal_id: string | null
  topic: string; platform: string; aspect_ratio: AspectRatio; video_type: 'motion_graphics'
  status: VideoJobStatus; outline_json: CarouselSlide[] | null; copy_json: StudioCopy | null
  voiceover_script: string | null; voiceover_url: string | null
  render_progress: RenderProgress | null; final_video_url: string | null; error_detail: string | null
  content_item_id: string | null; created_at: string; updated_at: string
}
export async function generateVideoBrief(params): Promise<VideoJob>       // sp-video-brief, sync
export async function updateVideoDraft(jobId, patch): Promise<void>       // outline/copy/VO edits
export async function triggerVideoRender(jobId): Promise<void>            // sp-video-render, async
export async function listVideoJobs / getVideoJob / deleteVideoJob        // same as every other Studio
```

Reuses these types directly rather than redefining them: `StudioSourceKind`, `StudioCopy` (both
from `lib/studio.ts`), `CarouselSlide`, `RenderProgress`, `describeProgress`, `overallProgress`
(all from `lib/carousels.ts`), `AspectRatio`/`ASPECT_RATIOS`/`PLATFORM_DEFAULT_RATIO` (from
`lib/studioStyles.ts`).

**`src/pages/VideoStudio.tsx`** (new) — the same 5-step flow as `AIStudio.tsx`, same visual
language (`Chip`, `Panel`, `PageHeader`, `Modal` from `components/ui.tsx`):

1. **Source** — identical `SOURCES` picker (trend/strategy/topic) to AI Studio, literally the
   same component if it's worth extracting; not a redesign.
2. **Settings** — Platform, Shape (`ASPECT_RATIOS`, capped to what Reels/Shorts/Feed actually
   use), a "slide count" chip (3-6, same `Chip` pattern as AI Studio's variant-count picker and
   the carousel feature's slide-count picker), a "Add a voiceover?" toggle.
3. **Brief** (`onBrief` → `generateVideoBrief`) — nothing spent (motion graphics has no paid
   video model at all in Phase 1; the ONLY spend is the GPT call and, if voiceover is on, a few
   cents of TTS). Review screen: an outline editor per slide (reuse the shape of AI Studio's
   `SlideEditor`, adapted to `CarouselSlide`'s fields per-type: cover gets headline/subhead,
   step gets its items, stat gets value/suffix/label), the post caption fields (same as AI
   Studio's Copy panel), and the VO script textarea when enabled.
4. **Render** (`onGenerate` → `triggerVideoRender`) — poll `render_progress`, show
   `describeProgress()`'s sentence + `overallProgress()`'s bar (both already written, reused
   verbatim) — the exact UX Carousel Studio already has live, just relabeled from "carousel" to
   "video."
5. **Result** — one embedded `<video>` player (`final_video_url`), a "Regenerate" (re-fires the
   whole render — Phase 1 has no per-slide video regenerate the way AI Studio's carousel does,
   since slides aren't independently useful once stitched; flagged as a real, deliberate scope
   cut, not an oversight), and **Send to Review**: `createManualItem({contentType:
   'motion_graphics', mediaUrl: final_video_url, ...})` — this call needs no new code in
   `content.ts` at all, `'motion_graphics'` is already a valid `ContentType`.

**Nav + manual**: new sidebar entry under Content Generation (matches AI Studio/Carousel
Studio's placement), and a `/manual` card — both per this project's own standing rule to update
the manual in the same piece of work a visible feature ships in.

## 4. Cost, per the PRD's own §8 table

Phase 1 has no per-video AI-model spend — its whole point is that it proves the pipeline for
~$0.05/video (GPT brief + optional cents of TTS). **No `VIDEO_GENERATION_ENABLED` gate or
per-video ceiling is needed for this phase** (the PRD's §12 deferred that decision to Phase 2
specifically because Phase 1 has nothing worth gating) — `GENERATION_ENABLED` (already `true`,
already gates every Studio's brief step) is sufficient here, same as Carousel Studio today.

## 5. Build order

1. **Supabase**: `video_jobs` migration (§3a). Zero risk — new table only.
2. **Worker**: `/render-video` + `stitchVideo()` in the `carousel-studio/` repo, tested locally
   first via a direct `node`/curl call against a dev instance of `server.js` (same verification
   discipline `carousel-studio-integration.md` §7 already used for `/render`) — concat + crop +
   logo overlay + optional VO mux, confirmed with a real multi-slide outline before touching
   Railway at all. Deploy once local output is verified frame-correct and audio-synced.
3. **n8n**: `ScalePods · Video Brief`, `ScalePods · Video Render` (§3b) — build against the
   already-deployed worker from step 2.
4. **FE**: `lib/videoStudio.ts` → `pages/VideoStudio.tsx` → nav entry → manual entry (§3d).
5. **End-to-end verification** (§6).

## 6. Verification (before calling Phase 1 done)

Same standard as every other module in this app (CLAUDE.md's own working method): a real login,
a throwaway test profile, the full round trip.

1. `npx tsc --noEmit` clean.
2. Real brief: pick a topic, confirm the outline + copy come back editable, confirm literally
   nothing was charged yet (no video model exists in this phase to charge anything).
3. Real render: confirm per-slide progress phases land in `render_progress` as the worker
   works, confirm the final `final_video_url` is ONE continuous MP4 (not N separate slide
   files) with correct total duration, correct aspect ratio, the logo actually burned in
   (visually inspect a frame), and — when voiceover was enabled — audible, roughly
   duration-matched narration with no jarring cutoff.
4. Confirm Carousel Studio's own `/render` path is completely unaffected — a real carousel
   render still produces N separate slide MP4s exactly as before (the new `/render-video` route
   and `runVideoJob()` are additive, sharing `gen.js`/`render.js`'s core functions but not
   touching `runJob()` or the existing route).
5. Send to Review → confirm a real `content_items` row lands with `content_type:
   'motion_graphics'` and a real playable `media_url`, and that Creative Review renders it
   (video content types already have a real player there — verify, don't assume).
6. Railway: confirm resource usage under a real render (video encoding + concat is heavier than
   a single carousel slide) — the PRD already flagged the Trial plan's 1GB RAM/2 vCPU cap as
   the likely first real constraint; this is the point where that gets confirmed or the plan
   gets bumped, not before.

## 7. Explicitly out of scope for this TRD (Phase 2+, per the PRD)

- Any AI video generation model (Veo, Kling, Seedance, HeyGen, avatars) — Phase 2/3.
- The "Product/UI demo" video type (PRD type 5) — needs a genuinely new gen.js template
  (screenshot pan/zoom/callouts), not just outline data in the existing 4 templates. A
  reasonable fast-follow once Phase 1's motion-graphics type is live and verified, but not
  bundled into this TRD's first slice — flagged here so it isn't silently assumed to ship free.
- Per-shot regenerate (only meaningful once real per-shot AI generation exists in Phase 2).
- `VIDEO_GENERATION_ENABLED`, the per-video spend ceiling, and the CLAUDE.md rule's actual
  *use* (it's narrowed already, per the PRD decision — but nothing in Phase 1 exercises that
  door yet, since there's no paid video model behind it).
