#!/usr/bin/env node
// ============================================================================
// Carousel Studio — server.js (the Railway render worker's HTTP entry point)
// ============================================================================
// Thin HTTP wrapper around gen.js + render.js's renderCarousel(), so the whole
// pipeline can be triggered by n8n instead of run by hand. See
// docs/carousel-studio-integration.md §7 Phase 0 for the design reasoning.
//
// Zero npm runtime dependencies, deliberately — same as every other file in
// this project (gen.js/render.js/serve.js). Node 18+'s built-in `fetch` talks
// directly to Supabase's REST/Storage HTTP APIs, matching this codebase's
// existing house convention of raw PostgREST calls (see CLAUDE.md: "Supabase
// upsert = ?on_conflict=<col> in URL + Prefer: resolution=merge-duplicates")
// rather than pulling in @supabase/supabase-js just for this.
//
// Endpoints:
//   GET  /health            -> "ok" (Railway health check + manual sanity check)
//   POST /render             body: { job_id, outline }
//                             Requires header X-Worker-Secret matching
//                             RENDER_WORKER_SECRET. Returns 202 immediately —
//                             the actual render (minutes) happens in the
//                             background; progress/result is reported to
//                             Supabase (the `carousel_jobs` row), NOT via this
//                             HTTP response, since the work outlives the
//                             request/response cycle by a wide margin.
//   POST /render-video       body: { job_id, outline, aspect_ratio, voiceover_url? }
//                             Video Studio Phase 1's route (docs/video-studio-trd.md §3c) — same
//                             X-Worker-Secret auth and 202-then-background pattern as /render,
//                             reusing gen.js/render.js's per-slide render UNCHANGED, but then
//                             concatenates + brand-stamps + aspect-crops into ONE final MP4
//                             (render.js's renderVideo()) instead of uploading per-slide clips.
//                             Reports to the `video_jobs` row, a separate table from `/render`'s
//                             `carousel_jobs` — the two routes never touch each other's rows.
//   POST /generate-video     body: { job_id, engine, shots, aspect_ratio, voiceover_url? }
//                             Video Studio Phase 2's route (docs/video-studio-trd-phase2.md §5) —
//                             same auth/202 pattern. Generates every shot via Veo (veo.js),
//                             uploading each raw clip as it lands (so a later /regenerate-shot
//                             call can be reused instead of re-paid-for), then assembles them
//                             through the SAME finalizeVideo() Phase 1 already built. Also
//                             reports to `video_jobs`.
//   POST /regenerate-shot    body: { job_id, shot_index, engine, shot, aspect_ratio }
//                             Re-generates exactly ONE shot and uploads it — does not re-run
//                             assembly. Mirrors AI Studio's per-slide regenerate.
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { generateCarousel } = require('./gen');
const { renderCarousel, renderVideo, generateAndAssembleVideo } = require('./render');
const { generateShot } = require('./veo'); // Video Studio Phase 2 only

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const WORKER_SECRET = process.env.RENDER_WORKER_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.CAROUSEL_STORAGE_BUCKET || 'carousel-media';
// Video Studio's final output is a finished, publishable asset like every other Studio's output
// (AI Studio, the blog composer) — content-media, not carousel-media, which is Carousel Studio's
// own dedicated bucket for its (intermediate-by-nature) per-slide clips.
const VIDEO_STORAGE_BUCKET = process.env.VIDEO_STORAGE_BUCKET || 'content-media';
// Every Video Studio output is brand-stamped, no opt-out (see render.js's finalizeVideo()) —
// checked into this repo at assets/brand/logo-white.png (copied from the main app's
// public/brand/logo-white.png, the same asset BlogPreview.tsx already uses for dark surfaces)
// so the Docker image's existing `COPY assets/ ./assets/` step ships it with zero Dockerfile
// changes.
const LOGO_PATH = path.join(ROOT, 'assets', 'brand', 'logo-white.png');
// RENDER_CONCURRENCY is obsolete — frames now come from a single persistent browser page
// rather than N parallel Chrome processes, so there's nothing to tune here. Left unread on
// purpose: the variable is still set on the deployed Railway service and removing the env var
// isn't required for correctness.

if (!WORKER_SECRET) console.warn('WARNING: RENDER_WORKER_SECRET is not set — /render is unauthenticated!');
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) console.warn('WARNING: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — job status/uploads will fail.');

async function uploadSlide(jobId, slideFile, localPath) {
  const objectPath = `${jobId}/${slideFile.replace(/\.html$/, '.mp4')}`;
  const data = fs.readFileSync(localPath);
  // PUT (not POST) + x-upsert so a retried/duplicate upload for the same job overwrites
  // cleanly instead of erroring — this endpoint can legitimately be called again if n8n
  // retries a request that actually did land the first time.
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: data,
  });
  if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
}

async function patchJob(jobId, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/carousel_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Job PATCH failed (${res.status}): ${await res.text()}`);
}

// Uploads the ONE final stitched video (render.js's renderVideo() output) — not a per-slide
// clip, so unlike uploadSlide() above there's exactly one call per job, not one per slide.
async function uploadFinalVideo(jobId, localPath) {
  const objectPath = `video-studio/${jobId}/final.mp4`;
  const data = fs.readFileSync(localPath);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${VIDEO_STORAGE_BUCKET}/${objectPath}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: data,
  });
  if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${VIDEO_STORAGE_BUCKET}/${objectPath}`;
}

// Same shape as patchJob() above, hitting `video_jobs` instead of `carousel_jobs` — the two
// job tables are otherwise unrelated, this is the only real difference.
async function patchVideoJob(jobId, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/video_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Job PATCH failed (${res.status}): ${await res.text()}`);
}

// Video Studio Phase 2 only — uploads ONE raw Veo shot clip so it can be reused (not
// regenerated, not re-paid-for) the next time this job's assembly step runs — see
// generateAndAssembleVideo()'s shot-reuse comment in render.js for why this matters.
async function uploadShotClip(jobId, shotIndex, localPath) {
  const objectPath = `video-studio/${jobId}/shots/shot-${String(shotIndex).padStart(2, '0')}.mp4`;
  const data = fs.readFileSync(localPath);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${VIDEO_STORAGE_BUCKET}/${objectPath}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: data,
  });
  if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${VIDEO_STORAGE_BUCKET}/${objectPath}`;
}

// Video Studio Phase 2 only — /regenerate-shot needs to read the job's current shots_json
// before patching just one entry (a Postgres jsonb PATCH replaces the whole column, it doesn't
// merge array elements, so the caller has to read-modify-write the full array).
async function fetchVideoJob(jobId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/video_jobs?id=eq.${jobId}&select=*`, {
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, apikey: SUPABASE_SERVICE_ROLE_KEY },
  });
  if (!res.ok) throw new Error(`Job fetch failed (${res.status}): ${await res.text()}`);
  const rows = await res.json();
  if (!rows[0]) throw new Error(`video_jobs row ${jobId} not found`);
  return rows[0];
}

function cleanupJobFiles(jobId) {
  fs.rmSync(path.join(ROOT, 'slides', jobId), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, 'output', jobId), { recursive: true, force: true });
}

// The actual work. Runs after the HTTP response is already sent — every outcome (progress,
// success, failure) is reported by writing to the `carousel_jobs` row, since nothing is left
// listening on the original HTTP connection by the time this matters.
async function runJob(jobId, outline) {
  const slideUrls = [];

  // Progress arrives once per captured frame (~100 per slide) — far too chatty to write straight
  // through to Postgres. Throttled to at most one write per PROGRESS_THROTTLE_MS, except for
  // phase changes (loading → capturing → encoding → uploading → slide_failed) which always write
  // immediately so the FE never sits on a stale phase label. Writes are fire-and-forget: a
  // dropped progress update is cosmetic and must never fail or slow the actual render.
  const PROGRESS_THROTTLE_MS = 1200;
  let lastProgressAt = 0;
  let lastPhase = null;
  let progressInFlight = false;
  const reportProgress = (progress) => {
    const now = Date.now();
    const phaseChanged = progress.phase !== lastPhase;
    if (!phaseChanged && now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
    if (progressInFlight && !phaseChanged) return;
    lastProgressAt = now;
    lastPhase = progress.phase;
    progressInFlight = true;
    patchJob(jobId, { render_progress: progress })
      .catch(() => {})
      .finally(() => { progressInFlight = false; });
  };

  try {
    await patchJob(jobId, {
      status: 'rendering',
      render_progress: { phase: 'starting', slideIndex: 0, slideTotal: outline.length },
    });

    generateCarousel(outline, jobId); // slug = job_id — keeps every job's slide files isolated

    const { failed } = await renderCarousel({
      slug: jobId,
      opts: { keepFrames: false, only: null },
      onProgress: reportProgress,
      onSlideDone: async (outfile, slide) => {
        const url = await uploadSlide(jobId, slide.file, outfile);
        slideUrls.push(url);
        // Written after EACH slide, not just at the end, so the FE shows slides landing one at
        // a time during a multi-minute render instead of one opaque wait.
        await patchJob(jobId, { slide_urls: slideUrls });
      },
    });

    if (failed.length > 0) {
      await patchJob(jobId, {
        status: 'failed',
        error_detail: `${failed.length} of ${outline.length} slide(s) failed to render: ${failed.join(', ')}`,
        slide_urls: slideUrls,
        render_progress: { phase: 'failed', slideTotal: outline.length, message: `${slideUrls.length} slide(s) completed before the failure` },
      });
    } else {
      await patchJob(jobId, {
        status: 'done',
        slide_urls: slideUrls,
        render_progress: { phase: 'done', slideIndex: outline.length, slideTotal: outline.length },
      });
    }
  } catch (err) {
    await patchJob(jobId, {
      status: 'failed',
      error_detail: err.message,
      render_progress: { phase: 'failed', message: err.message.slice(0, 300) },
    }).catch((e) =>
      console.error(`Job ${jobId}: also failed to write failure status:`, e.message),
    );
  } finally {
    // Server is stateless/ephemeral by design (fits Railway's scale-to-zero) — no reason to
    // keep a job's local files around once its results are uploaded.
    cleanupJobFiles(jobId);
  }
}

// Video Studio's job runner — same shape as runJob() above (progress throttling, try/catch/
// finally with cleanup), but ends in ONE final-video upload instead of N per-slide uploads, and
// writes to `video_jobs` via patchVideoJob() instead of `carousel_jobs`.
async function runVideoJob(jobId, outline, aspectRatio, voiceoverUrl) {
  const PROGRESS_THROTTLE_MS = 1200;
  let lastProgressAt = 0;
  let lastPhase = null;
  let progressInFlight = false;
  const reportProgress = (progress) => {
    const now = Date.now();
    const phaseChanged = progress.phase !== lastPhase;
    if (!phaseChanged && now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
    if (progressInFlight && !phaseChanged) return;
    lastProgressAt = now;
    lastPhase = progress.phase;
    progressInFlight = true;
    patchVideoJob(jobId, { render_progress: progress })
      .catch(() => {})
      .finally(() => { progressInFlight = false; });
  };

  try {
    await patchVideoJob(jobId, {
      status: 'rendering',
      render_progress: { phase: 'starting', slideIndex: 0, slideTotal: outline.length },
    });

    generateCarousel(outline, jobId); // slug = job_id, same isolation convention as runJob()

    // voiceoverUrl, when set, is a public Supabase Storage URL — passed straight through to
    // ffmpeg's own `-i` (which reads http/https URLs natively, no separate download step needed)
    // rather than fetched to local disk first.
    const { failed, finalVideoPath } = await renderVideo({
      slug: jobId,
      aspectRatio: aspectRatio || '9:16',
      logoPath: LOGO_PATH,
      voiceoverPath: voiceoverUrl || null,
      onProgress: reportProgress,
    });

    if (failed.length > 0) {
      await patchVideoJob(jobId, {
        status: 'failed',
        error_detail: `${failed.length} of ${outline.length} slide(s) failed to render: ${failed.join(', ')}`,
        render_progress: { phase: 'failed', slideTotal: outline.length, message: 'One or more slides failed before stitching could start' },
      });
    } else {
      const finalVideoUrl = await uploadFinalVideo(jobId, finalVideoPath);
      await patchVideoJob(jobId, {
        status: 'done',
        final_video_url: finalVideoUrl,
        render_progress: { phase: 'done', slideIndex: outline.length, slideTotal: outline.length },
      });
    }
  } catch (err) {
    await patchVideoJob(jobId, {
      status: 'failed',
      error_detail: err.message,
      render_progress: { phase: 'failed', message: err.message.slice(0, 300) },
    }).catch((e) =>
      console.error(`Video job ${jobId}: also failed to write failure status:`, e.message),
    );
  } finally {
    cleanupJobFiles(jobId);
  }
}

// ============================================================================
// Video Studio Phase 2 — generated-clips job runner
// ============================================================================
// Same shape as runVideoJob() above (progress throttling, try/catch/finally with cleanup), but
// the raw material is Veo-generated shots instead of locally-rendered slides, and shots_json is
// PATCHed incrementally as each shot finishes generating (not just the final render_progress),
// so the FE's storyboard can show each shot going pending -> generating -> done/failed in near
// real time, same discipline as Phase 1's per-slide slide_urls updates.
async function runGenerateVideoJob(jobId, shots, engine, aspectRatio, voiceoverUrl) {
  const PROGRESS_THROTTLE_MS = 1200;
  let lastProgressAt = 0;
  let lastPhase = null;
  let progressInFlight = false;
  const reportProgress = (progress) => {
    const now = Date.now();
    const phaseChanged = progress.phase !== lastPhase;
    if (!phaseChanged && now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
    if (progressInFlight && !phaseChanged) return;
    lastProgressAt = now;
    lastPhase = progress.phase;
    progressInFlight = true;
    patchVideoJob(jobId, { render_progress: progress })
      .catch(() => {})
      .finally(() => { progressInFlight = false; });
  };

  // Mutated in place as each shot resolves, then re-PATCHed whole (see fetchVideoJob's comment
  // on jsonb PATCH semantics) — this is the in-memory copy the worker itself tracks; it does not
  // re-read from Postgres between shots, since this worker is the only writer for this job while
  // it's running.
  let currentShots = shots;

  try {
    await patchVideoJob(jobId, {
      status: 'rendering',
      shots_json: currentShots,
      render_progress: { phase: 'starting', slideIndex: 0, slideTotal: currentShots.length },
    });

    const { failed, finalVideoPath } = await generateAndAssembleVideo({
      jobId,
      shots: currentShots,
      engine,
      aspectRatio: aspectRatio || '9:16',
      logoPath: LOGO_PATH,
      voiceoverPath: voiceoverUrl || null,
      onProgress: reportProgress,
      onShotDone: async (updatedShot, i) => {
        // `localPath` only appears on a freshly generated shot (a reused shot already has a
        // real clipUrl and nothing new to upload) — see generateAndAssembleVideo()'s comment in
        // render.js. Upload it here, then write the real public URL, never the local temp path.
        const { localPath, ...shotFields } = updatedShot;
        const clipUrl = localPath ? await uploadShotClip(jobId, i, localPath) : shotFields.clipUrl;
        currentShots = currentShots.map((s, idx) => (idx === i ? { ...s, ...shotFields, clipUrl } : s));
        await patchVideoJob(jobId, { shots_json: currentShots });
      },
    });

    if (failed.length > 0) {
      await patchVideoJob(jobId, {
        status: 'failed',
        error_detail: failed.join('; '),
        shots_json: currentShots,
        render_progress: { phase: 'failed', slideTotal: currentShots.length, message: 'One or more shots failed to generate' },
      });
    } else {
      const finalVideoUrl = await uploadFinalVideo(jobId, finalVideoPath);
      await patchVideoJob(jobId, {
        status: 'done',
        final_video_url: finalVideoUrl,
        shots_json: currentShots,
        render_progress: { phase: 'done', slideIndex: currentShots.length, slideTotal: currentShots.length },
      });
    }
  } catch (err) {
    await patchVideoJob(jobId, {
      status: 'failed',
      error_detail: err.message,
      render_progress: { phase: 'failed', message: err.message.slice(0, 300) },
    }).catch((e) =>
      console.error(`Generate-video job ${jobId}: also failed to write failure status:`, e.message),
    );
  } finally {
    cleanupJobFiles(jobId);
  }
}

// Re-generates exactly ONE shot (AI Studio's regenerateStudioSlide's shape, for shots) — does
// NOT re-run assembly; the user re-runs Approve & Render after fixing whichever shots they want
// fixed, same "review before the expensive step" discipline as everything else in this app. The
// regenerated clip is uploaded and its real URL written to shots_json, not discarded — that's
// what lets the next Approve & Render REUSE it instead of paying Veo for every shot again (see
// generateAndAssembleVideo()'s shot-reuse comment in render.js).
async function runRegenerateShot(jobId, shotIndex, engine, shot, aspectRatio) {
  try {
    const job = await fetchVideoJob(jobId);
    const shots = Array.isArray(job.shots_json) ? job.shots_json : [];
    const patched = (i, patch) => shots.map((s, idx) => (idx === i ? { ...s, ...patch } : s));

    await patchVideoJob(jobId, { shots_json: patched(shotIndex, { status: 'generating' }) });

    const outfile = path.join(ROOT, 'output', jobId, `shot-${String(shotIndex).padStart(2, '0')}-raw.mp4`);
    const { costUsd } = await generateShot({
      prompt: shot.prompt,
      engine,
      aspectRatio: aspectRatio || '9:16',
      durationS: shot.durationS,
      outfile,
    });
    const clipUrl = await uploadShotClip(jobId, shotIndex, outfile);
    fs.unlinkSync(outfile);
    await patchVideoJob(jobId, { shots_json: patched(shotIndex, { status: 'done', costUsd, clipUrl, errorDetail: null }) });
  } catch (err) {
    const job = await fetchVideoJob(jobId).catch(() => null);
    const shots = job && Array.isArray(job.shots_json) ? job.shots_json : [];
    const patched = shots.map((s, idx) => (idx === shotIndex ? { ...s, status: 'failed', errorDetail: err.message.slice(0, 300) } : s));
    await patchVideoJob(jobId, { shots_json: patched }).catch(() => {});
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (req.method === 'POST' && req.url === '/render') {
    if (WORKER_SECRET && req.headers['x-worker-secret'] !== WORKER_SECRET) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      return res.end('unauthorized');
    }

    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('invalid JSON body');
    }

    const { job_id, outline } = parsed;
    if (!job_id || !Array.isArray(outline) || outline.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('job_id (string) and outline (non-empty array) are required');
    }

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', job_id }));

    // Deliberately not awaited — the response above is the only thing the caller (n8n) waits
    // on. Failures from here on are reported via the job row, not this response.
    runJob(job_id, outline).catch((err) => console.error(`Job ${job_id} crashed unexpectedly:`, err));
    return;
  }

  if (req.method === 'POST' && req.url === '/render-video') {
    if (WORKER_SECRET && req.headers['x-worker-secret'] !== WORKER_SECRET) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      return res.end('unauthorized');
    }

    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('invalid JSON body');
    }

    const { job_id, outline, aspect_ratio, voiceover_url } = parsed;
    if (!job_id || !Array.isArray(outline) || outline.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('job_id (string) and outline (non-empty array) are required');
    }

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', job_id }));

    runVideoJob(job_id, outline, aspect_ratio, voiceover_url).catch((err) =>
      console.error(`Video job ${job_id} crashed unexpectedly:`, err),
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/generate-video') {
    if (WORKER_SECRET && req.headers['x-worker-secret'] !== WORKER_SECRET) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      return res.end('unauthorized');
    }

    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('invalid JSON body');
    }

    const { job_id, engine, shots, aspect_ratio, voiceover_url } = parsed;
    if (!job_id || !engine || !Array.isArray(shots) || shots.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('job_id (string), engine (string) and shots (non-empty array) are required');
    }

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', job_id }));

    runGenerateVideoJob(job_id, shots, engine, aspect_ratio, voiceover_url).catch((err) =>
      console.error(`Generate-video job ${job_id} crashed unexpectedly:`, err),
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/regenerate-shot') {
    if (WORKER_SECRET && req.headers['x-worker-secret'] !== WORKER_SECRET) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      return res.end('unauthorized');
    }

    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('invalid JSON body');
    }

    const { job_id, shot_index, engine, shot, aspect_ratio } = parsed;
    if (!job_id || typeof shot_index !== 'number' || !engine || !shot || !shot.prompt) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('job_id (string), shot_index (number), engine (string) and shot (object with prompt) are required');
    }

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', job_id, shot_index }));

    runRegenerateShot(job_id, shot_index, engine, shot, aspect_ratio).catch((err) =>
      console.error(`Regenerate-shot job ${job_id}/${shot_index} crashed unexpectedly:`, err),
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, () => console.log(`Carousel render worker listening on :${PORT}`));
