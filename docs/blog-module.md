# Blog module — ScalePods Growth OS → scalepods.co

**Status (2026-08-17): fully wired, all known gaps closed.** Site route deployed and verified
(401 on missing/wrong secret), both listing-page filters fixed, `ScalePods · Blog Publish` n8n
workflow published, `BLOG_PUBLISH_ENABLED = true` and `BLOG_UNPUBLISH_ENABLED = true`. Composer
has a live "Preview" that renders the draft in the site's actual visual style
(`src/components/blog/BlogPreview.tsx`). Pending: one real live-publish verification (needs
explicit go-ahead since it publishes real content to the live site).

## Resolved: Unpublish (DELETE /api/blog/publish)

Was a real gap — `deleteBlogPost` only ever deleted the Growth OS row, never touched
`website_content`, so a published post had no undo. Fixed on both sides:

- **Growth OS + n8n**: `triggerBlogUnpublish()` fires `sp-blog-unpublish`; n8n fetches the row,
  calls the site, sets `status='draft'` on success or `'failed'` on failure. Same
  n8n-owns-the-transition pattern as publish. "Unpublish" button next to "View live".
- **Site** (Antigravity, commit `0a8ea69`, `Scale-Pods/scalepods-replication` main): added
  `DELETE` handler to the existing `route.ts` — same secret check, deletes the `website_content`
  row by `slug`, same `revalidatePath` calls. **Verified independently, not just taken on
  claim**: read the actual deployed `route.ts`, confirmed the handler matches the contract
  exactly, and sent live `DELETE` requests with no/wrong secret — both correctly returned 401.

`BLOG_UNPUBLISH_ENABLED = true` as of this commit.

## Resolved: CTA card text + dark/light banner variants

Also verified against the actual deployed code (not the summary alone) — Antigravity took a
different implementation path than originally asked (no new `website_content` columns; instead
embeds `bannerUrlDark`/`bannerUrlLight`/`ctaTitle`/`ctaSubtitle` inside the existing `body`
column as `JSON.stringify({ sections, bannerUrlDark, ctaTitle, ... })`, a wrapper object instead
of the old bare `sections` array). Checked that this doesn't break anything: `[slug]/page.tsx`'s
parser handles both shapes (`Array.isArray(parsed) ? parsed : parsed.sections`), and there were
no live `website_content` rows yet for the old bare-array shape to break.

Confirmed by reading the code end to end:
- `route.ts` (`POST`) writes the wrapper object into `body`.
- `[slug]/page.tsx` parses it, builds `imageDark`/`imageLight`/`ctaTitle`/`ctaSubtitle`/
  `ctaLabel`/`ctaUrl` (columns first if present, falling back to the body-JSON values — the
  columns don't actually exist, confirmed via grep on the migration files, so this always
  resolves through the body-JSON path in practice, which is fine), and passes all of them into
  `<BlogHeroImage imageDark={} imageLight={} />` and `<BlogBodyClient ctaTitle={} ctaSubtitle={}
  ctaLabel={} ctaUrl={} />`.
- `BlogBodyClient.tsx`'s `WorkflowAuditCTA` accepts these as optional props and overrides its
  keyword-heuristic text only when each is actually set (`if (ctaTitle) dynamicTitle = ctaTitle`
  etc.) — old/static posts and any field left blank keep working exactly as before.

Both gaps are genuinely closed. The Growth OS composer's banner/CTA fields now do exactly what
their labels say on a real publish.

Added 2026-08-14 as a 5th content pillar (see [CLAUDE.md](../CLAUDE.md) Non-negotiables).
Publishes to the **separate** `scalepods.co` Next.js repo (`F:\Scalepods.co\scalepods-website-nextjs`,
built/maintained via its own Antigravity agent) — not to a social API, so this module has its own
integration contract instead of an n8n social-publish node.

## Confirmed facts (read directly from the site's codebase, 2026-08-14)

- **Separate Supabase project.** Site uses `pjblbouksmeypryiyoyr`; Growth OS uses `oyfudqqypvpqsyrjqnfy`.
  Growth OS must never hold a credential for the site's project — publish only through the API
  route below.
- **Storage table**: `public.website_content` — `id, slug (unique), title, excerpt, body (text),
  hero_image (text), category, tags (text[]), cta_label, cta_url, status, published_at, created_at,
  updated_at`. One hero image column — no light/dark variant, no meta_title/meta_description.
- **`body` is a JSON-stringified array**, parsed with `JSON.parse(post.body)` in
  `src/app/blog/[slug]/page.tsx`. Each element: `{ heading, body, image?, imageCaption?, cta?:
  {text, link, isDownload?}, video? }`. `body` is a markdown string rendered by
  `parseMarkdownInline` in `src/components/ui/BlogBodyClient.tsx`, which supports **exactly**
  `**bold**` and `[text](url)` — nothing else. Bullet lines (`•`/`-`/`*`), `### `/`## ` headings,
  and `✅`/`💡`-prefixed highlight lines get special layout treatment automatically.
  Do NOT emit the `visual` field from `BlogSection` — that's the one that powers ~30 bespoke
  hardcoded infographic components tied to specific legacy posts (`renderAITransform`,
  `renderBarriers`, etc. in `BlogBodyClient.tsx`) and has no generic composer equivalent.
  **Correction (2026-08-20): `accordionItems` and `imagePosition` are safe and now supported** —
  an earlier version of this doc lumped them in with `visual` as "don't emit," which was wrong.
  Read the site's `BlogBodyClient.tsx` directly (local repo,
  `F:\Scalepods.co\scalepods-website-nextjs`) and confirmed both are genuinely generic renderers:
  any section's `accordionItems` (`{title, content}[]`) becomes colored-left-border cards with a
  "STEP 01"/"STAGE 02"/etc. tag auto-derived from heading keywords (`tagPrefixForHeading` in
  `blogSerializer.ts`, ported verbatim from the site's own list); `imagePosition` just picks
  above/below placement for the section image. The Growth OS composer's "Cards" toolbar button
  (`SectionCardsNode.tsx`) now uses `accordionItems` — verified live end-to-end (draft save +
  cold reload round-trip).
- **Rendering is fully dynamic** (`export const revalidate = 0` in both `blog/page.tsx` and
  `blog/[slug]/page.tsx`) — a new/updated row in `website_content` appears live immediately, no
  rebuild or redeploy needed.
- **Images**: any absolute URL or a `/public`-relative path both work — the rendering logic
  branches on whether the string starts with `http`.

## ⚠️ Bug to fix on the site side before this ships — TWO filters, not one

`src/app/blog/page.tsx` hides 2026+ posts from the listing **twice**, independently. Fixing only
one still hides new CMS posts:

1. **Line 33**, the Supabase query itself:
   ```ts
   .lt("published_at", "2026-01-01") // Only show posts before 2026
   ```
2. **Lines 56–67**, a second filter applied to the *combined* list after the query:
   ```ts
   .filter(post =>
     post.category !== "Case Study" && (
       !post.date.includes("2026") ||
       post.slug === "ai-employees-digital-workforce-guide" ||
       // ...7 more hardcoded slugs
     )
   )
   ```
   This one clearly exists to allow-list today's real 2026-dated *static* posts through a
   date heuristic that was never meant to apply to dynamic ones — but as written it applies to
   the combined `dynamicPosts + staticPosts` list, so it would keep hiding any *new* dynamic
   post from `/blog` even after fix #1.

Both need fixing together — see the exact instruction in the Antigravity prompt below. Today
is 2026-08-14: any post this module publishes right now is live at its direct URL and in the
sitemap, but invisible on `/blog` itself until both filters are corrected.

## Gaps vs. Antigravity's original proposal

Its sample `POST /api/blog/publish` payload included `bannerUrlLight`, `metaTitle`,
`metaDescription` — none of these have a column in `website_content` today, and
`generateMetadata()` for DB posts only ever reads `title`/`excerpt`. Not a blocker: v1 ships with
one hero image and auto-derived SEO. Real per-post SEO + light/dark hero is a fast-follow if
wanted (2 small migration + code changes on the site side).

## Integration contract (once the API route exists)

`POST https://www.scalepods.co/api/blog/publish`, header `x-publish-secret: <BLOG_PUBLISH_SECRET>`.

```json
{
  "title": "string",
  "slug": "string",
  "category": "string",
  "excerpt": "string",
  "bannerUrl": "string | null",
  "bannerUrlDark": "string | null",
  "bannerUrlLight": "string | null",
  "ctaTitle": "string | null",
  "ctaSubtitle": "string | null",
  "ctaLabel": "string | null",
  "ctaUrl": "string | null",
  "sections": [
    { "heading": "string", "body": "markdown: **bold**, [text](url), bullet lines start with \"• \"", "image": "string?", "imageDark": "string?", "imageLight": "string?", "imageCaption": "string?" }
  ]
}
```
(`bannerUrlDark`/`bannerUrlLight`/`ctaTitle`/`ctaSubtitle` are already being sent by n8n as of
2026-08-17 — see the two "known gap" sections above for what the route/render path still need.)
Route logic:
1. 401 if `x-publish-secret` doesn't match `process.env.BLOG_PUBLISH_SECRET`.
2. Upsert by `slug` into `website_content`: `title`, `excerpt`, `category`,
   `hero_image = bannerUrl`, `body = JSON.stringify(sections)`, `cta_label = ctaLabel`,
   `cta_url = ctaUrl`, `status = 'published'`, `published_at = now()`.
3. `revalidatePath('/blog')` + `revalidatePath('/blog/' + slug)`.
4. Respond `{ success: true, slug, url: "https://www.scalepods.co/blog/" + slug }` (200) or
   `{ success: false, error }` (500) on a Supabase error.

No `metaTitle`/`metaDescription`/`bannerUrlLight` in the payload — those aren't in the schema
today (see gaps above), so this is the real, buildable contract, not the earlier draft.

## Growth OS side (this repo) — build plan

1. **Supabase**: new `blog_posts` table mirroring the payload shape 1:1 (`id, title, slug,
   category, excerpt, banner_url, sections jsonb, status, scheduled_at, published_at, created_at,
   updated_at`), RLS `auth_all` matching every other table.
2. **Editor**: Tiptap (new dependency) — the only thing that gives real "select text → add link"
   UX. Custom output step serializes each paragraph/heading/list block back into the markdown
   subset `BlogBodyClient` actually understands (not arbitrary HTML) — see the confirmed syntax
   above. One Tiptap "section" = one array element; heading nodes become new `BlogSection`
   boundaries; an inserted image node with a caption becomes `image`/`imageCaption` on the
   section it follows.
3. **New "Blog" nav section**: post list (draft/scheduled/published) + editor page — title,
   slug (auto-from-title, editable), category, banner upload (reuse `AssetUploader`), excerpt,
   Tiptap body, Publish / Save draft.
4. **Publish flow**: `sp-blog-publish` n8n webhook → `HTTP Request` node → the site's
   `/api/blog/publish` with the shared secret (new n8n credential, header-auth type) → on success,
   update the Growth OS row's `status`/`published_at`.
5. **Credential needed from you**: `BLOG_PUBLISH_SECRET` value (once Antigravity sets the env var
   on their side) to store as an n8n credential.

## Verification (once built)

Same standard as every other module — real login, throwaway test post, full round-trip: Growth OS
composer → n8n → site API → row in `website_content` → live at `/blog/<slug>` **and** visible on
`/blog` (this is the check that catches the 2026-filter bug above if it isn't actually fixed) →
delete the test row after.
