# Board List View — implementation plan

Status: **draft, awaiting approval.** Written 2026-09-22 after mapping the current Board
implementation (`src/pages/Board.tsx`, `src/lib/board.ts`, live schema on Supabase project
`oyfudqqypvpqsyrjqnfy`). Nothing in this plan is built yet.

## 1. What you asked for

A Jira-style **List view** alongside the existing Kanban board, reachable from a view switcher
next to "+ Create" on `/board`. The list shows one row per ticket — Work / Assignee / Reporter /
Priority / Status / Resolution / Created / Updated / Due date — with the same filter/group
tools Jira's list gives you, plus a way to see one person's workload over a time window (e.g.
"what did Palki get assigned in the last 7 days, and where does it stand now").

## 2. What's already there vs. what's genuinely new

The Kanban board (`tickets`, `board_columns`, `ticket_comments`, `ticket_activity` tables) is
solid and the List view reuses it as-is — no new ticket-creation logic, no new maker-checker
logic. But three things you're picturing from the Jira screenshot don't exist in this app yet,
and are net-new work, not a lift-and-shift:

- **A "Resolution" field.** Jira has a real Resolution column (Done / Won't Fix / Duplicate…).
  This app only has `column_id` (which board column) plus `accepted_at`/`rejection_note`. I'm
  proposing to **derive** a Resolution label from those instead of adding a new field (see §4) —
  it's less schema to maintain and matches what you actually track today. Say so if you want a
  real editable Resolution field instead (Won't Fix, Duplicate, etc.) — that's a bigger addition.
- **Attachments / "attach a URL or upload a file" on a ticket.** This does not exist anywhere in
  the app today — not on tickets, not on comments. It needs a new table + a Supabase Storage
  bucket (§5). Not hard — `AssetUploader.tsx` already has the upload pattern to copy — but it's
  new ground, not a config change.
- **Per-person activity tracking over a date range** ("Palki's tasks in the last 7 days"). The
  board today only has a one-click assignee filter with no date range and no group-by. Both are
  new UI (§6), reading the same `tickets`/`ticket_activity` tables that already exist.

Also worth knowing: the PRD for the original board planned type/priority/label/due-window
filters that were **never actually built** — only search + click-an-avatar-to-filter shipped.
So "let's go for it" here is also finishing filters that were already meant to exist.

## 3. View switcher

Two toggle buttons ("Board" / "List") next to "+ Create" on `/board`, both reading the same
`useQuery` calls Board.tsx already has (`listColumns()`, `listTickets()` in `src/lib/board.ts`) —
no new route, no new nav item, no new permission. Clicking a ticket in List view opens the same
`TicketDrawer` the Kanban cards already open, so comments/activity/attach/accept/reject all work
identically in both views. The chosen view is remembered per-browser (localStorage), not synced
across devices — it's a display preference, not app state worth a DB round-trip.

## 4. The List table

One row per ticket, matching your Jira reference:

| Column | Source | Notes |
|---|---|---|
| Work | `key` + `title` | e.g. "SP-101 — IG Post"; click opens the ticket drawer |
| Type | `type` | small colored dot, same as the Kanban card |
| Assignee | `assignee_id` → `app_users` | avatar + name, "Unassigned" if null |
| Reporter | `reporter_id` → `app_users` | |
| Priority | `priority` | same ↑↑/↑/=/↓/↓↓ glyph the Kanban card uses |
| Status | `column_id` → `board_columns.name` | the actual column, e.g. "In Review" |
| Resolution | **derived**: `is_terminal && accepted_at` → "Done"; `rejection_note` set and not terminal → "Sent back"; else "Unresolved" | see §2 — flag if you want a real field instead |
| Created | `created_at` | |
| Updated | `updated_at` | |
| Due date | `due_date` | overdue ones styled the same red/orange the Kanban cards already use |

No existing `<Table>` component in the codebase to reuse (checked `src/components/ui.tsx`) — the
closest precedent is the plain `<table>` in `Analytics.tsx`'s leads list. I'll build the List
view's table in that same inline-Tailwind style rather than introduce a shared `<Table>`
abstraction for a single caller — if a second table-shaped screen shows up later, that's the
moment to extract one, not before (matches this codebase's build-what's-needed convention).

## 5. Attachments (new)

A small new table, mirroring the shape of `ticket_comments`:

```sql
create table ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_id uuid references app_users(id),
  kind text not null check (kind in ('file','url')),
  url text not null,           -- Storage public URL for 'file', the pasted link for 'url'
  file_name text,               -- original filename, null for 'url' kind
  created_at timestamptz not null default now()
);
```

Plus a new Storage bucket `ticket-attachments` (same pattern as the existing buckets
`AssetUploader.tsx` already uploads to). New tab in `TicketDrawer` next to Comments/History:
"Attach file" (reuses `AssetUploader`'s upload-then-insert-row pattern) or "Attach link" (a plain
URL input, validated as `https://`). Gated on `board: edit` — the same level that lets someone
work their own ticket — so an assignee marking work done can drop proof in without needing
`full`. Deleting an attachment is `board: full` only (same asymmetry as everything else
destructive on the board).

## 6. Filters (new + reused)

Shared across Board and List (both read the same filtered `tickets` array before splitting into
columns or rows):

- **Search** — already exists, unchanged.
- **Assignee** — already exists (click an avatar); List view gets the same row above the table.
- **Reporter, Priority, Type** *(new)* — simple dropdowns, cheap to add since the fields already
  exist on every ticket.
- **Date range** *(new)* — "Last 7 days / Last 30 days / Custom", applied to `created_at` by
  default with a toggle to apply it to `due_date` instead. This is what makes "5 tasks were
  given to Vedika this week" answerable — filter by assignee + created_at range, List view, sort
  by created_at.
- **Group by** *(new, List view only)* — Status / Assignee / Priority / Type / Reporter — turns
  the flat list into headed sections, matching Jira's "Group by" dropdown. Board view doesn't
  need this since its columns already are the "Status" grouping.
- **"Assigned to me" quick chip** *(new)* — one click, filters to `assignee_id === meId`, visible
  to everyone (this is the personal-tracking view Palki and anyone else on the team gets for
  their own work, on top of what `full` users can already do by clicking someone else's avatar).

No permission changes needed anywhere in this plan — self-assignment on ticket creation and
"assigned to me" filtering both work at the existing `board: edit` level; assigning *other*
people and deleting attachments both stay `board: full`, same as every other admin action on the
board today.

## 7. What I need from you before I build

1. Confirm the derived Resolution (§2/§4) is fine, vs. wanting a real editable field.
2. Confirm attachments should support both a file upload and a pasted URL (as you described), not
   just one of the two.
3. Anything from the Jira screenshot I should treat as **out of scope** for this pass — e.g. Jira
   has Reports/Timeline/Forms/Components/Releases tabs too; this plan is List view + filters +
   attachments only, not a Jira clone.

## 8. Rollout

One migration (attachments table + bucket), then the List view/filters as a single FE change to
`Board.tsx` (+ a few new functions in `board.ts`). Verified live with a real login the same way
every other module in this app has been: create a ticket, assign it, attach a file and a URL,
filter by assignee/date range/group, confirm the Kanban view still behaves identically. User
manual entry for Board gets updated alongside (per the "keep manual updated" convention already
followed for every other shipped feature in this codebase).
