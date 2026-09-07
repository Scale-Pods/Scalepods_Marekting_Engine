# PRD — Video Studio (`/video-studio`)

**Status:** Approved, decisions locked 2026-09-08 · **Owner:** ScalePods (marketing@scalepods.co)
**Date:** 2026-09-04 · **Author:** Claude Code · **Next step:** [video-studio-trd.md](video-studio-trd.md) written, then build
**Relates to:** [AI Studio](../src/pages/AIStudio.tsx) · [carousel-studio-integration.md](carousel-studio-integration.md) · [PRD.md](PRD.md) §M6

## Decisions (2026-09-08, see §12 for the original options)

1. **Start at Phase 1** (motion graphics only — no AI video model, reuses the existing carousel
   renderer). Phase 2+ (real generated clips) comes later, not now.
2. **CLAUDE.md's manual-only video rule is narrowed as of this date** (see §0) — done, not just
   agreed. Video generation may now fire from an explicit human click in Video Studio behind a
   budget gate; still never auto-chained anywhere.
3. **Assembly route: FFmpeg on the existing Railway worker** (Carousel Studio's worker image —
   already has ffmpeg/Chrome/Supabase-upload/n8n-trigger auth). Shotstack stays the documented
   fallback if Railway cost/ops ever become the binding constraint.
4. **Per-video spend ceiling: deferred.** No AI-video generation exists yet at Phase 1, so there's
   nothing to gate — pick the real number (§8 proposed $5) when Phase 2 actually starts.
5. **fal.ai account creation: also deferred** — moot until Phase 2+; Phase 2 itself can run on the
   Google credential already in hand (§3.3) without a new vendor at all.

---

## 0. ⚠️ Blocking decision before anything is built — RESOLVED 2026-09-08, see above

`CLAUDE.md` currently carries this as a **non-negotiable**:

> **Video generation is MANUAL-ONLY.** HeyGen (founder avatar) and fal.ai Veo/Seedance are
> never wired to an FE button or an auto-chain. The Image Engine filter must match only
> `static_image | carousel | social_caption`.

**This PRD proposes reversing that rule.** A Video Studio *is* video generation behind an FE
button. Nothing here should be built until that's explicitly and deliberately overturned, because
the reason behind the rule is still real and gets *worse*, not better, at video prices:

| | AI Studio (today) | Video Studio (proposed) |
|---|---|---|
| Cost per click | ~$0.03–0.13 | **$2.20–$4.00** for one 30s video |
| Cost of a misfire | a wasted image | a wasted ~$3 |
| Blast radius of a loop bug | pennies | tens of dollars in minutes |

**Recommendation:** don't delete the rule — *narrow* it. Rewrite it as "video generation is
never auto-chained (no scheduler, no strategy auto-run, no batch); it fires only from an explicit
human click in Video Studio, behind a hard budget gate and a per-video cost confirmation." That
keeps the actual protection (no runaway spend) while allowing the product.

`GENERATION_ENABLED` is not enough on its own here — it's already `true` and covers images. This
needs its own flag (`VIDEO_GENERATION_ENABLED`) plus a real spend ceiling.

---

## 1. Purpose

Extend the Studio pattern from stills to motion. AI Studio turns a trend/strategy/topic into a
single image or a carousel; Video Studio turns the same three sources into a **short-form video
ready for Reels / Shorts / LinkedIn**, with the same "review before you spend" discipline, the
same brand stamping, and the same hand-off into Creative Review → Publishing.

The user-facing promise is identical to AI Studio's: *pick a source, pick a look, see the price,
review the plan before it costs anything, then generate.*

## 2. Goals & success criteria

- A marketer can produce a publishable 15–60s branded video without leaving Growth OS.
- **Nothing spends money before a human sees the plan and the price** — same rule as AI Studio.
- Output lands in Creative Review as a normal `ugc_video` / `motion_graphics` / `product_video`
  content item, so Review → Publishing works unchanged (those content types already exist in
  `src/lib/content.ts`).
- Every video is brand-stamped (logo + handles) automatically, like images are today.
- Real cost is shown in USD **and** INR before the button is clickable, and a hard budget ceiling
  makes an expensive mistake structurally impossible, not just unlikely.
- Existing infrastructure is reused, not duplicated (see §9).

**Non-goal:** competing with a human editor on a 3-minute brand film. This is short-form social.

---

## 3. Research findings — the 2026 video model landscape

All figures below were taken from each provider's **own** docs/pricing pages (per the standing
project rule: literal API strings and prices come from the vendor's own domain, never a blog —
the `gemini-3-pro-image-preview` mistake is why). Anything not vendor-confirmed is marked
**[verify]** and must be re-checked during the TRD.

### 3.1 The single most important constraint

**Every text→video and image→video model on the market caps at 4–15 seconds per call.**

| Model | Max clip | Native audio | Aspect ratios |
|---|---|---|---|
| Veo 3.1 | **8s** (4/6/8) | yes, synced dialogue | 16:9, 9:16 only |
| Kling 3.0 / 2.1 | **10s** (5/10) | no | 16:9, 9:16, 1:1 **[verify]** |
| Seedance 1.0 / 2.0 | **10s** (5/10) | 2.0 has native audio | **[verify]** |
| Wan 2.6 / 3.0 | **~15s** | **[verify]** | **[verify]** |

So the user's instinct is exactly right: **anything longer than ~10 seconds must be assembled
from multiple generated clips.** That assembly layer is not optional — it's the core of the
product, not a nice-to-have.

### 3.2 …with two long-form escape hatches that need no stitching

Both are avatar/talking-head only, and both are genuinely better than stitching for that format:

- **Kling AI Avatar v2** (`fal-ai/kling-video/ai-avatar/v2/standard` | `/pro`) — takes
  `image_url` + `audio_url`. **Output duration automatically matches the audio length.** Feed it
  a 45-second voiceover and you get a 45-second talking video in one call.
  $0.0562/s standard, $0.115/s pro.
- **HeyGen v3 Video Agent** — up to **5 minutes** per prompt. Already wired in this project
  (workflow `w2IytdHC2fIGpITM`, credential "Heygen API", founder avatar + voice IDs on file).
  avatar_iii ≈ $1/min, avatar_iv/v ≈ $4/min.

### 3.3 Provider comparison

| Route | Credential status | Breadth | Notes |
|---|---|---|---|
| **fal.ai** | ❌ needs creating (named in CLAUDE.md §10 as user-provided) | Veo 3.1, Kling 3.0, Seedance 2.5/2.0, Wan 3.0, LTX 2.3, PixVerse V6, MiniMax H3, Happy Horse, **plus avatar + lipsync + ElevenLabs** — 1000+ models, one key | **Recommended spine.** Uniform queue API, one credential, new models are one registry line |
| **Google direct (Veo)** | ✅ **already exists** ("Google AI Studio", `xVDIEwPOhjN8qAGQ`) | Veo 3.1 only | `veo-3.1-generate-preview`, `veo-3.1-lite-generate-preview`. Zero new credentials — cheapest possible v1 |
| **HeyGen** | ✅ already exists | Founder avatar, long-form | Keep for founder-led content |
| **Higgsfield** | ❌ none, and it burned us before | UGC/product presets, motion control | Public API docs are thin (no published model list). Previously hit a hard daily-limit wall mid-session. **Not recommended for v1** |
| **OpenAI Sora 2** | n/a | — | ⛔ **API shuts down 2026-09-24** (~3 weeks away). Do not build on it |

**Recommendation:** fal.ai as the primary registry (breadth + one credential + avatar/lipsync in
the same place), with the **existing Google credential as the zero-new-credential fallback** so
v1 can start before a fal key exists.

### 3.4 Audio

| Need | Option | Cost |
|---|---|---|
| Dialogue inside the clip | Veo 3.1 / Seedance 2.0 native audio | included |
| Voiceover track | ElevenLabs TTS | $0.10/1k chars (v3), $0.05/1k (Flash) — ~**$0.05 for a 30s VO** |
| Music bed | ElevenLabs Music | $0.30/min |
| Mixing / ducking / layering | assembly layer (§6) | free (self-hosted) |

Audio is a rounding error next to video generation. It should never be the thing we optimise.

### 3.5 What formats actually work (drives the "video type" picker)

For this audience (B2B, LinkedIn-primary, developer-first tone):

- **LinkedIn:** 30–60s tolerated and preferred; video gets ~3.2x the impressions of text posts.
- **Reels/Shorts:** 15–30s, vertical 9:16, fast cuts.
- **Highest-performing B2B formats:** founder hot-takes, 60-second tutorials, myth-busting,
  behind-the-scenes, customer-result snapshots.
- **Talking-head + text overlay consistently beats polished corporate video** — authenticity
  reads as trust. This matters: it means the *cheap* formats are also the *effective* ones.

---

## 4. Proposed video types (the "Look" equivalent)

AI Studio has 15 styles; Video Studio gets **6 types** at launch. Each one pins a recommended
model, a duration band, a shape, and whether it needs a voiceover — so the user picks an outcome,
not a model.

| # | Type | What it is | Default engine | Length | Needs VO |
|---|---|---|---|---|---|
| 1 | **Founder take** | Raunak's avatar delivering a hot-take to camera | HeyGen (existing) or Kling Avatar | 20–60s | yes (script) |
| 2 | **UGC testimonial** | A person-to-camera clip in the "filmed on a phone" register | Kling Avatar (image + VO) | 15–45s | yes |
| 3 | **Motion graphics / kinetic text** | Type, stats, and brand shapes animated — **no AI video model at all** | Existing HTML→frames→FFmpeg render path | 10–30s | optional |
| 4 | **B-roll + voiceover** | Generated cinematic shots cut to a VO track | Veo 3.1 / Seedance, multi-shot | 15–45s | yes |
| 5 | **Product/UI demo** | Real screenshots animated (pan/zoom/callouts) | Motion-graphics path + real assets | 15–45s | optional |
| 6 | **Hook cut / myth-buster** | 3–5 fast generated shots with big on-screen type | Veo/Kling multi-shot + overlay | 10–20s | optional |

Note that **types 3 and 5 use no video model at all** — they're the existing carousel-studio
render path (HTML + GSAP → frames → FFmpeg) pointed at a video template. Those are the *cheap,
unlimited-length, perfectly on-brand* types, and they should be the default, not an afterthought.

---

## 5. Product flow

Deliberately the same five steps as AI Studio, so nothing new has to be learned:

```
1. SOURCE      A live trend  |  The strategy  |  My own topic          <- identical to AI Studio
2. VIDEO TYPE  the 6 types above (tiles, like the style gallery)
3. SETTINGS    Platform · Shape (9:16 / 16:9 / 1:1 / 4:5) · Engine · Length · Voice
4. BRIEF       GPT writes: hook, script/VO, shot list, on-screen text, caption, hashtags
               ^ NOTHING SPENT YET - the whole storyboard is editable here
5. GENERATE    -> per-shot clips -> assembly (stitch + audio + brand) -> preview -> Send to Review
```

### Step 4 in detail — the storyboard is the review gate

This is the step that makes video affordable to get right. GPT returns a **shot list**, where
each shot is ≤ the engine's max clip length:

```
Shot 1 (0-8s)   prompt: "..."   on-screen: "Most ops teams..."
Shot 2 (8-16s)  prompt: "..."   on-screen: "...lose 5 hours a week"
Shot 3 (16-24s) prompt: "..."   on-screen: "Here's the fix"
Voiceover: "…full script…"   Music: subtle corporate bed   End card: logo + CTA
```

The user edits any shot's prompt, any on-screen line, and the VO script — then sees
**"Generate 3 shots · ≈ $2.88 (₹272)"**. One click, one confirmation, then it runs.

Per-shot regeneration works exactly like the carousel's per-slide regenerate that already
shipped: if shot 2 comes out wrong, re-roll **only shot 2** (~$0.96), not the whole video.

---

## 6. The assembly layer — the real decision

Everything after generation (stitch, trim, audio mix, logo, captions, aspect-crop) needs a real
video pipeline. Two viable routes, and the project already part-owns both:

| | **A. FFmpeg on the existing Railway worker** ✅ recommended | **B. Shotstack** |
|---|---|---|
| Status | **Already deployed.** `carousel-studio/` worker image already installs `ffmpeg`, already uploads to Supabase, already triggered by n8n behind `X-Worker-Secret` | **Credential already exists** in n8n ("shotstack render", 2 of them) |
| Marginal cost | $0 | per-minute render fee |
| Control | total (any filter, any overlay, any crop) | JSON timeline; whatever they expose |
| Risk | Railway Trial caps at **1GB RAM / 2 vCPU**, already forced `concurrency=1` for carousels. Video encoding is heavier → **needs a plan bump** | vendor dependency, less control |
| Institutional knowledge | high — we already hit and fixed the PID-exhaustion failure here | none |

**Recommendation: A**, with B kept as the documented fallback if Railway costs or ops burden
become the binding constraint. The worker gets renamed in role from "carousel render worker" to
"media render worker" and gains a `/render-video` endpoint. This is the single biggest reason
this project is cheaper to build than it looks.

The assembly layer also solves a real constraint from §3.1: **Veo only outputs 16:9 and 9:16.**
Instagram's 4:5 feed ratio has to come from a crop/pad step regardless of model — so we need
FFmpeg anyway, even for single-shot videos.

---

## 7. Branding

Images are stamped in-browser today (`src/lib/brandStamp.ts`, canvas) because the Supabase edge
function can't composite. That approach **cannot** be reused for video — it's per-frame work.

Video branding moves to the worker, as an FFmpeg filter chain: logo watermark (corner, safe-area
aware), optional lower-third handle bar, and a 1.5s end card built from the existing brand
tokens. Same visual result, different execution point. One consequence worth stating: **video
branding only exists server-side**, so a video that skips the worker is unbranded — the pipeline
must make that impossible rather than merely discouraged.

---

## 8. Cost model & guardrails

Illustrative 30-second video (4 shots × 8s), before assembly (assembly is free on route A):

| Engine | Per second | 32s of clips | + VO | **Total** |
|---|---|---|---|---|
| Motion graphics (no model) | — | $0 | $0.05 | **~$0.05** |
| Veo 3.1 **Lite** 1080p | $0.08 | $2.56 | $0.05 | **~$2.61** |
| Kling 3.0 standard | $0.07 | $2.24 | $0.05 | **~$2.29** |
| Veo 3.1 **Fast** 1080p | $0.12 | $3.84 | $0.05 | **~$3.89** |
| Veo 3.1 **Standard** 1080p | $0.40 | $12.80 | $0.05 | **~$12.85** ⚠️ |
| Kling Avatar (45s, std) | $0.0562 | $2.53 | $0.05 | **~$2.58** |
| HeyGen avatar_iii (45s) | $0.0167 | $0.75 | incl. | **~$0.75** |

That spread — **$0.05 to $12.85 for the same 30 seconds** — is the whole argument for the type
picker doing the model selection rather than exposing a raw model dropdown first.

**Mandatory guardrails (all of them, not a menu):**
1. `VIDEO_GENERATION_ENABLED` flag, separate from `GENERATION_ENABLED`.
2. **Hard per-video ceiling** (proposed default **$5**) — over it, the button is disabled, not
   just warned about.
3. **Explicit confirm dialog** stating the real USD+INR figure before the first spend.
4. **Daily/monthly spend ledger** with a cap, since a per-job estimate can't see cumulative
   burn. Precedent: the HeyGen workflow's existing Budget Gate.
5. Veo 3.1 **Standard** ships **disabled** by default — 5x the price of Fast for a marginal
   quality gain on social-sized output.

---

## 9. Build inventory — reuse vs. new

**Reused as-is (the reason this is ~a third the work it appears):**
- Source picker, brief-then-review UX, cost-estimate component, Recent grid + modal — all
  patterns already proven in `AIStudio.tsx`.
- The **Railway worker** (FFmpeg + Chrome + Supabase upload + secret auth + n8n trigger).
- The **carousel HTML→frames→MP4 renderer** — becomes the motion-graphics engine (types 3, 5).
- `content_items` already has `ugc_video` / `motion_graphics` / `product_video`, and
  `VIDEO_CONTENT_TYPES` is already defined. **Creative Review and Publishing need no changes.**
- Publishing already does real vertical video (Instagram Reels, YouTube Shorts).
- HeyGen pipeline + founder avatar/voice IDs.

**New:**
- `video_jobs` table (mirrors `studio_jobs`, plus a shot array).
- `src/lib/videoStudio.ts` — model registry (same shape as `IMAGE_MODELS`; `id` is the literal
  vendor endpoint string) + `VIDEO_TYPES`.
- `src/pages/VideoStudio.tsx` + storyboard editor.
- n8n: `sp-video-brief` (sync) + `sp-video-generate` (async) + `sp-video-regenerate-shot`.
- Worker: `/render-video` (concat, audio mix, brand overlay, aspect crop).
- ElevenLabs credential + fal.ai credential.
- `/manual` entry (standing rule: ships in the same piece of work).

---

## 10. Phasing

**Phase 1 — "cheap and safe first"** (no new AI-video vendor at all)
Motion graphics + product demo types, built on the existing renderer. Real videos, ~$0.05 each,
zero new credentials, and it proves the whole spine: storyboard → assembly → brand → Review.

**Phase 2 — generated clips**
Veo via the **existing Google credential**, multi-shot + stitching, per-shot regenerate.

**Phase 3 — avatar/UGC**
Kling Avatar + HeyGen long-form, ElevenLabs voices.

**Phase 4 — fal.ai breadth**
Swap in the fal registry for model choice (Kling/Seedance/Wan), image→video from AI Studio
output, video→video and lipsync-on-existing-footage.

Phase 1 is deliberately the one that ships without touching the CLAUDE.md rule at all, since it
generates no AI video.

## 11. Out of scope (v1)

- Timeline editing UI (we generate, we don't become a video editor).
- Auto-scheduling or auto-chaining video from strategy — **stays banned regardless.**
- Music licensing beyond ElevenLabs-generated beds.
- Subtitle burn-in (Phase 2+ — needs a transcription step).
- Higgsfield, Sora.

## 12. Open questions for sign-off — RESOLVED 2026-09-08

1. **The CLAUDE.md rule** — narrow it as proposed in §0, or keep video manual-only and stop here?
   → **Narrowed**, done (see the Decisions block up top and §0).
2. **Per-video ceiling** — is $5 right? And what monthly cap?
   → **Deferred to Phase 2** — nothing to gate yet at Phase 1.
3. **Assembly route** — FFmpeg-on-Railway (needs a paid plan bump) vs Shotstack (credential
   already there, per-render fee)?
   → **FFmpeg on Railway.**
4. **Start at Phase 1** (motion graphics, ~$0.05/video, no new vendor), or jump straight to
   Phase 2 (real Veo clips)?
   → **Phase 1.**
5. **fal.ai account** — create one now, or run Phase 2 on the existing Google credential only?
   → **Deferred** — moot at Phase 1; revisit when Phase 2 starts.

---

## Appendix — sources

Vendor-primary (used for all model IDs and prices):
- [Gemini API model list](https://ai.google.dev/gemini-api/docs/models) — `veo-3.1-generate-preview`, `veo-3.1-lite-generate-preview`
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) — Veo per-second rates, no free tier
- [fal Veo 3.1 API](https://fal.ai/models/fal-ai/veo3.1/api) — duration 4/6/8s, 16:9 & 9:16 only
- [fal Kling AI Avatar v2](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro) — image+audio, duration follows audio
- [fal marquee video models](https://fal.ai/explore/marquee-video-models) — current catalogue
- [HeyGen endpoint version comparison](https://developers.heygen.com/endpoint-version-comparison) — v1/v2 retire 2026-11-01
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- [Shotstack core concepts](https://shotstack.io/docs/guide/getting-started/core-concepts/)

Secondary (market/format context only, not used for any API fact):
- [Atlas Cloud 2026 video API comparison](https://www.atlascloud.ai/blog/guides/cheapest-ai-video-generation-api-2026) — incl. Sora 2 API sunset 2026-09-24
- [LinkedIn video formats for B2B 2026](https://info.parmonic.com/blog/linkedin-video-formats-in-2026-what-works-best-for-b2b-marketing)
- [Short-form video format data 2026](https://swarmify.com/blog/social-media-video-formats/)
