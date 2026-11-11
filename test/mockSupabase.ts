// Stands in for src/lib/supabase in every test (see test/vite.config.ts).
//
// An in-memory database the pages read and write like the real one: filters
// are applied, writes change the rows, and a reload sees them. Every call is
// recorded in `captured` — failed ones too — so a test can assert what the
// app asked for, and `failNext` makes the next matching call fail the way
// Postgres would, so the error paths can be driven too.
//
// What it cannot do is enforce RLS, grants or triggers. Those are the
// database's job, and test/sql/ proves them against a real Postgres; these
// tests prove the app asks for the right things and handles the answers. A
// few triggers are mirrored on insert (issue numbering, defaults, stamps) so
// the pages see the rows they would; project visibility is mirrored on
// select, so a person's navigation is what it would be.
import type { Profile } from '../src/lib/types'

type Row = Record<string, unknown>
export interface PgError {
  code?: string
  message: string
}
interface Result {
  data: unknown
  error: PgError | null
  count?: number | null
}

// The fixtures' "today"; tests freeze the clock to it (setup.ts freezeToday).
export const TODAY = '2026-10-21' // a Wednesday

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const at = (day: string, time = '10:00') => new Date(`${day}T${time}:00`).toISOString()

function person(id: string, full_name: string, app_role: 'admin' | 'member', active = true): Profile {
  return {
    id,
    email: `${id.slice(2)}@elevancelabs.com`,
    full_name,
    title: null,
    avatar_url: null,
    app_role,
    active,
    created_at: at('2026-09-01'),
  }
}

/**
 *   amna   workspace admin
 *   sara   member; member of WEB and OPS
 *   omar   member; viewer of WEB
 *   hina   member; in no project (sees OPS, which is open)
 *   zara   deactivated
 */
export const PEOPLE = {
  admin: person('p-amna', 'Amna Khan', 'admin'),
  member: person('p-sara', 'Sara Iqbal', 'member'),
  viewer: person('p-omar', 'Omar Farooq', 'member'),
  outsider: person('p-hina', 'Hina Raza', 'member'),
  gone: person('p-zara', 'Zara Ali', 'member', false),
}

const PROJECTS: Row[] = [
  { id: 'pr-web', key: 'WEB', name: 'Website', description: 'The marketing site', kind: 'scrum', visibility: 'private',
    lead_id: 'p-sara', color: '#3f51b5', issue_counter: 6, drive_folder_id: null, archived_at: null, created_at: at('2026-09-01') },
  { id: 'pr-ops', key: 'OPS', name: 'Operations', description: '', kind: 'kanban', visibility: 'open',
    lead_id: 'p-amna', color: '#00897b', issue_counter: 2, drive_folder_id: null, archived_at: null, created_at: at('2026-09-02') },
]

const MEMBERS: Row[] = [
  { project_id: 'pr-web', profile_id: 'p-amna', role: 'admin' },
  { project_id: 'pr-web', profile_id: 'p-sara', role: 'member' },
  { project_id: 'pr-web', profile_id: 'p-omar', role: 'viewer' },
  { project_id: 'pr-web', profile_id: 'p-zara', role: 'member' },
  { project_id: 'pr-ops', profile_id: 'p-amna', role: 'admin' },
  { project_id: 'pr-ops', profile_id: 'p-sara', role: 'member' },
]

const status = (id: string, project_id: string, name: string, category: string, position: number, wip_limit: number | null = null): Row =>
  ({ id, project_id, name, category, position, wip_limit })

const STATUSES: Row[] = [
  status('st-web-todo', 'pr-web', 'To Do', 'todo', 0),
  status('st-web-doing', 'pr-web', 'In Progress', 'in_progress', 1, 2),
  status('st-web-review', 'pr-web', 'In Review', 'in_progress', 2),
  status('st-web-done', 'pr-web', 'Done', 'done', 3),
  status('st-ops-todo', 'pr-ops', 'To Do', 'todo', 0),
  status('st-ops-doing', 'pr-ops', 'Doing', 'in_progress', 1),
  status('st-ops-done', 'pr-ops', 'Done', 'done', 2),
]

export const TYPES = {
  epic: { id: 't-epic', name: 'Epic', level: 'epic', icon: 'epic', color: '#904ee2', archived: false },
  story: { id: 't-story', name: 'Story', level: 'standard', icon: 'story', color: '#63ba3c', archived: false },
  task: { id: 't-task', name: 'Task', level: 'standard', icon: 'task', color: '#4bade8', archived: false },
  bug: { id: 't-bug', name: 'Bug', level: 'standard', icon: 'bug', color: '#e5493a', archived: false },
  subtask: { id: 't-sub', name: 'Sub-task', level: 'subtask', icon: 'subtask', color: '#4bade8', archived: false },
}

const SPRINTS: Row[] = [
  { id: 'sp-1', project_id: 'pr-web', name: 'WEB Sprint 1', goal: 'Ship the hero', state: 'active', start_date: '2026-10-14',
    end_date: '2026-10-27', started_at: at('2026-10-14', '09:00'), completed_at: null, created_at: at('2026-10-01') },
  { id: 'sp-2', project_id: 'pr-web', name: 'WEB Sprint 2', goal: '', state: 'future', start_date: null, end_date: null,
    started_at: null, completed_at: null, created_at: at('2026-10-02') },
]

const RELEASES: Row[] = [
  { id: 'rl-1', project_id: 'pr-web', name: 'v1.0', description: 'First public site', start_date: '2026-10-01',
    release_date: '2026-10-30', status: 'unreleased', released_at: null, created_at: at('2026-10-01') },
]

function issue(n: number, project: 'WEB' | 'OPS', title: string, extra: Row = {}): Row {
  const pid = project === 'WEB' ? 'pr-web' : 'pr-ops'
  return {
    id: `i-${project.toLowerCase()}-${n}`,
    project_id: pid,
    number: n,
    key: `${project}-${n}`,
    type_id: 't-task',
    status_id: project === 'WEB' ? 'st-web-todo' : 'st-ops-todo',
    title,
    description: '',
    priority: 'medium',
    assignee_id: null,
    reporter_id: 'p-sara',
    parent_id: null,
    sprint_id: null,
    release_id: null,
    story_points: null,
    start_date: null,
    due_date: null,
    labels: [],
    rank: n * 1024,
    custom: {},
    resolved_at: null,
    created_by: 'p-sara',
    created_at: at('2026-10-10'),
    updated_at: at('2026-10-15'),
    ...extra,
  }
}

const ISSUES: Row[] = [
  issue(1, 'WEB', 'Launch the new site', { type_id: 't-epic' }),
  issue(2, 'WEB', 'Hero banner', { type_id: 't-story', parent_id: 'i-web-1', sprint_id: 'sp-1', story_points: 5,
    assignee_id: 'p-sara', status_id: 'st-web-doing', priority: 'high', release_id: 'rl-1', labels: ['frontend'] }),
  issue(3, 'WEB', 'Fix the footer links', { type_id: 't-bug', sprint_id: 'sp-1', story_points: 2, status_id: 'st-web-done',
    resolved_at: at('2026-10-16'), release_id: 'rl-1' }),
  issue(4, 'WEB', 'Headline copy', { type_id: 't-sub', parent_id: 'i-web-2', sprint_id: 'sp-1', assignee_id: 'p-amna' }),
  issue(5, 'WEB', 'Pricing page', { type_id: 't-story', story_points: 3, due_date: '2026-10-20', assignee_id: 'p-sara' }),
  issue(6, 'WEB', 'Contact form', { type_id: 't-task', story_points: 1 }),
  issue(1, 'OPS', 'Laptop for Hina', { assignee_id: 'p-sara' }),
  issue(2, 'OPS', 'Renew the domain', { status_id: 'st-ops-doing' }),
]

const COMMENTS: Row[] = [
  { id: 'c-1', issue_id: 'i-web-2', author_id: 'p-amna', body: '<p>Use the new photo</p>', created_at: at('2026-10-15', '11:00'), edited_at: null },
]

// Sara's own two, one Omar shared with her (on WEB-2, done), and one of
// Omar's she must never see.
const TODOS: Row[] = [
  { id: 'td-1', owner_id: 'p-sara', title: 'Write the brief', notes: '', due_on: TODAY, done_at: null, issue_id: null, project_id: null,
    position: 1, shared_with: [], created_at: at('2026-10-20') },
  { id: 'td-2', owner_id: 'p-sara', title: 'Book the photographer', notes: '', due_on: '2026-10-19', done_at: null, issue_id: 'i-web-2',
    project_id: 'pr-web', position: 2, shared_with: [], created_at: at('2026-10-18') },
  { id: 'td-omar-shared', owner_id: 'p-omar', title: 'Choose the hero photo', notes: '', due_on: null, done_at: at('2026-10-19'),
    issue_id: 'i-web-2', project_id: 'pr-web', position: 3, shared_with: ['p-sara'], created_at: at('2026-10-17') },
  { id: 'td-omar', owner_id: 'p-omar', title: 'Omar private todo', notes: '', due_on: null, done_at: null, issue_id: 'i-web-2',
    project_id: 'pr-web', position: 4, shared_with: [], created_at: at('2026-10-17') },
]

// Sara's labels and notes (one on WEB, pinned; one on Monday's standup, a
// meeting in her Google Calendar), and one of Omar's that she must never see.
const NOTE_LABELS: Row[] = [
  { id: 'nl-ideas', owner_id: 'p-sara', name: 'Ideas', created_at: at('2026-10-01') },
  { id: 'nl-personal', owner_id: 'p-sara', name: 'Personal', created_at: at('2026-10-01') },
  { id: 'nl-omar', owner_id: 'p-omar', name: 'Omar label', created_at: at('2026-10-01') },
]

const note = (id: string, owner_id: string, title: string, body: string, extra: Row = {}): Row => ({
  id, owner_id, title, body, color: 'yellow', label_ids: [], project_id: null, pinned: false, meeting_id: null, meeting_title: null,
  meeting_on: null, created_at: at('2026-10-10'), updated_at: at('2026-10-10'), ...extra,
})

const NOTES: Row[] = [
  note('nt-launch', 'p-sara', 'Launch plan', 'Hero first, then pricing.', { label_ids: ['nl-ideas'], project_id: 'pr-web', pinned: true,
    updated_at: at('2026-10-20') }),
  note('nt-standup', 'p-sara', '', 'Ask about the domain\nAlso the invoices', { color: 'blue', meeting_id: 'g-standup-1019',
    meeting_title: 'Standup', meeting_on: '2026-10-19', updated_at: at('2026-10-19', '10:20') }),
  note('nt-gifts', 'p-sara', 'Gift ideas', 'Books for Hina', { color: 'green', label_ids: ['nl-personal'], updated_at: at('2026-10-15') }),
  note('nt-omar', 'p-omar', 'Omar private', 'Not for Sara', { project_id: 'pr-web' }),
]

const NOTIFICATIONS: Row[] = [
  { id: 'n-1', recipient_id: 'p-sara', actor_id: 'p-amna', kind: 'commented', issue_id: 'i-web-2', comment_id: 'c-1',
    detail: null, read_at: null, created_at: at('2026-10-15', '11:00') },
]

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

let db: Record<string, Row[]>
const rowsIn = (name: string) => (db[name] ??= [])
const find = (table: string, id: unknown) => rowsIn(table).find((r) => r.id === id)
let nextId = 1

const me = () => authState.bound

/** Mirror of role_in_project, for the project visibility the mock applies on select. */
function roleIn(projectId: unknown) {
  const p = find('projects', projectId)
  const who = me()
  if (!p || !who || !who.active) return null
  if (who.app_role === 'admin') return 'admin'
  const m = rowsIn('project_members').find((r) => r.project_id === projectId && r.profile_id === who.id)?.role ?? null
  if (p.archived_at) return m || p.visibility === 'open' ? 'viewer' : null
  return m ?? (p.visibility === 'open' ? 'viewer' : null)
}

// PostgREST embeds the pages ask for, derived on read.
function withEmbeds(table: string, row: Row): Row {
  switch (table) {
    case 'notifications': {
      const i = find('issues', row.issue_id)
      return { ...row, issue: i ? { key: i.key, title: i.title } : null }
    }
    case 'todos': {
      const i = find('issues', row.issue_id)
      return { ...row, issue: i ? { key: i.key, title: i.title } : null }
    }
    default:
      return row
  }
}

function rowsOf(table: string): Row[] {
  if (table === 'projects') return rowsIn('projects').filter((p) => roleIn(p.id) !== null)
  // Mirror of todos_select: yours, and those you're on.
  if (table === 'todos') return rowsIn('todos').filter((t) => t.owner_id === me()?.id || (t.shared_with as string[]).includes(me()?.id ?? ''))
  return rowsIn(table)
}

const categoryOf = (statusId: unknown) => find('project_statuses', statusId)?.category

// What the database's triggers fill in on insert.
function insertDefaults(table: string, row: Row): Row {
  const now = new Date().toISOString()
  switch (table) {
    case 'issues': {
      const p = find('projects', row.project_id)!
      const number = Number(p.issue_counter) + 1
      p.issue_counter = number
      const statusId = row.status_id ??
        rowsIn('project_statuses').filter((s) => s.project_id === row.project_id && s.category === 'todo')
          .sort((a, b) => Number(a.position) - Number(b.position))[0]?.id
      const maxRank = Math.max(0, ...rowsIn('issues').filter((i) => i.project_id === row.project_id).map((i) => Number(i.rank)))
      const parent = find('issues', row.parent_id)
      const level = (Object.values(TYPES).find((t) => t.id === row.type_id) ?? TYPES.task).level
      return {
        description: '', priority: 'medium', assignee_id: null, parent_id: null, sprint_id: null, release_id: null, story_points: null,
        start_date: null, due_date: null, labels: [], custom: {}, rank: maxRank + 1024, ...row,
        status_id: statusId, number, key: `${p.key}-${number}`, reporter_id: row.reporter_id ?? me()?.id, created_by: me()?.id,
        resolved_at: categoryOf(statusId) === 'done' ? now : null, created_at: now, updated_at: now,
        ...(level === 'subtask' && parent ? { sprint_id: parent.sprint_id } : {}),
      }
    }
    case 'comments':
      return { edited_at: null, ...row, author_id: me()?.id }
    case 'todos':
      return { notes: '', due_on: null, done_at: null, issue_id: null, project_id: null, position: Date.now(), ...row, owner_id: me()?.id,
        shared_with: ((row.shared_with ?? []) as string[]).filter((id) => id !== me()?.id),
        // todos_guard: an issue's todo is in the issue's project.
        ...(row.issue_id ? { project_id: find('issues', row.issue_id)?.project_id ?? null } : {}) }
    case 'saved_filters':
      return { shared: false, ...row, owner_id: me()?.id }
    case 'note_labels':
      return { ...row, owner_id: me()?.id }
    case 'notes':
      return { title: '', body: '', color: 'yellow', label_ids: [], project_id: null, pinned: false, meeting_id: null, meeting_title: null,
        meeting_on: null, ...row, owner_id: me()?.id, updated_at: now }
    case 'releases':
      return { description: '', start_date: null, release_date: null, status: 'unreleased', released_at: null, ...row, created_by: me()?.id }
    case 'documents':
      return { issue_id: null, drive_file_id: null, ...row, created_by: me()?.id }
    case 'sprints':
      return { goal: '', start_date: null, end_date: null, started_at: null, completed_at: null, ...row, state: 'future' }
    case 'project_statuses':
      return { wip_limit: null, ...row,
        position: Math.max(-1, ...rowsIn(table).filter((s) => s.project_id === row.project_id).map((s) => Number(s.position))) + 1 }
    case 'fields':
      return { options: [], issue_type_ids: null, required: false, ...row,
        position: Math.max(-1, ...rowsIn(table).filter((f) => f.project_id === row.project_id).map((f) => Number(f.position))) + 1 }
    case 'profiles':
      return { title: null, avatar_url: null, app_role: 'member', active: true, ...row }
    default:
      return row
  }
}

// What the database's triggers change on update.
function updateEffects(table: string, row: Row, values: Row) {
  if (table === 'issues') {
    if ('status_id' in values) row.resolved_at = categoryOf(values.status_id) === 'done' ? row.resolved_at ?? new Date().toISOString() : null
    row.updated_at = new Date().toISOString()
  }
  if (table === 'comments') row.edited_at = new Date().toISOString()
  if (table === 'notes' && ('title' in values || 'body' in values)) row.updated_at = new Date().toISOString()
  if (table === 'notes' && 'meeting_id' in values && !values.meeting_id) Object.assign(row, { meeting_title: null, meeting_on: null })
  if (table === 'todos' && values.issue_id) row.project_id = find('issues', values.issue_id)?.project_id ?? null
  if (table === 'releases' && 'status' in values) row.released_at = values.status === 'released' ? new Date().toISOString() : null
}

// ---------------------------------------------------------------------------
// Recording and failure injection
// ---------------------------------------------------------------------------

type Op = 'select' | 'insert' | 'update' | 'delete'
type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is' | 'in' | 'not' | 'ov' | 'fts' | 'or' | 'and'
export type Filter = [col: string, op: FilterOp, value: unknown]

export const captured = {
  reads: [] as string[],
  selects: [] as { table: string; columns: string; filters: Filter[] }[],
  inserts: [] as { table: string; rows: Row[] }[],
  updates: [] as { table: string; values: Row; filters: Filter[] }[],
  deletes: [] as { table: string; filters: Filter[] }[],
  rpcs: [] as { name: string; args: Row | undefined }[],
  functions: [] as { name: string; body: unknown }[],
  channels: [] as string[],
  auth: [] as { call: string; options?: unknown }[],
  // Every database call, in order — for asserting sequence.
  calls: [] as string[],
}

const failures = new Map<string, PgError>()

/**
 * Make the next call matching `key` fail with `error`. Keys look like
 * `issues.insert`, `sprints.delete`, `rpc.sprint_start`, `functions.drive`.
 */
export function failNext(key: string, error: PgError) {
  failures.set(key, error)
}

function takeFailure(key: string) {
  const error = failures.get(key)
  if (error) failures.delete(key)
  return error ?? null
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

type Session = { user: { id: string }; provider_refresh_token?: string } | null
type Listener = (event: string, session: Session) => void

export const authState = {
  session: null as Session,
  // What `bind_profile` hands back: the profile, or null to refuse.
  bound: null as Profile | null,
}
const listeners = new Set<Listener>()

/**
 * Your own Google Calendar, as the google-calendar function would answer.
 * Set `connected` / `events` before mounting; `connect` changes it as the
 * function would.
 */
export const googleCalendar = {
  connected: false,
  lapsed: false,
  events: [] as Row[],
}


/** Sign in as this person, before mounting. `null` = signed in but refused. */
export function signInAs(who: Profile | null) {
  authState.session = { user: { id: `auth-${who?.id ?? 'stranger'}` } }
  authState.bound = who
}

/** Reset every table, recording and auth to the fixtures. Call before each test. */
export function reset() {
  const copy = (rows: Row[]) => rows.map((r) => structuredClone(r))
  db = {
    profiles: copy(Object.values(PEOPLE) as unknown as Row[]),
    projects: copy(PROJECTS),
    project_members: copy(MEMBERS),
    project_statuses: copy(STATUSES),
    issue_types: copy(Object.values(TYPES) as unknown as Row[]),
    fields: [],
    project_integrations: [],
    workspace_settings: [{ id: true, chat_webhook_url: null, chat_events: ['release_released'] }],
    sprints: copy(SPRINTS),
    releases: copy(RELEASES),
    issues: copy(ISSUES),
    issue_events: [],
    sprint_issues: [],
    issue_links: [],
    issue_dev_links: [],
    issue_watchers: [{ issue_id: 'i-web-2', profile_id: 'p-sara' }],
    comments: copy(COMMENTS),
    attachments: [],
    documents: [],
    saved_filters: [],
    todos: copy(TODOS),
    note_labels: copy(NOTE_LABELS),
    notes: copy(NOTES),
    notifications: copy(NOTIFICATIONS),
  }
  for (const list of Object.values(captured)) list.length = 0
  failures.clear()
  Object.assign(googleCalendar, { connected: false, lapsed: false, events: [] })
  authState.session = null
  authState.bound = null
  listeners.clear()
}
reset()

/** A table as it now stands, after the app's writes. Push to it to add rows. */
export const table = (name: string) => rowsIn(name)

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

type Value = string | number | boolean | null

function compare(v: unknown, value: unknown) {
  return v === null || v === undefined ? NaN : (v as Value)! < (value as Value)! ? -1 : (v as Value)! > (value as Value)! ? 1 : 0
}

/** `a.is.null,b.in.(x,y),c.gte.2026-01-01,and(d.lte.x,e.gte.y)` — the shapes the app's `or()` filters use. */
function parseOr(expr: string): Filter[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of expr) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) parts.push(cur)
  return parts.map((p) => {
    if (p.startsWith('and(') && p.endsWith(')')) return ['', 'and', parseOr(p.slice(4, -1))] as Filter
    const [col, op, ...rest] = p.split('.')
    const raw = rest.join('.')
    if (op === 'in') return [col, 'in', raw.replace(/^\(|\)$/g, '').split(',').filter(Boolean)] as Filter
    if (op === 'is') return [col, 'is', raw === 'null' ? null : raw === 'true'] as Filter
    return [col, op as FilterOp, raw] as Filter
  })
}

function test(row: Row, [col, op, value]: Filter): boolean {
  const v = row[col] ?? null
  switch (op) {
    case 'eq':
      return v === value
    case 'is':
      return v === value
    case 'neq':
      return v !== value
    case 'gt':
      return compare(v, value) > 0
    case 'gte':
      return compare(v, value) >= 0
    case 'lt':
      return compare(v, value) < 0
    case 'lte':
      return compare(v, value) <= 0
    case 'in':
      return (value as unknown[]).includes(v)
    case 'not': {
      const [inner, operand] = value as [FilterOp, unknown]
      return !test(row, [col, inner, operand])
    }
    case 'ov':
      return Array.isArray(v) && (value as unknown[]).some((x) => v.includes(x))
    case 'fts': {
      const hay = `${row.key ?? ''} ${row.title ?? ''} ${String(row.description ?? '').replace(/<[^>]*>/g, ' ')}`.toLowerCase()
      return String(value).toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
    }
    case 'or':
      return (value as Filter[]).some((f) => test(row, f))
    case 'and':
      return (value as Filter[]).every((f) => test(row, f))
  }
}

class Query implements PromiseLike<Result> {
  private filters: Filter[] = []
  private columns = '*'
  private sorts: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
  private mode: 'many' | 'single' | 'maybeSingle' = 'many'
  private returning = false
  private counting = false
  private head = false
  private window: [number, number] | null = null

  constructor(
    private readonly name: string,
    private readonly op: Op,
    private readonly payload?: Row | Row[],
  ) {}

  select(columns = '*', opts?: { count?: 'exact'; head?: boolean }) {
    this.columns = columns
    this.returning = true
    this.counting = !!opts?.count
    this.head = !!opts?.head
    return this
  }
  private where(col: string, op: FilterOp, value: unknown) {
    this.filters.push([col, op, value])
    return this
  }
  eq = (col: string, value: unknown) => this.where(col, 'eq', value)
  neq = (col: string, value: unknown) => this.where(col, 'neq', value)
  gt = (col: string, value: unknown) => this.where(col, 'gt', value)
  gte = (col: string, value: unknown) => this.where(col, 'gte', value)
  lt = (col: string, value: unknown) => this.where(col, 'lt', value)
  lte = (col: string, value: unknown) => this.where(col, 'lte', value)
  is = (col: string, value: null | boolean) => this.where(col, 'is', value)
  'in' = (col: string, values: readonly unknown[]) => this.where(col, 'in', [...values])
  not = (col: string, op: FilterOp, value: unknown) => this.where(col, 'not', [op, value])
  overlaps = (col: string, values: readonly unknown[]) => this.where(col, 'ov', [...values])
  textSearch = (col: string, q: string) => this.where(col, 'fts', q)
  or = (expr: string) => this.where('', 'or', parseOr(expr))
  order(col: string, { ascending = true, nullsFirst = !ascending }: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.sorts.push({ col, ascending, nullsFirst })
    return this
  }
  limit(n: number) {
    this.window = [0, n - 1]
    return this
  }
  range(from: number, to: number) {
    this.window = [from, to]
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybeSingle'
    return this
  }

  private matches = (row: Row) => this.filters.every((f) => test(row, f))

  private execute(): Result {
    const key = `${this.name}.${this.op}`
    const input = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]
    // Recorded before any injected failure: a refused request was still sent.
    captured.calls.push(key)
    if (this.op === 'select') {
      captured.reads.push(this.name)
      captured.selects.push({ table: this.name, columns: this.columns, filters: this.filters })
    }
    if (this.op === 'insert') captured.inserts.push({ table: this.name, rows: input })
    if (this.op === 'update') captured.updates.push({ table: this.name, values: input[0], filters: this.filters })
    if (this.op === 'delete') captured.deletes.push({ table: this.name, filters: this.filters })
    const error = takeFailure(key)
    if (error) return { data: null, error }

    let rows: Row[]
    switch (this.op) {
      case 'select':
        rows = rowsOf(this.name).filter(this.matches).map((r) => withEmbeds(this.name, structuredClone(r)))
        break
      case 'insert':
        rows = input.map((r) => ({ id: `new-${nextId++}`, created_at: new Date().toISOString(), ...insertDefaults(this.name, r) }))
        rowsIn(this.name).push(...rows)
        rows = rows.map((r) => withEmbeds(this.name, structuredClone(r)))
        break
      case 'update':
        rows = rowsIn(this.name).filter(this.matches)
        for (const r of rows) {
          Object.assign(r, input[0])
          updateEffects(this.name, r, input[0])
        }
        rows = rows.map((r) => withEmbeds(this.name, structuredClone(r)))
        break
      case 'delete':
        rows = rowsIn(this.name).filter(this.matches)
        db[this.name] = rowsIn(this.name).filter((r) => !this.matches(r))
        break
    }

    if (this.sorts.length) {
      rows = [...rows].sort((a, b) => {
        for (const { col, ascending, nullsFirst } of this.sorts) {
          const x = a[col] ?? null
          const y = b[col] ?? null
          if (x === y) continue
          if (x === null) return nullsFirst ? -1 : 1
          if (y === null) return nullsFirst ? 1 : -1
          return (x < y ? -1 : 1) * (ascending ? 1 : -1)
        }
        return 0
      })
    }
    const total = rows.length
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1)
    const data = this.head ? null : this.op === 'select' || this.returning ? rows : null
    if (this.mode === 'many') return { data, error: null, count: this.counting ? total : null }
    if (this.mode === 'maybeSingle') return { data: rows[0] ?? null, error: null }
    return rows.length === 1
      ? { data: rows[0], error: null }
      : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected)
  }
}

// ---------------------------------------------------------------------------
// Database functions
// ---------------------------------------------------------------------------

// Simplified stand-ins for the SQL functions: enough for the pages to show
// the result. The rules they enforce are tested in test/sql/.
const RPCS: Record<string, (args: Row) => unknown> = {
  bind_profile: () => authState.bound,
  current_profile_id: () => authState.bound?.id ?? null,
  project_create: ({ p_key, p_name, p_kind, p_visibility, p_description }) => {
    const id = `new-${nextId++}`
    const p = { id, key: p_key, name: p_name, kind: p_kind, visibility: p_visibility, description: p_description ?? '',
      lead_id: me()?.id, color: '#3f51b5', issue_counter: 0, drive_folder_id: null, archived_at: null, created_at: new Date().toISOString() }
    rowsIn('projects').push(p)
    rowsIn('project_members').push({ project_id: id, profile_id: me()?.id, role: 'admin' })
    ;[['To Do', 'todo'], ['In Progress', 'in_progress'], ['In Review', 'in_progress'], ['Done', 'done']].forEach(([name, category], i) =>
      rowsIn('project_statuses').push({ id: `new-${nextId++}`, project_id: id, name, category, position: i, wip_limit: null }))
    return p
  },
  project_statuses_reorder: ({ p_ids }) => {
    ;(p_ids as string[]).forEach((id, i) => Object.assign(find('project_statuses', id) ?? {}, { position: i }))
    return null
  },
  fields_reorder: ({ p_ids }) => {
    ;(p_ids as string[]).forEach((id, i) => Object.assign(find('fields', id) ?? {}, { position: i }))
    return null
  },
  project_rerank: ({ p_project }) => {
    rowsIn('issues').filter((i) => i.project_id === p_project).sort((a, b) => Number(a.rank) - Number(b.rank))
      .forEach((i, n) => (i.rank = (n + 1) * 1024))
    return null
  },
  sprint_start: ({ p_sprint, p_start, p_end, p_name, p_goal }) => {
    const s = find('sprints', p_sprint)!
    Object.assign(s, { state: 'active', start_date: p_start, end_date: p_end, started_at: new Date().toISOString(),
      name: p_name || s.name, goal: p_goal ?? s.goal })
    for (const i of rowsIn('issues').filter((x) => x.sprint_id === p_sprint))
      rowsIn('sprint_issues').push({ sprint_id: p_sprint, issue_id: i.id, committed: true, points_at_start: i.story_points, points_at_end: null, completed: null })
    return null
  },
  sprint_complete: ({ p_sprint, p_move_to }) => {
    for (const i of rowsIn('issues').filter((x) => x.sprint_id === p_sprint)) {
      const done = categoryOf(i.status_id) === 'done'
      const line = rowsIn('sprint_issues').find((r) => r.sprint_id === p_sprint && r.issue_id === i.id)
      if (line) Object.assign(line, { points_at_end: i.story_points, completed: done })
      else rowsIn('sprint_issues').push({ sprint_id: p_sprint, issue_id: i.id, committed: false, points_at_start: null, points_at_end: i.story_points, completed: done })
      if (!done) i.sprint_id = p_move_to ?? null
    }
    Object.assign(find('sprints', p_sprint)!, { state: 'closed', completed_at: new Date().toISOString() })
    return null
  },
  todo_leave: ({ p_todo }) => {
    const t = find('todos', p_todo)
    if (t) t.shared_with = (t.shared_with as string[]).filter((id) => id !== me()?.id)
    return null
  },
}

function rpc(name: string, args?: Row) {
  const run = (): Result => {
    captured.rpcs.push({ name, args })
    captured.calls.push(`rpc.${name}`)
    const error = takeFailure(`rpc.${name}`)
    if (error) return { data: null, error }
    const fn = RPCS[name]
    return fn ? { data: fn(args ?? {}), error: null } : { data: null, error: { message: `unknown rpc ${name}` } }
  }
  const promise = Promise.resolve().then(run)
  return Object.assign(promise, { maybeSingle: () => promise, single: () => promise })
}

// ---------------------------------------------------------------------------
// Edge Functions (the browser calls `drive` and `google-calendar`)
// ---------------------------------------------------------------------------

function drive(body: unknown): unknown {
  if (body instanceof FormData) {
    const file = body.get('file') as File
    const row = { id: `new-${nextId++}`, issue_id: body.get('issue_id'), drive_file_id: `f-${nextId}`, file_name: file.name,
      mime_type: file.type || 'application/octet-stream', size_bytes: file.size, web_view_link: `https://drive.google.com/file/d/f-${nextId}/view`,
      uploaded_by: me()?.id, created_at: new Date().toISOString(), comment_id: body.get('comment_id') ?? null }
    rowsIn('attachments').push(row)
    return row
  }
  const b = body as Row
  switch (b.action) {
    case 'create_doc': {
      const row = { id: `new-${nextId++}`, project_id: b.project_id, issue_id: b.issue_id ?? null, title: b.title, doc_type: b.doc_type,
        url: `https://docs.google.com/document/d/d-${nextId}/edit`, drive_file_id: `d-${nextId}`, created_by: me()?.id, created_at: new Date().toISOString() }
      rowsIn('documents').push(row)
      return row
    }
    case 'delete_attachment':
      db.attachments = rowsIn('attachments').filter((a) => a.id !== b.attachment_id)
      return { ok: true }
    case 'project_folder':
      return { url: 'https://drive.google.com/drive/folders/folder-1' }
    case 'download':
      return new Blob(['x'], { type: 'image/png' })
    default:
      return null
  }
}

function googleCalendarFn(body: unknown): unknown {
  const b = body as Row
  const email = me()?.email
  switch (b.action) {
    case 'connect':
      googleCalendar.connected = true
      return { connected: true, email }
    case 'events':
      return googleCalendar.connected
        ? { connected: true, email, events: googleCalendar.events }
        : { connected: false, ...(googleCalendar.lapsed ? { lapsed: true } : {}) }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

interface Channel {
  on: (...args: unknown[]) => Channel
  subscribe: () => Channel
}

export const supabase = {
  from: (name: string) => ({
    select: (columns?: string, opts?: { count?: 'exact'; head?: boolean }) => new Query(name, 'select').select(columns, opts),
    insert: (payload: Row | Row[]) => new Query(name, 'insert', payload),
    update: (payload: Row) => new Query(name, 'update', payload),
    delete: () => new Query(name, 'delete'),
  }),
  rpc,
  functions: {
    async invoke(name: string, { body }: { body: unknown }) {
      captured.functions.push({ name, body })
      captured.calls.push(`functions.${name}`)
      const error = takeFailure(`functions.${name}`)
      if (error) return { data: null, error: { message: error.message, context: { json: async () => ({ error: error.message }) } } }
      return { data: name === 'drive' ? drive(body) : name === 'google-calendar' ? googleCalendarFn(body) : null, error: null }
    },
  },
  channel(name: string): Channel {
    captured.channels.push(name)
    const ch: Channel = { on: () => ch, subscribe: () => ch }
    return ch
  },
  removeChannel: () => Promise.resolve('ok'),
  auth: {
    onAuthStateChange(listener: Listener) {
      listeners.add(listener)
      setTimeout(() => listener('INITIAL_SESSION', authState.session), 0)
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
    },
    async signInWithOAuth(options: unknown) {
      captured.auth.push({ call: 'signInWithOAuth', options })
      return { data: {}, error: null }
    },
    async signOut() {
      captured.auth.push({ call: 'signOut' })
      authState.session = null
      for (const l of listeners) l('SIGNED_OUT', null)
      return { error: null }
    },
  },
}
