# Blog module — ScalePods Growth OS → scalepods.co

**Status (2026-08-14): fully wired.** Site route deployed and verified (401 on missing/wrong
secret), both listing-page filters fixed, `ScalePods · Blog Publish` n8n workflow published,
`BLOG_PUBLISH_ENABLED = true`. Composer has a live "Preview" that renders the draft in the
site's actual visual style (`src/components/blog/BlogPreview.tsx`). Pending: one real
live-publish verification (needs explicit go-ahead since it publishes real content to the live
site).

## ⚠️ Known gap: the CTA fields don't render anywhere yet

The composer's "CTA button text/link" fields write to `blog_posts.cta_label`/`cta_url`, and the
site's `/api/blog/publish` route correctly writes them into `website_content.cta_label`/`cta_url`
— but `src/app/blog/[slug]/page.tsx`'s dynamic-post `displayData` object never reads those two
columns into what it passes to `BlogBodyClient`, so today a CTA set in the composer is silently
inert: it's stored, but nothing on the live page renders it. Left as-is for now — a real fix is a
site-repo change (out of scope here), not something to paper over from the Growth OS side. The
composer's preview does not show a fake CTA button either, for the same reason (see its header
note).

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
  Do NOT emit the `visual`/`accordionItems`/`imagePosition` fields from `BlogSection` — those
  power ~30 bespoke hardcoded infographic components tied to specific legacy posts
  (`renderAITransform`, `renderBarriers`, etc. in `BlogBodyClient.tsx`) and have no generic
  composer equivalent.
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
  "ctaLabel": "string | null",
  "ctaUrl": "string | null",
  "sections": [
    { "heading": "string", "body": "markdown: **bold**, [text](url), bullet lines start with \"• \"", "image": "string?", "imageCaption": "string?" }
  ]
}
```
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
