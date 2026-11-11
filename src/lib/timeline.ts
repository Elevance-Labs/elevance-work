// The epic timeline's arithmetic: which stretch of days to draw, where a bar
// sits in it, and what dragging one does to its dates. Days are plain
// `YYYY-MM-DD` strings throughout, as the issues store them.
import { addDays, daysBetween } from './constants'
import type { Issue, IssueType, ProjectStatus } from './types'
import { byRank, isDone } from './issues'

export interface TimelineRow {
  epic: Issue
  // The epic's issues, in rank order.
  children: Issue[]
  done: number
  // The days the bar covers, or null when nothing dates the epic.
  start: string | null
  end: string | null
  // The dates are the epic's own. Otherwise they are borrowed from its
  // issues, and dragging the bar gives the epic dates of its own.
  own: boolean
}

/** One end of a span may be missing: a start with no due date is one day long, and the other way round. */
export function spanOf(issue: Pick<Issue, 'start_date' | 'due_date'>): { start: string; end: string } | null {
  const start = issue.start_date ?? issue.due_date
  const end = issue.due_date ?? issue.start_date
  if (!start || !end) return null
  return start <= end ? { start, end } : { start: end, end: start }
}

/** The project's epics, each with its issues and the days it covers. Open epics first, then by rank. */
export function timelineRows(issues: Issue[], types: IssueType[], statuses: ProjectStatus[]): TimelineRow[] {
  const epicTypes = new Set(types.filter((t) => t.level === 'epic').map((t) => t.id))
  const byParent = new Map<string, Issue[]>()
  for (const i of issues) {
    if (!i.parent_id) continue
    byParent.set(i.parent_id, [...(byParent.get(i.parent_id) ?? []), i])
  }
  return issues
    .filter((i) => epicTypes.has(i.type_id))
    .sort((a, b) => Number(!!a.resolved_at) - Number(!!b.resolved_at) || byRank(a, b))
    .map((epic) => {
      const children = (byParent.get(epic.id) ?? []).sort(byRank)
      const own = spanOf(epic)
      const spans = children.map(spanOf).filter((s) => s !== null)
      const borrowed = spans.length
        ? { start: spans.map((s) => s.start).sort()[0], end: spans.map((s) => s.end).sort().at(-1)! }
        : null
      const span = own ?? borrowed
      return {
        epic,
        children,
        done: children.filter((c) => isDone(c, statuses)).length,
        start: span?.start ?? null,
        end: span?.end ?? null,
        own: own !== null,
      }
    })
}

export interface TimelineWindow {
  // First and last day drawn: whole months.
  from: string
  to: string
  days: number
  months: { label: string; offset: number; days: number }[]
}

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`
function nextMonth(iso: string) {
  const [y, m] = iso.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/**
 * The months to draw: from a month before the earliest date to a month after
 * the latest, and never less than a month back and three ahead of today, so
 * an empty project still shows somewhere to plan into.
 */
export function timelineWindow(dates: (string | null | undefined)[], today: string): TimelineWindow {
  const known = [...dates.filter((d): d is string => !!d), addDays(today, -30), addDays(today, 92)].sort()
  const from = monthStart(addDays(monthStart(known[0]), -1))
  const lastMonth = nextMonth(monthStart(known.at(-1)!))
  const to = addDays(nextMonth(lastMonth), -1)
  const months: TimelineWindow['months'] = []
  for (let m = from; m <= to; m = nextMonth(m)) {
    const [y, mo] = m.split('-').map(Number)
    months.push({
      label: new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: mo === 1 || m === from ? 'numeric' : undefined }),
      offset: daysBetween(from, m),
      days: daysBetween(m, nextMonth(m)),
    })
  }
  return { from, to, days: daysBetween(from, to) + 1, months }
}

/** Where a span sits in the window, in days from its first day: the bar's left edge and its length. */
export function place(window: TimelineWindow, start: string, end: string) {
  return { offset: daysBetween(window.from, start), length: daysBetween(start, end) + 1 }
}

export type DragMode = 'move' | 'start' | 'end'

/** A bar's dates after dragging it, or one of its ends, by whole days. An end never crosses the other. */
export function dragged(start: string, end: string, mode: DragMode, days: number): { start: string; end: string } {
  if (mode === 'move') return { start: addDays(start, days), end: addDays(end, days) }
  if (mode === 'start') {
    const moved = addDays(start, days)
    return { start: moved > end ? end : moved, end }
  }
  const moved = addDays(end, days)
  return { start, end: moved < start ? start : moved }
}
