# Edit a published post — implementation plan

Status: **draft, awaiting your go-ahead.** Written 2026-09-25 from the platform-docs research
plus a read of the live Publishing Engine (`BT0liCZ4RbZDTBjY`), the schema, and the UI. Nothing
below is built.

## 1. What this feature is

An "Edit live post" action on a post that has already gone out, so a caption, hashtags, or a
YouTube title/description can be corrected without deleting and reposting. Which platforms can
actually do it is settled by what the platforms allow (research, 2026-09-25):

| Platform | Edit after publishing? | In this plan |
|---|---|---|
| LinkedIn, personal accounts (Hrishikesh, Adnan, Raunak) | Yes: `commentary` (caption + hashtags) | **Phase 1** |
| YouTube | Yes: title, description, tags | **Phase 1** |
| Facebook | Uncertain in Meta's docs; our ids are also missing | Phase 2 (test first) |
| X | Yes, but Premium + under 1 hour + native X API | Phase 3 (recommend skip) |
| Instagram | No (only comments on/off) | Never; explain in the UI |
| LinkedIn Company Page, X-via-Buffer | No (Buffer can't edit sent posts; Company Page holds a `buffer:` id) | Blocked, with a reason shown |
| Blog (scalepods.co) | Yes, it is our own site | Already possible, out of scope |

## 2. How the text is built today (an edit must rebuild it identically)

- The Publishing Engine's `Build Context` node builds one caption for every platform:
  `body + '\n\n' + hashtags` (each hashtag prefixed `#`). There is no CTA in it.
- LinkedIn sends that as `commentary` (`shareCommentary.text` for `ugcPosts`); YouTube sends
  `title` (first 100 chars of the title) and `description` = caption + `\n\n#Shorts`, with
  `categoryId 22` and no tags.
- `scheduled_posts.caption` stores the assembled string; `content_items.body` + `metadata.hashtags`
  are the source. The existing "edit a scheduled post" (`editScheduledPost`) writes the whole edit
  into `body` and clears `metadata.hashtags`, so nothing is appended twice. An edit of a live post
  does the same.

## 3. Design

**One safe path, not an open webhook.** Every existing `sp-*` webhook is unauthenticated, which
is fine for "please publish item X" but not for "replace this live post's text with this string".
So the text never travels in the webhook:

1. The browser inserts a row in a new **`post_edits`** table: which `scheduled_posts` row, the new
   caption/title, the old ones, who asked. RLS: insert only with `publishing: full`, and only as
   yourself. This row is also the audit trail and the edit history shown in the UI.
2. The browser then pokes a new n8n webhook `sp-edit-published` with just the row's id.
3. n8n **claims** the row (`pending` → `running`, so a replayed webhook does nothing — the same
   pattern the Trend Alerts run already uses), reads the text from the row, calls the platform,
   and writes `succeeded` or `failed` with the error back onto the row.
4. Only after the platform call succeeds does n8n update `scheduled_posts.caption`/`title` and
   `content_items.body` (+ `metadata.hashtags = []`). A failed call leaves our copy matching what
   is actually live.
5. The browser watches the row (Realtime, as the rest of the app does) and shows the result.

**Blocked, not hidden.** For a post that can't be edited, the button is shown but disabled with a
plain reason: "Instagram doesn't allow editing a published caption. Delete and repost instead",
or "Posted through Buffer, which can't edit a sent post." Nobody is left wondering where the
button went.

**Who.** `publishing: full` (admins and owner), the same level that already governs going live.
Makers can't edit a live post. Every edit is recorded with who/when/before/after.

## 4. Phases

**Phase 0: two checks before any code (need you).** Both involve a real live post, so I won't
touch one without you naming it.
- LinkedIn: confirm the n8n credentials carry `w_member_social`, and run one real
  `PARTIAL_UPDATE` on a post from each of the three accounts. The database holds both
  `urn:li:share:` and `urn:li:ugcPost:` ids (two different creation APIs), and the docs only
  clearly cover posts made through the newer `/rest/posts`. This decides whether older posts are
  editable. A test edit shows a public "Edited" label, so pick low-stakes posts.
- YouTube: one real `videos.update` on a Short, resending the full snippet (YouTube deletes any
  field you leave out).

**Phase 1: LinkedIn (personal) + YouTube.**
- Migration: `post_edits` (+ RLS, claim function).
- n8n workflow "ScalePods · Edit Published Post": claim → router → LinkedIn branch
  (`POST /rest/posts/{urn-encoded}`, `X-RestLi-Method: PARTIAL_UPDATE`, `{"patch":{"$set":{"commentary":…}}}`,
  headers `Linkedin-Version` and `X-Restli-Protocol-Version: 2.0.0`, credential picked from
  `content_items.metadata.linkedin_account`) or YouTube branch (`videos.list` then `videos.update`,
  description rebuilt as caption + `\n\n#Shorts`) → write result. Published and activated.
- UI: an "Edit live post" button in the published-post view (`ActivityPreviewModal`, which today
  shows only "View live"), a dialog with the caption (and title for YouTube), the platform's
  character limit, an "Edited" note for LinkedIn, and the edit history underneath.
- User manual entry.

**Phase 2: Facebook.** The `FB Result` node writes `post_id || id`, but both published Facebook
rows have no id, so nothing can be targeted. First fix the engine to store the id, then test
`POST /{page_post_id}` with `message` on our own Page — Meta's pages contradict each other, so it
gets tested, not assumed. Photo captions and Reels may not be editable at all.

**Phase 3: X (recommend skipping).** Editing needs X Premium on the account, a post under an hour
old, and a native X API credential; none exists (we post through Buffer). An X edit also returns
a **new** post id, so `scheduled_posts.platform_post_id` would have to be updated. Worth doing only
if you move X posting off Buffer.

**Not planned: Instagram delete-and-repost.** It's the only Instagram workaround, but it destroys
the post's likes and comments, so it's a separate decision, not part of this.

## 5. Risks I found

- **Company Page and X posts can't be edited** (Buffer). One row already holds a `buffer:` id
  with an empty link — the UI must treat any `buffer:` id as not editable.
- **Analytics is safe for LinkedIn and YouTube** (ids don't change on edit). It would only break
  for X, where an edit makes a new id.
- **Hashtag double-up:** if a user typed hashtags into the body, edits must clear
  `metadata.hashtags` exactly as scheduled-post edits do.
- **Two copies of the text** (`content_items.body`, `scheduled_posts.caption`) must stay in step;
  the "database updated only after the platform succeeds" rule is what protects that.
- **LinkedIn character limit** is about 3,000; YouTube title 100, description 5,000 — enforced in
  the dialog before anything is sent.

## 6. What I need from you

1. Go-ahead for Phase 0, and **which posts** I may use for the real test edits: one LinkedIn post
   each from Hrishikesh, Adnan and Raunak, and one YouTube Short.
2. Confirm edits should be **admins/owner only** (`publishing: full`), not editors.
3. Whether to plan Phases 2–3 now, or stop after Phase 1 and see how it's used.
