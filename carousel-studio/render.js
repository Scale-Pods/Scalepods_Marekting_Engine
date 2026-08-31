#!/usr/bin/env node
// ============================================================================
// Carousel Studio — render.js (invoked via render.sh)
// ============================================================================
// For a generated carousel (slides/<slug>/, from gen.js): screenshots every
// frame of every slide with headless Chrome, then ffmpeg-encodes each slide's
// frame sequence into its own MP4. One MP4 per slide — carousels post as
// separate slide videos, not one merged clip.
//
// USAGE:
//   node render.js <slug> [--keep-frames] [--only=<file>]
//
// ARCHITECTURE — one persistent browser, one page load per slide:
//   The original design launched a fresh `chrome --screenshot=... url?frame=N`
//   process for every single frame (~100/slide, ~600/carousel). That worked on
//   Windows but reliably killed a Linux container: orphaned Chrome helper
//   processes re-parent to PID 1 (the Node worker), which doesn't reap them,
//   so they piled up as zombies until every later fork failed permanently.
//   It also paid Chrome's cold start per frame, which dominated runtime.
//
//   Now the whole carousel shares ONE browser. Each slide loads its page once,
//   then seeks + screenshots per frame via the __seekFrame hook gen.js exposes.
//   Output is identical (each frame seeks by absolute progress, never relative)
//   with ~600x fewer processes and no per-frame cold start.
//
// ROBUSTNESS:
//   - Page load has a hard timeout so one hung slide can't stall the render.
//   - Any frame file that's missing or suspiciously small (a real 1080x1350
//     frame is never a few hundred bytes) counts as dropped and is retried,
//     up to 3 passes, before being reported as a hard failure.
//   - The browser is closed in a finally block, so a failure can't leak Chrome
//     into the long-lived worker process.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const puppeteer = require('puppeteer-core');
const { startServer } = require('./serve');

const ROOT = __dirname;
// NOT a fixed port — see renderCarousel() below. A hardcoded port here caused a real bug: two
// overlapping /render requests on the long-lived server.js worker both tried to bind the same
// port, and the second one failed outright with EADDRINUSE instead of queueing or coexisting.
const CHROME =
  process.env.CHROME_BIN ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIN_VALID_PNG_BYTES = 3000; // a real 1080x1350 frame is always much bigger than this
const CAPTURE_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

function parseArgs(argv) {
  const slug = argv[2];
  const opts = { keepFrames: false, only: null };
  for (const arg of argv.slice(3)) {
    if (arg === '--keep-frames') opts.keepFrames = true;
    else if (arg.startsWith('--only=')) opts.only = arg.split('=')[1];
    // --concurrency is accepted-and-ignored rather than rejected: it's baked into the deployed
    // server.js env (RENDER_CONCURRENCY) and this project's own docs. It no longer means
    // anything now that frames come from one page instead of N parallel processes.
    else if (arg.startsWith('--concurrency=')) { /* obsolete, see header */ }
  }
  return { slug, opts };
}

const CHROME_ARGS = [
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-sandbox',
  '--no-first-run',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-default-apps',
  '--disable-component-update',
  '--metrics-recording-only',
  '--mute-audio',
  // Containers default /dev/shm to 64MB and Chrome leans on it heavily — without this it
  // silently crashes or renders blank under memory pressure.
  '--disable-dev-shm-usage',
  // The crash reporter spawns chrome_crashpad_handler as a separate process. Under the old
  // process-per-frame design those handlers were the specific thing exhausting the container's
  // PID table (logs showed `posix_spawn .../chrome_crashpad_handler: Resource temporarily
  // unavailable`). Harmless to disable for a headless screenshot job, and one less thing to leak.
  '--disable-breakpad',
  '--disable-crash-reporter',
];

function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: CHROME_ARGS,
    protocolTimeout: 60000,
  });
}

function ffmpegEncode(framesDir, fps, outfile) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    const args = [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(framesDir, 'frame-%05d.png'),
      '-c:v', 'libx264',
      // Real bug hit on a resource-constrained host: libx264 defaults to spawning one encoder
      // thread per detected CPU (logged "threads=42" on a 2-vCPU Railway container) — on a host
      // already thread-starved from many sequential Chrome launches, that's enough to exhaust
      // the OS's process/thread limit and make ffmpeg itself fail with the WHOLE verbose stderr
      // banner as the error (a genuine failure, not just noisy logging). Cap it explicitly to a
      // small, safe number regardless of what the container's CPU count reports.
      '-threads', '2',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outfile,
    ];
    execFile('ffmpeg', args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

// Captures every frame of one slide from a SINGLE page load on an already-running browser.
//
// This replaced a process-per-frame design (`chrome --screenshot=... url?frame=N`) that spawned
// ~100 Chrome processes per slide, ~600 per carousel. On a container that reliably exhausted the
// PID table partway through — Chrome's orphaned helper processes are re-parented to PID 1 (our
// Node server), which doesn't reap them, so they accumulated as zombies until every subsequent
// fork failed permanently (`pthread_create: Resource temporarily unavailable`, `Cannot fork`).
// It also meant paying Chrome's full cold start for every single frame, which dominated runtime.
//
// Now: one page load per slide, then seek + screenshot in a loop via the __seekFrame hook
// gen.js exposes. Same deterministic output (absolute .progress() per frame, never relative),
// ~600x fewer processes, and no per-frame cold start.
async function renderSlide(browser, baseUrl, outDir, slide, fps, opts, onProgress) {
  const report = (patch) => { if (onProgress) onProgress(patch); };
  const slideName = slide.file.replace(/\.html$/, '');
  const frameCount = Math.max(1, Math.round(slide.durationS * fps));
  const framesDir = path.join(outDir, 'frames', slideName);
  fs.mkdirSync(framesDir, { recursive: true });

  const frameFile = (i) => path.join(framesDir, `frame-${String(i).padStart(5, '0')}.png`);

  console.log(`  ${slide.file}: capturing ${frameCount} frames...`);
  report({ phase: 'loading', frame: 0, frameTotal: frameCount });
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/${slide.file}`, { waitUntil: 'networkidle0', timeout: CAPTURE_TIMEOUT_MS });
    // Self-hosted fonts load as a real request but text can still paint with a fallback for a
    // beat after networkidle0 — waiting on document.fonts.ready makes frame 0 match every other
    // frame instead of occasionally shipping one frame in the fallback face.
    await page.evaluate(() => document.fonts.ready);

    const missing = [];
    report({ phase: 'capturing', frame: 0, frameTotal: frameCount });
    for (let i = 0; i < frameCount; i++) {
      await page.evaluate((frame, f) => window.__seekFrame(frame, f), i, fps);
      await page.screenshot({ path: frameFile(i) });
      // Same validity check as before — a real 1080x1350 frame is never this small, so a
      // truncated/blank write still gets caught rather than silently becoming a bad MP4.
      if (!fs.existsSync(frameFile(i)) || fs.statSync(frameFile(i)).size < MIN_VALID_PNG_BYTES) {
        missing.push(i);
      }
      report({ phase: 'capturing', frame: i + 1, frameTotal: frameCount });
    }

    // Retry pass, kept from the original design. Far less likely to trigger now that frames
    // don't each depend on a fresh process launch, but a dropped write is still a dropped write.
    for (let attempt = 1; attempt <= MAX_RETRIES && missing.length > 0; attempt++) {
      console.log(`  ${slide.file}: retry pass ${attempt} — ${missing.length} dropped frame(s): [${missing.join(', ')}]`);
      report({ phase: 'retrying', frame: frameCount - missing.length, frameTotal: frameCount, message: `Retrying ${missing.length} dropped frame(s) (pass ${attempt}/${MAX_RETRIES})` });
      const stillMissing = [];
      for (const i of missing) {
        await page.evaluate((frame, f) => window.__seekFrame(frame, f), i, fps);
        await page.screenshot({ path: frameFile(i) });
        if (!fs.existsSync(frameFile(i)) || fs.statSync(frameFile(i)).size < MIN_VALID_PNG_BYTES) {
          stillMissing.push(i);
        }
      }
      missing.length = 0;
      missing.push(...stillMissing);
    }

    if (missing.length > 0) {
      throw new Error(
        `${slide.file}: ${missing.length} frame(s) never rendered after ${MAX_RETRIES} retries: ` +
        missing.map((i) => `#${i}`).join(', '),
      );
    }
  } finally {
    // Closed per slide (not per carousel) so each slide's page memory is released as we go —
    // matters on a 1GB container where a long carousel would otherwise accumulate.
    await page.close().catch(() => {});
  }

  const outfile = path.join(outDir, `${slideName}.mp4`);
  console.log(`  ${slide.file}: encoding -> ${path.relative(ROOT, outfile)}`);
  report({ phase: 'encoding', frame: frameCount, frameTotal: frameCount });
  await ffmpegEncode(framesDir, fps, outfile);

  if (!opts.keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });

  return outfile;
}

// The reusable core, used by both the CLI (main(), below) and server.js's HTTP job runner.
//
// `onSlideDone(outfile, slide)` fires after EACH slide finishes (encode + cleanup done) —
// server.js uses this to upload and update the job row slide-by-slide instead of waiting for
// the whole carousel, so the FE can show slides landing one at a time.
//
// `onProgress(progress)` fires continuously *within* a slide (page load → each captured frame →
// encode). server.js throttles these into the job row's render_progress column so the FE can
// show what's actually happening during a multi-minute render rather than a blank spinner.
async function renderCarousel({ slug, opts, onSlideDone, onProgress }) {
  const slidesDir = path.join(ROOT, 'slides', slug);
  const manifestPath = path.join(slidesDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest at ${manifestPath} — run gen.js first.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const slides = opts.only ? manifest.slides.filter((s) => s.file === opts.only) : manifest.slides;
  if (slides.length === 0) {
    throw new Error(opts.only ? `No slide matching --only=${opts.only}` : 'Manifest has no slides.');
  }

  const outDir = path.join(ROOT, 'output', slug);
  fs.mkdirSync(outDir, { recursive: true });

  // Port 0 = OS assigns a free ephemeral port. Each renderCarousel() call gets its own —
  // required for the worker to survive two overlapping /render requests (see the note above).
  const server = await startServer(0);
  const port = server.address().port;
  console.log(`Starting render server on port ${port}...`);
  const baseUrl = `http://localhost:${port}/slides/${slug}`;

  const rendered = [];
  const failed = [];
  // ONE browser for the whole carousel — this is the change that took process spawns per
  // carousel from ~600 down to 1. Always closed in the finally block, including on a thrown
  // error, so a failed render can't leave an orphaned Chrome behind on a long-lived worker.
  let browser;
  try {
    browser = await launchBrowser();
    for (let idx = 0; idx < slides.length; idx++) {
      const slide = slides[idx];
      // Per-slide progress is enriched with carousel-level position here so the callback
      // receives one complete picture ("slide 2 of 6, frame 45 of 102") rather than the FE
      // having to stitch two sources together.
      const slideProgress = (patch) => {
        if (!onProgress) return;
        onProgress({
          slideIndex: idx + 1,
          slideTotal: slides.length,
          slideName: slide.file,
          ...patch,
        });
      };
      try {
        const outfile = await renderSlide(browser, baseUrl, outDir, slide, manifest.fps, opts, slideProgress);
        rendered.push(outfile);
        slideProgress({ phase: 'uploading' });
        if (onSlideDone) await onSlideDone(outfile, slide);
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
        failed.push(slide.file);
        // Surface the real reason to the FE rather than only the console — a slide that fails
        // mid-carousel otherwise looks identical to one still in progress.
        slideProgress({ phase: 'slide_failed', message: err.message.slice(0, 300) });
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }

  return { rendered, failed, outDir };
}

async function main() {
  const { slug, opts } = parseArgs(process.argv);
  if (!slug) {
    console.error('Usage: node render.js <slug> [--concurrency=3] [--keep-frames] [--only=<file>]');
    process.exit(1);
  }

  const { rendered, failed } = await renderCarousel({ slug, opts });

  console.log('');
  console.log(`Done: ${rendered.length}/${rendered.length + failed.length} slide(s) rendered.`);
  rendered.forEach((f) => console.log(`  ✓ ${path.relative(ROOT, f)}`));
  if (failed.length > 0) {
    console.log(`${failed.length} slide(s) failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

module.exports = { renderCarousel };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
