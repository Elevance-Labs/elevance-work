// The classic agile charts the Summary's widgets draw (burndown, velocity,
// sprint report, created vs resolved, cumulative flow). Pure functions over
// rows already loaded: issues, their history (issue_events) and the sprint
// snapshots (sprint_issues).
import { addDays, daysBetween, isoDate } from './constants'
import type { Issue, IssueEvent, Sprint, SprintIssue, StatusCategory, ProjectStatus } from './types'

export type Unit = 'points' | 'issues'

const endOfDay = (iso: string) => new Date(`${iso}T23:59:59.999`).getTime()
const dayOf = (timestamp: string) => isoDate(new Date(timestamp))

/** Every day from `from` to `to`, inclusive. */
export function daysFrom(from: string, to: string) {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

interface IssueState {
  sprint_id: string | null
  story_points: number | null
  status_id: string
  exists: boolean
}

/**
 * An issue as it was at instant `t`, rebuilt from its current row by undoing
 * every recorded change made after `t`, newest first.
 */
export function stateAt(issue: Issue, events: IssueEvent[], t: number): IssueState {
  const state: IssueState = {
    sprint_id: issue.sprint_id,
    story_points: issue.story_points,
    status_id: issue.status_id,
    exists: new Date(issue.created_at).getTime() <= t,
  }
  const later = events
    .filter((e) => e.issue_id === issue.id && new Date(e.created_at).getTime() > t)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  for (const e of later) {
    if (e.field === 'sprint') state.sprint_id = e.from_id
    else if (e.field === 'status' && e.from_id) state.status_id = e.from_id
    else if (e.field === 'story_points') state.story_points = e.from_value === null ? null : Number(e.from_value)
  }
  return state
}

const weight = (points: number | null, unit: Unit) => (unit === 'points' ? points ?? 0 : 1)

/** Whether anything in this sprint carries points; if not, burn down by issue count. */
export function unitFor(issues: Issue[], sprintIssues: SprintIssue[]): Unit {
  return issues.some((i) => (i.story_points ?? 0) > 0) || sprintIssues.some((s) => (s.points_at_start ?? 0) > 0)
    ? 'points'
    : 'issues'
}

export interface BurndownPoint {
  day: string
  ideal: number
  remaining: number | null
}

/**
 * Remaining work at the end of each day of a sprint: issues in the sprint at
 * that moment and not yet in a done status. Days still to come have no
 * remaining value; the ideal line runs from the starting scope to zero.
 */
export function burndown(
  sprint: Sprint,
  issues: Issue[],
  events: IssueEvent[],
  statuses: ProjectStatus[],
  today: string,
  unit: Unit,
): BurndownPoint[] {
  if (!sprint.start_date || !sprint.end_date || !sprint.started_at) return []
  const category = new Map(statuses.map((s) => [s.id, s.category]))
  const stop = sprint.completed_at ? new Date(sprint.completed_at).getTime() : Infinity
  const remainingAt = (t: number) =>
    issues.reduce((sum, issue) => {
      const s = stateAt(issue, events, Math.min(t, stop))
      return s.exists && s.sprint_id === sprint.id && category.get(s.status_id) !== 'done'
        ? sum + weight(s.story_points, unit)
        : sum
    }, 0)

  const start = remainingAt(new Date(sprint.started_at).getTime())
  const days = daysFrom(sprint.start_date, sprint.end_date)
  const span = Math.max(1, days.length - 1)
  const lastDay = sprint.completed_at ? dayOf(sprint.completed_at) : today
  return days.map((day, i) => ({
    day,
    ideal: Math.round((start - (start * i) / span) * 10) / 10,
    remaining: day <= lastDay ? remainingAt(endOfDay(day)) : null,
  }))
}

export interface VelocityRow {
  sprint: Sprint
  committed: number
  completed: number
}

/** Committed (at start) against completed (at completion), per completed sprint, oldest first. */
export function velocity(sprints: Sprint[], rows: SprintIssue[], unit: Unit = 'points'): VelocityRow[] {
  return sprints
    .filter((s) => s.state === 'closed')
    .sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? ''))
    .map((sprint) => {
      const mine = rows.filter((r) => r.sprint_id === sprint.id)
      return {
        sprint,
        committed: mine.filter((r) => r.committed).reduce((s, r) => s + weight(r.points_at_start, unit), 0),
        completed: mine.filter((r) => r.completed).reduce((s, r) => s + weight(r.points_at_end, unit), 0),
      }
    })
}

export const average = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0)

export interface SprintReport {
  completed: string[]
  notCompleted: string[]
  // In the sprint when it ended, but not when it started.
  added: string[]
  // In it at the start, gone before the end.
  removed: string[]
}

export function sprintReport(sprintId: string, rows: SprintIssue[]): SprintReport {
  const mine = rows.filter((r) => r.sprint_id === sprintId)
  const atEnd = mine.filter((r) => r.completed !== null)
  return {
    completed: atEnd.filter((r) => r.completed).map((r) => r.issue_id),
    notCompleted: atEnd.filter((r) => !r.completed).map((r) => r.issue_id),
    added: atEnd.filter((r) => !r.committed).map((r) => r.issue_id),
    removed: mine.filter((r) => r.committed && r.completed === null).map((r) => r.issue_id),
  }
}

export interface CreatedResolvedPoint {
  day: string
  created: number
  resolved: number
}

/** Cumulative issues created and resolved over the last `days` days. */
export function createdVsResolved(issues: Issue[], days: number, today: string): CreatedResolvedPoint[] {
  const from = addDays(today, -(days - 1))
  let created = 0
  let resolved = 0
  const createdOn = new Map<string, number>()
  const resolvedOn = new Map<string, number>()
  for (const i of issues) {
    const c = dayOf(i.created_at)
    if (c >= from) createdOn.set(c, (createdOn.get(c) ?? 0) + 1)
    if (i.resolved_at) {
      const r = dayOf(i.resolved_at)
      if (r >= from) resolvedOn.set(r, (resolvedOn.get(r) ?? 0) + 1)
    }
  }
  return daysFrom(from, today).map((day) => {
    created += createdOn.get(day) ?? 0
    resolved += resolvedOn.get(day) ?? 0
    return { day, created, resolved }
  })
}

export type FlowPoint = { day: string } & Record<StatusCategory, number>

/** How many issues sat in each status category at the end of each day. */
export function cumulativeFlow(issues: Issue[], events: IssueEvent[], statuses: ProjectStatus[], days: number, today: string) {
  const category = new Map(statuses.map((s) => [s.id, s.category]))
  return daysFrom(addDays(today, -(days - 1)), today).map((day): FlowPoint => {
    const point: FlowPoint = { day, todo: 0, in_progress: 0, done: 0 }
    for (const issue of issues) {
      const s = stateAt(issue, events, endOfDay(day))
      if (s.exists) point[category.get(s.status_id) ?? 'todo']++
    }
    return point
  })
}

/** How far through its dates a sprint or release is, 0–1. */
export function timeProgress(start: string | null, end: string | null, today: string) {
  if (!start || !end) return null
  const total = daysBetween(start, end)
  if (total <= 0) return today >= end ? 1 : 0
  return Math.min(1, Math.max(0, daysBetween(start, today) / total))
}
