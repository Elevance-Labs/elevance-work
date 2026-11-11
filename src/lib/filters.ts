// The issue filter: what the Issues page's filter bar holds, how it travels
// in the URL and in a saved filter, and how it becomes a query (server side)
// or a predicate (boards, which filter what they already loaded).
import { parseIssueKey } from './issues'
import { addDays, todayIso } from './constants'
import type { Issue, IssuePriority, ProjectStatus, StatusCategory } from './types'

export type SortKey = 'updated' | 'created' | 'priority' | 'key' | 'due' | 'rank'

export interface IssueFilter {
  projects: string[]
  types: string[]
  statuses: string[]
  categories: StatusCategory[]
  // Profile ids, plus 'me' and 'none' (unassigned).
  assignees: string[]
  reporters: string[]
  priorities: IssuePriority[]
  // Sprint ids, plus 'open' (any active sprint) and 'backlog' (no sprint).
  sprints: string[]
  // Release ids, plus 'none'.
  releases: string[]
  labels: string[]
  text: string
  resolution: 'any' | 'unresolved' | 'resolved'
  created: '' | '7d' | '30d' | '90d'
  updated: '' | '7d' | '30d'
  due: '' | 'overdue' | 'week'
  sort: SortKey
}

export const EMPTY_FILTER: IssueFilter = {
  projects: [],
  types: [],
  statuses: [],
  categories: [],
  assignees: [],
  reporters: [],
  priorities: [],
  sprints: [],
  releases: [],
  labels: [],
  text: '',
  resolution: 'any',
  created: '',
  updated: '',
  due: '',
  sort: 'updated',
}

const LIST_KEYS = [
  'projects', 'types', 'statuses', 'categories', 'assignees', 'reporters', 'priorities', 'sprints', 'releases', 'labels',
] as const
const TEXT_KEYS = ['text', 'resolution', 'created', 'updated', 'due', 'sort'] as const

export const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Recently updated',
  created: 'Newest',
  priority: 'Priority',
  key: 'Key',
  due: 'Due date',
  rank: 'Rank',
}

/** Only what differs from the empty filter, so URLs and saved filters stay short. */
export function filterToQuery(filter: IssueFilter): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const k of LIST_KEYS) if (filter[k].length) out[k] = [...filter[k]]
  for (const k of TEXT_KEYS) if (filter[k] !== EMPTY_FILTER[k]) out[k] = filter[k]
  return out
}

/** Read a saved filter's query (or anything shaped like one) back, ignoring what doesn't fit. */
export function filterFromQuery(query: Record<string, unknown> | null | undefined): IssueFilter {
  const f: IssueFilter = { ...EMPTY_FILTER }
  if (!query) return f
  for (const k of LIST_KEYS) {
    const v = query[k]
    if (Array.isArray(v)) (f[k] as string[]) = v.filter((x): x is string => typeof x === 'string')
  }
  for (const k of TEXT_KEYS) {
    const v = query[k]
    if (typeof v === 'string') (f[k] as string) = v
  }
  return f
}

export function filterToSearch(filter: IssueFilter, base = new URLSearchParams()) {
  const params = new URLSearchParams(base)
  for (const k of [...LIST_KEYS, ...TEXT_KEYS]) params.delete(k)
  for (const [k, v] of Object.entries(filterToQuery(filter))) params.set(k, Array.isArray(v) ? v.join(',') : v)
  return params
}

export function filterFromSearch(params: URLSearchParams): IssueFilter {
  const query: Record<string, unknown> = {}
  for (const k of LIST_KEYS) {
    const v = params.get(k)
    if (v) query[k] = v.split(',').filter(Boolean)
  }
  for (const k of TEXT_KEYS) {
    const v = params.get(k)
    if (v) query[k] = v
  }
  return filterFromQuery(query)
}

export function isEmptyFilter(filter: IssueFilter, ignore: (keyof IssueFilter)[] = ['sort']) {
  return Object.keys(filterToQuery(filter)).every((k) => ignore.includes(k as keyof IssueFilter))
}

export interface FilterContext {
  me: string
  statuses: ProjectStatus[]
  activeSprintIds: string[]
  today?: string
}

/** The status ids a filter allows, from its statuses and categories (null: any). */
function allowedStatuses(filter: IssueFilter, ctx: FilterContext) {
  if (!filter.statuses.length && !filter.categories.length) return null
  return ctx.statuses
    .filter((s) => (!filter.statuses.length || filter.statuses.includes(s.id)) &&
      (!filter.categories.length || filter.categories.includes(s.category)))
    .map((s) => s.id)
}

function people(ids: string[], me: string) {
  return { ids: [...new Set(ids.filter((x) => x !== 'none').map((x) => (x === 'me' ? me : x)))], none: ids.includes('none') }
}

function sinceIso(span: string, today: string) {
  const days = { '7d': 7, '30d': 30, '90d': 90 }[span]
  return days ? `${addDays(today, -days)}T00:00:00` : null
}

// The part of a PostgREST query builder this uses (and the test mock provides).
export interface FilterableQuery<Q> {
  in(column: string, values: readonly unknown[]): Q
  eq(column: string, value: unknown): Q
  is(column: string, value: null): Q
  not(column: string, operator: string, value: unknown): Q
  gte(column: string, value: unknown): Q
  lte(column: string, value: unknown): Q
  lt(column: string, value: unknown): Q
  or(filters: string): Q
  overlaps(column: string, value: readonly unknown[]): Q
  textSearch(column: string, query: string, options?: { type?: 'websearch'; config?: string }): Q
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): Q
}

/** An issues query as the filter and the list page use it (PostgREST's own types are too deep to check against). */
export type IssueQuery = FilterableQuery<IssueQuery> & {
  limit(n: number): IssueQuery
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null; count: number | null }>
}

/** Narrow a PostgREST issues query by the filter, and sort it. */
export function applyFilter<Q extends FilterableQuery<Q>>(query: Q, filter: IssueFilter, ctx: FilterContext): Q {
  const today = ctx.today ?? todayIso()
  let q = query
  if (filter.projects.length) q = q.in('project_id', filter.projects)
  if (filter.types.length) q = q.in('type_id', filter.types)
  const statuses = allowedStatuses(filter, ctx)
  if (statuses) q = q.in('status_id', statuses)
  if (filter.priorities.length) q = q.in('priority', filter.priorities)

  const assignees = people(filter.assignees, ctx.me)
  if (assignees.none && assignees.ids.length) q = q.or(`assignee_id.is.null,assignee_id.in.(${assignees.ids.join(',')})`)
  else if (assignees.none) q = q.is('assignee_id', null)
  else if (assignees.ids.length) q = q.in('assignee_id', assignees.ids)

  const reporters = people(filter.reporters, ctx.me)
  if (reporters.ids.length) q = q.in('reporter_id', reporters.ids)

  const sprintIds = [...new Set(filter.sprints.flatMap((s) => (s === 'open' ? ctx.activeSprintIds : s === 'backlog' ? [] : [s])))]
  const backlog = filter.sprints.includes('backlog')
  if (backlog && sprintIds.length) q = q.or(`sprint_id.is.null,sprint_id.in.(${sprintIds.join(',')})`)
  else if (backlog) q = q.is('sprint_id', null)
  else if (filter.sprints.length) q = q.in('sprint_id', sprintIds)

  const releaseIds = filter.releases.filter((r) => r !== 'none')
  if (filter.releases.includes('none') && releaseIds.length) q = q.or(`release_id.is.null,release_id.in.(${releaseIds.join(',')})`)
  else if (filter.releases.includes('none')) q = q.is('release_id', null)
  else if (releaseIds.length) q = q.in('release_id', releaseIds)

  if (filter.labels.length) q = q.overlaps('labels', filter.labels)

  const text = filter.text.trim()
  const key = parseIssueKey(text)
  if (key) q = q.eq('key', `${key.projectKey}-${key.number}`)
  else if (text) q = q.textSearch('search', text, { type: 'websearch', config: 'simple' })

  if (filter.resolution === 'unresolved') q = q.is('resolved_at', null)
  if (filter.resolution === 'resolved') q = q.not('resolved_at', 'is', null)
  const created = sinceIso(filter.created, today)
  if (created) q = q.gte('created_at', created)
  const updated = sinceIso(filter.updated, today)
  if (updated) q = q.gte('updated_at', updated)
  if (filter.due === 'overdue') q = q.lt('due_date', today).is('resolved_at', null)
  if (filter.due === 'week') q = q.gte('due_date', today).lte('due_date', addDays(today, 7))

  switch (filter.sort) {
    case 'created':
      return q.order('created_at', { ascending: false })
    case 'priority':
      return q.order('priority').order('updated_at', { ascending: false })
    case 'key':
      return q.order('project_id').order('number', { ascending: false })
    case 'due':
      return q.order('due_date', { nullsFirst: false }).order('priority')
    case 'rank':
      return q.order('rank')
    default:
      return q.order('updated_at', { ascending: false })
  }
}

/** The same filter, for issues already loaded (board quick filters). Text matches key or title. */
export function matchesFilter(issue: Issue, filter: IssueFilter, ctx: FilterContext) {
  const today = ctx.today ?? todayIso()
  if (filter.projects.length && !filter.projects.includes(issue.project_id)) return false
  if (filter.types.length && !filter.types.includes(issue.type_id)) return false
  const statuses = allowedStatuses(filter, ctx)
  if (statuses && !statuses.includes(issue.status_id)) return false
  if (filter.priorities.length && !filter.priorities.includes(issue.priority)) return false
  const a = people(filter.assignees, ctx.me)
  if (filter.assignees.length && !(issue.assignee_id ? a.ids.includes(issue.assignee_id) : a.none)) return false
  const r = people(filter.reporters, ctx.me)
  if (r.ids.length && !(issue.reporter_id && r.ids.includes(issue.reporter_id))) return false
  if (filter.labels.length && !issue.labels.some((l) => filter.labels.includes(l))) return false
  const text = filter.text.trim().toLowerCase()
  if (text && !issue.key.toLowerCase().includes(text) && !issue.title.toLowerCase().includes(text)) return false
  if (filter.resolution === 'unresolved' && issue.resolved_at) return false
  if (filter.resolution === 'resolved' && !issue.resolved_at) return false
  if (filter.due === 'overdue' && !(issue.due_date && issue.due_date < today && !issue.resolved_at)) return false
  if (filter.due === 'week' && !(issue.due_date && issue.due_date >= today && issue.due_date <= addDays(today, 7))) return false
  return true
}

/** Issues as CSV, for a spreadsheet. Values are quoted; formulas are defused. */
export function issuesToCsv(rows: Record<string, string | number | null>[]) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cell = (v: string | number | null) => {
    let s = v === null ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return `"${s.replace(/"/g, '""')}"`
  }
  return [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n')
}
