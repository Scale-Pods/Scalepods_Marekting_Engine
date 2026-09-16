# X (Twitter) Publishing — Buffer vs Official X API

**Status:** comparison only, nothing built. Written 2026-09-16 as a follow-up to
`docs/x-twitter-integration-plan.md` (the official-API-only plan), after the user asked to weigh
Buffer as an alternative route.

## Real, live finding before any comparison starts

I checked the actual ScalePods Buffer account (`info@scalepods.co`, org `6aa4479360010be01c0de207`,
the same account already powering LinkedIn Company Page publishing) and:

- **An X/Twitter channel is already connected**: `INFO_ScalePods` (channel id
  `6aaa7ab9ea19ca0bde57580a`, service `twitter`, `isDisconnected: false`). Someone already linked
  an X account to this Buffer org — I didn't have to set that up.
- The org is on Buffer's **Free plan**: 3-channel limit, 10-queued-posts-per-channel limit (queue
  *depth*, not a monthly cap — a slot frees up the moment a post goes out, so this is not a real
  volume ceiling for ScalePods' posting cadence).
- **2 of 3 free channels are already used** (LinkedIn Company Page + this X profile) — connecting
  the X branch costs nothing extra on the Buffer side, no plan upgrade needed.
- n8n already holds a working Buffer credential (`6z4YJQN8V0zDFuwb`, bearer token, org-scoped —
  not channel-specific) from the LinkedIn Buffer build. The same credential authenticates calls to
  any channel in this org, X included.

This means the "connect X to Buffer" step this plan would normally have to scope as new work is
**already done**.

## Side-by-side

| | **Buffer** | **Official X API (direct)** |
|---|---|---|
| **Cost model** | Flat per-channel subscription. Free plan: $0. Essentials: $5/mo/channel (annual) if the 10-post queue cap ever becomes real. **No per-post metering, no link surcharge.** | **Pay-per-use, no free tier.** $0.015/post, **$0.20/post if it contains a URL** (13×). Every post costs money, forever, scaled with volume. |
| **Auth setup** | **Already done** — channel connected, credential already live in n8n from the LinkedIn Buffer build. | New: X developer app registration, OAuth 2.0 Authorization Code + PKCE consent flow (one human has to approve), refresh-token storage, `offline.access`/`tweet.write`/`media.write` scopes. |
| **n8n build effort** | Mirror the already-built, already-verified LinkedIn Buffer branch: new `X: Config` / `X: Build Request` / `X: Create Post` nodes with `service: 'twitter'` and the new channel id, converging into the existing shared result node the same way LinkedIn's Buffer branch does. Small, proven pattern, hours not days. | New native n8n X OAuth2 node + credential; different pattern from anything else in this workflow. Structurally simpler *per node* (X's own API is synchronous, no status-polling needed) but nothing to copy from — first of its kind here. |
| **Char limit** | Buffer enforces X's own limit: 280 (free X account) or 25,000 (X Premium/Basic connected through Buffer). | Same underlying limit — Buffer doesn't change what X itself allows, it's just a client. |
| **Media** | 4 images (5MB each) / 1 video (512MB, up to 140s) / 1 GIF (15MB) — Buffer enforces these, matches X's real limits. | Same real X limits (chunked upload handles size, not a Buffer-specific ceiling). |
| **Threads** | Supported (up to 25 sub-posts), web-composer only on Buffer's side — not directly relevant since posts here are composed by n8n/GPT, not a human in Buffer's UI, so this is a non-factor either way. | Supported natively (reply-chain of posts), same effort either path. |
| **Analytics / reads** | Buffer's own help docs say explicitly: **no impression/view data available via its API** for X. Whatever ScalePods already gets from Buffer for LinkedIn (basically just publish + status, no rich analytics) is what X would get too. | Official reads are available but **separately metered** ($0.001-$0.010 per read) — real analytics would cost money on top of posting, whichever path is chosen for publishing. |
| **Dependency risk** | Same shape as the LinkedIn Buffer branch already in production: one more third party between ScalePods and X, subject to Buffer's own uptime/rate limits and its GraphQL schema quirks (already debugged once for LinkedIn — `shareNow` vs `customScheduled`, node-group wiring, etc.). | No middleman — ScalePods' own OAuth token, ScalePods' own reliability, no Buffer outage can block a post. Longer-term the "own the channel directly" position. |
| **Reason it existed for LinkedIn** | LinkedIn's native Community Management API (needed for posting *as* a Company Page) was blocked pending approval — Buffer was the only way to post as the ScalePods Page at all. | **Not applicable to X** — nothing blocks direct official API access for X. Buffer isn't a workaround here, it's a genuine cost/speed trade-off, not a "no other option" situation like LinkedIn was. |

## What this actually comes down to

For LinkedIn, Buffer was the *only* route — there was no working official alternative. For X,
**both routes are real options**, so the choice is genuinely: pay per post forever for direct
ownership and analytics headroom, vs. pay nothing extra right now and ship in hours by mirroring a
pattern that's already live and already debugged.

Given the channel is already connected and the credential already exists in n8n, **Buffer is the
faster and, at ScalePods' current posting volume, the cheaper path to ship v1** — same conclusion
the project already reached for LinkedIn, for an overlapping reason (reuse > new integration
surface) even though the *forcing* reason (no native alternative) doesn't apply here.

The honest trade-off to flag: going through Buffer means X publishing inherits Buffer's own
quirks and one more dependency, and if ScalePods ever wants real X analytics (impressions, link
clicks) neither path gives that for free — that would mean adding direct official-API *read* calls
later regardless of which path handles *writes* today. That's a reason to keep the official-API
plan (`docs/x-twitter-integration-plan.md`) on file as the v2/migration path, not to discard it.

## Recommendation

Ship v1 through **Buffer**, reusing the existing channel + credential + branch pattern. Revisit
the direct official-API path (already fully planned in the companion doc) only if/when ScalePods
needs analytics Buffer can't provide, or outgrows the free-tier queue depth in a way that isn't
just "upgrade to Essentials $5/mo" (which is still flat-fee, still cheaper than per-post metering
at any realistic ScalePods volume).

This doesn't change any of the open questions in the official-API plan's §7 that are still
relevant here too: CLAUDE.md platform-list update, which content types cross-post to X (carousel
→ 4-image grid or excluded), and the link-in-post character-cost question — though note **the
$0.20 link surcharge is an official-API-only problem; it does not apply when publishing through
Buffer**, since Buffer's flat fee doesn't change based on post content.
