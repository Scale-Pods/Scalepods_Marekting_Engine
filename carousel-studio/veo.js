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

// Real 1080p per-second pricing, confirmed against ai.google.dev/gemini-api/docs/pricing
// (2026-09-08). Duplicated here rather than imported — this worker is plain Node CJS with no
// build step, deployed as its own container, same convention TARGET_DIMENSIONS in render.js
// already uses. Keep this in sync by hand with src/lib/videoStudio.ts's copy if Google's
// pricing changes.
const PRICE_PER_SECOND = {
  'veo-3.1-lite': 0.08,
  'veo-3.1-fast': 0.12,
  'veo-3.1-standard': 0.40,
};

const POLL_INTERVAL_MS = 10000;
const MAX_POLL_MS = 10 * 60 * 1000; // 10 min — real Veo clips have taken this long in practice

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on this worker — Video Studio Phase 2 cannot generate clips.');
  return key;
}

async function startGeneration({ prompt, engine, aspectRatio, durationS }) {
  const modelId = MODEL_ID[engine];
  if (!modelId) throw new Error(`Unknown engine "${engine}" — expected one of ${Object.keys(MODEL_ID).join(', ')}`);
  // Veo only accepts 16:9 or 9:16 (confirmed, TRD §1) — the caller maps the job's real target
  // ratio to whichever of these two is closer; the assembly step's existing crop/pad (Phase 1's
  // finalizeVideo(), reused unchanged) handles turning that into the actual requested ratio.
  const veoAspect = aspectRatio === '16:9' ? '16:9' : '9:16';

  const res = await fetch(`${API_BASE}/models/${modelId}:predictLongRunning`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        aspectRatio: veoAspect,
        resolution: '1080p',
        durationSeconds: String(durationS),
        personGeneration: 'allow_all',
      },
    }),
  });
  if (!res.ok) throw new Error(`Veo generation request failed (${res.status}): ${await res.text()}`);
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
      throw new Error(`Veo generation timed out after ${Math.round(MAX_POLL_MS / 1000)}s (operation ${operationName})`);
    }
    await sleep(POLL_INTERVAL_MS);
    // Fires once per tick so the caller can report "still working" -- a real Veo clip can take
    // several minutes, and with no signal in between the FE's progress display would otherwise
    // look identical to a hung request for that whole time.
    if (onPoll) onPoll();
    const res = await fetch(`${API_BASE}/${operationName}`, {
      headers: { 'x-goog-api-key': apiKey() },
    });
    if (!res.ok) throw new Error(`Veo operation poll failed (${res.status}): ${await res.text()}`);
    const body = await res.json();
    if (body.error) throw new Error(`Veo generation failed: ${body.error.message || JSON.stringify(body.error)}`);
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
async function generateShot({ prompt, engine, aspectRatio, durationS, outfile, onPoll }) {
  const operationName = await startGeneration({ prompt, engine, aspectRatio, durationS });
  const result = await pollUntilDone(operationName, onPoll);
  const samples = result?.response?.generateVideoResponse?.generatedSamples;
  const videoUri = samples && samples[0] && samples[0].video && samples[0].video.uri;
  if (!videoUri) throw new Error(`Veo operation finished but returned no video URI: ${JSON.stringify(result)}`);
  await downloadVideo(videoUri, outfile);
  const costUsd = Math.round(durationS * PRICE_PER_SECOND[engine] * 100) / 100;
  return { localPath: outfile, costUsd };
}

module.exports = { generateShot, PRICE_PER_SECOND, MODEL_ID };
