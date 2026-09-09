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
const { generateShot } = require('./veo'); // Video Studio Phase 2 only — used by generateAndAssembleVideo() below

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

// ============================================================================
// Video Studio — stitching multiple per-slide MP4s into ONE continuous video
// ============================================================================
// renderCarousel() above is completely UNMODIFIED by any of this — Carousel Studio's own output
// is deliberately one MP4 per slide (Instagram carousels post as separate slide videos), and
// stays exactly that. Video Studio needs the opposite: one continuous file. This is new work
// layered on top of the same per-slide render, not a change to it.
//
// Target dimensions mirror this app's own AspectRatio type (src/lib/studioStyles.ts) — duplicated
// here (not imported) since this worker is plain Node CJS with no build step, deployed as its
// own container separate from the Vite/TS app. Keep in sync by hand if AspectRatio's ratio set
// ever changes. Values are real social-video conventions (1080-wide/tall on the short edge),
// not derived from the image-generation SIZE_BY_RATIO maps used elsewhere in this project —
// video and image size conventions differ and shouldn't be conflated.
const TARGET_DIMENSIONS = {
  '1:1': [1080, 1080],
  '4:5': [1080, 1350], // native slide resolution (render.js:149) -- no scaling needed for this one
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
  '4:3': [1440, 1080],
  '3:2': [1620, 1080],
};

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

// Whether a file carries a real audio stream. Veo 3.1 always generates audio (Google's own model
// table lists it as "Always on" for Lite, Fast and Standard alike), so in practice this is true
// for every generated shot — but the concat demuxer requires every segment to have an IDENTICAL
// stream layout, so one silent clip slipping through would break the whole render rather than
// just that shot. Cheap check, avoids a hard failure.
function hasAudioStream(input) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', input],
      (err, stdout) => resolve(!err && String(stdout).trim().length > 0),
    );
  });
}

// Step 1: join same-codec MP4s with the concat DEMUXER (`-c copy`, no re-encode) — the standard
// way to join clips that already share codec/resolution/framerate, which every slide here does,
// since they all come from the identical ffmpegEncode() above. Re-encoding filters (scale/crop/
// overlay) can't run in the same ffmpeg invocation as `-c copy`, so this has to be its own step.
async function concatSlides(slideFiles, outDir) {
  const listPath = path.join(outDir, 'concat-list.txt');
  // ffmpeg's concat-demuxer list format single-quotes each path and needs its OWN escaping for
  // any literal single quote in the path — Windows/Linux temp paths here never contain one, but
  // escaping unconditionally costs nothing and avoids a real (if unlikely) file-list corruption.
  const listBody = slideFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listPath, listBody);
  const outfile = path.join(outDir, 'concatenated.mp4');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outfile]);
  return outfile;
}

// Step 2: one filter_complex pass doing everything the re-encode actually needs:
//   - scale/crop the concatenated 1080x1350 video to fill the TARGET aspect ratio's frame with a
//     blurred, scaled-up copy of itself, rather than plain black bars or a lossy edge-crop of the
//     real content. Content composed for 4:5 (the templates' native shape) would lose real
//     text/layout if simply center-cropped into e.g. 9:16 — this is the standard "blurred
//     background fill" technique (split into a blurred fill-the-frame layer + the real content
//     scaled to fit *within* the frame, centered on top), not a shortcut.
//   - burns in the brand logo, bottom-right corner, safe-area padded.
//   - handles audio three ways, depending on what the source actually has:
//       * Phase 1 slides (hasSourceAudio false, no VO): silent, exactly as before. Chrome runs
//         with --mute-audio and ffmpegEncode() never maps an audio stream, so there is genuinely
//         nothing to keep.
//       * Phase 1 slides + VO: the voiceover becomes the only track, with `-shortest` so there's
//         no silent tail or clipped narration either way. Unchanged behaviour.
//       * Phase 2 Veo clips (hasSourceAudio true): Veo's OWN generated audio is kept — it is
//         always on and already paid for. With a voiceover on top, the native track is ducked
//         under the narration and mixed rather than thrown away, so ambience and SFX survive
//         beneath the voice.
async function finalizeVideo({ concatenatedPath, aspectRatio, logoPath, voiceoverPath, musicPath, outfile, hasSourceAudio = false }) {
  const [tw, th] = TARGET_DIMENSIONS[aspectRatio] || TARGET_DIMENSIONS['9:16'];
  const logoW = Math.round(tw * 0.22);
  const margin = Math.round(tw * 0.04);
  const videoFilters = [
    '[0:v]split=2[bg][fg]',
    `[bg]scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},gblur=sigma=24[bgblur]`,
    `[fg]scale=${tw}:${th}:force_original_aspect_ratio=decrease[fgscaled]`,
    '[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2[framed]',
    `[1:v]scale=${logoW}:-1[logo]`,
    `[framed][logo]overlay=W-w-${margin}:H-h-${margin}[outv]`,
  ];

  // ---- Audio ------------------------------------------------------------------------------
  // Up to three layers, mixed into one continuous track across the whole finished video:
  //
  //   voiceover  the message, always on top
  //   music      a continuous bed. This is what actually fixes the discontinuity problem: Veo
  //              generates each shot independently, so its per-shot room tone jumps at every cut.
  //              A bed running the full length masks those seams instead of leaving them exposed.
  //   native     Veo's own per-shot audio — real ambience and SFX, already paid for, kept low
  //              underneath rather than discarded.
  //
  // Levels are set relative to whatever else is playing: the voice always wins, and the bed only
  // comes forward when there is no voice to sit under.
  const inputs = [concatenatedPath, logoPath];
  const voIndex = voiceoverPath ? inputs.push(voiceoverPath) - 1 : -1;
  const musicIndex = musicPath ? inputs.push(musicPath) - 1 : -1;

  const nativeLevel = voiceoverPath ? 0.10 : musicPath ? 0.30 : 1.0;
  const musicLevel = voiceoverPath ? 0.15 : 0.55;

  const layers = [];
  if (hasSourceAudio) { videoFilters.push(`[0:a]volume=${nativeLevel}[anative]`); layers.push('[anative]'); }
  if (voIndex >= 0) { videoFilters.push(`[${voIndex}:a]volume=1.0[avo]`); layers.push('[avo]'); }
  if (musicIndex >= 0) { videoFilters.push(`[${musicIndex}:a]volume=${musicLevel}[amusic]`); layers.push('[amusic]'); }

  // Only the plain "keep exactly what Veo generated" case skips the filter graph entirely — it is
  // the already-verified path and there is nothing to mix.
  const nativeOnly = layers.length === 1 && hasSourceAudio;
  if (layers.length > 0 && !nativeOnly) {
    // apad runs the mix out with silence so a short voiceover or bed never truncates the video;
    // `-shortest` below then ends the file at the video, so a long one never extends it either.
    const mix = layers.length > 1
      ? `${layers.join('')}amix=inputs=${layers.length}:duration=longest:dropout_transition=0,apad[outa]`
      : `${layers[0]}apad[outa]`;
    videoFilters.push(mix);
  }

  const args = ['-y'];
  for (const input of inputs) args.push('-i', input);
  args.push('-filter_complex', videoFilters.join(';'), '-map', '[outv]');

  const hasAnyAudio = layers.length > 0;
  if (nativeOnly) {
    args.push('-map', '0:a');
  } else if (hasAnyAudio) {
    args.push('-map', '[outa]', '-shortest');
  }

  args.push(
    '-c:v', 'libx264',
    // Same rationale as ffmpegEncode() above — a small container's real thread/process budget
    // gets exhausted fast if ffmpeg defaults to one encoder thread per (over-)reported CPU.
    '-threads', '2',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
  );
  if (hasAnyAudio) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push(outfile);

  await runFfmpeg(args);
  return outfile;
}

// The reusable core for Video Studio, mirroring renderCarousel()'s shape and reusing it directly
// (same outline format, same per-slide render — gen.js/renderSlide() need ZERO changes for this),
// then layers the concat + finalize steps above on top. `logoPath` is required — every Video
// Studio output is brand-stamped, no opt-out, matching how every other Studio in this app
// auto-stamps its output. `voiceoverPath` is optional.
//
// Deliberately does NOT pass onSlideDone through to renderCarousel() — that callback exists so
// server.js's carousel job runner can upload+report each slide individually as its own asset,
// which Video Studio doesn't want (only the final stitched file is a real asset here). The
// per-slide MP4s stay on local disk in outDir and are consumed directly by concatSlides() before
// cleanup, never uploaded.
async function renderVideo({ slug, aspectRatio, logoPath, voiceoverPath, onProgress }) {
  const { rendered, failed, outDir } = await renderCarousel({
    slug,
    opts: { keepFrames: false, only: null },
    onProgress,
  });

  if (failed.length > 0) {
    return { failed, outDir, finalVideoPath: null };
  }

  if (onProgress) onProgress({ phase: 'stitching' });
  const concatenated = await concatSlides(rendered, outDir);
  const outfile = path.join(outDir, 'final.mp4');
  await finalizeVideo({ concatenatedPath: concatenated, aspectRatio, logoPath, voiceoverPath, outfile });

  return { failed: [], outDir, finalVideoPath: outfile };
}

// ============================================================================
// Video Studio Phase 2 — assembling AI-generated shots (Veo) into one video
// ============================================================================
// Everything below is new on top of the Phase 1 section above; nothing above this line is
// touched. renderVideo()/stitchVideo() (Phase 1, motion-graphics slides rendered locally by
// Chrome) and generateAndAssembleVideo() (Phase 2, clips generated remotely by Veo) are two
// independent entry points that both end by calling the SAME finalizeVideo() — the blurred-fill
// crop + logo overlay + optional voiceover mux is identical either way, only how the raw clips
// were produced differs. See docs/video-studio-trd-phase2.md §5.

// Veo shots may differ slightly in exact output resolution/fps between calls (a real, observed
// characteristic of generative video, unlike Chrome's byte-identical deterministic frames), so
// unlike concatSlides() above (which can safely `-c copy` same-codec files), each raw clip is
// individually re-encoded to the target dimensions FIRST. Audio is stripped here too — Phase 2
// deliberately uses one whole-video voiceover track rather than each shot's own native Veo audio
// (TRD §4), so there is nothing to preserve per-clip.
//
// Frame rate is forced to TARGET_FPS as well as resolution — caught by a real structural test
// (docs/video-studio-trd-phase2.md §8 step 2) using two synthetic clips at 24fps/30fps: without
// this, the concat demuxer's `-c copy` step below blindly copies packets from streams at two
// different frame rates into one container, corrupting the real playback timing (the combined
// file's reported duration came out wrong and the second shot played at the wrong speed). Every
// clip must share an identical fps before `-c copy` concat is valid, not just identical
// resolution/codec.
const TARGET_FPS = 30; // matches this app's own slide renders (gen.js/render.js's Phase 1 path)

// Debian's fonts-liberation package, already installed in the Dockerfile for Chromium's sake.
// Overridable so a non-container environment can point at whatever it has; when the file is
// missing we skip the text overlay entirely rather than failing the whole render for a caption.
const OVERLAY_FONT = process.env.OVERLAY_FONT || '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';

// ffmpeg filter arguments are colon-delimited and backslash-escaped, which makes Windows paths
// ("G:\work\...") and any real sentence ("Here's the fix: automate it") a parsing minefield.
// Passing the caption via `textfile=` sidesteps text escaping completely, and this handles the
// remaining path escaping for both platforms.
function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// Veo cannot spell — it renders text as convincing-looking gibberish, which is worse than no text
// at all on a brand asset. So every on-screen word in a Video Studio output is drawn HERE, by
// ffmpeg, from the exact string the user reviewed. Same reasoning as the logo being burned in
// rather than generated.
//
// Wrapped by hand because drawtext has no word-wrap: a long caption would otherwise run off both
// edges of a 1080-wide frame.
function wrapCaption(text, maxCharsPerLine = 26) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= maxCharsPerLine) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4).join('\n'); // 4 lines is already a lot of frame; hard-stop rather than cover the video
}

async function normalizeClip(clipPath, aspectRatio, outfile, onScreenText) {
  const [tw, th] = TARGET_DIMENSIONS[aspectRatio] || TARGET_DIMENSIONS['9:16'];
  const filters = [
    `scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}`,
    `fps=${TARGET_FPS}`,
  ];

  const caption = onScreenText && String(onScreenText).trim();
  if (caption && fs.existsSync(OVERLAY_FONT)) {
    const textPath = `${outfile}.caption.txt`;
    fs.writeFileSync(textPath, wrapCaption(caption), 'utf8');
    const fontSize = Math.round(tw * 0.058);
    const lineSpacing = Math.round(fontSize * 0.35);
    filters.push(
      [
        `drawtext=fontfile='${escapeFilterPath(OVERLAY_FONT)}'`,
        `textfile='${escapeFilterPath(textPath)}'`,
        'fontcolor=white',
        `fontsize=${fontSize}`,
        `line_spacing=${lineSpacing}`,
        'box=1',
        'boxcolor=black@0.55',
        `boxborderw=${Math.round(fontSize * 0.5)}`,
        'x=(w-text_w)/2',
        // Sits in the lower third but clear of the bottom-right logo, which finalizeVideo()
        // places at 4% margin — keeping the caption above 0.72h stops the two overlapping.
        'y=h*0.68',
      ].join(':'),
    );
  } else if (caption) {
    console.warn(`  overlay font missing at ${OVERLAY_FONT} — skipping on-screen text for this shot`);
  }

  // Veo's native audio is KEPT, not stripped. Every Veo clip ships with an AAC 48kHz stereo
  // track (audio is "always on" and priced in whether you use it or not), and the earlier
  // version of this function discarded it with `-an` — paying for sound and then deleting it.
  // Normalised to identical codec/rate/layout here because the concat demuxer below compares
  // stream layout across segments, not just video.
  const sourceHasAudio = await hasAudioStream(clipPath);
  const args = ['-y', '-i', clipPath];
  // A clip with no audio at all gets a silent track synthesised, so the concat step still sees a
  // consistent [video + audio] layout for every segment.
  if (!sourceHasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  args.push(
    '-vf', filters.join(','),
    '-map', '0:v:0',
    '-map', sourceHasAudio ? '0:a:0' : '1:a:0',
    '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
  );
  if (!sourceHasAudio) args.push('-shortest'); // stop at the video's end, not the infinite silence
  args.push(outfile);

  await runFfmpeg(args);
  return outfile;
}

// `clips` is [{ source, onScreenText }] — `source` is either a local path (freshly generated) or
// a remote URL (a reused shot), which ffmpeg reads identically.
async function normalizeAndConcatClips(clips, aspectRatio, outDir) {
  const normalizedDir = path.join(outDir, 'normalized');
  fs.mkdirSync(normalizedDir, { recursive: true });
  const normalized = [];
  for (let i = 0; i < clips.length; i++) {
    const outfile = path.join(normalizedDir, `shot-${String(i).padStart(2, '0')}.mp4`);
    await normalizeClip(clips[i].source, aspectRatio, outfile, clips[i].onScreenText);
    normalized.push(outfile);
  }
  // Same concat-demuxer approach as concatSlides() — every normalized clip now shares codec,
  // resolution, fps AND audio layout (AAC 48kHz stereo on every segment), so `-c copy` applies
  // cleanly. The audio consistency matters as much as the video here: the demuxer compares the
  // whole stream layout, so a segment missing its audio track would fail the join outright.
  const concatenated = await concatSlides(normalized, outDir);

  // One more Phase-2-only pass: re-encode with a forced constant frame rate to regenerate a
  // clean, gapless timeline. Caught by the same structural test that found the fps mismatch
  // above (docs/video-studio-trd-phase2.md §8 step 2): even with every input clip normalized to
  // an identical fps/resolution/codec, `-c copy` concat of files that were each encoded
  // separately (unlike Phase 1's concatSlides(), whose inputs all come from the same
  // ffmpegEncode() call with frame-accurate, deterministic timestamps) can leave the SECOND
  // segment onward with a subtly irregular presentation timeline — invisible to ffprobe's
  // reported duration/frame count, but real enough that finalizeVideo()'s logo-overlay filter
  // (Phase 1, unmodified — deliberately not touched here) stopped drawing the logo entirely
  // partway through a real assembled test video. `-vsync cfr` forces every output frame onto a
  // strict, evenly-spaced 30fps grid, which fixed it (re-verified below). Cheaper than tracking
  // down concat's exact PTS behavior further, and this is a normal, supported ffmpeg pattern for
  // "clean up a concat-demuxer output before feeding it into more filtering."
  const cleaned = path.join(outDir, 'concatenated-clean.mp4');
  await runFfmpeg([
    '-y', '-i', concatenated,
    '-r', String(TARGET_FPS), '-vsync', 'cfr',
    '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p',
    // Audio carried through explicitly rather than left to ffmpeg's defaults — this pass exists
    // to rebuild the timeline, and the soundtrack has to survive it intact.
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    cleaned,
  ]);
  return cleaned;
}

// The Phase 2 counterpart to renderVideo(): generates every shot via Veo (veo.js), then reuses
// finalizeVideo() completely unchanged for the crop/logo/VO pass — Veo's native 16:9 or 9:16
// output feeds directly into the same blurred-background-fill technique Phase 1 built for 4:5
// slides (TRD §1).
//
// A shot that already has `status: 'done'` and a real `clipUrl` (set by an earlier
// /regenerate-shot call) is REUSED, not regenerated — ffmpeg reads http/https URLs natively (the
// same fact Phase 1's voiceover mux already relies on), so normalizeAndConcatClips() below can
// take a mix of local paths (freshly generated) and remote URLs (reused) with no special-casing.
// This is what makes per-shot regenerate actually cheaper than a full re-render, matching AI
// Studio's per-slide regenerate economics — without it, every Approve & Render would re-pay for
// every shot regardless of which ones had already been fixed.
//
// `onShotDone(shot, i)` fires after each shot (generated OR reused) so server.js can PATCH
// shots_json incrementally, mirroring renderCarousel()'s onSlideDone. For a freshly generated
// shot it receives `localPath` (server.js uploads it and writes the real clipUrl back); for a
// reused shot there is nothing new to upload, so `localPath` is absent.
async function generateAndAssembleVideo({ jobId, shots, engine, aspectRatio, logoPath, voiceoverPath, musicPath, onProgress, onShotDone, resolution = '1080p' }) {
  const outDir = path.join(ROOT, 'output', jobId);
  fs.mkdirSync(outDir, { recursive: true });

  const clips = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    if (onProgress) onProgress({ phase: 'shot_generating', slideIndex: i + 1, slideTotal: shots.length });

    if (shot.status === 'done' && shot.clipUrl) {
      clips.push({ source: shot.clipUrl, onScreenText: shot.onScreenText });
      if (onShotDone) await onShotDone({ ...shot }, i);
      continue;
    }

    const outfile = path.join(outDir, `shot-${String(i).padStart(2, '0')}-raw.mp4`);
    try {
      const { localPath, costUsd } = await generateShot({
        prompt: shot.prompt,
        negativePrompt: shot.negativePrompt,
        engine,
        aspectRatio,
        durationS: shot.durationS,
        outfile,
        resolution,
        // Real Veo generation can take several minutes -- reports 'shot_polling' on every poll
        // tick (veo.js's pollUntilDone(), ~every 10s) so the FE shows genuine ongoing activity
        // instead of "generating..." frozen for minutes at a time.
        onPoll: () => { if (onProgress) onProgress({ phase: 'shot_polling', slideIndex: i + 1, slideTotal: shots.length }); },
      });
      clips.push({ source: localPath, onScreenText: shot.onScreenText });
      if (onShotDone) await onShotDone({ ...shot, status: 'done', costUsd, localPath }, i);
    } catch (err) {
      if (onShotDone) await onShotDone({ ...shot, status: 'failed', errorDetail: err.message.slice(0, 300) }, i);
      return { failed: [`shot ${i + 1}: ${err.message}`], outDir, finalVideoPath: null };
    }
  }

  if (onProgress) onProgress({ phase: 'stitching' });
  const concatenated = await normalizeAndConcatClips(clips, aspectRatio, outDir);
  const outfile = path.join(outDir, 'final.mp4');
  // hasSourceAudio: Veo generates audio on every clip (always on, all tiers), and
  // normalizeAndConcatClips() now preserves it end to end, so the assembled input really does
  // carry a soundtrack — unlike Phase 1's silent slides.
  await finalizeVideo({ concatenatedPath: concatenated, aspectRatio, logoPath, voiceoverPath, musicPath, outfile, hasSourceAudio: true });

  return { failed: [], outDir, finalVideoPath: outfile };
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

module.exports = { renderCarousel, renderVideo, generateAndAssembleVideo };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
