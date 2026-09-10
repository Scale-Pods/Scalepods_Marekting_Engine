import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  KanbanSquare, Plus, Search, X, AlertCircle, CheckCircle2, Undo2, Clock,
  MessageSquare, History, Trash2, Send, Loader2,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { listTeam, initialsOf, TEAM_KEY, type AppUser } from '../lib/team'
import {
  listColumns, listTickets, listComments, listActivity, createTicket, updateTicket,
  deleteTicket, addComment, moveTicket, sendBackTicket, ticketsIn, personById,
  daysUntilDue, dueTone, formatDue, describeActivity, extractMentions, splitMentions,
  BOARD_KEY, TICKETS_KEY, TYPE_LABEL, TYPE_COLOR, PRIORITIES, PRIORITY_LABEL, PRIORITY_COLOR,
  type BoardColumn, type Ticket, type TicketType, type TicketPriority,
} from '../lib/board'
import { PageHeader, Badge, Button, Spinner, Modal } from '../components/ui'
import { useToast, toastMessage } from '../components/Toast'
import { useCan } from '../components/Gate'

// The Jira-shaped board. Columns are rows in board_columns, so renaming or reordering them is a
// data change rather than a deploy.
//
// Nothing here decides who may do what: the tickets_* triggers in Postgres refuse a move into
// Done by anyone but the reviewer, stamp the timestamps, write the history and send the
// notifications. When a rule fires, its real message is what lands in the toast — which is why
// the drag handler surfaces the error instead of swallowing it.

function Avatar({ user, size = 24 }: { user?: AppUser; size?: number }) {
  if (!user) {
    return (
      <div
        className="rounded-full shrink-0 flex items-center justify-center text-[10px] text-muted"
        style={{ width: size, height: size, background: 'var(--fill-tertiary)' }}
        title="Unassigned"
      >
        —
      </div>
    )
  }
  if (user.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.full_name}
        title={user.full_name}
        referrerPolicy="no-referrer"
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-semibold text-white"
      style={{
        width: size, height: size, fontSize: size * 0.4,
        background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-green))',
      }}
      title={user.full_name}
    >
      {initialsOf(user.full_name, user.email)}
    </div>
  )
}

export default function Board() {
  const { key: routeKey } = useParams()
  const navigate = useNavigate()
  const { appUser } = useAuth()
  const canManage = useCan('board', 'full')
  const canEdit = useCan('board', 'edit')
  const qc = useQueryClient()
  const toast = useToast()

  const { data: columns = [], isLoading: colsLoading } = useQuery({ queryKey: [...BOARD_KEY, 'columns'], queryFn: listColumns })
  const { data: tickets = [], isLoading: ticketsLoading } = useQuery({ queryKey: TICKETS_KEY, queryFn: listTickets })
  const { data: team = [] } = useQuery({ queryKey: TEAM_KEY, queryFn: listTeam })

  const [query, setQuery] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: TICKETS_KEY })
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string }) => {
      const target = ticketsIn(tickets, to)
      return moveTicket(id, to, target[target.length - 1] ?? null, null)
    },
    onSuccess: refresh,
    // The refusal message from tickets_workflow_guard is the useful part — it names the reviewer
    // rule rather than saying "update failed".
    onError: (e) => toast.error(toastMessage(e, 'Could not move that ticket.')),
  })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tickets.filter((t) => {
      if (assigneeFilter && t.assignee_id !== assigneeFilter) return false
      if (!q) return true
      return (
        t.key.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [tickets, query, assigneeFilter])

  const openTicket = routeKey ? tickets.find((t) => t.key === routeKey) ?? null : null

  if (colsLoading || ticketsLoading) {
    return <div className="flex justify-center py-20"><Spinner size={26} /></div>
  }

  return (
    <div>
      <PageHeader
        accent={<Badge tone="green"><KanbanSquare size={13} /> {tickets.length} tickets</Badge>}
        title="Board"
        subtitle="Everything the team is working on. Drag a card to move it; finished work goes to the reviewer, not straight to Done."
        actions={canEdit ? <Button onClick={() => setCreating(true)}><Plus size={15} /> Create</Button> : undefined}
      />

      {/* Search + the team avatar row — "search for all users profile in our circle". */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input !pl-9 !py-1.5 text-sm"
            placeholder="Search board"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-1">
          {team.map((u) => {
            const active = assigneeFilter === u.id
            const count = tickets.filter((t) => t.assignee_id === u.id).length
            return (
              <button
                key={u.id}
                onClick={() => setAssigneeFilter(active ? null : u.id)}
                className={`rounded-full transition-all ${active ? 'ring-2' : 'opacity-60 hover:opacity-100'}`}
                style={active ? ({ '--tw-ring-color': 'var(--accent-green)' } as React.CSSProperties) : undefined}
                title={`${u.full_name} — ${count} ticket${count === 1 ? '' : 's'}`}
              >
                <Avatar user={u} size={28} />
              </button>
            )
          })}
          {assigneeFilter && (
            <button onClick={() => setAssigneeFilter(null)} className="btn-ghost !p-1.5 !rounded-full ml-1" title="Clear filter">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Columns scroll sideways; the page itself never does. */}
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ scrollbarWidth: 'thin' }}>
        {columns.map((col) => {
          const items = ticketsIn(visible, col.id)
          const isOver = dragOverCol === col.id
          return (
            <div
              key={col.id}
              className="shrink-0 w-[290px] rounded-xl flex flex-col"
              style={{
                background: 'var(--bg-panel)',
                outline: isOver ? '2px dashed var(--accent-green)' : '1px solid var(--border-subtle)',
                outlineOffset: -1,
                minHeight: 180,
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id) }}
              onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverCol(null)
                const id = dragId ?? e.dataTransfer.getData('text/plain')
                setDragId(null)
                const t = tickets.find((x) => x.id === id)
                if (t && t.column_id !== col.id) move.mutate({ id, to: col.id })
              }}
            >
              <div className="flex items-center justify-between px-3 py-2.5 shrink-0">
                <span className="text-muted text-[10.5px] font-semibold uppercase tracking-wide truncate">
                  {col.name}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {col.is_review && <Clock size={11} className="text-[var(--accent-blue)]" />}
                  {col.is_terminal && <CheckCircle2 size={11} className="text-sage" />}
                  <span className="text-muted text-[11px] tabular-nums">{items.length}</span>
                </span>
              </div>

              <div className="px-2 pb-2 space-y-2 flex-1">
                {items.map((t) => (
                  <TicketCard
                    key={t.id}
                    ticket={t}
                    team={team}
                    dragging={dragId === t.id}
                    onDragStart={(e) => { setDragId(t.id); e.dataTransfer.setData('text/plain', t.id) }}
                    onDragEnd={() => { setDragId(null); setDragOverCol(null) }}
                    onOpen={() => navigate(`/board/${t.key}`)}
                  />
                ))}

                {items.length === 0 && (
                  <div
                    className="rounded-lg text-center text-muted text-[11px] py-6"
                    style={{ border: '1px dashed var(--border-subtle)' }}
                  >
                    {isOver ? 'Drop here' : 'Nothing here'}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {move.isPending && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2 text-sm card !px-3 !py-2">
          <Loader2 size={14} className="animate-spin text-sage" /> Moving…
        </div>
      )}

      {creating && (
        <CreateTicketModal
          columns={columns}
          team={team}
          tickets={tickets}
          meId={appUser?.id ?? null}
          canAssignOthers={canManage}
          onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); refresh(); navigate(`/board/${t.key}`) }}
        />
      )}

      {openTicket && (
        <TicketDrawer
          ticket={openTicket}
          columns={columns}
          team={team}
          meId={appUser?.id ?? null}
          canManage={canManage}
          onClose={() => navigate('/board')}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

function TicketCard({
  ticket, team, dragging, onDragStart, onDragEnd, onOpen,
}: {
  ticket: Ticket
  team: AppUser[]
  dragging: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onOpen: () => void
}) {
  const assignee = personById(team, ticket.assignee_id)
  const days = daysUntilDue(ticket.due_date)
  const tone = dueTone(days)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`card !p-3 cursor-pointer transition-opacity ${dragging ? 'opacity-40' : 'hover:opacity-90'}`}
    >
      <div className="text-sm leading-snug mb-2 line-clamp-3">{ticket.title}</div>

      {ticket.due_date && (
        <div className="flex items-center gap-1 text-[11px] mb-2" style={{ color: tone ?? 'var(--text-muted)' }}>
          {days !== null && days < 0 && <AlertCircle size={11} />}
          {formatDue(ticket.due_date)}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <span
            className="h-2.5 w-2.5 rounded-[3px] shrink-0"
            style={{ background: TYPE_COLOR[ticket.type] }}
            title={TYPE_LABEL[ticket.type]}
          />
          <span className="text-muted text-[11px] tabular-nums">{ticket.key}</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span
            className="text-[10px] font-semibold"
            style={{ color: PRIORITY_COLOR[ticket.priority] }}
            title={`${PRIORITY_LABEL[ticket.priority]} priority`}
          >
            {ticket.priority === 'highest' ? '↑↑' : ticket.priority === 'high' ? '↑'
              : ticket.priority === 'low' ? '↓' : ticket.priority === 'lowest' ? '↓↓' : '='}
          </span>
          <Avatar user={assignee} size={22} />
        </span>
      </div>
    </div>
  )
}

function CreateTicketModal({
  columns, team, tickets, meId, canAssignOthers, onClose, onCreated,
}: {
  columns: BoardColumn[]
  team: AppUser[]
  tickets: Ticket[]
  meId: string | null
  canAssignOthers: boolean
  onClose: () => void
  onCreated: (t: Ticket) => void
}) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<TicketType>('task')
  const [priority, setPriority] = useState<TicketPriority>('medium')
  const [assigneeId, setAssigneeId] = useState<string | null>(canAssignOthers ? null : meId)
  const [reviewerId, setReviewerId] = useState<string | null>(meId)
  const [dueDate, setDueDate] = useState('')
  const [columnId, setColumnId] = useState(columns[0]?.id ?? '')

  const create = useMutation({
    mutationFn: () => createTicket({
      title, description: description || null, type, priority,
      columnId, reporterId: meId, assigneeId, reviewerId,
      dueDate: dueDate || null,
    }, tickets),
    onSuccess: onCreated,
    onError: (e) => toast.error(toastMessage(e, 'Could not create that ticket.')),
  })

  // Everyone except suspended accounts. Invited people are deliberately assignable: work gets
  // handed out while onboarding is still in progress, and they will see it the moment an admin
  // switches them on. Filtering to active-only left an admin staring at a dropdown containing
  // only themselves with nothing explaining why.
  const assignable = team.filter((u) => u.status !== 'suspended')
  const personLabel = (u: AppUser) =>
    u.status === 'invited' ? `${u.full_name} — not activated yet` : u.full_name

  return (
    <Modal title="Create a ticket" onClose={onClose} size="lg">
      <div className="space-y-4">
        <div>
          <label className="label">Summary</label>
          <input
            className="input mt-1" autoFocus placeholder="What needs doing?"
            value={title} onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input mt-1" rows={4} placeholder="Detail, links, acceptance criteria…"
            value={description} onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Type</label>
            <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value as TicketType)}>
              {(Object.keys(TYPE_LABEL) as TicketType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input mt-1" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Assignee {!canAssignOthers && <span className="text-muted">(you)</span>}</label>
            <select
              className="input mt-1"
              value={assigneeId ?? ''}
              disabled={!canAssignOthers}
              onChange={(e) => setAssigneeId(e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {assignable.map((u) => <option key={u.id} value={u.id}>{personLabel(u)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Reviewer</label>
            <select className="input mt-1" value={reviewerId ?? ''} onChange={(e) => setReviewerId(e.target.value || null)}>
              <option value="">Nobody</option>
              {assignable.map((u) => <option key={u.id} value={u.id}>{personLabel(u)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Column</label>
            <select className="input mt-1" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input className="input mt-1" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <p className="text-muted text-xs">
          The reviewer is who accepts this work. Only they can move it to Done — the assignee submits it for
          review instead.
        </p>

        <div className="flex gap-2">
          <Button className="flex-1" disabled={!title.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            <Plus size={15} /> Create ticket
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}

function TicketDrawer({
  ticket, columns, team, meId, canManage, onClose, onChanged,
}: {
  ticket: Ticket
  columns: BoardColumn[]
  team: AppUser[]
  meId: string | null
  canManage: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<'comments' | 'history'>('comments')
  const [comment, setComment] = useState('')
  const [sendBackNote, setSendBackNote] = useState('')
  const [showSendBack, setShowSendBack] = useState(false)
  // "@" plus whatever's typed since it, as long as there's no space yet — the moment a space
  // (or a picked name) closes it off, this goes back to null and the dropdown disappears.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)

  const { data: comments = [] } = useQuery({
    queryKey: ['ticket', ticket.id, 'comments'], queryFn: () => listComments(ticket.id),
  })
  const { data: activity = [] } = useQuery({
    queryKey: ['ticket', ticket.id, 'activity'], queryFn: () => listActivity(ticket.id),
  })

  const qc = useQueryClient()
  const after = () => {
    onChanged()
    qc.invalidateQueries({ queryKey: ['ticket', ticket.id] })
  }

  const reviewCol = columns.find((c) => c.is_review)
  const doneCol = columns.find((c) => c.is_terminal)
  const progressCol = columns.find((c) => !c.is_review && !c.is_terminal && c.name.toLowerCase().includes('progress'))
    ?? columns[1] ?? columns[0]

  const isAssignee = ticket.assignee_id === meId
  const isReviewer = ticket.reviewer_id === meId
  const inReview = reviewCol?.id === ticket.column_id
  const isDone = doneCol?.id === ticket.column_id

  const act = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: () => { after(); setShowSendBack(false); setSendBackNote('') },
    onError: (e) => toast.error(toastMessage(e, 'That did not work.')),
  })

  const post = useMutation({
    mutationFn: () => addComment(ticket.id, meId!, comment, extractMentions(comment, team)),
    onSuccess: () => { setComment(''); after() },
    onError: (e) => toast.error(toastMessage(e, 'Could not post that comment.')),
  })

  const mentionMatches = mentionQuery === null
    ? []
    : team.filter((u) => u.full_name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 5)

  function onCommentChange(value: string) {
    setComment(value)
    // Only the tail of the text counts — mentions are typed at the cursor, not pasted mid-way.
    const tail = /@([^\s@]*)$/.exec(value)
    setMentionQuery(tail ? tail[1] : null)
  }

  function pickMention(user: AppUser) {
    const next = comment.replace(/@([^\s@]*)$/, `@${user.full_name} `)
    // Clicking the suggestion moves focus to its button; a real Slack/GitHub-style picker hands
    // focus straight back to the textbox, cursor after the inserted name, so typing just
    // continues. flushSync forces the value onto the DOM node before we touch its selection —
    // an rAF-deferred version of this raced the textarea's own re-render and lost.
    flushSync(() => {
      setComment(next)
      setMentionQuery(null)
    })
    commentRef.current?.focus()
    commentRef.current?.setSelectionRange(next.length, next.length)
  }

  const assignee = personById(team, ticket.assignee_id)
  const reviewer = personById(team, ticket.reviewer_id)
  const reporter = personById(team, ticket.reporter_id)

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div
        className="w-full max-w-xl h-full overflow-y-auto p-6"
        style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ background: TYPE_COLOR[ticket.type] }}
              />
              <span className="text-muted text-xs tabular-nums">{ticket.key}</span>
              <span className="text-muted text-xs">·</span>
              <span className="text-xs" style={{ color: PRIORITY_COLOR[ticket.priority] }}>
                {PRIORITY_LABEL[ticket.priority]}
              </span>
            </div>
            <h2 className="text-lg leading-snug">{ticket.title}</h2>
          </div>
          <button onClick={onClose} className="btn-ghost !p-2 shrink-0"><X size={16} /></button>
        </div>

        {ticket.rejection_note && !isDone && (
          <div
            className="flex gap-2.5 px-4 py-3 rounded-xl text-sm mb-4"
            style={{
              background: 'rgb(var(--accent-orange-rgb) / 0.12)',
              border: '1px solid rgb(var(--accent-orange-rgb) / 0.3)',
              color: 'var(--accent-orange)',
            }}
          >
            <Undo2 size={16} className="shrink-0 mt-0.5" />
            <span><b>Sent back:</b> {ticket.rejection_note}</span>
          </div>
        )}

        {/* The maker–checker controls. Which one you see depends on which side of the
            handover you are on — and Postgres enforces the same thing regardless. */}
        <div className="flex flex-wrap gap-2 mb-5">
          {isAssignee && !inReview && !isDone && reviewCol && (
            <Button
              className="!py-1.5 !px-3 text-xs"
              loading={act.isPending}
              onClick={() => act.mutate(() => updateTicket(ticket.id, { column_id: reviewCol.id }))}
            >
              <Send size={13} /> Submit for review
            </Button>
          )}

          {(isReviewer || canManage) && inReview && doneCol && (
            <>
              <Button
                className="!py-1.5 !px-3 text-xs"
                loading={act.isPending}
                onClick={() => act.mutate(() => updateTicket(ticket.id, { column_id: doneCol.id }))}
              >
                <CheckCircle2 size={13} /> Accept
              </Button>
              <Button
                variant="ghost" className="!py-1.5 !px-3 text-xs"
                onClick={() => setShowSendBack((s) => !s)}
              >
                <Undo2 size={13} /> Send back
              </Button>
            </>
          )}

          {canManage && (
            <Button
              variant="ghost" className="!py-1.5 !px-3 text-xs"
              onClick={() => { if (confirm(`Delete ${ticket.key}?`)) act.mutate(() => deleteTicket(ticket.id).then(onClose)) }}
            >
              <Trash2 size={13} /> Delete
            </Button>
          )}
        </div>

        {showSendBack && (
          <div className="space-y-2 mb-5">
            <textarea
              className="input" rows={2} autoFocus
              placeholder="What needs to change? (required)"
              value={sendBackNote}
              onChange={(e) => setSendBackNote(e.target.value)}
            />
            <Button
              className="!py-1.5 !px-3 text-xs w-full justify-center"
              disabled={!sendBackNote.trim()}
              loading={act.isPending}
              onClick={() => act.mutate(() => sendBackTicket(ticket.id, progressCol.id, sendBackNote))}
            >
              <Undo2 size={13} /> Send back to {assignee?.full_name ?? 'the assignee'}
            </Button>
          </div>
        )}

        {ticket.description && (
          <p className="text-secondary text-sm whitespace-pre-wrap leading-relaxed mb-5">{ticket.description}</p>
        )}

        <div className="panel !py-3 mb-5 space-y-2.5 text-sm">
          <Row label="Assignee"><span className="flex items-center gap-2"><Avatar user={assignee} size={20} />{assignee?.full_name ?? 'Unassigned'}</span></Row>
          <Row label="Reviewer"><span className="flex items-center gap-2"><Avatar user={reviewer} size={20} />{reviewer?.full_name ?? 'Nobody'}</span></Row>
          <Row label="Reporter"><span className="text-secondary">{reporter?.full_name ?? '—'}</span></Row>
          <Row label="Column"><span className="text-secondary">{columns.find((c) => c.id === ticket.column_id)?.name}</span></Row>
          {ticket.due_date && (
            <Row label="Due">
              <span style={{ color: dueTone(daysUntilDue(ticket.due_date)) ?? undefined }}>
                {formatDue(ticket.due_date)}
              </span>
            </Row>
          )}
        </div>

        <div className="flex gap-1 mb-3">
          <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>
            <MessageSquare size={13} /> Comments {comments.length > 0 && `(${comments.length})`}
          </TabButton>
          <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
            <History size={13} /> History
          </TabButton>
        </div>

        {tab === 'comments' ? (
          <div className="space-y-3">
            {comments.map((c) => {
              const author = personById(team, c.author_id)
              return (
                <div key={c.id} className="flex gap-2.5">
                  <Avatar user={author} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted mb-0.5">
                      <b className="text-ink">{author?.full_name ?? 'Someone'}</b>{' '}
                      {new Date(c.created_at).toLocaleString()}
                    </div>
                    <div className="text-sm whitespace-pre-wrap">
                      {splitMentions(c.body, team).map((part, i) => (
                        part.isMention
                          ? <b key={i} style={{ color: 'var(--accent-green)' }}>{part.text}</b>
                          : <span key={i}>{part.text}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
            {comments.length === 0 && <p className="text-muted text-sm">No comments yet.</p>}

            <div className="relative pt-1">
              {mentionMatches.length > 0 && (
                <div
                  className="absolute bottom-full left-0 mb-1 w-56 rounded-lg overflow-hidden z-10"
                  style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)' }}
                >
                  {mentionMatches.map((u) => (
                    <button
                      key={u.id}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm hover:opacity-80"
                      onClick={() => pickMention(u)}
                    >
                      <Avatar user={u} size={20} /> {u.full_name}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <textarea
                  ref={commentRef}
                  className="input flex-1" rows={2} placeholder="Add a comment… (@ to mention someone)"
                  value={comment} onChange={(e) => onCommentChange(e.target.value)}
                />
                <Button
                  className="!px-3 self-end"
                  disabled={!comment.trim() || !meId}
                  loading={post.isPending}
                  onClick={() => post.mutate()}
                >
                  <Send size={14} />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {activity.map((a) => (
              <div key={a.id} className="flex gap-2.5 text-sm">
                <Avatar user={personById(team, a.actor_id)} size={22} />
                <div className="min-w-0">
                  <span className="text-secondary">
                    <b className="text-ink">{personById(team, a.actor_id)?.full_name ?? 'Someone'}</b>{' '}
                    {describeActivity(a, team)}
                  </span>
                  <div className="text-muted text-[11px]">{new Date(a.created_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted text-xs">{label}</span>
      {children}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style={{
        background: active ? 'var(--fill-tertiary)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
      }}
    >
      {children}
    </button>
  )
}
