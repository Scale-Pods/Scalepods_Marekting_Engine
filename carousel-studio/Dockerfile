# Carousel Studio render worker — see docs/carousel-studio-integration.md §7 Phase 1.
#
# node:20-bookworm-slim, not alpine: Debian's `chromium` apt package is a known-good headless
# Chromium build with predictable dependency handling; Alpine's musl-based Chromium has a long
# history of headless-rendering quirks not worth debugging here.
FROM node:20-bookworm-slim

# Debian's own `chromium` package, NOT Google's `google-chrome-stable` — avoids adding Google's
# apt repo/signing key just for this; functionally identical for headless screenshotting.
# fonts-liberation: a base font set so Chromium always has *something* to fall back on for any
# glyph outside Inter (Inter itself is self-hosted by base.css, no network fetch needed).
# tini: a real init as PID 1. Chrome spawns helper processes that get orphaned and re-parented
# to PID 1; plain `node server.js` as PID 1 does NOT reap them, so they accumulate as zombies
# until the container's PID table is full and every later fork fails permanently. That's the
# exact failure this worker hit in production. The renderer no longer spawns Chrome per frame
# (see render.js), which removes the source — tini is the belt-and-braces guarantee that any
# helper process Chrome still orphans gets reaped instead of piling up.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ffmpeg \
      fonts-liberation \
      ca-certificates \
      tini \
    && rm -rf /var/lib/apt/lists/*

# render.js already reads CHROME_BIN from the environment (its Windows path is only a local-dev
# default) — no code change needed to point it at the container's Chromium.
ENV CHROME_BIN=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# puppeteer-core is the one real runtime dependency (it drives the persistent browser). Installed
# before the source copy so this layer caches across code-only changes. PUPPETEER_SKIP_DOWNLOAD
# matters: puppeteer-core shouldn't fetch its own Chromium, we point it at the system one via
# CHROME_BIN — without this the image would balloon by hundreds of MB for a browser we don't use.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY base.css gen.js render.js server.js serve.js ./
COPY vendor/ ./vendor/
COPY assets/ ./assets/
COPY icons/ ./icons/

# slides/ and output/ are written fresh per job at runtime (job_id-named subfolders, cleaned up
# after each job by server.js) — an empty starting point, not baked-in demo/test content.
RUN mkdir -p slides output

EXPOSE 8080
# tini as PID 1 (see the apt install above), with server.js as its single child.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
