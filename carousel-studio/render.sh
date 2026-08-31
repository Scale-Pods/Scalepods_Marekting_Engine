#!/usr/bin/env bash
# Renderer entry point. The concurrency-pool/retry/ffmpeg logic lives in render.js —
# Node gives proper async concurrency control and cross-platform process spawning
# without bash job-pool quoting headaches, especially with this repo's spaces-in-path.
#
# Usage: ./render.sh <slug> [--concurrency=3] [--keep-frames] [--only=<file>]
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/render.js" "$@"
