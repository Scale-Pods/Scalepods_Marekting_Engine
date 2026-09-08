#!/usr/bin/env node
// ============================================================================
// Carousel Studio — veo.js (Video Studio Phase 2: Veo 3.1 client)
// ============================================================================
// Thin, dependency-free client for Google's Gemini API video generation
// (Veo 3.1). Every field/endpoint here was confirmed against ai.google.dev's
// own docs directly (not a blog) — see docs/video-studio-trd-phase2.md §1 for
// the source. Node 18+'s built-in fetch, same house convention as server.js.
//
// Generation is a LONG-RUNNING OPERATION, not a synchronous call: POST kicks
// it off and returns an operation name immediately; the actual clip can take
// several minutes. This module owns the whole generate -> poll -> download
// sequence in real, testable Node code rather than an n8n polling loop (see
// the TRD §2 for why that split was chosen) — GEMINI_API_KEY lives here, as a
// worker env var, and nowhere else.
// ============================================================================

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Real model IDs, confirmed against ai.google.dev/gemini-api/docs/veo.
const MODEL_ID = {
  'veo-3.1-standard': 'veo-3.1-generate-preview',
  'veo-3.1-fast': 'veo-3.1-fast-generate-preview',
  'veo-3.1-lite': 'veo-3.1-lite-generate-preview',
};

// Real per-second pricing by resolution, confirmed against ai.google.dev/gemini-api/docs/pricing
// (2026-09-08) — Lite/Fast get genuinely cheaper at 720p, Standard does not (Google's own price
// table charges the same for 720p and 1080p on Standard). Duplicated here rather than imported —
// this worker is plain Node CJS with no build step, deployed as its own container, same
// convention TARGET_DIMENSIONS in render.js already uses. Keep this in sync by hand with
// src/lib/videoStudio.ts's and the ScalePods · Video Brief workflow's copies if Google's pricing
// changes. NOTE: the FE/n8n copies are still 1080p-only as of 2026-09-08 (no resolution picker
// exposed yet, per the TRD's own out-of-scope list) — this worker-side table is intentionally
// ahead of them, for the manual resolution override used in direct/manual test calls.
const PRICE_PER_SECOND = {
  'veo-3.1-lite': { '720p': 0.05, '1080p': 0.08 },
  'veo-3.1-fast': { '720p': 0.10, '1080p': 0.12, '4k': 0.30 },
  'veo-3.1-standard': { '720p': 0.40, '1080p': 0.40, '4k': 0.60 },
};

const POLL_INTERVAL_MS = 10000;
const MAX_POLL_MS = 10 * 60 * 1000; // 10 min — real Veo clips have taken this long in practice

/**
 * Tags a failure with a machine-readable prefix so the FE can render a specific, actionable
 * message instead of dumping raw Google error JSON at a marketer (see describeVideoError() in
 * src/lib/videoStudio.ts).
 *
 * The case that actually matters is billing: when the connected Google account runs out of
 * credit, the fix is "go add credit on this exact page", which is a completely different
 * response from "try again" — and the raw error says RESOURCE_EXHAUSTED, which means nothing to
 * anyone who isn't reading Google's API reference.
 */
function classifyVeoError(status, bodyText) {
  const body = String(bodyText || '');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|billing|insufficient|out of credit/i.test(body)) {
    return `QUOTA_EXCEEDED: ${body}`;
  }
  if (status === 401 || status === 403 || /API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(body)) {
    return `AUTH_FAILED: ${body}`;
  }
  if (/safety|blocked|policy|PROHIBITED_CONTENT/i.test(body)) {
    return `SAFETY_BLOCKED: ${body}`;
  }
  return body;
}

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on this worker — Video Studio Phase 2 cannot generate clips.');
  return key;
}

async function startGeneration({ prompt, engine, aspectRatio, durationS, resolution, negativePrompt }) {
  const modelId = MODEL_ID[engine];
  if (!modelId) throw new Error(`Unknown engine "${engine}" — expected one of ${Object.keys(MODEL_ID).join(', ')}`);
  if (!PRICE_PER_SECOND[engine][resolution]) {
    throw new Error(`"${resolution}" is not offered for ${engine} — expected one of ${Object.keys(PRICE_PER_SECOND[engine]).join(', ')}`);
  }
  // Veo only accepts 16:9 or 9:16 (confirmed, TRD §1) — the caller maps the job's real target
  // ratio to whichever of these two is closer; the assembly step's existing crop/pad (Phase 1's
  // finalizeVideo(), reused unchanged) handles turning that into the actual requested ratio.
  const veoAspect = aspectRatio === '16:9' ? '16:9' : '9:16';

  // Negative direction goes INSIDE the prompt text rather than as a separate API parameter.
  // Google's own prompting guide demonstrates exclusions phrased in the prompt itself ("a
  // desolate landscape with no buildings or roads"), and this endpoint's documented parameter
  // set is aspectRatio/resolution/durationSeconds/personGeneration only. After the durationSeconds
  // incident — where the docs' own example was formatted wrongly and cost us a failed call — an
  // unverified extra parameter is not worth a 400 on a paid request.
  const fullPrompt = negativePrompt
    ? `${prompt}\n\nDo not include: ${negativePrompt}.`
    : prompt;

  const res = await fetch(`${API_BASE}/models/${modelId}:predictLongRunning`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt: fullPrompt }],
      parameters: {
        aspectRatio: veoAspect,
        resolution,
        // A real live call corrected the docs here (2026-09-08): Google's own written example
        // showed this quoted ("4"|"6"|"8") but the real API rejects a string with
        // INVALID_ARGUMENT ("needs to be a number"). Send the actual number.
        durationSeconds: Number(durationS),
        personGeneration: 'allow_all',
      },
    }),
  });
  if (!res.ok) throw new Error(classifyVeoError(res.status, await res.text()));
  const body = await res.json();
  if (!body.name) throw new Error(`Veo generation request returned no operation name: ${JSON.stringify(body)}`);
  return body.name; // operation name, e.g. "models/veo-3.1-fast-generate-preview/operations/abc123"
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntilDone(operationName, onPoll) {
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > MAX_POLL_MS) {
      throw new Error(`TIMEOUT: Veo generation timed out after ${Math.round(MAX_POLL_MS / 1000)}s (operation ${operationName})`);
    }
    await sleep(POLL_INTERVAL_MS);
    // Fires once per tick so the caller can report "still working" -- a real Veo clip can take
    // several minutes, and with no signal in between the FE's progress display would otherwise
    // look identical to a hung request for that whole time.
    if (onPoll) onPoll();
    const res = await fetch(`${API_BASE}/${operationName}`, {
      headers: { 'x-goog-api-key': apiKey() },
    });
    if (!res.ok) throw new Error(classifyVeoError(res.status, await res.text()));
    const body = await res.json();
    if (body.error) throw new Error(classifyVeoError(body.error.code, body.error.message || JSON.stringify(body.error)));
    if (body.done) return body;
  }
}

async function downloadVideo(videoUri, outfile) {
  const res = await fetch(videoUri, { headers: { 'x-goog-api-key': apiKey() }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Veo video download failed (${res.status}): ${await res.text()}`);
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outfile, buf);
  return outfile;
}

/**
 * Generates one shot end-to-end: kick off -> poll -> download. Returns the local file path and
 * the shot's real cost (durationS * the engine's real per-second rate — the same number the FE
 * estimated before Approve & Generate, recomputed here from the actual engine/duration actually
 * used so `shots_json[i].costUsd` reflects what really happened, same discipline as this app's
 * other jobCostEstimate()-style "what did this actually cost" displays).
 */
async function generateShot({ prompt, engine, aspectRatio, durationS, outfile, onPoll, resolution = '1080p', negativePrompt }) {
  const operationName = await startGeneration({ prompt, engine, aspectRatio, durationS, resolution, negativePrompt });
  const result = await pollUntilDone(operationName, onPoll);
  const samples = result?.response?.generateVideoResponse?.generatedSamples;
  const videoUri = samples && samples[0] && samples[0].video && samples[0].video.uri;
  if (!videoUri) throw new Error(`Veo operation finished but returned no video URI: ${JSON.stringify(result)}`);
  await downloadVideo(videoUri, outfile);
  const costUsd = Math.round(durationS * PRICE_PER_SECOND[engine][resolution] * 100) / 100;
  return { localPath: outfile, costUsd };
}

module.exports = { generateShot, PRICE_PER_SECOND, MODEL_ID };
