import type { Issue, IssueLevel, IssueType, ProjectStatus, StatusCategory } from './types'

// What lists, boards and the backlog select. The description is only read by
// the issue view (ISSUE_DETAIL_COLUMNS), since it can be large.
export const ISSUE_COLUMNS =
  'id, project_id, number, key, type_id, status_id, title, priority, assignee_id, reporter_id, parent_id, ' +
  'sprint_id, release_id, story_points, start_date, due_date, labels, rank, custom, resolved_at, created_at, updated_at'
export const ISSUE_DETAIL_COLUMNS = `${ISSUE_COLUMNS}, description, created_by`

// The columns a client may write (the grant lists in the schema).
export type IssueWrite = Partial<
  Pick<
    Issue,
    | 'type_id'
    | 'status_id'
    | 'title'
    | 'priority'
    | 'assignee_id'
    | 'reporter_id'
    | 'parent_id'
    | 'sprint_id'
    | 'release_id'
    | 'story_points'
    | 'start_date'
    | 'due_date'
    | 'labels'
    | 'rank'
    | 'custom'
  > & { description: string }
>

export const ISSUE_KEY = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/

export function parseIssueKey(text: string) {
  const m = ISSUE_KEY.exec(text.trim().toUpperCase())
  return m ? { projectKey: m[1], number: Number(m[2]) } : null
}

export const byRank = (a: Issue, b: Issue) => a.rank - b.rank || a.number - b.number

/**
 * A rank between two neighbours (either may be missing: the top or the end of
 * a list). Null when they are too close to split, so the caller reranks the
 * project first (`project_rerank`).
 */
export function rankBetween(before: number | null | undefined, after: number | null | undefined) {
  if (before == null && after == null) return 1024
  if (before == null) return after! - 1024
  if (after == null) return before + 1024
  const mid = (before + after) / 2
  return mid > before && mid < after && after - before > 1e-6 ? mid : null
}

/**
 * The rank for moving `moving` into `list` (sorted by rank) at `index`,
 * ignoring where it is now. Null: rerank first.
 */
export function rankForIndex(list: Issue[], index: number, movingId: string) {
  const others = list.filter((i) => i.id !== movingId)
  return rankBetween(others[index - 1]?.rank, others[index]?.rank)
}

export function levelOf(issue: Pick<Issue, 'type_id'>, types: IssueType[]): IssueLevel {
  return types.find((t) => t.id === issue.type_id)?.level ?? 'standard'
}

export function categoryOf(issue: Pick<Issue, 'status_id'>, statuses: ProjectStatus[]): StatusCategory {
  return statuses.find((s) => s.id === issue.status_id)?.category ?? 'todo'
}

export const isDone = (issue: Pick<Issue, 'status_id'>, statuses: ProjectStatus[]) => categoryOf(issue, statuses) === 'done'

/** Which issues may be the parent of an issue of this level (mirror of issues_guard). */
export function parentLevelFor(level: IssueLevel): IssueLevel | null {
  return level === 'standard' ? 'epic' : level === 'subtask' ? 'standard' : null
}

export function statusesOf(projectId: string, statuses: ProjectStatus[]) {
  return statuses.filter((s) => s.project_id === projectId).sort((a, b) => a.position - b.position)
}

export function firstStatus(projectId: string, statuses: ProjectStatus[], category: StatusCategory = 'todo') {
  return statusesOf(projectId, statuses).find((s) => s.category === category) ?? null
}

/** Labels the way issues_guard stores them: lower-case, hyphenated, unique. */
export function normaliseLabels(labels: string[]) {
  return [...new Set(labels.map((l) => l.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 50)).filter(Boolean))]
}

export const sumPoints = (issues: Pick<Issue, 'story_points'>[]) =>
  issues.reduce((sum, i) => sum + (i.story_points ?? 0), 0)

/** "/browse/KEY" — the issue's own page; `?issue=KEY` opens it over the current one. */
export const issuePath = (key: string) => `/browse/${key}`
