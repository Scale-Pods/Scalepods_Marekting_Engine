#!/usr/bin/env node
// ============================================================================
// Carousel Studio — render.js (invoked via render.sh)
// ============================================================================
// For a generated carousel (slides/<slug>/, from gen.js): screenshots every
// frame of every slide with headless Chrome using the deterministic ?frame=
// &fps= seek gen.js's slides expose, then ffmpeg-encodes each slide's frame
// sequence into its own MP4. One MP4 per slide — carousels post as separate
// slide videos, not one merged clip.
//
// USAGE:
//   node render.js <slug> [--concurrency=3] [--keep-frames] [--only=<file>]
//
// ROBUSTNESS, per the brief ("low parallelism plus a retry pass for any
// dropped frames"):
//   - Frames are captured with a SMALL worker pool (default 3), not all at
//     once — each frame is a full headless Chrome process launch, and firing
//     dozens at once is how you get random crashes/timeouts, not speed.
//   - Every capture has a hard timeout (15s) so one hung Chrome process can't
//     stall the whole render.
//   - After the main pass, any frame file that's missing or suspiciously
//     small (a real screenshot of a filled 1080x1350 frame is never a few
//     hundred bytes) is treated as dropped and retried serially, up to 3
//     attempts each, before being reported as a hard failure.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { startServer } = require('./serve');

const ROOT = __dirname;
const PORT = 4174; // distinct from the interactive preview server's 4173, so both can run at once
const CHROME =
  process.env.CHROME_BIN ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MIN_VALID_PNG_BYTES = 3000; // a real 1080x1350 frame is always much bigger than this
const CAPTURE_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

function parseArgs(argv) {
  const slug = argv[2];
  // 5 ran clean (zero dropped frames) in testing on this machine and roughly halved render
  // time vs. 3 — still deliberately capped, not "as many as possible", per the brief.
  const opts = { concurrency: 5, keepFrames: false, only: null };
  for (const arg of argv.slice(3)) {
    if (arg.startsWith('--concurrency=')) opts.concurrency = parseInt(arg.split('=')[1], 10);
    else if (arg === '--keep-frames') opts.keepFrames = true;
    else if (arg.startsWith('--only=')) opts.only = arg.split('=')[1];
  }
  return { slug, opts };
}

function captureFrame(url, outfile) {
  return new Promise((resolve) => {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--force-device-scale-factor=1',
      '--allow-file-access-from-files',
      '--hide-scrollbars',
      '--window-size=1080,1350',
      // Each frame is a full fresh Chrome process launch — these trim startup work that's
      // pure overhead for a one-shot local screenshot (extensions, sync, network probing,
      // update checks, sandbox init) and measurably cut cold-start time in testing.
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-default-apps',
      '--disable-component-update',
      '--metrics-recording-only',
      '--mute-audio',
      `--screenshot=${outfile}`,
      url,
    ];
    const child = execFile(CHROME, args, { timeout: CAPTURE_TIMEOUT_MS }, (err) => {
      if (err) return resolve({ ok: false, error: err.message });
      const ok = fs.existsSync(outfile) && fs.statSync(outfile).size >= MIN_VALID_PNG_BYTES;
      resolve({ ok, error: ok ? null : 'missing or truncated output file' });
    });
    child.on('error', () => resolve({ ok: false, error: 'failed to spawn chrome' }));
  });
}

// Small concurrency-limited worker pool — deliberately not Promise.all(...map(...)), which
// would fire every capture at once regardless of the requested concurrency.
async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runOne));
  return results;
}

function ffmpegEncode(framesDir, fps, outfile) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    const args = [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(framesDir, 'frame-%05d.png'),
      '-c:v', 'libx264',
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

async function renderSlide(baseUrl, outDir, slide, fps, opts) {
  const slideName = slide.file.replace(/\.html$/, '');
  const frameCount = Math.max(1, Math.round(slide.durationS * fps));
  const framesDir = path.join(outDir, 'frames', slideName);
  fs.mkdirSync(framesDir, { recursive: true });

  const frameIndices = Array.from({ length: frameCount }, (_, i) => i);
  const frameFile = (i) => path.join(framesDir, `frame-${String(i).padStart(5, '0')}.png`);
  const frameUrl = (i) => `${baseUrl}/${slide.file}?frame=${i}&fps=${fps}`;

  console.log(`  ${slide.file}: capturing ${frameCount} frames (concurrency ${opts.concurrency})...`);
  let results = await runPool(
    frameIndices,
    (i) => captureFrame(frameUrl(i), frameFile(i)),
    opts.concurrency,
  );

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const dropped = frameIndices.filter((i) => !results[i].ok);
    if (dropped.length === 0) break;
    console.log(`  ${slide.file}: retry pass ${attempt} — ${dropped.length} dropped frame(s): [${dropped.join(', ')}]`);
    // Retried serially (concurrency 1) — dropped frames are usually a symptom of resource
    // contention from running several Chrome instances at once, so retrying them one at a
    // time is deliberately more likely to actually succeed than hammering them again in a pool.
    const retryResults = await runPool(dropped, (i) => captureFrame(frameUrl(i), frameFile(i)), 1);
    dropped.forEach((i, idx) => { results[i] = retryResults[idx]; });
  }

  const stillDropped = frameIndices.filter((i) => !results[i].ok);
  if (stillDropped.length > 0) {
    throw new Error(
      `${slide.file}: ${stillDropped.length} frame(s) never rendered after ${MAX_RETRIES} retries: ` +
      stillDropped.map((i) => `#${i} (${results[i].error})`).join(', '),
    );
  }

  const outfile = path.join(outDir, `${slideName}.mp4`);
  console.log(`  ${slide.file}: encoding -> ${path.relative(ROOT, outfile)}`);
  await ffmpegEncode(framesDir, fps, outfile);

  if (!opts.keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });

  return outfile;
}

// The reusable core, used by both the CLI (main(), below) and server.js's HTTP job runner.
// `opts.onSlideDone(outfile, slide)`, if given, fires after EACH slide finishes (encode +
// cleanup done) — server.js uses this to upload and update the job row slide-by-slide instead
// of waiting for the whole carousel, so the FE can show slides landing one at a time.
async function renderCarousel({ slug, opts, onSlideDone }) {
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

  console.log(`Starting render server on port ${PORT}...`);
  const server = await startServer(PORT);
  const baseUrl = `http://localhost:${PORT}/slides/${slug}`;

  const rendered = [];
  const failed = [];
  try {
    for (const slide of slides) {
      try {
        const outfile = await renderSlide(baseUrl, outDir, slide, manifest.fps, opts);
        rendered.push(outfile);
        if (onSlideDone) await onSlideDone(outfile, slide);
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
        failed.push(slide.file);
      }
    }
  } finally {
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
