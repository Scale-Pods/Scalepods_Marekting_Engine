# PRD — Radar (AI Intelligence Alerts) → shipped as "Trend Alerts"

**Status:** v1 BUILT 2026-09-17 as **ScalePods Trend Alerts** (`/trend-alerts`) · **Owner:** ScalePods (marketing@scalepods.co)
**Date:** 2026-09-15 (PRD) · 2026-09-17 (build) · **Author:** Claude Code

> **Decisions from the §12 open questions (answered 2026-09-17):** name = "Trend Alerts";
> everyone can create watch items (`trend_alerts` permission granted `full` to every role);
> sidebar placement under Marketing Strategy, after Trends; check frequency is user-chosen per
> watch item from every 30 minutes to once a day, default every hour; X (Twitter) and WhatsApp
> deferred to a later phase.
>
> **What v1 actually built, and where it differs from §5-§7 below:**
> - **Sources:** Google News (free, direct RSS, no Apify), custom RSS feeds (free), Reddit / Web
>   search / YouTube (Apify, same credential as Trend Intelligence). The Google News *Apify actor*
>   from §3.2 was not needed.
> - **Most of the pipeline lives in Postgres, not n8n:** pg_cron `sp-trend-alerts-enqueue` (every
>   5 min) queues due checks and calls n8n via pg_net; similarity filtering, clustering (pgvector
>   cosine), daily stats, spike detection, rule matching, and delivery (notifications insert, Slack
>   and webhook POSTs via pg_net) are `trend_alerts_*` SQL functions. Digests are pg_cron jobs
>   `sp-trend-alerts-daily-digest` / `-weekly-digest` at 09:00 IST.
> - **One n8n workflow, not four:** `ScalePods · Trend Alerts Run` (`RUSAvRcKGy1H1zLA`) does only
>   what needs external I/O: collect → embeddings → classify (gpt-4o-mini) → explain (gpt-4o, only
>   for immediate alerts) → record cost.
> - **Cost control added:** URLs already seen for a watch item are skipped before any paid step
>   (a repeat check with nothing new costs $0 in AI), plus a per-watch monthly budget (default $25)
>   that pauses scheduled checks for the rest of the IST month.
> - **Channels in v1:** in-app + email (via the existing notifications → SES trigger), Slack
>   incoming webhook, generic webhook. Telegram deferred alongside WhatsApp.
> - **Tables** are prefixed `trend_alert_*` (watches, runs, mentions, events, rules, deliveries,
>   stats_daily) rather than `watch_*`.
> - **Verified live:** a real Google News check classified 10 mentions into 9 stories (6 alerts)
>   for $0.0126 in 37 s; an immediate repeat check found 0 new links and cost $0.
**Relates to:** [PRD.md](PRD.md) §M4 (Trend Intelligence Engine) · [TRD.md](TRD.md) §7 · `docs/team-collaboration-prd.md` (permission model, spend caps this reuses)

"Radar" is a working name so this document can talk about the feature concretely — see §12 for
naming as an open question. Everywhere below, "Radar" = the system described in your brief:
user-defined watch items (a brand, product, model, feature, or topic), continuously monitored
across multiple sources, filtered for real relevance (not keyword matching), scored for
sentiment/importance, deduplicated across sources, checked for anomalies over time, and only then
turned into an alert.

---

## 0. This is not a green-field build — read this first

Before researching new vendors, I checked what this codebase already has, because a large slice
of your brief already exists and works, just scoped differently. **ScalePods · Trend Intelligence**
(PRD §M4, `n8n` workflow `F93rrEvcaVVczo6t`, [[trend-intelligence-fabrication]]) already does:

- Scheduled, automated collection across 5 real sources (Reddit, Instagram, YouTube, Google
  Search, Google Trends) via Apify, on an already-live, already-paid-for Apify credential
  (`elQCeUo8leyvvb40`).
- Free-text keyword queries per source (not fixed hashtags/channels) — the actors your brief needs
  are the *same* actors already proven live in this exact app.
- A GPT-4o ranking pass that scores signals for relevance to the business.
- A daily scheduler, anchored to real clock time (`Asia/Kolkata` midnight), with a working
  per-profile fan-out pattern.
- A proven allow-list-and-cite discipline that stops GPT from inventing content or URLs — the
  exact anti-fabrication pattern this brief's "AI understands context" requirement needs, already
  built and battle-tested (see [[trend-intelligence-fabrication]]'s "real bugs hit" section).

**What Radar adds on top, genuinely new:**
1. A **user-defined watch list** (arbitrary keywords/entities, not just "trends relevant to my own
   business") — Trend Intelligence today only ever looks for things relevant to *ScalePods'
   *own* content strategy; Radar watches *anything* the user names.
2. **Sentiment (incl. mixed) + importance + credibility scoring** per mention, not just a
   relevance rank.
3. **Cross-source deduplication** — Trend Intelligence doesn't need this today (each source's
   signals are shown separately); Radar must consolidate "the same story on 12 sites" into one
   event.
4. **Time-series anomaly detection** — mention-volume spikes, sentiment shifts — Trend
   Intelligence has no historical trend-over-time model; it's a point-in-time scan.
5. **Configurable alert rules + multi-channel delivery** (email/Slack/Telegram/webhook) — nothing
   like this exists yet; the closest precedent is [[team-collaboration]]'s in-app notification +
   SES email system (Phase 5), which Radar's own alert delivery should reuse, not duplicate.

Recommendation baked into this PRD: **build Radar as a new, separate module that reuses Trend
Intelligence's proven data-source plumbing (same Apify credential, same actor patterns, same
anti-fabrication discipline) rather than bolting watch-lists onto the existing workflow.** The
two features serve different jobs (one is "what should ScalePods post about," the other is
"tell me when something I'm watching moves") and mixing their schemas/schedules would make both
harder to reason about. Nothing about Trend Intelligence needs to change for Radar to exist.

---

## 1. Purpose

Give a ScalePods user a way to name something they care about — a competitor, a product, a
model, a feature, a technology — and have the system watch the real internet for it continuously,
understand whether each mention actually matters (not just whether the keyword appears), track
how the conversation is changing over time, and surface only what's genuinely worth knowing,
through the channel that fits its urgency.

## 2. Goals & success criteria

| Goal | Metric |
|---|---|
| Real relevance, not keyword noise | A human spot-check of 20 accepted mentions finds ≥90% genuinely on-topic (the brief's own "OpenAI opens an office" vs "OpenAI's image model improved" test case) |
| Mixed sentiment handled correctly | A mention with both praise and criticism is stored with both, not forced into one label |
| No duplicate alerts for one event | 10 outlets covering the same story produce 1 alert citing 10 sources, not 10 alerts |
| Real anomaly detection | A genuine mention-volume or sentiment spike (≥3 standard deviations from that watch item's own rolling baseline) is caught within one collection cycle |
| Cost stays predictable | Per-watch-item monthly cost is shown to the user before they turn a watch item on, and never exceeds it — same discipline as every spend-capable feature in this app (§8) |
| Low noise | A user with 5 watch items gets a small number of real alerts a week, not a firehose — most mentions land in a digest, not a push |

## 3. Research findings — real data sources & their real cost (checked 2026-09-15)

Every figure below is from the vendor's own current pricing (Apify's own actor pricing pages via
the Apify API, OpenAI's own developers.openai.com/api/docs/pricing) — none of this is guessed,
per this project's own standing rule for anything that touches a real dollar figure.

### 3.1 Sources this reuses as-is (already integrated, already paid for)

| Source | Actor | Real pay-per-event price (FREE tier) |
|---|---|---|
| Reddit | `automation-lab/reddit-scraper` | $0.003/run + $0.00115/post + $0.000575/comment |
| YouTube | `streamers/youtube-scraper` | $0.004/video |
| Google Search (general web) | `apify/google-search-scraper` | $0.001/run + $0.0045/result page |
| Google Trends | `emreceylan/google-trends-scraper` | **Free** |
| Instagram (hashtag) | `apify/instagram-scraper` | *(pricing not re-checked this session — already live in Trend Intelligence, re-verify before enabling for Radar)* |

All five already run through this project's one Apify credential and the native
`@apify/n8n-nodes-apify.apify` node. Nothing new to set up for these.

### 3.2 New sources needed, evaluated

| Need | Recommendation | Why |
|---|---|---|
| News articles | `automation-lab/google-news-scraper` — $0.005/run + $0.0023/article | Same developer (`automation-lab`) as the already-trusted Reddit actor; cheapest credible option of 6 Google News actors compared. A "monitor mode, new articles only" variant exists on a different developer's actor (`scrapesage/google-news-scraper`) worth a look in Phase 2 to cut re-scraping cost, but isn't required for v1. |
| Blogs/RSS feeds (specific known sources — a company's own blog, a vendor's changelog) | `automation-lab/rss-feed-reader` — $0.035/run + $0.00115/item | Same trusted developer; user supplies feed URLs per watch item (optional, not required) |
| Forums (beyond Reddit) | **Deferred, no clean actor found.** Most forum platforms don't have a generic, reliable Apify actor the way Reddit/YouTube do. Google Search (already in scope) surfaces forum threads when they rank; that's the v1 answer. |
| Twitter/X | **Deferred.** X's own API moved to pay-per-use in 2026 ($0.005/read, no more $200/mo minimum) — more accessible than it used to be, but still a real recurring cost with no natural place in the free-tier-first funnel below. Revisit once the core pipeline is proven; either the official pay-per-use API or an Apify X scraper would slot in the same way News/RSS do now. |

### 3.3 The AI layer

| Task | Model | Real price | Why this model |
|---|---|---|---|
| Cheap pre-filter (near-duplicate + rough topical similarity) | `text-embedding-3-small` | $0.02 / 1M input tokens | Essentially free at this volume — used to (a) skip items that aren't even topically close to the watch item's own description before any LLM call, (b) cluster near-duplicate mentions across sources |
| Deep classification (relevance, sentiment incl. mixed, intensity, topic, importance, credibility) | `gpt-4o-mini`, batched | $0.15/1M input, $0.60/1M output | Cheap enough to run on every item that survives the pre-filter; batching ~10-12 survivors into one call (same pattern as this app's existing GPT-4o brief calls) keeps this a fraction of a cent per cycle (§8) |
| "Why does this matter" explainer, only for a high-priority spike alert | `gpt-4o` | $2.50/1M input, $10/1M output | Same model already used everywhere else in this app for real writing tasks; gated to fire rarely (only on an actual anomaly, not every cycle) so the higher per-token cost never adds up |

**This funnel is the direct answer to your own "cost optimization... avoid sending every piece of
content to an expensive LLM" requirement** — see §5 and §8 for the exact stage-by-stage cost math.

### 3.4 Notification channels

| Channel | Real integration effort |
|---|---|
| Email | **Already built** — this app's SES sending (`docs/team-collaboration-prd.md` §7.5) is reusable as-is |
| In-app | **Already built** — the `notifications` table + bell (same Phase 5 system) |
| Slack | Incoming Webhook — a URL the user pastes in, one HTTP POST per alert. No app review, no approval wait. |
| Telegram | Bot API — a bot token + chat id, one HTTP POST per alert. No approval wait. |
| Generic webhook | Whatever URL the user gives — one HTTP POST, JSON body they define. |
| WhatsApp | **Real friction, recommend deferring.** Meta's WhatsApp Business Platform needs a verified business phone number, template-message approval for anything outside a 24h customer-service window, and is a genuinely separate onboarding from the Meta app this project already has for Instagram/Facebook publishing. Not a flag-flip. |

---

## 4. Product concept

1. **Create a watch item**: a name ("OpenAI Image Generation"), a free-text description of what
   actually counts ("new model releases, quality changes, pricing changes — not general company
   news"), which sources to pull from, and a collection frequency.
2. **Radar collects on schedule** and, per §5, only escalates what survives the funnel.
3. **The watch item's feed** shows consolidated events (deduplicated, sourced, scored), each
   with: relevance score, sentiment (with a mixed-sentiment breakdown when real), importance,
   how many independent sources are reporting it, and a one-line "why this matters."
4. **Alert rules** (per watch item or global) say what should interrupt vs. what waits for a
   digest: e.g. "relevance ≥ 0.8 AND importance ≥ high → notify immediately"; "anything else →
   daily digest at 9am."
5. **A trend/anomaly view** per watch item: mention volume over time, sentiment over time, with
   spikes flagged and (for a real spike) an AI-written note on what's actually driving it.

## 5. Architecture — the cost-optimized funnel

Every stage after the first is strictly cheaper than the one before, and each stage only ever
sees what survived the previous one — this is the direct implementation of your "multiple
filtering stages... before deeper AI analysis" requirement.

```
1. COLLECT        Apify actors per source, per watch item, on its schedule.
                   → raw mentions: title, snippet/body, url, source, published_at

2. CHEAP FILTER    No LLM call. Embed each raw mention's title+snippet (text-embedding-3-small),
   (embeddings)    compare to the watch item's own description embedding (computed once, reused).
                   Below a similarity floor → discarded before anything else touches it.
                   This is the stage that kills "OpenAI opened an office" before it ever reaches
                   a classification call, cheaply.

3. DEDUPLICATE     Cluster survivors by embedding similarity within a rolling time window (e.g.
   (embeddings)    same day) — same event reported by N outlets collapses to one cluster.
                   Cluster's mention_count = N; keep the highest-credibility source as primary.

4. CLASSIFY        gpt-4o-mini, batched (10-12 clusters/call): relevance score, sentiment
   (LLM, batched)  (positive/negative/neutral/mixed — with an explicit positive_aspects/
                   negative_aspects pair when mixed), sentiment intensity, topic, importance,
                   source credibility, "is this a meaningful development" boolean.
                   Below a relevance floor → discarded (still logged, not shown).

5. TREND CHECK     No LLM call. Compare today's mention count / sentiment mix for this watch item
   (statistics)    against its own rolling mean + stddev (built from mentions history, §6). A
                   z-score past a threshold → anomaly flag.

6. ALERT RULES     Evaluate each surviving cluster + any anomaly flag against the watch item's
                   configured rules. Route to immediate notification or the next digest.

7. EXPLAIN         gpt-4o, ONLY for what actually became a high-priority alert or a real anomaly
   (LLM, rare)      — writes the "what happened, why it matters" summary.

8. DELIVER          Email / Slack / Telegram / webhook / in-app, per the user's channel config.
```

## 6. Data model (new tables — additive, nothing existing changes)

- **`watch_items`** — `id, profile_id, name, description, keywords[], sources[], frequency_minutes,
  status (active|paused), created_by, created_at`
- **`watch_mentions`** — one row per raw item that survived stage 2: `id, watch_item_id, source,
  title, body, url, author, published_at, embedding, collected_at`
- **`watch_clusters`** — one row per deduplicated event (stage 3-4 output): `id, watch_item_id,
  primary_mention_id, mention_ids[], source_count, relevance_score, sentiment
  (positive|negative|neutral|mixed), sentiment_intensity, positive_aspects, negative_aspects,
  topic, importance, credibility, is_meaningful_development, created_at`
- **`watch_stats_daily`** — the rolling baseline anomaly detection reads from: `watch_item_id,
  date, mention_count, avg_sentiment, mean_7d, stddev_7d` (materialized once per day per watch
  item, cheap to compute)
- **`watch_alert_rules`** — `id, watch_item_id (nullable = applies to all), condition_json,
  channel (email|slack|telegram|webhook|in_app), target (webhook url / slack url / telegram
  chat id / null for email+in_app), digest (immediate|daily|weekly)`
- **`watch_alerts`** — the actual sent/queued alerts, for history + "why did I get this": `id,
  rule_id, cluster_id, channel, sent_at, summary_text`

## 7. n8n workflow breakdown (mirrors Trend Intelligence's already-proven shape)

- **`ScalePods · Radar Collect`** — scheduled per watch item (or one scheduler that fans out to
  all active watch items due for a cycle, mirroring the Daily Scheduler → per-profile fan-out
  pattern already proven for Trend Intelligence). Runs stages 1-4 above, writes `watch_clusters`.
- **`ScalePods · Radar Trend Check`** — daily, computes `watch_stats_daily` + anomaly flags
  (stage 5), no LLM.
- **`ScalePods · Radar Alert Dispatch`** — evaluates stage 6 rules against new clusters/anomalies,
  fires stage 7 (rare) + stage 8 delivery.
- **`ScalePods · Radar Digest`** — daily/weekly, per user's configured cadence, batches everything
  that didn't trigger an immediate alert.

Same conventions this project already enforces everywhere: `onError: continueRegularOutput` +
retry on every external call (one flaky source degrades results, never kills the run — the exact
lesson [[trend-intelligence-fabrication]] already learned the hard way); shape-based branch
identification, not position-based; Apify actor IDs passed as expressions, not literals; publish
after every edit.

## 8. Cost model & guardrails

**Worked example** — one watch item, 5 sources (Reddit/YouTube/Google Search/Google
News/Trends), ~10 results per source per cycle, running every 4 hours (6 cycles/day):

| Stage | Cost per cycle |
|---|---|
| Collection (Reddit + YouTube + Search + News + Trends, ~40 raw items) | ≈ $0.088 |
| Embeddings (pre-filter + dedup, ~40 items × ~100 tokens) | ≈ $0.00008 |
| Classification (gpt-4o-mini, batched, ~12 survivors) | ≈ $0.0012 |
| **Total per cycle** | **≈ $0.09** |
| **Per watch item, per month (6 cycles/day × 30)** | **≈ $16** |

The explainer (stage 7, gpt-4o) only fires on a real high-priority alert — realistically a handful
of times a month per watch item, each a few cents — not part of the recurring per-cycle cost.

**This is dominated by data collection, not AI** — exactly validating your instinct that the
expensive-LLM-on-everything approach is the wrong default. A user can cut this further by
picking fewer sources, a slower cadence (e.g. every 12h → ~$8/month), or fewer results per source.

**Guardrails, reusing what this app already has rather than building new:**
- A **per-watch-item estimated monthly cost**, shown before it's turned on — same "estimate
  before you spend" pattern as every generation button in this app.
- **Reuse the existing `spend_events` + `monthly_spend_cap_usd` system** from
  `docs/team-collaboration-prd.md` §7.7 — `recordSpend('radar', watchItemId, cycleCostUsd)` on
  every collection cycle, same guard trigger, same admin-configurable per-person cap. A watch
  item whose owner is over cap simply pauses rather than silently overspending.
- A **hard ceiling on active watch items** (configurable, small default) so nobody accidentally
  runs 50 watch items at $16/month each.

## 9. Build inventory — reuse vs. new

**Reused as-is:** the Apify credential + 5 existing actors and their n8n calling pattern; the
GPT anti-fabrication/allow-list discipline; SES email sending; the `notifications` table + bell;
`spend_events`/`monthly_spend_cap_usd`; the permission system (`FeatureKey`, `FEATURES`,
`ROLE_PRESETS` in `src/lib/permissions.ts` — Radar needs one new entry there, same shape as every
existing feature).

**New:** 2 Apify actors (News, RSS) on the same credential; 6 tables (§6); 4 n8n workflows (§7);
embedding-based pre-filter + dedup (new pattern for this codebase, not reused from anywhere);
statistical anomaly detection (new); alert-rule engine (new); Slack/Telegram/webhook senders
(new, but each is a single well-documented HTTP call); a new FE surface (`/radar` — watch-item
list, per-item feed + trend chart, alert-rule config, digest settings).

## 10. Phasing

- **v1**: Reddit + YouTube + Google Search + Google News (the 4 highest-value, cheapest, already-
  proven-pattern sources). Email + in-app + Slack + webhook delivery. Manual watch-item creation.
  Daily digest. Basic z-score anomaly detection.
- **v2**: RSS (user-supplied feeds), Google Trends, Instagram. Telegram delivery. Weekly digest
  option. Mixed-sentiment breakdown surfaced in the FE, not just stored.
- **v3**: Twitter/X (once a channel is chosen — §3.2). WhatsApp (once the separate Business
  Platform approval is worth pursuing). Cross-watch-item pattern detection ("multiple watch items
  spiking on the same underlying story").

## 11. Out of scope (v1)

- WhatsApp delivery (§3.4).
- Twitter/X collection (§3.2).
- General forum scraping beyond Reddit (§3.2).
- Cross-watch-item correlation (v3).
- A public/shareable watch-item feed (this is an internal ops tool, same as the rest of this app).

## 12. Open questions for the user

1. **Name.** "Radar" is a placeholder. This app already has an `/intelligence` page (the Business
   Intelligence Report, PRD §M3) — the new feature needs a genuinely distinct name so the two are
   never confused in the sidebar or in conversation. Other options: Watchtower, Signal, Pulse,
   Monitor.
2. **Who can create watch items?** Everyone, or gated like Trend Intelligence's "run a scan"
   (`full` permission only)? My default assumption: same shape as every other spend-capable
   feature — `view`/`edit`/`full` per `src/lib/permissions.ts`'s existing convention.
3. **Where does it live in the nav?** Proposed: under "Insight," next to Analytics/Intelligence,
   since it's a read/interpret surface, not a content-generation one.
4. **Collection frequency ceiling.** I'd default to "no faster than every 4 hours" per watch item
   to keep the cost model in §8 predictable — open to a different floor.
5. **Twitter/X and WhatsApp** — confirmed OK to defer to v3 (§3.2, §3.4), or is either a launch
   requirement? Both are real, quantified cost/complexity additions, not quick wins.

## Appendix — sources checked this session (2026-09-15)

- Apify actor pricing (live, via the Apify API): `automation-lab/reddit-scraper`,
  `streamers/youtube-scraper`, `apify/google-search-scraper`, `emreceylan/google-trends-scraper`,
  `automation-lab/google-news-scraper`, `automation-lab/rss-feed-reader`, plus 5 other Google-News
  and 5 other RSS actors compared before picking these two.
- `developers.openai.com/api/docs/pricing` (via search, cross-checked against multiple current
  aggregators) — `text-embedding-3-small` ($0.02/1M input), `gpt-4o-mini` ($0.15/$0.60 per 1M),
  `gpt-4o` (already an established, verified rate elsewhere in this codebase).
- X (Twitter) API 2026 pricing change (Basic tier discontinued for new developers, pay-per-use
  $0.005/read replacing the old $200/mo minimum) — via search, multiple current sources agree.
- This codebase directly: `docs/PRD.md` §M4, `docs/TRD.md` §7, `src/lib/permissions.ts`,
  `docs/team-collaboration-prd.md` §7.5/§7.7, and the [[trend-intelligence-fabrication]] memory
  file for the real, already-solved engineering problems this build will hit again.
