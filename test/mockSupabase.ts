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
    issue_view: 'modal',
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

// The project's test case lists, as project_create leaves them.
const TEST_LISTS = {
  test_types: ['Functional', 'UI', 'Negative', 'Edge case', 'Integration'],
  test_levels: ['Smoke', 'Sanity', 'Regression'],
  test_environments: ['Dev', 'QA', 'Staging'],
}

const PROJECTS: Row[] = [
  { id: 'pr-web', key: 'WEB', name: 'Website', description: 'The marketing site', kind: 'scrum', visibility: 'private',
    lead_id: 'p-sara', color: '#3f51b5', issue_counter: 6, drive_folder_id: null, archived_at: null, created_at: at('2026-09-01'),
    disabled_features: [], summary_widgets: null, test_counter: 3, test_run_counter: 2, ...TEST_LISTS },
  { id: 'pr-ops', key: 'OPS', name: 'Operations', description: '', kind: 'kanban', visibility: 'open',
    lead_id: 'p-amna', color: '#00897b', issue_counter: 2, drive_folder_id: null, archived_at: null, created_at: at('2026-09-02'),
    disabled_features: [], summary_widgets: null, test_counter: 0, test_run_counter: 0, ...TEST_LISTS },
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
  { id: 'rl-1', project_id: 'pr-web', name: 'v1.0', description: 'First public site', notes: '', start_date: '2026-10-01',
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
    flag_reason: null,
    flagged_by: null,
    flagged_at: null,
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

// Amna agrees with her own comment.
const COMMENT_REACTIONS: Row[] = [
  { comment_id: 'c-1', issue_id: 'i-web-2', profile_id: 'p-amna', kind: 'up', created_at: at('2026-10-15', '11:05') },
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

// Sara's list (Book the photographer is filed in it) and one of Omar's.
const TODO_LISTS: Row[] = [
  { id: 'tl-work', owner_id: 'p-sara', name: 'Work', color: '#26a69a', position: 1, created_at: at('2026-10-01') },
  { id: 'tl-omar', owner_id: 'p-omar', name: 'Omar list', color: '#5c6bc0', position: 1, created_at: at('2026-10-01') },
]
const TODO_PLACES: Row[] = [
  { todo_id: 'td-2', profile_id: 'p-sara', list_id: 'tl-work' },
  { todo_id: 'td-omar-shared', profile_id: 'p-omar', list_id: 'tl-omar' },
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
  meeting_on: null, archived_at: null, created_at: at('2026-10-10'), updated_at: at('2026-10-10'), ...extra,
})

const NOTES: Row[] = [
  note('nt-launch', 'p-sara', 'Launch plan', 'Hero first, then pricing.', { label_ids: ['nl-ideas'], project_id: 'pr-web', pinned: true,
    updated_at: at('2026-10-20') }),
  note('nt-standup', 'p-sara', '', 'Ask about the domain\nAlso the invoices', { color: 'blue', meeting_id: 'g-standup-1019',
    meeting_title: 'Standup', meeting_on: '2026-10-19', updated_at: at('2026-10-19', '10:20') }),
  note('nt-gifts', 'p-sara', 'Gift ideas', 'Books for Hina', { color: 'green', label_ids: ['nl-personal'], updated_at: at('2026-10-15') }),
  note('nt-omar', 'p-omar', 'Omar private', 'Not for Sara', { project_id: 'pr-web' }),
  note('nt-old', 'p-sara', 'Old retro', 'Went fine', { project_id: 'pr-web', archived_at: at('2026-10-12'), updated_at: at('2026-10-11') }),
]

// WEB's test cases: two written for WEB-2 (one passed on Dev, one failed on
// QA), one for no issue, not run yet.
const testCase = (n: number, title: string, extra: Row = {}): Row => ({
  id: `tc-${n}`, project_id: 'pr-web', number: n, key: `WEB-T${n}`, issue_id: null, title, description: '', expected: '', type: null,
  level: null, areas: [], rank: n * 1024, last_status: null, last_reason: null, last_environment: null, last_recorded_by: null,
  last_recorded_at: null, created_by: 'p-sara', created_at: at('2026-10-12'), updated_at: at('2026-10-12'), updated_by: 'p-sara',
  script_repo: null, script_path: null, script_title: null, automated_at: null, ...extra,
})

const TEST_CASES: Row[] = [
  testCase(1, 'Hero shows the new photo', { issue_id: 'i-web-2', description: 'Open the home page', expected: 'The new photo fills the hero',
    type: 'Functional', level: 'Regression', areas: ['Home'], script_repo: 'elevance/site', script_path: 'e2e/home/hero.spec.ts',
    script_title: 'shows the new photo @WEB-T1', automated_at: at('2026-10-13') }),
  // Edited after its script was linked.
  testCase(2, 'Hero is readable on a phone', { issue_id: 'i-web-2', type: 'UI', level: 'Smoke', areas: ['Home', 'Mobile'],
    script_repo: 'elevance/site', script_path: 'e2e/home/hero-mobile.spec.ts', automated_at: at('2026-10-11') }),
  testCase(3, 'Footer links open', { type: 'Functional', level: 'Regression', areas: ['Footer'] }),
]

const result = (extra: Row): Row => ({ reason: '', run_id: null, duration_ms: null, error: null, artifact_url: null, attempts: 1,
  flaky: false, source: 'manual', ...extra })

const TEST_RESULTS: Row[] = [
  // From Sara's local run WEB-R1, on Dev.
  result({ id: 'tr-1', case_id: 'tc-1', project_id: 'pr-web', status: 'pass', environment: 'Dev', source: 'automated', run_id: 'run-1',
    duration_ms: 4200, attempts: 2, flaky: true, recorded_by: 'p-sara', created_at: at('2026-10-20', '09:00') }),
  result({ id: 'tr-2', case_id: 'tc-2', project_id: 'pr-web', status: 'fail', reason: 'Text overlaps the photo', environment: 'QA',
    recorded_by: 'p-amna', created_at: at('2026-10-20', '11:00') }),
]

// Sara's local run on Dev (finished), and a cloud run on Staging still going.
const TEST_RUNS: Row[] = [
  { id: 'run-1', project_id: 'pr-web', number: 1, key: 'WEB-R1', environment: 'Dev', mode: 'local', run_by: 'p-sara', repo: 'elevance/site',
    branch: 'feature/hero', commit_sha: 'abc1234def', ci_url: null, started_at: at('2026-10-20', '08:58'), finished_at: at('2026-10-20', '09:01'),
    total: 1, passed: 1, failed: 0, blocked: 0, skipped: 0, flaky: 1 },
  { id: 'run-2', project_id: 'pr-web', number: 2, key: 'WEB-R2', environment: 'Staging', mode: 'cloud', run_by: null, repo: 'elevance/site',
    branch: 'main', commit_sha: null, ci_url: 'https://github.com/elevance/site/actions/runs/7', started_at: at('2026-10-21', '06:00'),
    finished_at: null, total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, flaky: 0 },
]

const TEST_CASE_EVENTS: Row[] = [
  { id: 'tce-1', case_id: 'tc-1', project_id: 'pr-web', actor_id: 'p-sara', via: 'api', field: 'created', from_value: null,
    to_value: 'Hero shows the new photo', reason: null, created_at: at('2026-10-12') },
  { id: 'tce-2', case_id: 'tc-1', project_id: 'pr-web', actor_id: 'p-amna', via: 'api', field: 'expected', from_value: 'The photo shows',
    to_value: 'The new photo fills the hero', reason: 'The story asks for the full width', created_at: at('2026-10-13') },
]

// Sara's own token, and WEB's CI token. The mock keeps the token itself (`_token`); the database keeps only its hash.
const API_TOKENS: Row[] = [
  { id: 'tok-sara', profile_id: 'p-sara', project_id: null, name: 'Sara laptop', prefix: 'elw_aaaaaaaa', _token: `elw_${'a'.repeat(64)}`,
    scopes: ['tests:read', 'tests:write'], created_by: 'p-sara', created_at: at('2026-10-15'), expires_at: null, last_used_at: null, revoked_at: null },
  { id: 'tok-ci', profile_id: null, project_id: 'pr-web', name: 'GitHub Actions', prefix: 'elw_cccccccc', _token: `elw_${'c'.repeat(64)}`,
    scopes: ['tests:read', 'tests:write'], created_by: 'p-amna', created_at: at('2026-10-15'), expires_at: null, last_used_at: null, revoked_at: null },
]

/** Mirror of test_results_after_write's count of a run. */
function runCounts(runId: unknown) {
  const run = find('test_runs', runId)
  if (!run) return
  const rs = rowsIn('test_results').filter((r) => r.run_id === runId)
  Object.assign(run, { total: rs.length, passed: rs.filter((r) => r.status === 'pass').length, failed: rs.filter((r) => r.status === 'fail').length,
    blocked: rs.filter((r) => r.status === 'blocked').length, skipped: rs.filter((r) => r.status === 'skipped').length,
    flaky: rs.filter((r) => r.flaky).length })
}

/** Mirror of test_results_after_write: a case shows its latest result. */
function latestResult(caseId: unknown) {
  const c = find('test_cases', caseId)
  if (!c) return
  const r = rowsIn('test_results').filter((x) => x.case_id === caseId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  Object.assign(c, { last_status: r?.status ?? null, last_reason: r?.reason ?? null, last_environment: r?.environment ?? null,
    last_recorded_by: r?.recorded_by ?? null, last_recorded_at: r?.created_at ?? null })
}

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

// The service role (an Edge Function): nobody signed in, every row readable.
const me = () => (authState.service ? null : authState.bound)

/** Mirror of role_in_project, for the project visibility the mock applies on select. */
function roleIn(projectId: unknown, who: Profile | null = me()) {
  const p = find('projects', projectId)
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
      const c = find('comments', row.comment_id)
      return { ...row, issue: i ? { key: i.key, title: i.title } : null, comment: c ? { body: c.body } : null }
    }
    case 'saved_filter_pins': {
      // The pinned filter, if you can still read it (saved_filters_select).
      const f = rowsOf('saved_filters').find((x) => x.id === row.filter_id)
      return { ...row, filter: f ? structuredClone(f) : null }
    }
    case 'todos': {
      const i = find('issues', row.issue_id)
      // Only your own place (todo_places_select).
      const place = rowsIn('todo_places').filter((p) => p.todo_id === row.id && p.profile_id === me()?.id).map((p) => ({ list_id: p.list_id }))
      return { ...row, issue: i ? { key: i.key, title: i.title } : null, place }
    }
    default:
      return row
  }
}

function rowsOf(table: string): Row[] {
  if (authState.service) return rowsIn(table)
  if (table === 'projects') return rowsIn('projects').filter((p) => roleIn(p.id) !== null)
  // Mirror of todos_select: yours, and those you're on.
  if (table === 'todos') return rowsIn('todos').filter((t) => t.owner_id === me()?.id || (t.shared_with as string[]).includes(me()?.id ?? ''))
  // Your own lists and places only.
  if (table === 'todo_lists') return rowsIn(table).filter((l) => l.owner_id === me()?.id)
  if (table === 'todo_places') return rowsIn(table).filter((p) => p.profile_id === me()?.id)
  // Your filters and shared ones; your own pins.
  if (table === 'saved_filters') return rowsIn(table).filter((f) => f.owner_id === me()?.id || f.shared)
  if (table === 'saved_filter_pins') return rowsIn(table).filter((p) => p.profile_id === me()?.id)
  // api_tokens_select: yours; a project's CI tokens to its admins.
  if (table === 'api_tokens') {
    return rowsIn(table).filter((t) => t.profile_id === me()?.id || (!t.profile_id && roleIn(t.project_id) === 'admin'))
  }
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
        flag_reason: null, flagged_by: null, flagged_at: null,
        status_id: statusId, number, key: `${p.key}-${number}`, reporter_id: row.reporter_id ?? me()?.id, created_by: me()?.id,
        resolved_at: categoryOf(statusId) === 'done' ? now : null, created_at: now, updated_at: now,
        ...(level === 'subtask' && parent ? { sprint_id: parent.sprint_id } : {}),
      }
    }
    case 'comments':
      return { edited_at: null, ...row, author_id: me()?.id }
    // comment_reactions_guard: yours, on the comment's issue.
    case 'comment_reactions':
      return { ...row, profile_id: me()?.id, issue_id: find('comments', row.comment_id)?.issue_id, created_at: now }
    case 'todos':
      return { notes: '', due_on: null, done_at: null, issue_id: null, project_id: null, position: Date.now(), ...row, owner_id: me()?.id,
        shared_with: ((row.shared_with ?? []) as string[]).filter((id) => id !== me()?.id),
        // todos_guard: an issue's todo is in the issue's project.
        ...(row.issue_id ? { project_id: find('issues', row.issue_id)?.project_id ?? null } : {}) }
    case 'saved_filters':
      return { shared: false, created_at: now, ...row, owner_id: me()?.id }
    case 'saved_filter_pins':
      return { position: Date.now(), created_at: now, ...row, profile_id: me()?.id }
    case 'note_labels':
      return { ...row, owner_id: me()?.id }
    case 'todo_lists':
      return { color: '#5c6bc0', position: Date.now(), created_at: now, ...row, name: String(row.name).trim(), owner_id: me()?.id }
    case 'notes':
      return { title: '', body: '', color: 'yellow', label_ids: [], project_id: null, pinned: false, meeting_id: null, meeting_title: null,
        meeting_on: null, ...row, owner_id: me()?.id, updated_at: now, archived_at: null }
    case 'releases':
      return { description: '', notes: '', start_date: null, status: 'unreleased', released_at: null, ...row, created_by: me()?.id }
    case 'release_approvers':
      return { ...row, decision: null, comment: '', decided_at: null, added_by: me()?.id, created_at: now }
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
    case 'test_cases': {
      const p = find('projects', row.project_id)!
      const number = Number(p.test_counter) + 1
      p.test_counter = number
      const maxRank = Math.max(0, ...rowsIn('test_cases').filter((c) => c.project_id === row.project_id).map((c) => Number(c.rank)))
      return { issue_id: null, description: '', expected: '', type: null, level: null, areas: [], rank: maxRank + 1024, ...row,
        number, key: `${p.key}-T${number}`, last_status: null, last_reason: null, last_environment: null, last_recorded_by: null,
        last_recorded_at: null, updated_by: null, script_repo: null, script_path: null, script_title: null, automated_at: null,
        created_by: me()?.id ?? row.created_by ?? null, created_at: now, updated_at: now }
    }
    case 'test_results': {
      const run = find('test_runs', row.run_id)
      return { reason: '', environment: null, run_id: null, duration_ms: null, error: null, artifact_url: null, attempts: 1, flaky: false,
        source: 'manual', ...row, project_id: find('test_cases', row.case_id)?.project_id, recorded_by: me()?.id ?? row.recorded_by ?? null,
        created_at: now, ...(run ? { environment: run.environment } : {}) }
    }
    case 'test_runs': {
      const p = find('projects', row.project_id)!
      const number = Number(p.test_run_counter ?? 0) + 1
      p.test_run_counter = number
      const env = (p.test_environments as string[]).find((e) => e.toLowerCase() === String(row.environment).toLowerCase()) ?? row.environment
      return { repo: null, branch: null, commit_sha: null, ci_url: null, finished_at: null, ...row, number, key: `${p.key}-R${number}`,
        environment: env, run_by: me()?.id ?? row.run_by ?? null, started_at: now, total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, flaky: 0 }
    }
    default:
      return row
  }
}

// release_approvals_reset: an unreleased release's decisions go back to pending.
function resetApprovals(releaseId: unknown) {
  if (!releaseId || find('releases', releaseId)?.status !== 'unreleased') return
  for (const a of rowsIn('release_approvers')) {
    if (a.release_id === releaseId) Object.assign(a, { decision: null, comment: '', decided_at: null })
  }
}

// What the database's triggers change on update.
function updateEffects(table: string, row: Row, values: Row) {
  if (table === 'issues') {
    if ('status_id' in values) row.resolved_at = categoryOf(values.status_id) === 'done' ? row.resolved_at ?? new Date().toISOString() : null
    row.updated_at = new Date().toISOString()
    // issues_guard: a flag stamps who and when; a new reason keeps them; removing it clears them.
    if ('flag_reason' in values) {
      if (!values.flag_reason) Object.assign(row, { flag_reason: null, flagged_by: null, flagged_at: null })
      else if (!row.flagged_at) Object.assign(row, { flagged_by: me()?.id, flagged_at: new Date().toISOString() })
    }
  }
  if (table === 'comments') row.edited_at = new Date().toISOString()
  if (table === 'notes' && ('title' in values || 'body' in values)) row.updated_at = new Date().toISOString()
  if (table === 'notes' && 'meeting_id' in values && !values.meeting_id) Object.assign(row, { meeting_title: null, meeting_on: null })
  // notes_guard: an archived note is never pinned.
  if (table === 'notes' && row.archived_at) row.pinned = false
  if (table === 'todos' && values.issue_id) row.project_id = find('issues', values.issue_id)?.project_id ?? null
  // releases_guard: stamped on going out, cleared on coming back; archiving keeps it.
  if (table === 'releases' && values.status === 'released') row.released_at = new Date().toISOString()
  if (table === 'releases' && values.status === 'unreleased') row.released_at = null
}

// ---------------------------------------------------------------------------
// Recording and failure injection
// ---------------------------------------------------------------------------

type Op = 'select' | 'insert' | 'update' | 'delete'
type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'is' | 'in' | 'not' | 'ov' | 'fts' | 'or' | 'and'
export type Filter = [col: string, op: FilterOp, value: unknown]

/** Realtime listeners the app registered, so a test can deliver a change. */
export const realtime: { channel: string; handler: () => void }[] = []
export function emitRealtime(channel: string) {
  for (const r of realtime.filter((x) => x.channel === channel)) r.handler()
}

/** How long writes take, for tests that look at a save in flight; reset() sets it back to 0. */
export const latency = { writeMs: 0 }

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
  // Calls made as the service role (an Edge Function's), as asService sets.
  service: false,
}

/** Act as an Edge Function (the service role): nobody signed in, no RLS. */
export function asService(on = true) {
  authState.service = on
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
  latency.writeMs = 0
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
    release_approvers: [],
    issues: copy(ISSUES),
    issue_events: [],
    sprint_issues: [],
    issue_links: [],
    issue_dev_links: [],
    issue_watchers: [{ issue_id: 'i-web-2', profile_id: 'p-sara' }],
    comments: copy(COMMENTS),
    comment_reactions: copy(COMMENT_REACTIONS),
    attachments: [],
    documents: [],
    saved_filters: [],
    saved_filter_pins: [],
    todos: copy(TODOS),
    todo_lists: copy(TODO_LISTS),
    todo_places: copy(TODO_PLACES),
    note_labels: copy(NOTE_LABELS),
    notes: copy(NOTES),
    notifications: copy(NOTIFICATIONS),
    test_cases: copy(TEST_CASES),
    test_results: copy(TEST_RESULTS),
    test_runs: copy(TEST_RUNS),
    test_case_events: copy(TEST_CASE_EVENTS),
    api_tokens: copy(API_TOKENS),
  }
  for (const c of db.test_cases) latestResult(c.id)
  for (const list of Object.values(captured)) list.length = 0
  realtime.length = 0
  failures.clear()
  Object.assign(googleCalendar, { connected: false, lapsed: false, events: [] })
  authState.session = null
  authState.bound = null
  authState.service = false
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
        if (this.name === 'test_results') for (const r of rows) {
          latestResult(r.case_id)
          runCounts(r.run_id)
        }
        rows = rows.map((r) => withEmbeds(this.name, structuredClone(r)))
        break
      case 'update':
        rows = rowsIn(this.name).filter(this.matches)
        for (const r of rows) {
          // issues_release_changed: moving an issue in or out of a release asks its approvers again.
          if (this.name === 'issues' && 'release_id' in input[0] && input[0].release_id !== r.release_id) {
            resetApprovals(r.release_id)
            resetApprovals(input[0].release_id)
          }
          // issues_after_write: a flag's change is posted as a comment, as whoever made it.
          if (this.name === 'issues' && 'flag_reason' in input[0] && (input[0].flag_reason || null) !== (r.flag_reason || null)) {
            const to = input[0].flag_reason as string | null
            const title = !to ? 'Flag removed' : r.flag_reason ? 'Flag reason changed' : 'Flag added'
            rowsIn('comments').push({ id: `new-${nextId++}`, issue_id: r.id, author_id: me()?.id ?? null, edited_at: null,
              body: `<p>🚩 <strong>${title}</strong></p>${to ? `<p>${to.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : ''}`,
              created_at: new Date().toISOString() })
          }
          Object.assign(r, input[0])
          updateEffects(this.name, r, input[0])
        }
        rows = rows.map((r) => withEmbeds(this.name, structuredClone(r)))
        break
      case 'delete':
        rows = rowsIn(this.name).filter(this.matches)
        db[this.name] = rowsIn(this.name).filter((r) => !this.matches(r))
        // A list's places cascade: its todos are back in the Inbox.
        if (this.name === 'comments') db.comment_reactions = rowsIn('comment_reactions').filter((r) => !rows.some((c) => c.id === r.comment_id))
        if (this.name === 'todo_lists') db.todo_places = rowsIn('todo_places').filter((p) => !rows.some((l) => l.id === p.list_id))
        // A case's results go with it; the case shows its latest result.
        if (this.name === 'test_results') for (const r of rows) {
          latestResult(r.case_id)
          runCounts(r.run_id)
        }
        // A run's results go with it.
        if (this.name === 'test_runs') {
          const gone = rowsIn('test_results').filter((r) => rows.some((x) => x.id === r.run_id))
          db.test_results = rowsIn('test_results').filter((r) => !gone.includes(r))
          for (const r of gone) latestResult(r.case_id)
        }
        if (this.name === 'test_cases') db.test_results = rowsIn('test_results').filter((r) => !rows.some((c) => c.id === r.case_id))
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
    // A write can be held back (latency.writeMs) to see what a page shows while it saves.
    const wait = this.op !== 'select' && latency.writeMs ? new Promise((r) => setTimeout(r, latency.writeMs)) : Promise.resolve()
    return wait.then(() => this.execute()).then(onfulfilled, onrejected)
  }
}

// ---------------------------------------------------------------------------
// Database functions
// ---------------------------------------------------------------------------

// Simplified stand-ins for the SQL functions: enough for the pages to show
// the result. The rules they enforce are tested in test/sql/.
const RPCS: Record<string, (args: Row) => unknown> = {
  // release_decide: your own pending decision only.
  release_decide: ({ p_release, p_decision, p_comment }) => {
    const a = rowsIn('release_approvers').find((r) => r.release_id === p_release && r.profile_id === me()?.id && !r.decision)
    if (a) Object.assign(a, { decision: p_decision, comment: String(p_comment ?? '').trim(), decided_at: new Date().toISOString() })
    return null
  },
  release_request_approval: ({ p_release }) => {
    resetApprovals(p_release)
    return null
  },
  // The stored row, as the database would (what you changed on it sticks).
  bind_profile: () => (authState.bound && (rowsIn('profiles').find((p) => p.id === authState.bound!.id) as Profile | undefined)) ?? authState.bound,
  current_profile_id: () => authState.bound?.id ?? null,
  project_create: ({ p_key, p_name, p_kind, p_visibility, p_description }) => {
    const id = `new-${nextId++}`
    const p = { id, key: p_key, name: p_name, kind: p_kind, visibility: p_visibility, description: p_description ?? '',
      lead_id: me()?.id, color: '#3f51b5', issue_counter: 0, drive_folder_id: null, archived_at: null, created_at: new Date().toISOString(),
      disabled_features: [], summary_widgets: null, test_counter: 0, test_run_counter: 0, ...structuredClone(TEST_LISTS) }
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
  api_token_create: ({ p_name, p_project, p_ci, p_scopes, p_days }) => {
    const token = `elw_${String(nextId++).padStart(64, '0')}`
    const row = { id: `new-${nextId++}`, profile_id: p_ci ? null : me()?.id, project_id: p_project ?? null, name: p_name, prefix: token.slice(0, 12),
      _token: token, scopes: p_scopes, created_by: me()?.id, created_at: new Date().toISOString(),
      expires_at: p_days ? new Date(Date.now() + Number(p_days) * 86_400_000).toISOString() : null, last_used_at: null, revoked_at: null }
    rowsIn('api_tokens').push(row)
    return { id: row.id, token, prefix: row.prefix }
  },
  api_token_revoke: ({ p_id }) => {
    Object.assign(find('api_tokens', p_id) ?? {}, { revoked_at: new Date().toISOString() })
    return null
  },
  // As qa_token_use: the token's row while it may be used.
  qa_token_use: ({ p_token }) => rowsIn('api_tokens')
    .filter((t) => t._token === p_token && !t.revoked_at && (!t.expires_at || String(t.expires_at) > new Date().toISOString()))
    .map((t) => ({ id: t.id, profile_id: t.profile_id, project_id: t.project_id, scopes: t.scopes })),
  // As qa_role: a person's own role; a CI token a member of its project only.
  qa_role: ({ p_token, p_project }) => {
    const t = find('api_tokens', p_token)
    if (!t || (t.project_id && t.project_id !== p_project)) return null
    if (!t.profile_id) return find('projects', p_project)?.archived_at ? 'viewer' : 'member'
    return roleIn(p_project, (find('profiles', t.profile_id) as unknown as Profile) ?? null)
  },
  test_cases_rerank: ({ p_project }) => {
    rowsIn('test_cases').filter((c) => c.project_id === p_project).sort((a, b) => Number(a.rank) - Number(b.rank))
      .forEach((c, n) => (c.rank = (n + 1) * 1024))
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
  // As in the push_notifications migration: turning on makes the device the
  // caller's; a check only confirms (and keeps) a registration still theirs,
  // and ends somebody else's.
  save_push_subscription: ({ p_endpoint, p_device, p_refresh_only }) => {
    const rows = rowsIn('push_subscriptions')
    const row = rows.find((r) => r.endpoint === p_endpoint)
    if (p_refresh_only) {
      if (!row) return false
      if (row.profile_id !== me()?.id) {
        db.push_subscriptions = rows.filter((r) => r !== row)
        return false
      }
      return true
    }
    const now = new Date().toISOString()
    if (row) Object.assign(row, { profile_id: me()?.id, device: p_device, created_at: now, last_used_at: null })
    else rows.push({ id: `new-${nextId++}`, profile_id: me()?.id, endpoint: p_endpoint, device: p_device, created_at: now, last_used_at: null })
    return true
  },
  send_test_notification: () => {
    rowsIn('notifications').push({ id: `new-${nextId++}`, recipient_id: me()?.id, actor_id: null, kind: 'test', issue_id: null,
      comment_id: null, detail: null, read_at: null, created_at: new Date().toISOString() })
    return null
  },
  // Mirror of todo_move: file a todo you're on in one of your lists, or (null) the Inbox.
  todo_move: ({ p_todo, p_list }) => {
    const places = rowsIn('todo_places')
    const at = places.findIndex((p) => p.todo_id === p_todo && p.profile_id === me()?.id)
    if (at >= 0) places.splice(at, 1)
    if (p_list) places.push({ todo_id: p_todo, profile_id: me()?.id, list_id: p_list })
    return null
  },
  // Mirror of watched_activity: per issue you watch (and can see), its latest change or comment.
  watched_activity: ({ p_limit }) => {
    const mine = rowsIn('issue_watchers').filter((w) => w.profile_id === me()?.id).map((w) => w.issue_id)
      .filter((id) => roleIn(find('issues', id)?.project_id) !== null)
    const activity = [
      ...rowsIn('issue_events').map((e) => ({ issue_id: e.issue_id, at: e.created_at, actor_id: e.actor_id, kind: 'change', field: e.field, to_value: e.to_value })),
      ...rowsIn('comments').map((c) => ({ issue_id: c.issue_id, at: c.created_at, actor_id: c.author_id, kind: 'comment', field: null, to_value: null })),
    ].filter((a) => mine.includes(a.issue_id))
    const latest = new Map<unknown, Row>()
    for (const a of activity) if (!latest.has(a.issue_id) || String(a.at) > String(latest.get(a.issue_id)!.at)) latest.set(a.issue_id, a)
    return [...latest.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, Number(p_limit ?? 50))
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
    const ch: Channel = {
      on: (...args: unknown[]) => {
        const handler = args.at(-1)
        if (typeof handler === 'function') realtime.push({ channel: name, handler: handler as () => void })
        return ch
      },
      subscribe: () => ch,
    }
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
