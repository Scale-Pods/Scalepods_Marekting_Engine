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
// ============================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { generateCarousel } = require('./gen');
const { renderCarousel } = require('./render');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const WORKER_SECRET = process.env.RENDER_WORKER_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.CAROUSEL_STORAGE_BUCKET || 'carousel-media';
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

function cleanupJobFiles(jobId) {
  fs.rmSync(path.join(ROOT, 'slides', jobId), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, 'output', jobId), { recursive: true, force: true });
}

// The actual work. Runs after the HTTP response is already sent — every outcome (progress,
// success, failure) is reported by writing to the `carousel_jobs` row, since nothing is left
// listening on the original HTTP connection by the time this matters.
async function runJob(jobId, outline) {
  const slideUrls = [];
  try {
    await patchJob(jobId, { status: 'rendering' });

    generateCarousel(outline, jobId); // slug = job_id — keeps every job's slide files isolated

    const { failed } = await renderCarousel({
      slug: jobId,
      opts: { keepFrames: false, only: null },
      onSlideDone: async (outfile, slide) => {
        const url = await uploadSlide(jobId, slide.file, outfile);
        slideUrls.push(url);
        // Written after EACH slide, not just at the end, so the FE's poll can show slides
        // landing one at a time during an 11-minute render instead of one opaque wait.
        await patchJob(jobId, { slide_urls: slideUrls });
      },
    });

    if (failed.length > 0) {
      await patchJob(jobId, {
        status: 'failed',
        error_detail: `${failed.length} slide(s) failed to render: ${failed.join(', ')}`,
        slide_urls: slideUrls,
      });
    } else {
      await patchJob(jobId, { status: 'done', slide_urls: slideUrls });
    }
  } catch (err) {
    await patchJob(jobId, { status: 'failed', error_detail: err.message }).catch((e) =>
      console.error(`Job ${jobId}: also failed to write failure status:`, e.message),
    );
  } finally {
    // Server is stateless/ephemeral by design (fits Railway's scale-to-zero) — no reason to
    // keep a job's local files around once its results are uploaded.
    cleanupJobFiles(jobId);
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

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, () => console.log(`Carousel render worker listening on :${PORT}`));
