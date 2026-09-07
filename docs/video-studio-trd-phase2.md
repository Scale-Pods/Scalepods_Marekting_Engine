# TRD — Video Studio Phase 2 (generated clips)

**Status:** Draft, build started same session · **Date:** 2026-09-08 · **Author:** Claude Code
**Scope:** Phase 2 only, per [video-studio-prd.md](video-studio-prd.md)'s "Phase 2 decisions"
block — Veo 3.1 (Fast/Lite/Standard, all enabled), multi-shot storyboard, per-shot regenerate,
$5 hard per-video ceiling, no spend ledger yet.
**Relates to:** [video-studio-trd.md](video-studio-trd.md) (Phase 1 — everything here is
additive on top of it, nothing in Phase 1 changes) · [carousel-studio-integration.md](carousel-studio-integration.md)

---

## 1. Real API facts (fetched from ai.google.dev directly, per this project's own standing rule
—  literal API strings/prices come from the vendor's own domain, never a blog)

**Generation:**
```
POST https://generativelanguage.googleapis.com/v1beta/models/{modelId}:predictLongRunning
Header: x-goog-api-key: $GEMINI_API_KEY

{
  "instances": [{ "prompt": "<shot prompt>" }],
  "parameters": {
    "aspectRatio": "16:9" | "9:16",
    "resolution": "720p" | "1080p" | "4k",
    "durationSeconds": "4" | "6" | "8",
    "personGeneration": "allow_all" | "allow_adult"
  }
}
```
Returns an operation name immediately (this is a long-running op, not a sync response).

**Polling:**
```
GET https://generativelanguage.googleapis.com/v1beta/{operation_name}
Header: x-goog-api-key: $GEMINI_API_KEY
```
Poll until `"done": true`. Video URI is then at
`response.generateVideoResponse.generatedSamples[0].video.uri`.

**Download:** `GET {video_uri}` with the same header, follow redirects.

**Model IDs:** Standard `veo-3.1-generate-preview` · Fast `veo-3.1-fast-generate-preview` ·
Lite `veo-3.1-lite-generate-preview`.

**Real constraints that shape the design below:**
- `durationSeconds` only accepts `4 | 6 | 8` — a shot is never longer than 8s, confirming the
  PRD's §3.1 stitching requirement is mandatory, not a nice-to-have.
- `aspectRatio` only accepts `16:9 | 9:16` — never `1:1`/`4:5`. Any other target ratio the user
  picks (Instagram feed 4:5, etc.) has to come from the assembly layer's crop/pad step, exactly
  the same blurred-background-fill technique Phase 1's `finalizeVideo()` already does for
  motion-graphics slides. **No new crop logic needed — this is direct reuse.**
- 1,024 token prompt limit per shot — GPT's shot prompts need to stay well under this; not a
  real constraint in practice (shot prompts are one visual description, not a paragraph).

**Real 1080p pricing** (ai.google.dev/gemini-api/docs/pricing, confirms/refines the PRD §8
table which used these same figures):

| Engine | $/s (1080p) | One 8s shot | 4×8s shots |
|---|---|---|---|
| Lite | $0.08 | $0.64 | $2.56 |
| Fast | $0.12 | $0.96 | $3.84 |
| Standard | $0.40 | $3.20 | $12.80 |

With the locked **$5 hard per-video ceiling** and **all three tiers enabled** (per the PRD's
Phase 2 decisions — a deliberate divergence from §8's own "ship Standard disabled" default),
Standard is arithmetically usable for **one shot only** (≤8s, ≤$3.20) before the ceiling blocks
a second shot — the cap does its real job (no runaway spend) without needing to disable the
tier outright. This is a natural consequence of the numbers, not a separate rule to build.

## 2. Real credential gap — blocking, flagged 2026-09-08

`list_credentials` was checked live against the n8n project: **no Gemini/Veo-capable credential
exists.** The PRD §3.3's claim that "Google AI Studio" (`xVDIEwPOhjN8qAGQ`) already exists is
stale/wrong. The user needs to create a Gemini API key at aistudio.google.com (a **billing-
enabled** project — Veo has no free tier) and hand it to the worker as `GEMINI_API_KEY`.

**Architectural consequence, decided here:** rather than having n8n hold this credential and
orchestrate the generate→poll→download loop node-by-node (which n8n has no clean primitive for
— a multi-minute polling loop needs a Wait+loop-back pattern that's fragile to build correctly
in the graph builder), **the Railway worker holds `GEMINI_API_KEY` as an environment variable**
and does the whole generate→poll→download→assemble sequence in plain Node, using the exact same
"long background job, progress via DB PATCH" pattern `server.js` already runs for both
`/render` and `/render-video`. n8n's job stays exactly what it already is for Phase 1: fetch the
job row, POST it to the worker, respond immediately. This is a real design choice worth stating
plainly — it keeps the credential in one place, keeps the polling logic in real testable code
instead of an n8n graph, and adds zero new n8n node types.

## 3. Schema — `video_jobs` gets new nullable columns (Phase 1 rows untouched)

```sql
alter table public.video_jobs
  add column engine text,              -- 'veo-3.1-fast' | 'veo-3.1-lite' | 'veo-3.1-standard'; null for motion_graphics jobs
  add column shots_json jsonb,         -- VideoShot[] (Phase 2 jobs only; outline_json stays null for these)
  add column estimated_cost_usd numeric; -- shown before Generate is clickable; recomputed on every edit
```

`video_type` gets a new value **`'generated_clips'`** alongside the existing `'motion_graphics'`
default — this is the on/off switch for which code path (slide outline vs. shot storyboard) a
job follows, both server-side and in the FE. No migration needed for this — it's a free-text
column already.

**`VideoShot` shape** (mirrors `CarouselSlide`'s role for the motion-graphics path):
```ts
interface VideoShot {
  index: number
  prompt: string                  // Veo generation prompt — visual description only, no dialogue (see §4)
  onScreenText?: string           // optional caption burned in during assembly
  durationS: 4 | 6 | 8
  status: 'pending' | 'generating' | 'done' | 'failed'
  clipUrl: string | null          // raw Veo clip, uploaded to content-media once generated
  costUsd: number | null          // real cost, written by the worker once the shot is actually generated
  errorDetail?: string | null
}
```

**`content_type` mapping at Send to Review**: `'generated_clips'` jobs map to
`content_type: 'product_video'` — not `'ugc_video'`, since Veo B-roll is a produced/generated
shot, not literally user-generated content; `'ugc_video'`'s real meaning in this app is closer
to Kling Avatar/HeyGen output (Phase 3, not built). This is a real, documented judgment call
(both existing content_types were reused rather than adding a new one, per PRD §9's "content_
items needs no changes" instruction) — flagged here rather than silently assumed.

## 4. Audio — deliberately NOT using Veo's native audio in v1

Veo 3.1 supports native synced dialogue per-clip. Phase 2 v1 does **not** use it: shot prompts
are written as visual descriptions only ("no dialogue" is stated explicitly in the GPT system
prompt), and the video gets exactly one voiceover track for the whole thing — reusing Phase 1's
existing `finalizeVideo()` VO-mux path completely unchanged. Reasons: (1) per-shot native audio
would need per-shot volume/tone consistency across independently generated clips, a real quality
risk; (2) it collapses "does this video have audio" into the one mechanism Phase 1 already built
and verified live, instead of two. A real, flagged scope cut — native per-shot audio is a
plausible Phase 2.1 addition, not built now.

## 5. Worker changes (`carousel-studio/`)

**New file `veo.js`:**
```js
async function generateShot({ prompt, engine, aspectRatio, durationS }) {
  // 1. POST predictLongRunning with the real model ID for `engine`, real aspectRatio (16:9 or
  //    9:16 only -- caller maps the job's actual target ratio to whichever Veo ratio is closer,
  //    same "generate native, crop-to-target in assembly" reasoning as §1).
  // 2. Poll GET {operation_name} every 10s, up to a real max wait (~10 min) before giving up.
  // 3. Download the finished video via its URI to a local temp file.
  // 4. Return { localPath, costUsd: durationS * PRICE_PER_SECOND[engine] }.
}
module.exports = { generateShot, PRICE_PER_SECOND };
```
`PRICE_PER_SECOND` is the real 1080p table from §1, hardcoded here (this worker has no build
step / can't import from the main app — same duplication-with-a-comment convention
`TARGET_DIMENSIONS` already uses in `render.js`).

**`render.js` additions** (alongside, not replacing, `renderVideo()`/`stitchVideo()`):
```js
// Normalizes N raw Veo clips (which may differ slightly in exact resolution) to one consistent
// codec/resolution/fps and strips their audio (Phase 2 uses ONE whole-video voiceover, never
// per-shot native audio -- see TRD §4), then concats them with the same demuxer approach
// concatSlides() already uses. Reuses finalizeVideo() UNCHANGED for logo + VO + final crop --
// Veo's native 16:9/9:16 output feeds directly into the exact same blurred-fill technique
// Phase 1 built for 4:5 slides.
async function normalizeAndConcatClips(clipPaths, aspectRatio, outDir) { ... }

async function generateAndAssembleVideo({ shots, engine, aspectRatio, logoPath, voiceoverPath, onProgress, onShotDone }) {
  // For each shot: onProgress({phase:'shot_generating', shotIndex, shotTotal}) -> veo.generateShot()
  // -> onShotDone(shot, localClipPath, costUsd) so server.js can PATCH shots_json incrementally,
  // exactly like renderCarousel()'s onSlideDone does for Carousel Studio today.
  // Then: onProgress({phase:'stitching'}) -> normalizeAndConcatClips() -> finalizeVideo() (reused).
}
```

**`server.js` additions:** new route `POST /generate-video` (same `X-Worker-Secret` check,
same 202-then-background pattern as `/render-video`), body
`{ job_id, engine, shots, aspect_ratio, voiceover_url }`; new `runGenerateVideoJob()` mirroring
`runVideoJob()`'s shape — progress-throttled PATCHes to `video_jobs` (now including `shots_json`
per-shot updates as each clip lands, not just the whole-video `render_progress`), uploads the
one final file to `content-media` at the same `video-studio/<jobId>/final.mp4` convention,
writes `final_video_url`/`status`.

**New env var, not yet set:** `GEMINI_API_KEY` — real blocker, see §2.

## 6. n8n changes

**`ScalePods · Video Brief`** (existing, extended — not a new workflow): `Normalize Input` gains
`videoType` (`'motion_graphics' | 'generated_clips'`) and, when `'generated_clips'`, `engine`
and `shotCount`. `Build GPT Request`'s Code node branches its system prompt on `videoType`:
the existing slide-outline prompt (unchanged) for `'motion_graphics'`, or a new shot-list prompt
for `'generated_clips'` — GPT returns `shots: VideoShot[]` (prompt + onScreenText + durationS
per shot, cover-to-CTA arc same as the slide version, no dialogue per §4) instead of `slides`.
`Build Job Row` branches its parse/validate logic the same way and writes `engine`,
`shots_json`, `estimated_cost_usd` (computed here from `shotCount × durationS × PRICE_PER_
SECOND[engine]`, same table as the worker's, so the number the user reviews in the brief step
matches what the worker will actually charge) instead of `outline_json`.

**`ScalePods · Video Render`** (existing, extended): after `Fetch Job`, one new `IF` node
(`Fetch Job → Is Generated Clips? → onTrue: POST /generate-video, onFalse: POST /render-video`
— the existing Phase 1 branch, unchanged) checking `$json.engine` is non-null. Everything else
(secret credential, 202-respond-immediately shape) is identical to Phase 1.

**Per-shot regenerate**: a new, small workflow `ScalePods · Video Regenerate Shot` — near-copy
of `Video Render`'s new branch, `POST /webhook/sp-video-regenerate-shot {jobId, shotIndex}` →
fetch job → POST `{job_id, shotIndex, engine, shot: shots_json[shotIndex], aspect_ratio}` to a
new worker route `/regenerate-shot` (re-generates just that one shot via `veo.generateShot()`,
PATCHes only that shot's entry in `shots_json`, does **not** re-run assembly — the user re-runs
Approve & Render after fixing all the shots they want fixed, same "review before the expensive
step" discipline as everything else in this app). Mirrors AI Studio's
`regenerateStudioSlide`/`sp-studio-regenerate-slide` pattern exactly.

## 7. Frontend

**`VIDEO_GENERATION_ENABLED`** (new flag, `src/lib/content.ts`, separate from
`GENERATION_ENABLED` per PRD §0/§8) — **ships `false`.** Per this project's own CLAUDE.md rule
("keep credit-safety flags false until a stage is being demoed/used") and the real fact that no
`GEMINI_API_KEY` exists yet: flipping it true is a real action for the user to take once the
Railway env var is set, not something to default on speculatively.

**Cost estimate & hard ceiling** (`src/lib/videoStudio.ts`): `estimateShotsCost(engine, shots)`
using the real §1 price table; the Approve & Generate button shows the live total
("≈ $3.84 (₹362)") and is **disabled**, not just warned, above **$5** — matches PRD §8's
"structurally impossible, not just unlikely" bar. Recomputed on every shot edit (duration
change, added/removed shot) so the number on the button is never stale.

**Confirm dialog**: one click on Approve & Generate opens a small modal restating the real
USD+INR figure and requiring a second explicit click — PRD §8 guardrail #3. This is the one
place in Video Studio Phase 2 where a real, non-trivial dollar amount is about to be spent in
one shot (Phase 1's GPT-only brief step never needed this; Phase 2's render step does).

**Storyboard editor**: replaces the slide editor for `'generated_clips'` jobs — one card per
shot (prompt textarea, on-screen text input, duration select 4/6/8s, live per-shot cost, remove
button), same visual language as Phase 1's `SlideEditor`. **Per-shot regenerate** button on any
`done`/`failed` shot once the video is in `rendering`/`done` state — fires
`sp-video-regenerate-shot`, only that shot's card shows a spinner, matching AI Studio's carousel
per-slide regenerate UX exactly.

**Video-type picker**: step 2 gains a second tile, "Generated clips (AI video)" next to
"Motion graphics" — disabled with an explanatory tooltip while `VIDEO_GENERATION_ENABLED` is
false, so the UI is honest about what's actually usable right now rather than offering a button
that silently fails.

**New render-progress phases** (`src/lib/carousels.ts`, extending the union Phase 1 already
added `'stitching'` to): `'shot_generating'` (shows "Shot 2/4 — generating…"),
`'shot_polling'` (shows "Shot 2/4 — Veo is rendering…"). `overallProgress()` blends shot
completion the same way it already blends slide completion.

## 8. Build order

1. `video_jobs` migration (§3) — additive, zero risk to Phase 1 rows.
2. Worker: `veo.js`, `render.js` additions, `server.js` `/generate-video` + `/regenerate-shot`
   routes. **Cannot be tested against the real Veo API without `GEMINI_API_KEY`** (real,
   flagged gap) — verified instead with a structural test: real sample clips standing in for
   "already-generated Veo shots," proving `normalizeAndConcatClips()` + the reused
   `finalizeVideo()` actually produce a correct single MP4. The Veo call path itself
   (`generateShot()`) gets a real live test only once the credential exists.
3. n8n: extend `Video Brief` and `Video Render`, add `Video Regenerate Shot`.
4. FE: `VIDEO_GENERATION_ENABLED` flag, cost estimator, storyboard editor, confirm dialog,
   video-type picker, new progress phases.
5. `npx tsc --noEmit` clean.
6. Real end-to-end verification — **blocked on `GEMINI_API_KEY`**, done as a follow-up once the
   user has added it.

## 9. Explicitly out of scope for this TRD

- The daily/monthly spend ledger (PRD §8 guardrail #4) — locked as "not built yet" in the PRD's
  Phase 2 decisions. Per-video ceiling only.
- Native per-shot Veo audio (§4).
- fal.ai, Kling Avatar, HeyGen long-form (Phase 3/4 per PRD §10).
- A resolution picker — hardcoded 1080p for v1, matching the PRD's own cost table.
