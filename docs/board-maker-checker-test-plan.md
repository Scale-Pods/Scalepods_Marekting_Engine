# Board maker–checker — end-to-end test plan

Status: **complete, 2026-09-23.** §1 and §2 below were run in full (including the designer/
writer/client-level cases, after explicit go-ahead to temporarily flip the owner's own role for
the JWT simulation — reverted immediately after, confirmed byte-for-byte identical to before).
One real bug was found and fixed: `ticket_comments_mod` was scoped `FOR ALL` instead of
`UPDATE, DELETE`, so Postgres's OR-combination of permissive policies let anyone with `board:full`
insert a comment falsely attributed to someone else, bypassing `ticket_comments_ins`'s "you can
only post as yourself" check entirely. Fixed by splitting it into `ticket_comments_upd` /
`ticket_comments_del`; verified the spoof is now refused and that self-posting plus full-level
moderation (edit/delete someone else's comment) both still work. `ticket_attachments` never had
this hole — it was built with per-command policies from the start.

Every other row in the tables below passed on the first try: full-level bypass (move/accept/
delete anything), the reviewer-only Done gate (refused for a non-reviewer assignee, allowed for
the real reviewer even at plain edit level), edit-level's "only your own ticket" restriction,
board:none (client) losing visibility into the board entirely (0 rows returned, not just 0
writes), and every frontend button-visibility case in §2. All test tickets/comments/attachments
were throwaway (`ZZ TEST` prefix) and are deleted; nothing else in the database was touched.

§3 (the real click-through) was not run — it needs a real person signed in, which is optional
and up to you.

Original plan follows, for reference.

## What "end-to-end, per user" can actually mean here

I can't literally log in as Palki, Raunak, Adnan, Puja or Vedika — I don't have (and won't ask
for) anyone's Google credentials, and per the research when I built "View as" (2026-09-22): three
of those five have **never signed in at all**, so there isn't even a session to test with for
them today. So a literal "become each person and click the buttons" test isn't available to me,
and wouldn't be even with credentials for three of the five.

What I *can* do, rigorously and without needing anyone's login, is test the same two layers that
actually decide what "how they are getting it" means in this app:

- **The database layer** — the Postgres RLS policies and the `tickets_workflow_guard` trigger,
  which are what *really* stop a non-reviewer from closing a ticket, no matter what the UI shows.
  I can call these as each role by simulating that role's JWT directly against Postgres (the same
  technique already used once before for this app's own dev QA, per `team-collaboration-prd.md`
  §13 — I'd be reusing a documented pattern, not inventing a new risk).
- **The frontend layer** — whether Board.tsx/TicketDrawer/ListView actually show the right
  buttons and hide the wrong ones for a given role. I can render these components directly with
  a fake identity for each role (the same mock-harness technique I used to verify the List view,
  the ticket modal, and "View as" itself) — real code, real render, no login needed.

Together those two layers are what "the maker-checker ecosystem" *is* — if both agree for every
role, the feature works correctly regardless of who's logged in. What they can't prove is the
literal experience of a specific named person clicking through their own real account — see
§4 for what that would take.

## 1. Database/RLS layer — per role, real SQL against the live schema

For each of **owner, admin, designer/writer (the two non-admin "maker" roles), client**, run as
that role (simulated JWT) and confirm:

| Action | Expected |
|---|---|
| Read the board (`board:view`) | Everyone with any board access sees every ticket, not just their own |
| Create a ticket, no explicit assignee | Assignee defaults to self unless the caller has `board:full` |
| Move a ticket **they are not** assignee/reporter/reviewer of | Refused, unless `board:full` |
| Move a ticket they **are** assignee/reporter/reviewer of, into a non-terminal column | Allowed |
| Move **into the terminal (Done) column** as the assignee, not the reviewer | Refused — `tickets_workflow_guard`'s exact error naming the reviewer |
| Move into Done as the real reviewer | Allowed; `accepted_at` stamped, `rejection_note` cleared |
| Move into Done as `board:full` (any admin/owner), not the reviewer | Allowed — full bypasses the reviewer check by design |
| Send a ticket back out of Review | `submitted_at` cleared, ticket lands back in Progress |
| Post a comment with `author_id` set to **someone else** | Refused |
| Post a comment with `author_id = self` | Allowed |
| Add an attachment (file or link) as self, `board:edit` | Allowed |
| Delete **someone else's** attachment without `board:full` | Refused |
| Delete their own attachment | Allowed |
| Delete a whole ticket without `board:full` | Refused |

## 2. Frontend gating — per role, mock-rendered (no login)

Using the same harness technique from the List view and ticket-modal work, render with a fake
`AppUser` for each role and confirm, purely from what's on screen:

- **Kanban card / List row**: same tickets visible regardless of role (view is not restricted
  per-person); "Create" button only for `board:edit`+.
- **Ticket modal — action buttons**: "Submit for review" only when previewed-as is the real
  assignee and the ticket isn't already in review/done; "Accept"/"Send back" only for the
  reviewer or `board:full`; "Delete" only for `board:full`.
- **Ticket modal — inline-edit sidebar**: Assignee/Reviewer/Reporter/Column dropdowns only for
  `board:full`; everyone else sees the same fields as plain text (this is the fix from
  2026-09-22 — confirming it hasn't regressed).
- **Attachments tab**: add controls visible at `board:edit`; a "remove" icon only on attachments
  the previewed person authored, or if `board:full`.
- **List view filters/Group by**: all render regardless of role (they're display-only); "Assigned
  to me" reflects the previewed person's id correctly.
- **"View as" itself**: the eye icon only renders when the real role is `owner` — confirming this
  again explicitly, since it's the newest and most sensitive piece.

## 3. A real click-through you can run yourself (optional, ~5 minutes)

Phases 1–2 prove the rules are correct for every role in principle. If you want to see the real
UI actually do it once, end to end, the one round trip a single logged-in session (you, the
owner) can genuinely exercise is:

1. Create a ticket, assign it to yourself, set yourself as reviewer too (or leave reviewer blank
   and use `board:full`'s override).
2. Submit it for review, then accept it — confirms the column/timestamp machinery fires for real,
   not just in SQL.
3. Attach a file and a link, then remove one — confirms Supabase Storage upload actually works
   (this is the one thing SQL-only testing can't touch, since it's a real HTTP upload).
4. Use "View as" to preview each role once and eyeball the nav for anything that looks wrong.

Anything beyond that — a real writer clicking their own "Submit for review", a real admin
clicking "Accept" on someone else's work — needs that actual person signed in on their own
account. That's not something I can substitute for; if you want it verified, the fastest path is
asking Adnan or Vedika (the two who have signed in before) to run steps 1–3 above themselves and
tell you what happened. Entirely your call, not something I'll chase on my own.

## 4. What you'll get back

A pass/fail table against the rows in §1 and §2, with the exact error text for anything that was
supposed to be refused and wasn't (or vice versa) — same format as a code-review report. Nothing
gets touched in the live database beyond throwaway test tickets/comments/attachments I create and
clean up myself.

---

Let me know when to go ahead.
