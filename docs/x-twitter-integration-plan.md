# X (Twitter) — Publishing Engine Integration Plan

**Status:** research + plan only, nothing built. Written 2026-09-16 in response to a direct
request to add X as a 6th publishing platform.

**⚠️ Scope note:** `CLAUDE.md`'s non-negotiables currently read *"Platforms: Instagram, YouTube,
Facebook, LinkedIn, and the scalepods.co Blog. No TikTok, no Google Business Profile..."* — X is
not on that list. This plan assumes the user wants to formally extend that list. If approved,
`CLAUDE.md` should be updated in the same PR that ships this feature so the non-negotiables stay
truthful (same discipline already applied when Blog was added 2026-08-14).

---

## 1. What changed on X's side (real research, not assumed)

X retired its old Free/Basic/Pro subscription tiers. As of **2026-02-06**, every new developer is
on **pay-per-use**: you buy credits at `console.x.com` and each API call debits credits directly.
Legacy Basic ($200/mo) subscribers were force-migrated after 2026-06-01; legacy Pro ($5,000/mo)
is being force-migrated after 2026-09-01. There is no meaningful free tier left for a new app.
[[Sources: docs.x.com, Blotato pricing guide]]

**Real per-call pricing (pay-per-use, 2026):**

| Action | Cost |
|---|---|
| Create a plain-text or media post | **$0.015** |
| Create a post that contains **any URL** | **$0.20** (≈13× the plain-post price) |
| Delete a post | $0.010 |
| Read your own posts/data | $0.001 |
| Read someone else's posts | $0.005 |
| Read user/follower/trend data | $0.010 |
| Direct message | $0.015 |

Media upload itself (`/2/media/upload/*`) is not separately metered in the sources checked — cost
attaches to the post-create call, not the upload.

**This has one real product implication worth flagging now, before any build work**: ScalePods
posts routinely carry a CTA link (to scalepods.co, a blog post, a LinkedIn article, etc.). If that
link goes into the X post body, every one of those posts costs **13× more** than a link-free post.
Common workarounds other tools use — link in the account bio, link in a reply instead of the post
body, or a link-shortener the algorithm doesn't visually flag as a URL — don't reliably dodge X's
own URL detection, so I'm not treating any of them as a real cost dodge. This needs an explicit
decision (see §7) rather than silently either eating the cost or silently stripping links.

Approval to get `tweet.write` access is light — X asks for a one-line description of intended use
during app creation at `console.x.com`, reviewed for policy compliance (AI/bot use cases get more
scrutiny, which a "scheduled brand posting" app is not). No partner application needed.

## 2. Auth: OAuth 2.0 Authorization Code + PKCE (mandatory, no way around it)

X API v2 posting **requires OAuth 2.0 user-context tokens** — there's no static bearer/app-only
path for writes. Concretely:

1. Register an app at `console.x.com`, set **App permissions → Read and write**.
2. Build an authorize URL (`https://x.com/i/oauth2/authorize`) with `code_challenge`
   (PKCE) + `state`, redirecting the ScalePods X account owner to approve.
3. Exchange the returned `code` for an access token + refresh token at
   `https://api.x.com/2/oauth2/token`.
4. Scopes needed: `tweet.write`, `tweet.read`, `users.read`, `media.write`, plus
   **`offline.access`** so the refresh token is issued (access tokens expire; without
   `offline.access` a human has to re-approve manually when it expires — not acceptable for an
   unattended n8n workflow).

**This is the same shape of problem LinkedIn's own OAuth already is in this project** (one-time
human consent, long-lived refresh token stored as an n8n credential) — no new pattern for the
team, just a new credential to walk through once.

## 3. How to actually call it from n8n — reuse the native node, not raw HTTP

Unlike the LinkedIn Buffer workaround (raw GraphQL over HTTP, because Buffer has no native n8n
node), **n8n ships a native X (Twitter) node with OAuth2 + PKCE built in** (available since n8n
0.236, replacing the deprecated OAuth 1.0a node). It natively supports:
- Posting text + media (images/video) in one operation — it handles the INIT → APPEND → FINALIZE
  chunked media upload internally, no custom Code node needed.
- Replies (useful for a link-in-first-reply approach if that's the cost decision in §7).
- Using n8n's predefined X OAuth2 credential type — set app permission to **Read and write and
  Direct message**, paste n8n's generated redirect URI into the X app's callback field, select the
  scopes above (the predefined credential type exposes all 14 X scopes as checkboxes) — no
  hand-built OAuth flow required.

**This means the X branch of the Publishing Engine is structurally simpler than the LinkedIn/
Buffer branch**: one native node call instead of a multi-step GraphQL + status-polling chain,
because X's own API is synchronous (a successful `POST /2/tweets` response means it's live,
no async "shareNow vs queued" ambiguity like Buffer had).

## 4. Post-content constraints (what the FE/GPT prompts need to respect)

- **280 characters** for a standard (non-Premium-verified) account — the ScalePods X account, once
  created, will be on this limit unless X Premium is purchased for it (a separate, ongoing cost
  decision, not part of this plan).
- Up to **4 images**, or 1 GIF, or 1 video per post (never mixed).
- Video: 20 min / 8 GB on a standard account (125 min / 16 GB on Premium) — well inside what
  Video Studio already produces, so no format-side blocker there.
- No native "swipeable carousel" like LinkedIn's PDF/carousel — X's 4-image post is 4 images shown
  in a grid, not a slide deck. AI Studio carousels would need to either post as a 4-image X post
  (losing the per-slide narrative order) or route to X as a single-image post only. This needs a
  product decision, not a technical one (see §7).

## 5. Where this plugs into the existing codebase

Following the same integration points every other platform already uses:

- **`src/lib/publishing.ts:42`** — `ACTIVE_PLATFORMS = ['instagram', 'linkedin', 'facebook',
  'youtube']` gets `'x'` (or `'twitter'`) appended. This one array already gates platform
  selection across Publishing/Calendar/Composer.
- **`src/components/CreatePostModal.tsx`** — the platform picker, `PlatformBadge`, and the
  existing **"Different per platform" caption override** (already built, used today for
  cross-posting the same media with per-platform copy) are the natural home for a per-platform
  280-char counter/hard-stop on the X caption box specifically — no new UI pattern needed, just a
  length guard scoped to `p === 'x'`.
- **`src/lib/content.ts`** — the auto-engine content-type filter (`static_image | carousel |
  social_caption`) stays as-is; X becomes a destination platform for those same content types, not
  a new content type.
- **n8n `ScalePods · Publishing Engine`** (`BT0liCZ4RbZDTBjY`) — add an `X: Config` /
  `X: Build Request` / `X: Create Post` branch off the existing platform-router pattern, using
  the native X node (see §3), converging into the shared result node the same way the LinkedIn
  Buffer branch does today (`source === 'x'` discriminator).
- **Spend + safety gates** — reuse what's already in place rather than building new plumbing:
  `PUBLISHING_ENABLED` (`src/lib/content.ts`) as the master kill switch, and the
  `spend_events`/`monthly_spend_cap_usd` infra from Team Collaboration Phase 6 to track the
  per-post $0.015/$0.20 spend the same way Video Studio tracks its per-video Veo spend — including
  a real-cost confirmation the first time a post would trigger the $0.20 linked-post charge,
  matching the discipline AI Studio and Video Studio already apply before any real spend.

## 6. Rough build inventory

**New:**
- One X developer app + OAuth2 app-permission setup (console.x.com) — user-side, one-time.
- One n8n X OAuth2 credential (one-time human consent flow, refresh token stored by n8n).
- ~4-5 new n8n nodes (Config / Build Request / Create Post / Result branch) — smaller than the
  LinkedIn Buffer branch since no status-polling loop is needed.
- FE: platform entry in `ACTIVE_PLATFORMS`, `x` case in `PlatformBadge`/icon set, 280-char counter
  on the X caption block, publish-cost display for the $0.015 vs $0.20 linked-post case.
- `spend_events` wiring for the per-post X charge.

**Reused, not rebuilt:** the entire composer (multi-platform select, per-platform caption
override, media picker, scheduling), the Publishing Engine's existing router/result-convergence
pattern, `spend_events`/spend-cap infra, `PUBLISHING_ENABLED` kill switch, Recent/Ready-to-publish
grids (already newest-first with relative-time badges as of 2026-09-15).

## 7. Open questions — need answers before a TRD/build

1. **CLAUDE.md update** — confirm X should be formally added to the platform non-negotiables list
   (currently explicitly excludes anything beyond IG/YT/FB/LinkedIn/Blog).
2. **Link-in-post cost decision** — accept the $0.20/linked-post charge as normal cost of doing
   business, or adopt a policy (e.g., CTA link goes in a reply instead of the post body, or X
   posts simply don't carry the link and rely on bio/other channels for click-through)? This
   changes both the GPT prompt and the n8n branch logic.
3. **Which X account** — a new ScalePods-owned handle, or an existing one? Determines who runs the
   one-time OAuth consent.
4. **X Premium or not** — affects the 280-char limit and video length ceiling; a recurring
   subscription cost separate from the pay-per-use API cost, so it's a real budget line, not a
   toggle.
5. **Carousel handling** — post AI Studio carousels to X as a 4-image grid (loses slide order), or
   simply exclude X from carousel cross-posts and treat it as single-image/text/video only for v1?
6. **Spend cap default** — what monthly cap should X publishing sit under in `spend_events`, given
   $0.015-$0.20 per post is materially cheaper per-action than image/video generation but adds up
   with a fifth platform now length-limited to 280 characters (more, smaller posts)?

---

## Appendix — sources checked

- `docs.x.com/x-api/posts/create-post` — endpoint spec, request fields, media limits
- `docs.x.com/x-api/media/quickstart/media-upload-chunked` — chunked upload spec
- `docs.x.com/resources/fundamentals/authentication/oauth-2-0/user-access-token` — OAuth2 PKCE flow
- Blotato, Postproxy, Xpoz, Sorsa 2026 pricing breakdowns (cross-checked for the pay-per-use
  numbers above, consistent across sources)
- `docs.n8n.io/integrations/builtin/credentials/twitter` — native n8n X node OAuth2 setup
- n8n community threads confirming OAuth2 PKCE is mandatory and `media.write` scope requirement
