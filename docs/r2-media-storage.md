# Media storage on Cloudflare R2

Status: **live since 2026-10-12.** Big media no longer sits in Supabase storage, which was over its
free quota (storage 93%, cached egress 128%).

## What lives where

| Where | What |
|---|---|
| **Cloudflare R2**, bucket `scalepods-media` | Everything uploaded in the post composer (`manual/`), AI Studio, Video Studio outputs, branded images, imports, review attachments. Public address: `https://pub-8b2ce60ea95c479788ece9746398e7e1.r2.dev` |
| **Supabase storage** | Blog images (`blog/`, the public website loads them), brand logos (`brand/`, `brand-assets/`), ticket attachments, Carousel Studio output, and anything the n8n workflows and the Railway worker still write (see "Not moved yet"). |

The R2 address is Cloudflare's free `r2.dev` one. Cloudflare documents it as development-grade:
rate limited, no caching or firewall. Moving to a custom domain later only changes the base address
and the links stored in the database (files are not re-uploaded); that needs the domain's DNS on
Cloudflare (scalepods.co's DNS is on GoDaddy today).

## How uploads work

1. The browser asks the `r2-upload` Supabase edge function for an upload link (`src/lib/mediaUpload.ts`).
2. The function checks the person is a signed-in, active team member, validates the folder, file
   type (no HTML/SVG/scripts) and size (300 MB video, 100 MB other), and returns a link valid 10 minutes.
3. The browser sends the file straight to R2 with that link and stores the public address.

R2 keys exist only as Supabase secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`,
`R2_BUCKET`, `R2_PUBLIC_URL`). The values are trimmed in code (a trailing newline once broke signing).
The bucket's CORS policy allows `GET/HEAD/PUT` from the production app and `localhost:5173`.

## Cost guard

Free allowance: 10 GB stored, 1 million writes, 10 million reads a month; downloads cost nothing.
Beyond that: $0.015 per GB-month (100 GB is about $1.50).

- The R2 token is limited to Object Read & Write on this one bucket, so it cannot create or enable
  any other paid Cloudflare product.
- `r2-usage-check` runs daily (pg_cron job `r2-usage-check`, 03:45 UTC), logs the bucket size in
  `r2_usage_log`, and emails + notifies the owner and admins at **5 GB, 8 GB and 10 GB**, and on a
  jump of more than 2 GB in a day.
- Cloudflare's own usage alert ("Usage Based Billing") needs a paid Cloudflare plan, so it is not used.

## Migration record (2026-10-12)

191 files (649 MB) were copied from Supabase to R2 with a size check on each, and every media link in
16 database columns was rewritten to the R2 address (184 distinct links, all checked against R2).
Backups of the changed rows: tables `zz_bak_*`. Copy list: `zz_migrate_list`. The Supabase originals
are still in place; delete them (after checking the code and workflows for hardcoded references; see
the AI Studio thumbnail incident) once the app has been confirmed working, then drop the `zz_*` tables.

## Not moved yet

n8n workflows (image engine, branding, studio generate, carousel, video render), the Railway
worker, and the canva/figma/brand-overlay edge functions still write to Supabase storage. Their
output is small compared with the manual uploads, but it is the next step.

## Hardcoded files (do not delete)

- AI Studio style thumbnails: `public/studio-styles/*.jpg` (stock images, see
  `docs/studio-style-thumbnail-credits.md`).
- Video Studio voice previews: `content-media/video-studio/voice-samples/<voice>.wav` on Supabase,
  written by the Railway worker's `POST /voice-samples`.
