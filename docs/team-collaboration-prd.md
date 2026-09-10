# Team Collaboration & Access Control — PRD + Implementation Plan

**Status:** Approved · **Phases 0–3 shipped 2026-09-11** · **Owner:** marketing@scalepods.co

> **Progress:** Phases 0 (identity), 1 (Users & Access), 2 (UI enforcement) and 3 (the RLS
> rewrite) are built and verified. **Permissions are now enforced by Postgres**, not just by the
> interface — the constraint that held since Phase 0 is lifted, and the team can be activated.
> §13 records the decisions that changed during the build.
>
> **Next up — Phase 4, the Kanban board.** Phases 5–7 (notifications, spend caps, docs) follow.

Covers: real multi-user identity, per-feature access control, a Jira-style Kanban board with a
maker–checker gate, per-user notifications (in-app + email), and per-user spend caps.

Read alongside `docs/PRD.md` (product scope) and `docs/TRD.md` (system contracts). This document
supersedes the "single-login, three role views" assumption those two were written under.

---

## 1. Why this is bigger than "add a Kanban board"

Four findings from the current codebase and database decide the shape of the whole plan. None of
them are blockers, but all four mean this is **introducing multi-user identity into an app that
has never had it**, not adding a feature next to the ones that exist.

| # | Finding | Where | Consequence |
|---|---|---|---|
| 1 | **One user account exists.** `auth.users` holds exactly one row: `marketing@scalepods.co`, provider `email`. | Supabase `auth.users` | Every "who did this" field in the app has never had a second value. There is no user table to hang permissions off. |
| 2 | **Roles are cosmetic.** `Role = 'admin' \| 'client' \| 'designer'` is read from and written to **localStorage**. The sidebar dropdown just changes which nav items render. | `src/lib/theme.ts:39`, `src/components/AppShell.tsx:274` | Today anyone can become Admin by picking it from a dropdown. This must be deleted, not extended — it is the opposite of an access-control mechanism. |
| 3 | **RLS is wide open.** All 23 tables carry exactly one policy: `auth_all — ALL — USING (true) WITH CHECK (true)`. | `pg_policies` | Any authenticated user can read and write every table directly via the API. UI gating alone would be decorative. |
| 4 | **Notifications aren't addressed to people.** `notifications.profile_id` is a **business** profile id (`business_profiles`), not a user id — and `listNotifications()` doesn't filter on it at all. 27 of 31 rows have it null. | `src/lib/notifications.ts:23` | The bell is currently a shared activity feed. Per-user targeting needs a new `user_id` column, not just a query change. |

**What already works and gets reused rather than rebuilt:**

- **In-app notifications end-to-end** — `notifications` table, `NotificationBell`, and a live
  Realtime subscription that invalidates the bell on insert (`useRealtimeSync`,
  `src/lib/queries.ts:198`). Only targeting is missing.
- **Branded email over Amazon SES** — n8n workflow `ScalePods · Notifications`
  (`fPdqb8ghKpiUIX1K`), active, SMTP credential `AMAZON SES` bound, sending from
  `marketing@scalepods.co`. It is hardcoded to one recipient (`info@scalepods.co`) and one
  payload shape (a `content_items` row), so it needs a sibling workflow, not a rewrite.
- **A working approve / send-back loop** — Creative Review already does maker–checker for content
  (`approveItem` / `sendBackForRevision`, `src/lib/content.ts:276`). The Kanban gate should mirror
  its vocabulary, not invent a second one.
- **Route-level code splitting and a grouped sidebar** — adding a permission filter is a change to
  one `.filter()` in `AppShell`, plus a route guard.

---

## 2. Decisions taken

Confirmed 2026-09-10 before drafting:

1. **Real database enforcement.** RLS is rewritten so permissions hold in Postgres, not just in
   the UI. A designer cannot read Analytics even with a raw API call.
2. **Tickets are freeform *and* linkable.** Jira-style tickets that stand on their own, with an
   optional link to a content item, video job, carousel job, studio job or blog post.
3. **Google sign-in restricted to `@scalepods.co`.** Supabase Google provider, domain-gated. No
   passwords to manage.
4. **Designers may spend, under a per-user monthly cap** set in the Users screen; hitting the cap
   blocks generation until an admin raises it.

---

## 3. Goals / Non-goals

**Goals**
- Named humans sign in as themselves; every action is attributable.
- An admin creates users and grants per-feature access from the front end, with no SQL and no
  Supabase dashboard visit.
- Work is assigned, tracked on a board, submitted, and accepted or sent back — with both sides
  notified in-app and by email.
- Access control is enforced by the database.
- Paid generation stays bounded per person.

**Non-goals (this phase)**
- Sprints, story points, burndown charts, epics, or Jira's issue-linking graph.
- Time tracking / worklogs.
- Per-business-profile permissions (a user has one permission set across all business profiles;
  see §11).
- A public/external client portal. The existing `client` role stays an internal view.
- Migrating existing content-approval flows onto tickets. They coexist; §7.4 links them.

---

## 4. People and roles

Seeded on first deploy. Everyone signs in with their `@scalepods.co` Google account.

| Name | Role | Access |
|---|---|---|
| marketing@scalepods.co | **Owner** | Everything, including Users & Access. Cannot be suspended or demoted by anyone else. |
| Palki | **Admin** | Everything, including Users & Access and assigning work. |
| Raunak | **Admin** | As above. |
| Adnan | **Admin** | As above. |
| Puja | **Designer** | Studios, Creative Review, Calendar, Board. No Publishing, Settings, Business or Analytics. |
| Priya | **Designer** | As above. |
| Pratham | **Content Writer** | Blog, Content, Strategy (view), Creative Review, Calendar, Board. No Studios spend, no Publishing. |

**Roles are presets, not cages.** A role sets a starting permission bundle; every individual
permission is then overridable per user from the Users screen. Name, role and each permission are
editable after creation, and new users can be added from the front end at any time — that is what
"role and particular name to be changed as well as edit" means in practice.

Existing roles `client` and the old localStorage `designer`/`admin` toggle are removed. `client`
returns as a real, assignable role preset with view-only access to Strategy, Calendar, Analytics
and Creative Review.

---

## 5. Permission model

### 5.1 Grain

Each user gets one **access level per feature**:

| Level | Means |
|---|---|
| `none` | The feature is invisible: no sidebar item, the route redirects, the database refuses. |
| `view` | Read-only. Can open the page and see everything on it. |
| `edit` | Can change drafts, prompts, copy, schedules — anything reversible and free. |
| `full` | Can take the feature's consequential action: spend money, publish, approve, change credentials. |

Four levels rather than a flat on/off is what makes "a designer can edit the video prompt but
can't fire the $3 render" expressible without a second permission axis.

### 5.2 The full feature catalogue

Every screen in the Growth OS, with what each level unlocks and the role defaults.

| Feature key | Screen | `view` | `edit` | `full` | Owner/Admin | Designer | Writer | Client |
|---|---|---|---|---|---|---|---|---|
| `dashboard` | Dashboard `/` | See KPIs | — | — | full | view | view | view |
| `business` | Business `/clients` | See profiles | Edit profile, competitors | Create/delete profiles | full | none | none | none |
| `trends` | Trends `/trends` | See signals | Select, tag | Run a trend scan | full | none | view | view |
| `strategy` | Strategy `/strategy` | See strategies | Edit | Generate a strategy | full | none | view | view |
| `studio` | AI Studio `/studio` | See jobs | Edit prompts/copy | **Generate (spends)** | full | full | edit | none |
| `carousel_studio` | Carousel Studio | See jobs | Edit slides | **Render (spends)** | full | full | edit | none |
| `video_studio` | Video Studio | See jobs | Edit shots/script | **Generate (spends)** | full | full | none | none |
| `content` | Content Factory `/content` | See runs | Edit items | Run the engine | full | none | edit | none |
| `review` | Creative Review `/review` | See queue | Comment, edit copy | **Approve / send back** | full | edit | edit | full |
| `calendar` | Calendar `/calendar` | See schedule | Move/reschedule | — | full | view | edit | view |
| `publishing` | Publishing `/publishing` | See queue | Schedule | **Publish now, cancel** | full | none | none | none |
| `blog` | Blog `/blog` | See posts | Write, edit | **Publish to scalepods.co** | full | none | edit | view |
| `analytics` | Analytics `/analytics` | See metrics | — | Refresh, run AI insights | full | none | none | view |
| `intelligence` | Intelligence `/intelligence` | See reports | — | Run analysis | full | none | none | view |
| `board` | **Kanban `/board`** (new) | See board | Create/edit own tickets | **Assign to others, force-move, delete** | full | edit | edit | none |
| `settings` | Settings `/settings` | See own profile | Own preferences | **Connections, credentials, automations** | full | edit | edit | edit |
| `users` | **Users & Access** (new) | — | — | **Create/edit/suspend users, set permissions** | full | none | none | none |

Always available to every signed-in user, ungated: **User Manual** `/manual` and the external
**Support AI** link. A person who cannot find the manual cannot learn their way out of confusion.

`settings` at `edit` shows only the user's own profile, theme and notification preferences —
the Instagram/Canva connections and safety flags are `full`-only.

---

## 6. Data model

### 6.1 New tables

```sql
-- One row per human. NOTE: `id` is its own uuid, NOT a FK to auth.users — see §13.1 for why.
create table app_users (
  id                      uuid primary key default gen_random_uuid(),
  auth_user_id            uuid unique references auth.users(id) on delete set null,
  email                   text not null,   -- unique on lower(email)
  full_name               text not null,
  avatar_url              text,
  role                    text not null default 'designer',   -- owner|admin|designer|writer|client
  status                  text not null default 'invited',    -- invited|active|suspended
  monthly_spend_cap_usd   numeric,                            -- null = uncapped (owner/admin)
  email_notifications     boolean not null default true,
  last_seen_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Sparse override table: a row exists only where the user's level differs from nothing.
-- Absent row === 'none'. Role presets are applied by writing rows, not by implying them at
-- read time — so what the Users screen shows is exactly what the database enforces.
create table user_permissions (
  user_id  uuid not null references app_users(id) on delete cascade,
  feature  text not null,
  level    text not null default 'none',   -- none|view|edit|full
  primary key (user_id, feature)
);

-- Board columns are data, not an enum — admins rename and reorder them (§7.3).
create table board_columns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  position    int  not null,
  is_terminal boolean not null default false,  -- "Done": entering requires acceptance
  is_review   boolean not null default false,  -- "In Review": the checker's queue
  created_at  timestamptz not null default now()
);

create table tickets (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,              -- SP-101, auto-assigned by trigger
  profile_id     uuid references business_profiles(id) on delete set null,
  title          text not null,
  description    text,
  type           text not null default 'task',      -- task|design|copy|video|blog|bug
  priority       text not null default 'medium',    -- highest|high|medium|low|lowest
  column_id      uuid not null references board_columns(id),
  position       numeric not null,                  -- fractional index for drag-reorder
  reporter_id    uuid references app_users(id),     -- who raised it
  assignee_id    uuid references app_users(id),     -- the maker
  reviewer_id    uuid references app_users(id),     -- the checker
  start_date     date,
  due_date       date,
  labels         text[] not null default '{}',
  linked_kind    text,   -- content_item|video_job|studio_job|carousel_job|blog_post
  linked_id      uuid,
  submitted_at   timestamptz,
  accepted_at    timestamptz,
  rejection_note text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table ticket_comments (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references tickets(id) on delete cascade,
  author_id  uuid not null references app_users(id),
  body       text not null,
  mentions   uuid[] not null default '{}',   -- @-mentioned app_users, notified individually
  created_at timestamptz not null default now()
);

-- Append-only. Powers the ticket's History tab and is the audit trail for maker-checker.
create table ticket_activity (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references tickets(id) on delete cascade,
  actor_id   uuid references app_users(id),
  action     text not null,   -- created|assigned|moved|submitted|accepted|rejected|commented|edited
  detail     jsonb,           -- { from, to, field, ... }
  created_at timestamptz not null default now()
);

-- Every real spend, from every surface. This is what the monthly cap reads.
create table spend_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app_users(id),
  feature    text not null,          -- studio|carousel_studio|video_studio
  job_id     uuid,
  amount_usd numeric not null,
  created_at timestamptz not null default now()
);
```

Ticket keys come from a sequence plus a `before insert` trigger, so `SP-101` is assigned
atomically and never reused. Prefix is a constant, changeable in one place.

### 6.2 Changes to existing tables

| Table | Change | Why |
|---|---|---|
| `notifications` | **Add `user_id uuid references app_users(id)`.** Keep `profile_id` as-is. | Finding #4 — there is currently no way to address a notification to a person. Null `user_id` continues to mean "everyone", so the 31 existing rows stay valid. |
| `notifications` | `listNotifications()` filters `user_id.is.null,user_id.eq.<me>` | Makes the bell personal without losing broadcast announcements. |
| `content_items` | Add `assigned_to uuid references app_users(id)` | Lets Creative Review show "yours" vs "the team's", and lets a ticket's acceptance write back. |
| all 23 tables | Drop `auth_all`, add real policies | §7.6. |

---

## 7. Feature specs

### 7.1 Identity — Google sign-in

- Enable the **Google provider** in Supabase Auth with a Google Cloud OAuth client (§10).
- The Login page gains a primary **Continue with Google** button. Email/password stays as a
  secondary path so `marketing@scalepods.co` keeps working and nobody is locked out if the OAuth
  client is misconfigured.
- **Domain restriction is enforced twice.** Google's `hd` hint is a UX convenience and can be
  spoofed; the real gate is a Postgres `before insert` trigger on `auth.users` that rejects any
  address not ending in `@scalepods.co` and not already on an allowlist. Belt and braces, because
  a "sign in with Google" button with only a client-side domain check is an open door.
- **First sign-in bootstrap:** a trigger creates the matching `app_users` row. If an admin already
  invited that email, the invited row is claimed (status `invited` → `active`) and keeps its
  pre-set role and permissions. If not, the user is created with `status='suspended'` and **no**
  permissions — an unexpected scalepods.co account gets in the door and no further. Admins see it
  in the Users screen as "Awaiting approval".
- Name and avatar are seeded from the Google profile and remain editable.

### 7.2 Users & Access screen

New page at `/settings/users`, reachable from a **Team** card in Settings and from a sidebar entry
under Insight, both visible only with `users: full`.

**List view** — one row per person: avatar, name, email, role badge, status, last seen, spend this
month against cap. Filter by role and status. Search by name or email.

**Create user** — a modal taking name, email (must be `@scalepods.co`), role, and an optional
spend cap. Applies the role preset, writes `app_users` + `user_permissions`, and sends an invite
email. The person then signs in with Google and lands on their claimed account.

**Edit user** — a full-page detail with:
- Name, role and status (active / suspended) — all editable.
- **The permission matrix**: every feature from §5.2 as a row, with four radio segments
  (None / View / Edit / Full). Changing the role re-applies its preset and visibly resets the
  matrix; individual overrides after that are kept and marked as "customised".
- Monthly spend cap, with current month's usage shown beneath it.
- Email notification preference.
- A danger zone: suspend (blocks sign-in, keeps history) and delete (only if the user owns no
  tickets; otherwise suspend is offered instead).

**Guardrails.** The Owner cannot be demoted, suspended or deleted. An admin cannot remove their
own `users: full` (no locking yourself out). The last remaining `users: full` account cannot be
suspended. These are enforced in Postgres, not just disabled in the UI.

### 7.3 The Kanban board

New page at `/board`, sidebar entry **Board** in a new "Team" group above Insight.

**Columns**, seeded to match your Jira board exactly and renameable by admins:

`Backlog` · `Not Started` · `In Progress` · `Selected for Development` · **`In Review`** · `On Hold` · `Done`

> **One addition to flag: `In Review`.** Your six columns have no place for "the designer finished,
> the assigner hasn't looked yet" — which is precisely the maker–checker moment. Without it, either
> Done means "claimed done" (and the checker gate is invisible) or work sits in In Progress after
> it's finished. `In Review` is where a submitted ticket waits for its reviewer. Say the word and
> I'll drop it and gate the Done transition instead, but I'd keep it.
>
> Also worth a moment: **"Selected for Development"** is Jira's software vocabulary. For this team
> "Ready to Start" or "Queued" may read better. Columns are data, so this is a one-field change
> whenever you decide — it doesn't need settling now.

**Board UI** mirroring your screenshot:
- Horizontally scrolling columns with a per-column count and a `+ Create` affordance.
- Ticket cards showing key, title, type icon, priority marker, due date (turning amber when
  within 48h and red when overdue), and the assignee avatar.
- **Avatar filter row** at the top — every team member's avatar; click to filter to their tickets,
  which is the "search for all users profile in our circle" behaviour.
- A text search across key, title and description.
- Filters for type, priority, label, business profile, and due window.
- **Drag and drop** between columns and to reorder within a column, using fractional positions so
  a move is one row update, not a renumbering of the column.
- Empty columns render as visible drop targets, not blank space.

**Permissions on the board:** `board: edit` lets a person create tickets, edit tickets they report
or are assigned, comment, and move their own tickets. `board: full` adds assigning to other
people, editing anyone's ticket, force-moving past the review gate, renaming columns, and deleting.
That is exactly your split: Palki, Raunak and Adnan assign; Puja, Priya and Pratham receive, and
can also **raise their own tickets** — which you asked for and which the `edit` level covers.

### 7.4 Ticket detail and the maker–checker gate

A ticket opens in a right-hand drawer (fast to scan, keeps board context) with a deep link at
`/board/SP-101` so a ticket can be pasted into chat.

**Contents:** title and description (rich text), type, priority, assignee, reviewer, reporter,
start and due dates, labels, business profile, linked asset, comments, and a History tab fed by
`ticket_activity`.

**The linked asset** is the part that makes this more than a standalone tracker. A ticket can point
at a content item, video job, studio job, carousel job or blog post. The drawer renders a live
preview of it with a button through to the real screen, and the board card shows a small thumbnail.
Linking is optional and can be added after creation.

**The maker–checker cycle:**

1. **Assign.** An admin creates a ticket and sets `assignee_id` (the maker) and `reviewer_id`
   (the checker, defaulting to the person assigning). → notification to the assignee, in-app and
   by email.
2. **Accept the work.** The assignee sees it, and moves it to In Progress. There is no separate
   "accept the assignment" click — moving it is the acknowledgement, and the History tab records
   who moved it and when. *(If you want an explicit Accept/Decline step on assignment, say so —
   it's a small addition, but it adds a click to every ticket and most teams stop using it.)*
3. **Submit.** When done, the assignee hits **Submit for review**. The ticket moves to In Review,
   `submitted_at` is stamped, and the reviewer is notified in-app and by email. An assignee cannot
   move a ticket into Done directly — the gate is enforced by a database trigger, not by hiding
   the column.
4. **Accept or send back.** The reviewer gets **Accept** and **Send back**, the same vocabulary
   Creative Review already uses. Accept stamps `accepted_at` and moves it to Done. Send back
   requires a note, clears `submitted_at`, returns it to In Progress, and notifies the assignee
   with the note. Both write to `ticket_activity`.
5. **Write-back.** If the ticket has a linked content item and the reviewer has `review: full`,
   accepting offers to approve that content item in the same click — one action instead of
   remembering to do the same thing in two screens.

A ticket can cycle steps 3–4 any number of times; the History tab shows every round.

### 7.5 Notifications

**In-app** reuses the existing `notifications` table, bell and Realtime subscription — the only
change is writing `user_id` and filtering on it. **Email** gets a new n8n workflow
`ScalePods · Team Notifications` (webhook `sp-team-notify`) taking a generic
`{ to, subject, heading, body, link }` payload and reusing the bound `AMAZON SES` credential and
the existing branded dark template. A new workflow rather than an edit to `sp-notify`, so the live
content-approval emails can't regress.

Every email respects the recipient's `email_notifications` preference and carries a deep link
straight to the ticket.

| Event | In-app | Email |
|---|---|---|
| Ticket assigned to you | Assignee | Assignee |
| Ticket reassigned away from you | Previous assignee | — |
| Ticket submitted for review | Reviewer | Reviewer |
| Ticket accepted | Assignee | Assignee |
| Ticket sent back (with note) | Assignee | Assignee |
| Comment added | Assignee, reviewer, reporter (minus the author) | Same |
| You were @-mentioned | Mentioned user | Mentioned user |
| Due tomorrow | Assignee | Assignee (one daily digest, not per ticket) |
| Overdue | Assignee + reviewer | Daily digest |
| New user awaiting approval | All `users: full` | All `users: full` |
| Spend cap reached | The user + all `users: full` | Same |

Due/overdue digests come from an n8n schedule trigger anchored to a real 00:00 IST, matching the
fix already made to the Trends scheduler.

### 7.6 Real enforcement — the RLS rewrite

Three `SECURITY DEFINER` helpers, so a policy can ask about permissions without recursing into
`app_users`' own RLS:

```sql
create function app_level(feature text) returns text            -- 'none'|'view'|'edit'|'full'
create function app_can(feature text, min_level text) returns boolean
create function app_is_admin() returns boolean
```

`app_can` orders the levels `none < view < edit < full` and answers "at least". A suspended user
answers `none` to everything, which is what makes suspension real rather than a UI badge.

Every table's `auth_all` policy is replaced by separate SELECT / INSERT / UPDATE / DELETE policies:

| Tables | Gated on |
|---|---|
| `business_profiles`, `competitor_search_runs` | `business` |
| `business_intelligence_reports` | `intelligence` |
| `trend_runs`, `trend_signals` | `trends` |
| `marketing_strategies`, `strategy_generations` | `strategy` |
| `studio_jobs` | `studio` |
| `carousel_jobs` | `carousel_studio` |
| `video_jobs` | `video_studio` |
| `content_runs` | `content` |
| `scheduled_posts` | `publishing` |
| `post_analytics`, `analytics_state`, `ai_insights`, `instagram_leads`, `comment_dm_log`, `follow_gate_verifications` | `analytics` |
| `blog_posts` | `blog` |
| `canva_connections`, `instagram_connections` | `settings` at `full` |
| `notifications` | own rows (`user_id = auth.uid()` or null) |
| `app_users`, `user_permissions` | read: self + any admin · write: `users` at `full` |
| `tickets`, `ticket_comments`, `ticket_activity` | `board`, with row-level rules for assignee/reporter |
| `spend_events` | read: self + admin · write: server only |

**`content_items` is the one that needs care.** It is read by Creative Review, Calendar,
Publishing, Content Factory and all three studios. Its SELECT policy therefore grants read if the
user has `view` on **any** of those; UPDATE is gated on `review: full` for status changes and
`review: edit` for copy changes. This is the single most likely place for a policy to be too tight
and break a working page, so it gets tested first and explicitly.

**Two things that must be verified before this phase ships** (see §11):
- The n8n `supabaseApi` credential must be the **service_role** key. If it is the anon key, every
  workflow that writes back to Supabase starts failing the moment RLS tightens.
- **Realtime respects RLS.** `useRealtimeSync` subscribes to `content_items`, `scheduled_posts`,
  `content_runs`, `notifications` and `blog_posts`. A user without SELECT on one of those silently
  stops receiving those events. Expected and correct — but the subscription should be built from
  the user's permissions so we aren't subscribing to channels that will never fire.

### 7.7 Spend caps

`spend_events` is written at the same moment a generation is fired, from the three functions that
already exist for the purpose — `triggerVideoRender`, the AI Studio generate path, and the Carousel
render path. Before firing, each checks the current calendar month's sum for that user against
`monthly_spend_cap_usd` and refuses with a clear message naming the cap and the current total.

The check is repeated in a Postgres trigger on the job tables, so it holds even if a request is
made outside the UI. The existing `PER_VIDEO_CEILING_USD` ($5) and the real-cost confirmation
dialog stay exactly as they are — this is a second, per-person ceiling stacked on top, not a
replacement.

Defaults: Owner and Admin uncapped; Designer $50/month; Writer $20/month; Client none. All
editable per user.

---

## 8. Implementation plan

Ordered so the app keeps working at every step, and so enforcement lands while the permission
model is still fresh rather than being deferred indefinitely.

| Phase | What | Ships | Size |
|---|---|---|---|
| **0** | **Identity.** Google provider + domain trigger, `app_users`, bootstrap trigger, Login page button, seed the 7 people. No gating yet — everyone still sees everything. | Real named sign-in | M |
| **1** | **Users & Access screen.** `user_permissions`, role presets, list/create/edit/suspend, permission matrix, guardrails. | Admin can grant access from the FE | M |
| **2** | **UI enforcement.** `useAuth` exposes real permissions; `AppShell` filters nav on them; a `<Requires>` route guard; action buttons respect `edit` vs `full`. **Delete the localStorage role switcher** and `theme.ts`'s `Role`. | Permissions visibly bite | M |
| **3** | **RLS rewrite.** Helpers, then table-by-table policy replacement, developed on a Supabase branch and verified with a real second login per role before merge. | Permissions actually bite | **L — highest risk** |
| **4** | **Kanban board.** All ticket tables (born with correct RLS), board UI, drag and drop, filters, avatar row, ticket drawer, maker–checker gate, asset linking. | The board | **L — largest** |
| **5** | **Notifications.** `notifications.user_id`, personal bell, `sp-team-notify` n8n workflow, the §7.5 matrix, digest scheduler, per-user preference. | Both sides get told | M |
| **6** | **Spend caps.** `spend_events`, write on every paid path, pre-flight check, DB trigger, usage display in the Users screen. | Bounded spend | S |
| **7** | **Manual + docs.** New Board and Users sections in `/manual`, role-aware manual content, TRD update. | Per the standing rule that the manual ships with the feature | S |

Phases 0–2 are worth treating as one deliverable: individually they change little, together they
turn the app multi-user. Phase 3 is the one to schedule when there's room to verify properly —
it touches all 23 tables and a too-tight policy fails as a blank page rather than an error.

Phase 4 can run in parallel with 5–6 if useful; it shares no files with them.

---

## 9. What changes for you day to day

- The sidebar role dropdown disappears. You are whoever you signed in as.
- Puja opens the app, sees Dashboard, the three Studios, Creative Review, Calendar and Board —
  and nothing else. Not greyed out: absent.
- You create a ticket, assign it to Priya, set yourself as reviewer. Priya gets a bell
  notification and an email within seconds. She works, hits Submit for review. You get notified,
  open it, and either Accept — which can approve the linked content item in the same click — or
  Send back with a note, which lands in her inbox.
- Pratham raises his own ticket for a blog piece; it appears in Backlog with him as reporter.
- Priya hits her $50 cap mid-month; her generate buttons explain why and you get told. You raise
  it from her user page in two clicks.

---

## 10. What I need from you

| # | Item | Why | Blocks |
|---|---|---|---|
| 1 | **Google Cloud OAuth client ID + secret.** Authorised redirect URI: `https://oyfudqqypvpqsyrjqnfy.supabase.co/auth/v1/callback` | Only you can create this in Google Cloud Console. | Phase 0 |
| 2 | **The seven exact `@scalepods.co` addresses** for Palki, Raunak, Adnan, Puja, Priya, Pratham (+ confirm the Owner account). | Invites and seeding. | Phase 0 |
| 3 | **Is Amazon SES out of sandbox?** In sandbox it can only send to *verified* addresses — team emails would silently not arrive. | Determines whether email notifications work at all. | Phase 5 |
| 4 | **Confirm `In Review` as a 7th column** (§7.3), and whether to rename "Selected for Development". | Column seeding. | Phase 4 |
| 5 | **Ticket key prefix** — `SP-101` or `SCALEPODS-101`? | One constant. | Phase 4 |
| 6 | **Spend caps** — are $50/designer and $20/writer per month right? | Defaults only; editable later. | Phase 6 |
| 7 | **Is the n8n Supabase credential the service_role key?** I can check, but you may already know. | If it's the anon key, Phase 3 breaks every workflow. | Phase 3 |

Items 1–3 are the real ones. 4–6 have sane defaults I'll use unless you say otherwise.

---

## 11. Risks and open questions

**Risks**

- **The RLS rewrite is the sharp edge.** 23 tables, one shared table (`content_items`) read by
  five features. Mitigation: build it on a Supabase branch, and verify every role with a real
  second login before merging — the same discipline the TRD already mandates for module
  round-trips.
- **SES sandbox.** If SES has never sent outside verified addresses, team email fails silently
  rather than erroring. Verify early (item 3), not at Phase 5.
- **Realtime goes quiet under RLS.** Subscriptions to tables a user can't read simply never fire.
  Expected, but it will look like a bug the first time it happens to someone.
- **n8n writes bypass the FE.** Every workflow that writes to Supabase must keep working after
  Phase 3. Item 7 settles this in one look.
- **Google account ≠ authorisation.** A new `@scalepods.co` Google account can reach the sign-in
  step. §7.1's `suspended` + zero-permission default is what makes that harmless.

**Open questions — not blocking, worth deciding before Phase 4**

- **Per-business-profile permissions.** Right now a user's permissions apply across all business
  profiles. With two profiles today that's fine; if ScalePods starts running client accounts
  through this, "Puja can work on Client A but not Client B" becomes a real requirement and the
  `user_permissions` primary key would need a `profile_id`. Cheap to add now, expensive to retrofit
  — worth a decision even though the answer today is probably "not yet".
- **Explicit assignment accept/decline** (§7.4 step 2) — a click most teams abandon. Currently
  designed as implicit.
- **Ticket attachments.** Not in the schema above. Comments can carry links, and the asset link
  covers generated content. If people need to drop reference images on a ticket, that's a Supabase
  Storage bucket and a small table — say so and I'll fold it into Phase 4.
- **Should `client` role users ever see the board?** Currently `none`. If clients should see
  progress on their own work, that's a filtered read-only board view.

---

## 12. Explicitly out of scope

Sprints, epics, story points, burndown, worklogs, issue dependencies, custom fields, workflow
automation rules, a mobile app, SSO beyond Google, and any external-facing client portal. Each is a
real feature; none is needed to assign work to Puja and know when she's done.

---

## 13. Build log — decisions that changed during implementation

Recorded here rather than silently edited into the spec above, so the reasoning survives.

### 13.1 `app_users.id` is its own uuid, not a FK to `auth.users`

§6.1 originally keyed `app_users` on `auth.users(id)`. That makes it impossible to **invite**
anyone: an invited teammate has no `auth.users` row until the first time they sign in with
Google, so there would be nothing to hang their pre-assigned role and permissions off — and
Phase 1 is entirely about assigning those before the person ever arrives.

Built instead as an own-PK table with a nullable, unique `auth_user_id` that the claim trigger
fills in on first sign-in. An invite is simply a row with `auth_user_id IS NULL`. This also
means deleting someone from Supabase Auth nulls the link (`on delete set null`) rather than
cascading away their ticket history.

### 13.2 First sign-in does NOT auto-activate the account

§7.1 had the claim flow flip an invited row from `invited` to `active`. Shipping that today
would be unsafe: RLS is still `USING (true)` on all 23 tables until Phase 3, so an
auto-activated teammate would land in an app where every table is readable and writable.

The claim trigger therefore links the account and takes the Google name/avatar, but leaves
`status` untouched. An admin switches people on from the Users screen (Phase 1) — by which
point Phase 2 and 3 have made that switch mean something. An uninvited `@scalepods.co` address
gets a `suspended` row: through Google's door, no further.

**Consequence to plan around:** the team should not be told to sign in until Phase 2 and 3 are
live. Until then, activating anyone grants them everything.

### 13.3 Trigger functions had to be revoked from `PUBLIC`, not from the roles

PostgREST publishes every function in `public` as a REST endpoint, so
`enforce_signup_domain()` and `handle_new_auth_user()` were callable by anyone at
`/rest/v1/rpc/…`. Revoking from `anon` and `authenticated` by name changed nothing — Postgres
grants EXECUTE to the pseudo-role `PUBLIC` on every new function, and both roles inherit it.
The grant to `PUBLIC` is the one that has to be revoked. Triggers keep working: a trigger's
EXECUTE permission is checked when the trigger is created, not each time it fires.

`app_is_admin()` and `app_my_user_id()` intentionally remain callable by `authenticated` —
RLS policies invoke them as the querying role — and only ever report on the caller's own
identity.

### 13.4 Known dead end while the Google provider is disabled

With the provider switched off in Supabase, `Continue with Google` redirects to Supabase's
authorize endpoint, which renders a raw JSON error (`"Unsupported provider: provider is not
enabled"`) instead of redirecting back with an error parameter. The in-app error handler never
runs and there is no way back except the browser button. This resolves itself the moment the
provider is enabled and is not worth defending against in code.

### 13.5 Pre-existing security findings, untouched

The Supabase advisor flags four issues that predate this work and were deliberately left alone:
`canva_connections` and `instagram_connections` have RLS enabled with no policies at all (so
they are currently readable only by `service_role`), the `instagram_connection_status` view is
`SECURITY DEFINER`, `rls_auto_enable()` is a publicly-callable `SECURITY DEFINER` function, and
leaked-password protection is off in Auth. Phase 3 is the natural place to resolve the first
three; the fourth is a one-click Auth setting.

### 13.6 Phase 1: `users` is not a permission, it follows from the role

PRD §5.2 listed `users` as a row in the permission matrix. Built without it: access to the Users
screen follows from `app_users.role` being owner/admin instead. A role *and* a users-permission
would be two switches for one thing, free to contradict each other (`role='designer'` with
`users='full'`?), and `app_is_admin()` already keys off the role for every database check. The
matrix therefore has 16 features, not 17.

### 13.7 Phase 1: Google identity linking skipped the profile sync

Signing in with Google as `marketing@scalepods.co` did **not** create a second auth user —
Supabase merged the Google identity into the existing email account (`auth.identities` now holds
both `email` and `google`). Good, but it meant `handle_new_auth_user()` never fired, because that
is an INSERT trigger and no row was inserted. The name and photo were never copied across.

The same gap would have applied to everyone forever: a trigger that only runs at account creation
cannot notice a photo somebody changes later. Fixed on the client instead — `syncFromProvider()`
compares the session's provider metadata against the directory row on each sign-in and patches
the difference, which needed a new `app_users_update_self` RLS policy. Scope is split
deliberately: the *policy* decides which row you may touch (your own), the `app_users_guard`
trigger decides which *columns* (role, status, email and spend cap stay admin-only). RLS alone
cannot express a column restriction, and a column GRANT would have applied to admins too.

Verified live: the owner's `avatar_url` is now the real Google photo.

### 13.8 Phase 2: `/` is deliberately left ungated

Every route carries the feature it guards except the Dashboard. A person with `dashboard: none`
would otherwise land on a wall at the root of the app with nowhere to go — the redirect target
for every other refusal is `/` itself. It stays reachable; the KPI content inside it is what a
`dashboard` grant governs.

### 13.9 Phase 2: refusals explain rather than redirect

A route the person lacks renders `NoAccess` — naming the screen and pointing at Settings → Team
& access — instead of bouncing them to the dashboard. A silent redirect is indistinguishable
from a broken link, and generates a support question rather than answering one. Action buttons
follow the same rule: they stay visible but disabled, with the required level in the tooltip.
The one exception is the danger zone in Team & access, which hides outright.

### 13.10 Phase 2: admins short-circuit the permission map

`can()` returns true for owner/admin without consulting `user_permissions`, matching what
`app_can()` will do in Phase 3 so the UI and the database agree. It also means an admin cannot
lock themselves out of their own app by mangling a permission row.

The side effect is that **Phase 2 cannot be verified from an admin account** — every gate answers
true. Proving it needs either a temporary self-demotion in SQL or a second real login.

### 13.11 Phase 2: first paint waits for permissions

`Protected` holds the spinner until the permission map has loaded, not just the directory row.
Rendering earlier showed the ungated sidebar items (manual, Support AI) alone for a beat before
the rest appeared, which reads as the app deciding you have no access.

### 13.12 Phase 3: shipped in three steps so it could be rolled back

Applied as `phase3_access_helpers`, `phase3_granular_policies`,
`phase3_status_transition_guards` and `phase3_drop_auth_all`. The middle two are **additive** —
PERMISSIVE policies OR together, so adding the real policies while `auth_all` was still in place
changed nothing observable. Only the final `drop policy auth_all` switches enforcement on, which
means the risky step is one statement per table and the rollback is one statement per table:

```sql
create policy auth_all on public.<table> for all to authenticated using (true) with check (true);
```

88 policies now stand where 21 tables previously shared a single `USING (true)`.

### 13.13 Phase 3: verified against the end state before committing to it

The whole rewrite was tested by dropping `auth_all` **inside a transaction that rolled back** and
running the matrix as the real `authenticated` role with simulated JWTs — `postgres` has
BYPASSRLS, so testing as the migration role would have proved nothing. Row visibility across ten
tables for owner / designer / writer / stranger, then ten write cases covering insert, update,
delete and both status triggers. All passed before the drop was applied for real.

One trap worth recording: **an RLS-filtered UPDATE or DELETE affects 0 rows rather than raising.**
A test that only catches exceptions reports a silent denial as a pass. Every write case checks
`GET DIAGNOSTICS row_count` instead.

### 13.14 Phase 3: `content_items` reads on any of eight features

The shared table is read by Creative Review, Calendar, Publishing, Content Factory, all three
studios and Blog. A single feature gate would have locked most of the app out of most of its own
data, so SELECT grants if the person has `view` on **any** of those eight. Verified: a designer
and a writer both still see all 49 rows, while seeing zero rows of `business_profiles`,
`scheduled_posts` and `post_analytics`.

### 13.15 Phase 3: status transitions are triggers, not policies

RLS has no column granularity, so it cannot say "you may edit the copy but not approve it" — and
that distinction is the whole difference between `edit` and `full` on Creative Review and Blog.
`content_items_status_guard` and `blog_posts_status_guard` carry that half: approving or sending
back needs `review: full`, scheduling/publishing/unpublishing needs `publishing: full`, and
publishing a blog post needs `blog: full`. Same policy-for-rows / trigger-for-columns split used
for `app_users` in Phase 1.

### 13.16 Phase 3: n8n is unaffected, and why

`service_role` has `rolbypassrls = true`, and n8n's predefined Supabase credential field is the
service-role secret — so every workflow bypasses RLS entirely and none of this reaches them. The
status-transition triggers also return early when `auth.uid()` is null, so the publish and
approve steps inside those workflows keep working. This was PRD §11's biggest listed risk; it
closed structurally rather than needing a change.

### 13.17 Phase 3: a bypass found in `instagram_connection_status`

Locking down `instagram_connections` exposed that the status view over it was a way around the
new policy. The view was created without `security_invoker`, so on PG15+ it runs with its
owner's rights — and the owner has BYPASSRLS. It had also been granted `arwdDxtm` (all
privileges, including writes) to **`anon`**, meaning an unauthenticated request could read
connection details and write through the view into the table beneath it.

Fixed by setting `security_invoker = true`, revoking `anon` entirely, and leaving `authenticated`
with SELECT only. Verified: the owner still sees the row, a designer sees none, writes through
the view are refused, and `anon` gets "permission denied". This also cleared the advisor's
long-standing `rls_enabled_no_policy` finding on `canva_connections` and `instagram_connections`,
which now carry real `settings: full` policies.

### 13.18 Phase 3: what is deliberately still open

`notifications` keeps its `auth_all` policy. It has no `user_id` column yet, so there is nothing
to scope "own rows" to — Phase 5 adds the column and the policy together rather than inventing
half of it now. Every signed-in user can currently read the whole notification feed.
