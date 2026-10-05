# Scheduled-publish orphaned "publishing" row — root cause and fix

Fixed 2026-09-28. Every scheduled post (any platform) was leaving a permanent orphaned
`scheduled_posts` row stuck at `status='publishing'`. It read as "Facebook isn't publishing" (or
"LinkedIn isn't publishing," etc) to the user, when the real post had actually gone out fine —
there were just two rows for it, and the wrong one was the one being watched.

## Root cause

Two n8n workflows, both in folder `jJEOXcM5FdAqzLE9`:

1. **ScalePods · Publishing Scheduler** (`roijjuI7ib4Ifgeu`), every 30 min: fetches due
   `scheduled_posts` rows, PATCHes the row it's about to handle to `status='publishing'` (a
   claim, so the next tick doesn't grab it again), then fires `sp-publish` — but only passed
   `{ itemId: content_item_id, scheduleNow: true }`, never the claimed row's own id.
2. **ScalePods · Publishing Engine** (`BT0liCZ4RbZDTBjY`): on success, `Log Published` always
   **inserted** a brand-new `scheduled_posts` row with the result (`status='published'`,
   `platform_post_id`, `post_url`), because it had no way to know which row the Scheduler had
   already claimed.

So a scheduled publish always produced two rows: the Scheduler's claimed one (stuck at
`'publishing'` forever) and a fresh one from `Log Published` (correctly `'published'`). Confirmed
identically on Facebook, Instagram and LinkedIn.

The same gap existed on the failure path: nothing ever wrote `status='failed'` back onto a
scheduled run's row either (only the Buffer branches even had a `stopAndError` node, and that
only stopped the workflow — it never touched the database), so a genuine scheduled-publish
failure looked identical to a still-orphaned row.

## The fix

**Success path** — thread the claimed row's id through:
- Scheduler's `Fire Publish` now sends `{ itemId, scheduledPostId: id, scheduleNow: true }`.
- Publishing Engine's `Normalize Input` captures `scheduledPostId`; `Build Context` carries it
  into its output.
- `Log Published` is now gated by a new `Has Scheduled Post Id?` IF node: when
  `scheduledPostId` is present, `Log Published (Update)` PATCHes that exact row instead of
  inserting a new one. The immediate "Post now" path (which never has a pre-existing row, since
  it skips `Log Scheduled` entirely) is untouched — it still inserts, as before.

**Failure path** — a new workflow, **ScalePods · Scheduled Publish Failure Handler**
(`Zt3XRdr4ENcaP8sP`), wired as the Publishing Engine's `errorWorkflow` setting. On any production
failure of the Publishing Engine, it reads the failed execution back via n8n's own REST API
(`GET /api/v1/executions/:id?includeData=true`, credential `N8N API(Supabase)` —
the credential named "n8n account" is *not* authorized for this endpoint and returns 401; use
the other one), pulls `Build Context`'s output out of the run data, and — only when
`scheduledPostId` is present, i.e. this was a scheduled run, not a "Post now" one — PATCHes that
`scheduled_posts` row to `status='failed'` with the real error, and mirrors the same onto the
source `content_item` (`status='failed'`, `error_message`). A "Post now" failure, or a run that
died before `Build Context` even ran, has no row to unstick and is skipped.

Both workflows are published/active.

## DB guardrail

`scheduled_posts_one_active_per_item`: a partial unique index on `scheduled_posts (content_item_id)
WHERE status IN ('scheduled', 'publishing')`. Turns this bug class (or anything like it) into a
loud constraint violation instead of a silent duplicate. Multi-platform cross-posts are
unaffected (separate `content_item` per platform); cancel-then-reschedule is unaffected (cancel
deletes the row before a new one can be created); terminal rows (published/failed) are
unrestricted.

## Cleanup

Of 21 orphaned `'publishing'` rows found (2026-09-28): 16 had a `published` sibling with a real
`platform_post_id` and were deleted as confirmed duplicates. 4 were left alone and reported to
the user, not touched:

- **2 with no sibling at all** — `1e9852d7…` (LinkedIn, 2 Sep) and `bd4a61f0…` (Instagram, 23
  Sep). Genuinely unresolved; nothing in the database says what happened to them.
- **2 whose sibling is itself `'published'` but with a null `platform_post_id`** —
  `4a976c02…`/`133cf0eb…` (Facebook, 18 Sep) and `4abefcb9…`/`d045818b…` (Facebook, 23 Sep).
  These are the same two pre-Page-token-fix Facebook posts already documented in
  `docs/edit-published-post-plan.md` §7 — Facebook actually rejected them (403,
  `publish_actions`), but the old code logged `'published'` anyway. Left as-is rather than
  silently deleted, since deciding what "resolved" means for an already-known, already-broken
  pair felt like the user's call, not a cleanup default.

## Frontend

`isStuckPublishing()` (`src/lib/publishing.ts`) and `postStatusMeta()` (`src/components/postPreview.tsx`)
treat a `'publishing'` row as **"Stuck"** (orange, non-spinning, with an explanatory line) once
it's been sitting there more than 10 minutes — used consistently in Publishing's "Recent
activity" grid, the post preview modal, and Calendar's day chips/tiles. Purely a display
decision; it never writes to the row. Deliberately did **not** also collapse duplicate rows per
`content_item_id` in the list — the backend fix plus the unique index mean new duplicates can no
longer be created, so the added complexity of a display-side dedup wasn't worth it right now.

## Verified live (2026-09-28)

- A real scheduled Facebook photo post: manually advanced its `scheduled_time` into the past,
  fired the Scheduler's real trigger, confirmed exactly one `scheduled_posts` row afterward,
  `status='published'`, real `platform_post_id`/link, then deleted the test post from the real
  Page.
- A real scheduled Facebook photo post pointed at a broken media URL: confirmed the Publishing
  Engine execution failed, the Failure Handler fired automatically, and the claimed row + its
  `content_item` both ended up `status='failed'` with the real error message.
- "Edit live post" (`post_edits` → `sp-edit-published` → `post_edit_claim`/`post_edit_finish`):
  untouched by this fix; a pre-existing edit history for other posts was confirmed present and
  unaffected.
