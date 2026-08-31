#!/usr/bin/env node
// ============================================================================
// Carousel Studio — gen.js
// ============================================================================
// Turns a slide OUTLINE (a plain JSON array describing each slide) into a set
// of self-contained HTML files, one per slide, plus a manifest.json that
// render.sh reads to know how long to hold each slide and at what fps.
//
// HOW THE "DETERMINISTIC RENDER" TRICK WORKS (read this before touching the
// templates below):
//   Every generated slide has a GSAP timeline built paused. On load, the
//   slide's own bootstrap script checks the URL for ?frame=N&fps=F. If those
//   are present, it computes elapsed = N/F seconds, converts that to a 0..1
//   timeline progress, and calls tl.progress(p).pause() BEFORE Chrome takes
//   its screenshot. So "render frame 47 at 30fps" always produces the exact
//   same pixels, no matter when Chrome happens to actually paint it — there's
//   no reliance on wall-clock timing during the render pass at all. Loading
//   the file with no query string just autoplays the timeline normally,
//   which is how you preview a slide's motion live in a browser.
//
// USAGE:
//   node gen.js <outline.json>
// Writes slides/<carousel-slug>/NN-<type>.html for every slide, plus
// slides/<carousel-slug>/manifest.json.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const REL = '../../'; // every generated file lives 2 levels under carousel-studio/ (slides/<slug>/file.html)

// ---------------------------------------------------------------------------
// Small helpers shared by every template
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Renders an icon chip. `icon` can be a path (relative to icons/, e.g. "notion.svg")
// or omitted, in which case a plain glyph tile is used instead — never blocks slide
// generation just because a real icon hasn't been fetched yet.
// `onLight` must be true for chips sitting on a light/white background (e.g. the cover's
// icon-ring, which base.css deliberately gives a --tile fill) — the glyph fallback needs
// dark text there, not the white text that reads fine on the default accent-blue chip fill.
function iconInner(icon, label, onLight = false) {
  if (icon) return `<img src="${REL}icons/${esc(icon)}" alt="">`;
  const glyph = esc((label || '?').trim().charAt(0).toUpperCase());
  const color = onLight ? 'var(--ink)' : 'white';
  return `<span style="font-family:'Inter',sans-serif;font-weight:700;font-size:32px;color:${color};">${glyph}</span>`;
}

function avatarTag(pose, style, cls) {
  const p = pose || 'casual';
  return `<img class="avatar${cls ? ' ' + cls : ''}" style="${style || ''}" src="${REL}assets/pose-${esc(p)}-cutout.png" alt="">`;
}

// Bootstrap script every slide ends with. Exposes TWO ways to seek the timeline:
//
//   1. window.__seekFrame(frame, fps) — used by the persistent-browser renderer, which loads
//      the page ONCE per slide and then seeks + screenshots each frame without reloading.
//      Deliberately a closure over `tl` rather than relying on `window.tl`: a top-level
//      `const` in a classic script lives in the global lexical environment, not on `window`,
//      so `window.tl` would be undefined from an injected evaluation.
//   2. ?frame=N&fps=F in the URL — the original one-page-load-per-frame path. Kept because
//      it's how a slide is previewed/debugged by hand, and it keeps each frame reproducible
//      from a plain URL.
//
// Both call the same seek logic, so a frame renders identically either way.
function bootstrapScript() {
  return `
<script>
  window.__seekFrame = function (frame, fps) {
    const elapsed = Number(frame) / Number(fps);
    const p = Math.max(0, Math.min(1, elapsed / tl.duration()));
    tl.progress(p).pause();
    document.documentElement.dataset.rendered = 'true';
  };

  const params = new URLSearchParams(location.search);
  const frame = params.get('frame');
  const fps = params.get('fps');
  if (frame !== null && fps !== null) {
    window.__seekFrame(frame, fps);
  } else {
    tl.play();
  }
</script>`;
}

function shell({ title, body, extraStyle = '' }) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${REL}base.css">
<script src="${REL}vendor/gsap.min.js"></script>
<style>${extraStyle}</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// TEMPLATE: cover — centered dark headline plate, icon-framed edges, avatar
// hosting/presenting it. This is slide 1 — the scroll-stopper.
// ---------------------------------------------------------------------------
function coverTemplate(spec) {
  const { eyebrow, headline, subhead, icons = [], pose = 'pointing' } = spec;

  // Frame the stage with small icon chips at the corners — the "ringed around it, filling
  // the frame" cover rule, done as a perimeter frame rather than a literal circle (simpler,
  // reads just as intentional). Positions deliberately avoid the plate's footprint (anchored
  // top:150/left:64/width:620, height grows with headline length) and the avatar's (anchored
  // bottom-right, ~731px wide at the default 980px height) — mid-edge positions were tried
  // first and got silently hidden behind the plate whenever a headline ran to 3 lines, since
  // the plate's height isn't fixed. Top corners sit above both; bottom-left sits left of the
  // avatar. Re-check this composition if a cover ever uses a much longer headline/subhead.
  const framePositions = [
    { top: '64px', left: '64px' },
    { top: '64px', right: '64px' },
    { bottom: '64px', left: '64px' },
  ];
  const iconChips = framePositions
    .map((pos, i) => {
      const style = Object.entries(pos).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`).join(';');
      return `<div class="icon-chip frame-icon" style="${style}">${iconInner(icons[i], icons[i] || 'A', true)}</div>`;
    })
    .join('\n    ');

  const body = `
  <div class="stage">
    <div class="focal-glow" style="--focal-x:72%; --focal-y:66%;"></div>
    <div class="icon-ring">
      ${iconChips}
    </div>
    <div class="plate-dark flex-col gap-md" id="plate" style="position:absolute; left:64px; top:150px; width:620px;">
      <div class="eyebrow" id="eyebrow">${esc(eyebrow)}</div>
      <div class="display" id="headline">${esc(headline).split('\n').join('<br>')}</div>
      ${subhead ? `<div class="body-lg dim" id="subhead">${esc(subhead)}</div>` : ''}
    </div>
    ${avatarTag(pose, 'right: 10px; height: 980px;', 'cover-avatar')}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } });
    tl.from('.frame-icon', { opacity: 0, scale: 0.5, duration: 0.5, stagger: 0.08 })
      .from('#plate', { opacity: 0, y: 50, duration: 0.6 }, 0.15)
      .from('#eyebrow', { opacity: 0, y: 12, duration: 0.4 }, 0.35)
      .from('#headline', { opacity: 0, y: 16, duration: 0.5 }, 0.45)
      .from('.cover-avatar', { opacity: 0, x: 80, duration: 0.7 }, 0.3);
  </script>
  ${bootstrapScript()}`;

  return shell({ title: 'cover', body });
}

// ---------------------------------------------------------------------------
// TEMPLATE: step — one idea per slide: a heading plate + one hero tile (or a
// short stacked list of 2-3 sub-tiles for one topic), avatar gesturing at it.
// ---------------------------------------------------------------------------
function stepTemplate(spec) {
  const { eyebrow, heading, items = [], pose = 'pointing', stepLabel } = spec;
  const single = items.length === 1;

  // The avatar always anchors the LEFT side of this template with content to its right — but
  // the "pointing" pose's raised hand was drawn reaching toward the character's own left (i.e.
  // toward screen-left), which pointed straight into empty space instead of at the content.
  // Mirroring it horizontally is far simpler than generating a second "points right" pose, and
  // reads exactly the same for a symmetric gesture like this.
  const avatarStyle = `left: 20px; bottom: 0; height: 760px;${pose === 'pointing' ? ' transform: scaleX(-1);' : ''}`;

  const tilesHtml = items
    .map((item, i) => `
    <div class="tile flex-row gap-md items-center step-tile" id="tile-${i}" style="${single ? 'padding:60px; width:600px;' : ''}">
      <div class="icon-chip" style="${single ? 'width:96px;height:96px;' : ''}">${iconInner(item.icon, item.heading)}</div>
      <div class="flex-col gap-sm">
        <div class="heading" style="font-size:${single ? 40 : 34}px;">${esc(item.heading)}</div>
        ${item.body ? `<div class="${single ? 'body-lg' : 'body'} dim">${esc(item.body)}</div>` : ''}
      </div>
    </div>`)
    .join('\n');

  const body = `
  <div class="stage">
    <div class="focal-glow" style="--focal-x:28%; --focal-y:70%;"></div>
    <div class="flex-col gap-sm" style="position:absolute; left:64px; top:80px; right:64px;">
      ${stepLabel ? `<div class="eyebrow" id="eyebrow">${esc(stepLabel)}</div>` : ''}
      <div class="heading" id="heading" style="font-size:56px; max-width:900px;">${esc(heading)}</div>
    </div>
    <!-- content column fills the whole zone below the heading and is vertically centered in
         it, so a single tile doesn't strand itself near the top with dead space below — a
         stacked multi-item list still reads top-down fine, just centered as a group -->
    <div class="flex-col gap-md justify-center" id="tiles" style="position:absolute; right:64px; left:420px; top:300px; bottom:64px;">
      ${tilesHtml}
    </div>
    ${avatarTag(pose, avatarStyle, 'step-avatar')}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } });
    tl.from('#heading', { opacity: 0, y: 20, duration: 0.5 })
      .from('.step-avatar', { opacity: 0, x: -60, duration: 0.6 }, 0.1)
      .from('.step-tile', { opacity: 0, y: 30, duration: 0.5, stagger: 0.18 }, 0.25);
  </script>
  ${bootstrapScript()}`;

  return shell({ title: 'step', body });
}

// ---------------------------------------------------------------------------
// TEMPLATE: big-stat — one large number, minimal, avatar celebrating/pointing.
// ---------------------------------------------------------------------------
function statTemplate(spec) {
  const { eyebrow, value, suffix = '', label, pose = 'victory' } = spec;

  const body = `
  <div class="stage">
    <div class="focal-glow" style="--focal-x:62%; --focal-y:44%;"></div>
    <div class="flex-col gap-sm" style="position:absolute; right:70px; top:300px; text-align:right;">
      ${eyebrow ? `<div class="eyebrow" id="eyebrow" style="align-self:flex-end;">${esc(eyebrow)}</div>` : ''}
      <div class="stat" id="stat">0${esc(suffix)}</div>
      ${label ? `<div class="body-lg dim" id="label">${esc(label)}</div>` : ''}
    </div>
    ${avatarTag(pose, 'left: 10px; bottom: 0; height: 900px;', 'stat-avatar')}
  </div>
  <script>
    const statEl = document.getElementById('stat');
    const target = ${JSON.stringify(Number(value) || 0)};
    const suffix = ${JSON.stringify(suffix)};
    const counter = { n: 0 };
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } });
    tl.from('.stat-avatar', { opacity: 0, x: -60, duration: 0.6 })
      .from('#eyebrow', { opacity: 0, y: 12, duration: 0.4 }, 0.1)
      .to(counter, {
        n: target, duration: 0.9, ease: 'power1.out',
        onUpdate: () => { statEl.textContent = Math.round(counter.n) + suffix; },
      }, 0.15)
      .from('#label', { opacity: 0, y: 12, duration: 0.4 }, 0.6);
  </script>
  ${bootstrapScript()}`;

  return shell({ title: 'stat', body });
}

// ---------------------------------------------------------------------------
// TEMPLATE: cta — comment-keyword call to action, closing slide.
// ---------------------------------------------------------------------------
function ctaTemplate(spec) {
  const { eyebrow, headline, keyword, pose = 'victory' } = spec;

  // First cut centered the plate AND the avatar on top of it — a fully centered avatar
  // overlapped and covered the headline/pill text (a real legibility break, caught in QA, not
  // just a taste call). Switched to the same non-overlapping split the cover template already
  // proved out: plate offset left, avatar anchored bottom-right, clear of the text entirely.
  const body = `
  <div class="stage">
    <div class="focal-glow" style="--focal-x:70%; --focal-y:55%;"></div>
    <div class="plate-dark flex-col gap-md" id="plate" style="position:absolute; left:64px; top:50%; transform:translateY(-50%); width:600px;">
      ${eyebrow ? `<div class="eyebrow" id="eyebrow">${esc(eyebrow)}</div>` : ''}
      <div class="display" id="headline" style="font-size:60px;">${esc(headline).split('\n').join('<br>')}</div>
      <div class="cta-pill" id="pill" style="align-self:flex-start;">Comment &ldquo;${esc(keyword)}&rdquo; below&nbsp;👇</div>
    </div>
    ${avatarTag(pose, 'bottom: 0; right: 10px; height: 980px;', 'cta-avatar')}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'back.out(1.6)' } });
    tl.from('#plate', { opacity: 0, y: 40, duration: 0.5, ease: 'power2.out' })
      .from('.cta-avatar', { opacity: 0, x: 60, duration: 0.6, ease: 'power2.out' }, 0.15)
      .from('#pill', { opacity: 0, scale: 0.7, duration: 0.5 }, 0.5);
  </script>
  ${bootstrapScript()}`;

  return shell({ title: 'cta', body });
}

const TEMPLATES = { cover: coverTemplate, step: stepTemplate, stat: statTemplate, cta: ctaTemplate };
const DEFAULT_DURATION_S = { cover: 3.2, step: 3.4, stat: 3.4, cta: 3.6 };
const FPS = 30;

function generateCarousel(outline, slug) {
  const outDir = path.join(ROOT, 'slides', slug);
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = { slug, fps: FPS, slides: [] };
  outline.forEach((slide, i) => {
    const tpl = TEMPLATES[slide.type];
    if (!tpl) throw new Error(`Unknown slide type "${slide.type}" at index ${i}. Valid: ${Object.keys(TEMPLATES).join(', ')}`);
    const filename = `${String(i + 1).padStart(2, '0')}-${slide.type}.html`;
    fs.writeFileSync(path.join(outDir, filename), tpl(slide));
    manifest.slides.push({
      file: filename,
      type: slide.type,
      durationS: slide.durationS || DEFAULT_DURATION_S[slide.type],
    });
    console.log(`  ${filename}`);
  });

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Wrote manifest.json (${outline.length} slides) -> slides/${slug}/`);
  return outDir;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (require.main === module) {
  const outlinePath = process.argv[2];
  if (!outlinePath) {
    console.error('Usage: node gen.js <outline.json>');
    process.exit(1);
  }
  const outline = JSON.parse(fs.readFileSync(outlinePath, 'utf8'));
  const slug = path.basename(outlinePath, '.json');
  console.log(`Generating carousel "${slug}" (${outline.length} slides)...`);
  generateCarousel(outline, slug);
}

module.exports = { generateCarousel, TEMPLATES };
