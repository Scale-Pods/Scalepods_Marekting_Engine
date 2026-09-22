import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  KanbanSquare, List as ListIcon, Plus, Search, X, AlertCircle, CheckCircle2, Undo2, Clock,
  MessageSquare, History, Paperclip, Link2, Trash2, Send, Loader2, User,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { listTeam, initialsOf, TEAM_KEY, type AppUser } from '../lib/team'
import {
  listColumns, listTickets, listComments, listActivity, listAttachments, createTicket,
  updateTicket, deleteTicket, addComment, addAttachment, deleteAttachment, moveTicket,
  sendBackTicket, ticketsIn, personById, resolutionOf,
  daysUntilDue, dueTone, formatDue, describeActivity, extractMentions, splitMentions,
  BOARD_KEY, TICKETS_KEY, TYPE_LABEL, TYPE_COLOR, PRIORITIES, PRIORITY_LABEL, PRIORITY_COLOR,
  RESOLUTION_TONE,
  type BoardColumn, type Ticket, type TicketType, type TicketPriority, type TicketAttachment,
} from '../lib/board'
import { PageHeader, Badge, Button, Spinner, Modal } from '../components/ui'
import { useToast, toastMessage } from '../components/Toast'
import { useCan } from '../components/Gate'
import AssetUploader from '../components/AssetUploader'

type BoardView = 'board' | 'list'
type DateField = 'created_at' | 'due_date'
type DateRange = 'all' | '7' | '30' | 'custom'
type GroupBy = 'none' | 'column' | 'assignee' | 'priority' | 'type' | 'reporter'

const VIEW_STORAGE_KEY = 'board-view'

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

  const [view, setView] = useState<BoardView>(() => (localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'board'))
  useEffect(() => { try { localStorage.setItem(VIEW_STORAGE_KEY, view) } catch { /* private mode, etc. */ } }, [view])

  const [query, setQuery] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null)
  const [reporterFilter, setReporterFilter] = useState<string | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | null>(null)
  const [typeFilter, setTypeFilter] = useState<TicketType | null>(null)
  const [onlyMine, setOnlyMine] = useState(false)
  const [dateField, setDateField] = useState<DateField>('created_at')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
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

  const meId = appUser?.id ?? null

  // Custom-range bounds are computed once per render rather than per ticket — a fixed window
  // "now" is fine here, this isn't a live countdown.
  const [rangeFrom, rangeTo] = useMemo((): [number | null, number | null] => {
    if (dateRange === '7') return [Date.now() - 7 * 86_400_000, null]
    if (dateRange === '30') return [Date.now() - 30 * 86_400_000, null]
    if (dateRange === 'custom') {
      return [
        customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : null,
        customTo ? new Date(`${customTo}T23:59:59`).getTime() : null,
      ]
    }
    return [null, null]
  }, [dateRange, customFrom, customTo])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tickets.filter((t) => {
      if (onlyMine && t.assignee_id !== meId) return false
      if (assigneeFilter && t.assignee_id !== assigneeFilter) return false
      if (reporterFilter && t.reporter_id !== reporterFilter) return false
      if (priorityFilter && t.priority !== priorityFilter) return false
      if (typeFilter && t.type !== typeFilter) return false
      if (rangeFrom !== null || rangeTo !== null) {
        const raw = dateField === 'due_date' ? t.due_date : t.created_at
        if (!raw) return false
        const ts = new Date(raw).getTime()
        if (rangeFrom !== null && ts < rangeFrom) return false
        if (rangeTo !== null && ts > rangeTo) return false
      }
      if (!q) return true
      return (
        t.key.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [tickets, query, assigneeFilter, reporterFilter, priorityFilter, typeFilter, dateField, rangeFrom, rangeTo, onlyMine, meId])

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
        actions={
          <>
            <div className="flex items-center rounded-lg p-0.5 gap-0.5" style={{ background: 'var(--fill-tertiary)' }}>
              <button
                onClick={() => setView('board')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{ background: view === 'board' ? 'var(--bg-card)' : 'transparent', color: view === 'board' ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                <KanbanSquare size={13} /> Board
              </button>
              <button
                onClick={() => setView('list')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                style={{ background: view === 'list' ? 'var(--bg-card)' : 'transparent', color: view === 'list' ? 'var(--text-primary)' : 'var(--text-muted)' }}
              >
                <ListIcon size={13} /> List
              </button>
            </div>
            {canEdit && <Button onClick={() => setCreating(true)}><Plus size={15} /> Create</Button>}
          </>
        }
      />

      {/* Search, the team avatar row, and the rest of the filters. Assignee/search were already
          here; reporter/priority/type/date-range/"assigned to me" are new — the original board
          only ever shipped search + the avatar row, despite the PRD planning more. */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
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

        {meId && (
          <button
            onClick={() => setOnlyMine((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all"
            style={onlyMine
              ? { background: 'rgba(177,217,151,0.14)', border: '1px solid var(--accent-green)', color: 'var(--text-primary)' }
              : { background: 'var(--fill-tertiary)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            <User size={12} /> Assigned to me
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-5 flex-wrap text-xs">
        <select className="input !py-1.5 !text-xs !w-auto" value={reporterFilter ?? ''} onChange={(e) => setReporterFilter(e.target.value || null)}>
          <option value="">Any reporter</option>
          {team.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select className="input !py-1.5 !text-xs !w-auto" value={priorityFilter ?? ''} onChange={(e) => setPriorityFilter((e.target.value || null) as TicketPriority | null)}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select className="input !py-1.5 !text-xs !w-auto" value={typeFilter ?? ''} onChange={(e) => setTypeFilter((e.target.value || null) as TicketType | null)}>
          <option value="">Any type</option>
          {(Object.keys(TYPE_LABEL) as TicketType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>

        <span className="text-muted">·</span>

        <select className="input !py-1.5 !text-xs !w-auto" value={dateField} onChange={(e) => setDateField(e.target.value as DateField)}>
          <option value="created_at">Created</option>
          <option value="due_date">Due date</option>
        </select>
        <select className="input !py-1.5 !text-xs !w-auto" value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRange)}>
          <option value="all">Any time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="custom">Custom range…</option>
        </select>
        {dateRange === 'custom' && (
          <>
            <input type="date" className="input !py-1.5 !text-xs !w-auto" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-muted">to</span>
            <input type="date" className="input !py-1.5 !text-xs !w-auto" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}

        {view === 'list' && (
          <>
            <span className="text-muted">·</span>
            <span className="text-muted">Group by</span>
            <select className="input !py-1.5 !text-xs !w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="none">Nothing</option>
              <option value="column">Status</option>
              <option value="assignee">Assignee</option>
              <option value="reporter">Reporter</option>
              <option value="priority">Priority</option>
              <option value="type">Type</option>
            </select>
          </>
        )}
      </div>

      {/* All columns share the row's width and shrink together (minmax(0,1fr)) so the whole
          board is visible at once, Jira-style — never a horizontal scrollbar, however many
          columns board_columns holds. */}
      {view === 'board' && <div
        className="grid gap-2 pb-4"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((col) => {
          const items = ticketsIn(visible, col.id)
          const isOver = dragOverCol === col.id
          return (
            <div
              key={col.id}
              className="min-w-0 rounded-xl flex flex-col"
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
              <div className="flex items-center justify-between px-2.5 py-2 shrink-0 min-w-0">
                <span className="text-muted text-[10px] font-semibold uppercase tracking-wide truncate">
                  {col.name}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {col.is_review && <Clock size={11} className="text-[var(--accent-blue)]" />}
                  {col.is_terminal && <CheckCircle2 size={11} className="text-sage" />}
                  <span className="text-muted text-[11px] tabular-nums">{items.length}</span>
                </span>
              </div>

              <div className="px-1.5 pb-1.5 space-y-1.5 flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
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
      </div>}

      {view === 'list' && (
        <ListView
          tickets={visible}
          columns={columns}
          team={team}
          groupBy={groupBy}
          onOpen={(t) => navigate(`/board/${t.key}`)}
        />
      )}

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
          meId={meId}
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
          meId={meId}
          canManage={canManage}
          canEdit={canEdit}
          onClose={() => navigate('/board')}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

// ─── list view ───────────────────────────────────────────────────────────────

const GROUP_LABEL: Record<Exclude<GroupBy, 'none'>, (t: Ticket, ctx: { columns: BoardColumn[]; team: AppUser[] }) => string> = {
  column: (t, { columns }) => columns.find((c) => c.id === t.column_id)?.name ?? 'Unknown',
  assignee: (t, { team }) => personById(team, t.assignee_id)?.full_name ?? 'Unassigned',
  reporter: (t, { team }) => personById(team, t.reporter_id)?.full_name ?? 'Unknown',
  priority: (t) => PRIORITY_LABEL[t.priority],
  type: (t) => TYPE_LABEL[t.type],
}

/** Encounter order (whichever ticket happens to sort first) reads as random for anyone scanning
 *  grouped sections — Status should read top-to-bottom like the Kanban columns do, Priority
 *  Highest-to-Lowest, Type in its own fixed list; only people-based groupings (who has no
 *  inherent order) fall back to alphabetical. */
function groupOrder(groupBy: GroupBy, columns: BoardColumn[]): string[] | null {
  if (groupBy === 'column') return [...columns].sort((a, b) => a.position - b.position).map((c) => c.name)
  if (groupBy === 'priority') return PRIORITIES.map((p) => PRIORITY_LABEL[p])
  if (groupBy === 'type') return (Object.keys(TYPE_LABEL) as TicketType[]).map((t) => TYPE_LABEL[t])
  return null
}

function ListView({
  tickets, columns, team, groupBy, onOpen,
}: {
  tickets: Ticket[]
  columns: BoardColumn[]
  team: AppUser[]
  groupBy: GroupBy
  onOpen: (t: Ticket) => void
}) {
  const sorted = useMemo(() => [...tickets].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)), [tickets])

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ label: null as string | null, items: sorted }]
    const labelFn = GROUP_LABEL[groupBy]
    const byLabel = new Map<string, Ticket[]>()
    for (const t of sorted) {
      const label = labelFn(t, { columns, team })
      byLabel.set(label, [...(byLabel.get(label) ?? []), t])
    }
    const fixedOrder = groupOrder(groupBy, columns)
    const labels = fixedOrder
      ? fixedOrder.filter((l) => byLabel.has(l))
      : [...byLabel.keys()].sort((a, b) => a.localeCompare(b))
    return labels.map((label) => ({ label, items: byLabel.get(label)! }))
  }, [sorted, groupBy, columns, team])

  if (!tickets.length) {
    return (
      <div className="rounded-xl text-center text-muted text-sm py-16" style={{ border: '1px dashed var(--border-subtle)' }}>
        Nothing matches these filters.
      </div>
    )
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-muted text-[11px] uppercase tracking-wide" style={{ background: 'var(--bg-panel)' }}>
            <th className="text-left font-medium px-3 py-2">Work</th>
            <th className="text-left font-medium px-3 py-2">Assignee</th>
            <th className="text-left font-medium px-3 py-2">Reporter</th>
            <th className="text-left font-medium px-3 py-2">Priority</th>
            <th className="text-left font-medium px-3 py-2">Status</th>
            <th className="text-left font-medium px-3 py-2">Resolution</th>
            <th className="text-left font-medium px-3 py-2">Created</th>
            <th className="text-left font-medium px-3 py-2">Updated</th>
            <th className="text-left font-medium px-3 py-2">Due date</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <FragmentGroup key={g.label ?? '_'} label={g.label} count={g.items.length}>
              {g.items.map((t) => {
                const assignee = personById(team, t.assignee_id)
                const reporter = personById(team, t.reporter_id)
                const resolution = resolutionOf(t, columns)
                const days = daysUntilDue(t.due_date)
                const tone = dueTone(days)
                return (
                  <tr
                    key={t.id}
                    onClick={() => onOpen(t)}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ borderTop: '1px solid var(--border-subtle)' }}
                  >
                    <td className="px-3 py-2 max-w-md">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2 w-2 rounded-[2px] shrink-0" style={{ background: TYPE_COLOR[t.type] }} title={TYPE_LABEL[t.type]} />
                        <span className="text-muted text-[11px] tabular-nums shrink-0">{t.key}</span>
                        <span className="truncate">{t.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 whitespace-nowrap"><Avatar user={assignee} size={18} />{assignee?.full_name ?? 'Unassigned'}</span>
                    </td>
                    <td className="px-3 py-2 text-secondary whitespace-nowrap">{reporter?.full_name ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span style={{ color: PRIORITY_COLOR[t.priority] }}>{PRIORITY_LABEL[t.priority]}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-secondary">{columns.find((c) => c.id === t.column_id)?.name}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><Badge tone={RESOLUTION_TONE[resolution]}>{resolution}</Badge></td>
                    <td className="px-3 py-2 text-muted text-xs whitespace-nowrap tabular-nums">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-muted text-xs whitespace-nowrap tabular-nums">{new Date(t.updated_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap tabular-nums" style={{ color: tone ?? 'var(--text-muted)' }}>
                      {t.due_date ? formatDue(t.due_date) : '—'}
                    </td>
                  </tr>
                )
              })}
            </FragmentGroup>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A `<tbody>` can't nest another `<tbody>`, so a group header is just another row spanning every
 *  column — skipped entirely when there's no grouping (label is null). */
function FragmentGroup({ label, count, children }: { label: string | null; count: number; children: React.ReactNode }) {
  return (
    <>
      {label !== null && (
        <tr>
          <td colSpan={9} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted" style={{ background: 'var(--bg-panel)', borderTop: '1px solid var(--border-subtle)' }}>
            {label} <span className="text-muted font-normal">({count})</span>
          </td>
        </tr>
      )}
      {children}
    </>
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
      className={`card !p-2.5 cursor-pointer transition-opacity ${dragging ? 'opacity-40' : 'hover:opacity-90'}`}
    >
      <div className="text-[12.5px] leading-snug mb-1.5 line-clamp-3">{ticket.title}</div>

      {ticket.due_date && (
        <div className="flex items-center gap-1 text-[10.5px] mb-1.5" style={{ color: tone ?? 'var(--text-muted)' }}>
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
          <Avatar user={assignee} size={20} />
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
  ticket, columns, team, meId, canManage, canEdit, onClose, onChanged,
}: {
  ticket: Ticket
  columns: BoardColumn[]
  team: AppUser[]
  meId: string | null
  canManage: boolean
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<'comments' | 'attachments' | 'history'>('comments')
  const [comment, setComment] = useState('')
  const [sendBackNote, setSendBackNote] = useState('')
  const [showSendBack, setShowSendBack] = useState(false)
  const [attachUrl, setAttachUrl] = useState('')
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
  const { data: attachments = [] } = useQuery({
    queryKey: ['ticket', ticket.id, 'attachments'], queryFn: () => listAttachments(ticket.id),
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

  const updateField = useMutation({
    mutationFn: (patch: Partial<Ticket>) => updateTicket(ticket.id, patch),
    onSuccess: after,
    onError: (e) => toast.error(toastMessage(e, 'Could not update that.')),
  })

  const attach = useMutation({
    mutationFn: (input: { kind: 'file' | 'url'; url: string; fileName?: string | null }) =>
      addAttachment(ticket.id, meId!, input.kind, input.url, input.fileName ?? null),
    onSuccess: () => { setAttachUrl(''); after() },
    onError: (e) => toast.error(toastMessage(e, 'Could not attach that.')),
  })

  const removeAttachment = useMutation({
    mutationFn: (id: string) => deleteAttachment(id),
    onSuccess: after,
    onError: (e) => toast.error(toastMessage(e, 'Could not remove that attachment.')),
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
  // Suspended people stay pickable as whatever they already are (so an old ticket doesn't show
  // a broken reference) but drop out of the "reassign to" list, same rule CreateTicketModal uses.
  const assignable = team.filter((u) => u.status !== 'suspended')

  return (
    <Modal title={`${ticket.key} — ${ticket.title}`} onClose={onClose} size="2xl" aspectVideo>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4 min-w-0">
        <div className="flex items-center gap-2 -mt-1">
          <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: TYPE_COLOR[ticket.type] }} title={TYPE_LABEL[ticket.type]} />
          <span className="text-xs" style={{ color: PRIORITY_COLOR[ticket.priority] }}>{PRIORITY_LABEL[ticket.priority]} priority</span>
        </div>

        {ticket.rejection_note && !isDone && (
          <div
            className="flex gap-2.5 px-4 py-3 rounded-xl text-sm"
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
        <div className="flex flex-wrap gap-2">
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
          <div className="space-y-2">
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
          <p className="text-secondary text-sm whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
        )}

        <div className="flex gap-1">
          <TabButton active={tab === 'comments'} onClick={() => setTab('comments')}>
            <MessageSquare size={13} /> Comments {comments.length > 0 && `(${comments.length})`}
          </TabButton>
          <TabButton active={tab === 'attachments'} onClick={() => setTab('attachments')}>
            <Paperclip size={13} /> Attachments {attachments.length > 0 && `(${attachments.length})`}
          </TabButton>
          <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
            <History size={13} /> History
          </TabButton>
        </div>

        {tab === 'attachments' ? (
          <div className="space-y-3">
            {attachments.map((a: TicketAttachment) => {
              const author = personById(team, a.author_id)
              const canRemove = a.author_id === meId || canManage
              return (
                <div key={a.id} className="flex items-center gap-2.5">
                  {a.kind === 'file' ? <Paperclip size={15} className="text-muted shrink-0" /> : <Link2 size={15} className="text-muted shrink-0" />}
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-secondary hover:text-sage truncate flex-1 min-w-0">
                    {a.file_name ?? a.url}
                  </a>
                  <span className="text-muted text-[11px] shrink-0">{author?.full_name ?? 'Someone'}</span>
                  {canRemove && (
                    <button
                      onClick={() => removeAttachment.mutate(a.id)}
                      className="btn-ghost !p-1 shrink-0"
                      title="Remove attachment"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )
            })}
            {attachments.length === 0 && <p className="text-muted text-sm">No attachments yet.</p>}

            {canEdit && meId && (
              <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <AssetUploader
                  bucket="ticket-attachments"
                  pathPrefix={ticket.id}
                  accept=""
                  label="Attach file"
                  onUploaded={(url, file) => attach.mutate({ kind: 'file', url, fileName: file.name })}
                />
                <input
                  className="input flex-1 !py-1.5 text-sm"
                  placeholder="Or paste a link and press Enter"
                  value={attachUrl}
                  onChange={(e) => setAttachUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && /^https?:\/\//i.test(attachUrl.trim())) {
                      attach.mutate({ kind: 'url', url: attachUrl.trim() })
                    }
                  }}
                />
              </div>
            )}
          </div>
        ) : tab === 'comments' ? (
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

        {/* The details sidebar. Only board:full (admin/owner) gets dropdowns here — everyone
            else keeps the plain read-only display, same asymmetry the rest of the board already
            has between "work your own ticket" and "reassign/override anything". Resolution has
            no dropdown: it isn't a stored field (see docs/board-list-view-plan.md), it's read off
            the column plus accepted_at/rejection_note, so editing Column already changes it. */}
        <div className="space-y-4">
          <div className="panel !py-3 space-y-3 text-sm">
            <FieldRow label="Assignee">
              {canManage ? (
                <select
                  className="input !py-1 !text-xs"
                  value={ticket.assignee_id ?? ''}
                  onChange={(e) => updateField.mutate({ assignee_id: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {assignable.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              ) : (
                <span className="flex items-center gap-2"><Avatar user={assignee} size={18} />{assignee?.full_name ?? 'Unassigned'}</span>
              )}
            </FieldRow>
            <FieldRow label="Reviewer">
              {canManage ? (
                <select
                  className="input !py-1 !text-xs"
                  value={ticket.reviewer_id ?? ''}
                  onChange={(e) => updateField.mutate({ reviewer_id: e.target.value || null })}
                >
                  <option value="">Nobody</option>
                  {assignable.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              ) : (
                <span className="flex items-center gap-2"><Avatar user={reviewer} size={18} />{reviewer?.full_name ?? 'Nobody'}</span>
              )}
            </FieldRow>
            <FieldRow label="Reporter">
              {canManage ? (
                <select
                  className="input !py-1 !text-xs"
                  value={ticket.reporter_id ?? ''}
                  onChange={(e) => updateField.mutate({ reporter_id: e.target.value || null })}
                >
                  <option value="">—</option>
                  {assignable.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              ) : (
                <span className="text-secondary">{reporter?.full_name ?? '—'}</span>
              )}
            </FieldRow>
            <FieldRow label="Column">
              {canManage ? (
                <select
                  className="input !py-1 !text-xs"
                  value={ticket.column_id}
                  onChange={(e) => updateField.mutate({ column_id: e.target.value })}
                >
                  {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : (
                <span className="text-secondary">{columns.find((c) => c.id === ticket.column_id)?.name}</span>
              )}
            </FieldRow>
            <FieldRow label="Resolution">
              {(() => { const r = resolutionOf(ticket, columns); return <Badge tone={RESOLUTION_TONE[r]}>{r}</Badge> })()}
            </FieldRow>
            {ticket.due_date && (
              <FieldRow label="Due">
                <span style={{ color: dueTone(daysUntilDue(ticket.due_date)) ?? undefined }}>
                  {formatDue(ticket.due_date)}
                </span>
              </FieldRow>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Label above the control rather than beside it — a `<select>` needs the width a same-line
 *  label would eat into, unlike the plain-text values `Row` (used elsewhere in this file)
 *  displays for everyone who isn't `board:full`. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted text-xs mb-1">{label}</div>
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
