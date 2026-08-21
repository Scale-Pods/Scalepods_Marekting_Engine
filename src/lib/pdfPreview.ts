import * as pdfjsLib from 'pdfjs-dist'

// `pdf.worker.min.mjs` needs to run as its own script, and getting Vite's dev transform pipeline
// to hand it to a Worker correctly turned out to be unreliable two different ways:
//   - `?url` import (a plain hashed URL) leaves pdf.js to spawn the Worker itself, which under
//     Vite's dev dep-optimizer creates a classic (non-module) worker that can't parse an ESM file
//     — the worker never comes up and getDocument() hangs forever.
//   - `?worker` import (Vite's own module-worker constructor) fixed the classic/module mismatch,
//     but Vite's dev server then hung indefinitely trying to transform-and-serve the underlying
//     `...?worker_file&type=module` chunk for this specific (large, pre-minified, node_modules-
//     vendored) file — confirmed via network inspection: the request just sits with no response.
// Copying the file into `public/` (repo root: `public/pdf.worker.min.mjs`, synced from this exact
// pdfjs-dist version) and pointing `workerSrc` at that static path sidesteps Vite's transform
// pipeline entirely — same trick already used for the self-hosted brand fonts.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// Likewise, the Helvetica/standard-14 font metrics pdf.js needs for non-embedded fonts ship as
// static files in the package (`standard_fonts/`) — also copied into `public/` and pointed at
// directly, rather than left to pdf.js's default resolution.
const STANDARD_FONT_DATA_URL = '/standard_fonts/'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// pdf.js paces its own display-intent rendering with requestAnimationFrame, and separately can
// fall back to a slow linear-scan "recovery" pass on any PDF with a corrupt/missing xref table
// (a real thing plenty of real-world exported PDFs hit, not just hand-broken test files) — either
// one can occasionally take a while. Without a cap, a slow render would leave the composer's
// preview spinning forever instead of just falling back to the plain filename card, so the whole
// load+render pipeline is bounded end to end.
const RENDER_TIMEOUT_MS = 15_000

/**
 * Renders each page of a PDF to a PNG data URL, entirely client-side — used by the LinkedIn PDF
 * composer's "How it'll look" preview so it shows the actual page content, not just a filename
 * (a Document post is exactly this: LinkedIn's own swipeable page-by-page viewer). Capped at
 * `maxPages` so an accidentally-huge deck doesn't stall the composer — LinkedIn caps at 300
 * pages anyway, nobody is previewing all of them one by one.
 */
export async function renderPdfPages(url: string, maxPages = 10): Promise<string[]> {
  return withTimeout(renderPdfPagesInner(url, maxPages), RENDER_TIMEOUT_MS)
}

async function renderPdfPagesInner(url: string, maxPages: number): Promise<string[]> {
  // pdf.js's own network layer hangs indefinitely against Supabase Storage URLs, even with
  // range/streamed fetching disabled (Supabase answers Range requests with a 206 but doesn't
  // expose `Content-Range`/`Accept-Ranges` via CORS, and pdf.js's reader doesn't fail cleanly on
  // that — it just never settles). Fetching the bytes ourselves with the browser's own `fetch`
  // — confirmed reliable against the same URL — and handing pdf.js the buffer sidesteps its
  // network layer entirely. Fine here: these are small marketing PDFs, one at a time, capped at
  // `maxPages`.
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`)
  const data = new Uint8Array(await res.arrayBuffer())
  const doc = await pdfjsLib.getDocument({ data, standardFontDataUrl: STANDARD_FONT_DATA_URL }).promise
  const count = Math.min(doc.numPages, maxPages)
  const images: string[] = []
  for (let i = 1; i <= count; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    // `canvas` alone is the modern param — pdf.js's docs note `canvasContext` is a legacy
    // alternative that requires `canvas` to be null; passing both together is undefined behavior.
    await page.render({ canvas, viewport }).promise
    images.push(canvas.toDataURL('image/png'))
  }
  return images
}
