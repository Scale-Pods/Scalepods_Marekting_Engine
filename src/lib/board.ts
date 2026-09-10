// The Kanban board — Phase 4 of docs/team-collaboration-prd.md.
//
// Tickets are freeform (a task is a task) but can optionally point at something the app already
// made — a content item, a video job, a carousel, a blog post — so a ticket can reference the
// actual asset instead of describing it.
//
// The maker–checker rules are NOT enforced here. `tickets_workflow_guard` in Postgres refuses a
// move into Done by anyone but the ticket's reviewer, stamps submitted_at/accepted_at, and clears
// them on a send-back; `tickets_log_activity` writes the history; `tickets_notify` tells the right
// person. This module drives that machinery and reports what it says.

import { supabase } from './supabase'
import type { AppUser } from './team'

export type TicketType = 'task' | 'design' | 'copy' | 'video' | 'blog' | 'bug'
export type TicketPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest'
export type LinkedKind = 'content_item' | 'video_job' | 'studio_job' | 'carousel_job' | 'blog_post'

export interface BoardColumn {
  id: string
  name: string
  position: number
  is_review: boolean
  is_terminal: boolean
}

export interface Ticket {
  id: string
  key: string
  profile_id: string | null
  title: string
  description: string | null
  type: TicketType
  priority: TicketPriority
  column_id: string
  position: number
  reporter_id: string | null
  assignee_id: string | null
  reviewer_id: string | null
  start_date: string | null
  due_date: string | null
  labels: string[]
  linked_kind: LinkedKind | null
  linked_id: string | null
  submitted_at: string | null
  accepted_at: string | null
  rejection_note: string | null
  created_at: string
  updated_at: string
}

export interface TicketComment {
  id: string
  ticket_id: string
  author_id: string | null
  body: string
  mentions: string[]
  created_at: string
}

export interface TicketActivity {
  id: string
  ticket_id: string
  actor_id: string | null
  action: string
  detail: Record<string, unknown> | null
  created_at: string
}

export const BOARD_KEY = ['board'] as const
export const TICKETS_KEY = ['board', 'tickets'] as const

export const TYPE_LABEL: Record<TicketType, string> = {
  task: 'Task', design: 'Design', copy: 'Copy', video: 'Video', blog: 'Blog', bug: 'Bug',
}

/** Jira's own ordering, because everyone reading this board already knows it. */
export const PRIORITIES: TicketPriority[] = ['highest', 'high', 'medium', 'low', 'lowest']

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest',
}

export const PRIORITY_COLOR: Record<TicketPriority, string> = {
  highest: 'var(--accent-orange)',
  high: 'var(--accent-orange)',
  medium: 'var(--accent-blue)',
  low: 'var(--text-muted)',
  lowest: 'var(--text-muted)',
}

export const TYPE_COLOR: Record<TicketType, string> = {
  task: 'var(--accent-blue)',
  design: 'var(--accent-green)',
  copy: 'var(--accent-green)',
  video: 'var(--accent-blue)',
  blog: 'var(--accent-green)',
  bug: 'var(--accent-orange)',
}

// --- reads -----------------------------------------------------------------

export async function listColumns(): Promise<BoardColumn[]> {
  const { data, error } = await supabase.from('board_columns').select('*').order('position')
  if (error) throw error
  return data as BoardColumn[]
}

export async function listTickets(): Promise<Ticket[]> {
  const { data, error } = await supabase.from('tickets').select('*').order('position')
  if (error) throw error
  return data as Ticket[]
}

export async function getTicketByKey(key: string): Promise<Ticket | null> {
  const { data, error } = await supabase.from('tickets').select('*').eq('key', key).maybeSingle()
  if (error) throw error
  return (data as Ticket) ?? null
}

export async function listComments(ticketId: string): Promise<TicketComment[]> {
  const { data, error } = await supabase
    .from('ticket_comments').select('*').eq('ticket_id', ticketId).order('created_at')
  if (error) throw error
  return data as TicketComment[]
}

export async function listActivity(ticketId: string): Promise<TicketActivity[]> {
  const { data, error } = await supabase
    .from('ticket_activity').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: false })
  if (error) throw error
  return data as TicketActivity[]
}

// --- writes ----------------------------------------------------------------

export interface NewTicket {
  title: string
  description?: string | null
  type: TicketType
  priority: TicketPriority
  columnId: string
  reporterId: string | null
  assigneeId: string | null
  reviewerId: string | null
  dueDate?: string | null
  profileId?: string | null
  labels?: string[]
  linkedKind?: LinkedKind | null
  linkedId?: string | null
}

export async function createTicket(input: NewTicket, tickets: Ticket[]): Promise<Ticket> {
  const { data, error } = await supabase
    .from('tickets')
    .insert({
      title: input.title.trim(),
      description: input.description ?? null,
      type: input.type,
      priority: input.priority,
      column_id: input.columnId,
      position: nextPositionInColumn(tickets, input.columnId),
      reporter_id: input.reporterId,
      assignee_id: input.assigneeId,
      reviewer_id: input.reviewerId,
      due_date: input.dueDate ?? null,
      profile_id: input.profileId ?? null,
      labels: input.labels ?? [],
      linked_kind: input.linkedKind ?? null,
      linked_id: input.linkedId ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Ticket
}

export async function updateTicket(id: string, patch: Partial<Ticket>): Promise<void> {
  const { error } = await supabase.from('tickets').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteTicket(id: string): Promise<void> {
  const { error } = await supabase.from('tickets').delete().eq('id', id)
  if (error) throw error
}

export async function addComment(ticketId: string, authorId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('ticket_comments')
    .insert({ ticket_id: ticketId, author_id: authorId, body: body.trim() })
  if (error) throw error
}

/**
 * Moves a ticket, placing it between the two cards it was dropped between.
 *
 * Fractional positions: a move writes one row instead of renumbering the column. The gap halves
 * each time a card lands in the same slot, so after ~50 consecutive drops into one spot the
 * doubles would run out of precision — far beyond anything a marketing board will do, and a
 * renumber would be the fix if it ever mattered.
 *
 * The maker–checker rules ride on this same update: Postgres decides whether the move is allowed
 * and stamps the timestamps, so a refusal surfaces here as a thrown error with its real message.
 */
export async function moveTicket(
  id: string, toColumnId: string, before: Ticket | null, after: Ticket | null,
): Promise<void> {
  const lo = before?.position ?? 0
  const hi = after?.position ?? (before ? before.position + 2000 : 1000)
  const { error } = await supabase
    .from('tickets')
    .update({ column_id: toColumnId, position: (lo + hi) / 2 })
    .eq('id', id)
  if (error) throw error
}

/** Sends a ticket back to its assignee with a reason. The note is required — "sent back" with no
 *  explanation is the single most useless thing a reviewer can do. */
export async function sendBackTicket(id: string, toColumnId: string, note: string): Promise<void> {
  const { error } = await supabase
    .from('tickets')
    .update({ column_id: toColumnId, rejection_note: note.trim() })
    .eq('id', id)
  if (error) throw error
}

function nextPositionInColumn(tickets: Ticket[], columnId: string): number {
  const inCol = tickets.filter((t) => t.column_id === columnId)
  if (!inCol.length) return 1000
  return Math.max(...inCol.map((t) => t.position)) + 1000
}

// --- helpers ---------------------------------------------------------------

export function ticketsIn(tickets: Ticket[], columnId: string): Ticket[] {
  return tickets.filter((t) => t.column_id === columnId).sort((a, b) => a.position - b.position)
}

export function personById(team: AppUser[], id: string | null): AppUser | undefined {
  return id ? team.find((u) => u.id === id) : undefined
}

/** null when there is no due date; negative means overdue. Days, not hours — a board is scanned,
 *  not stared at. */
export function daysUntilDue(due: string | null): number | null {
  if (!due) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(due + 'T00:00:00')
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

export function dueTone(days: number | null): string | null {
  if (days === null) return null
  if (days < 0) return 'var(--accent-orange)'
  if (days <= 2) return 'var(--accent-orange)'
  return 'var(--text-muted)'
}

export function formatDue(due: string | null): string {
  const days = daysUntilDue(due)
  if (days === null) return ''
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 0) return `${Math.abs(days)}d overdue`
  return new Date(due! + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Human sentence for one history row. The trigger stores structured detail; this is the only
 *  place that turns it into English, so the wording stays consistent across the drawer. */
export function describeActivity(a: TicketActivity, team: AppUser[]): string {
  const nameOf = (id: unknown) =>
    (typeof id === 'string' ? team.find((u) => u.id === id)?.full_name : null) ?? 'someone'
  const d = a.detail ?? {}
  switch (a.action) {
    case 'created':   return 'created this ticket'
    case 'assigned':  return d.from ? `reassigned it to ${nameOf(d.to)}` : `assigned it to ${nameOf(d.to)}`
    case 'moved':     return `moved it from ${String(d.from ?? '?')} to ${String(d.to ?? '?')}`
    case 'submitted': return 'submitted it for review'
    case 'accepted':  return 'accepted it'
    case 'rejected':  return `sent it back — "${String(d.note ?? '')}"`
    default:          return a.action
  }
}
