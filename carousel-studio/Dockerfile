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
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ffmpeg \
      fonts-liberation \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# render.js already reads CHROME_BIN from the environment (its Windows path is only a local-dev
# default) — no code change needed to point it at the container's Chromium.
ENV CHROME_BIN=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Zero runtime npm dependencies (gen.js/render.js/server.js/serve.js use only Node's built-ins —
# see server.js's header comment for why) — no package.json/node_modules needed in the image,
# just the source files and the static assets the pipeline actually reads at runtime.
COPY base.css gen.js render.js server.js serve.js ./
COPY vendor/ ./vendor/
COPY assets/ ./assets/
COPY icons/ ./icons/

# slides/ and output/ are written fresh per job at runtime (job_id-named subfolders, cleaned up
# after each job by server.js) — an empty starting point, not baked-in demo/test content.
RUN mkdir -p slides output

EXPOSE 8080
CMD ["node", "server.js"]
