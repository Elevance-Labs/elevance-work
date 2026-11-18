// The backlog's quick filters (words, people, yours, recently updated,
// flagged, an epic or no epic), what its epics panel says of each epic, and
// selecting rows to move together (ranks for a block, the next selection).
import type { Issue, ProjectStatus } from './types'
import { categoryOf } from './issues'

/** "Recently updated" (as Jira's quick filter): changed in the last day. */
export const RECENT_HOURS = 24

/** An epic's id, NO_EPIC for issues under none, or '' for all. */
export const NO_EPIC = 'none'

/** The drop target's id for an epic in the Epics panel (NO_EPIC: out of any). */
export const epicDropId = (epicId: string) => `epic:${epicId}`

export interface BacklogFilter {
  text: string
  people: string[] // assignee ids, 'none' for unassigned; any of them
  mine: boolean
  recent: boolean
  flagged: boolean
  epic: string
}

export const EMPTY_BACKLOG_FILTER: BacklogFilter = { text: '', people: [], mine: false, recent: false, flagged: false, epic: '' }

/** Whether any quick filter is narrowing the lists. */
export const backlogFiltered = (f: BacklogFilter) =>
  !!f.text.trim() || f.people.length > 0 || f.mine || f.recent || f.flagged || !!f.epic

/** Whether an issue passes every quick filter that is on. `now` in milliseconds. */
export function matchesBacklog(i: Issue, f: BacklogFilter, meId: string, now: number) {
  const t = f.text.trim().toLowerCase()
  if (t && !i.key.toLowerCase().includes(t) && !i.title.toLowerCase().includes(t)) return false
  if (f.people.length && !f.people.includes(i.assignee_id ?? 'none')) return false
  if (f.mine && i.assignee_id !== meId) return false
  if (f.recent && now - new Date(i.updated_at).getTime() > RECENT_HOURS * 3600_000) return false
  if (f.flagged && !i.flag_reason) return false
  if (f.epic === NO_EPIC) return !i.parent_id
  if (f.epic) return i.parent_id === f.epic
  return true
}

export interface EpicProgress {
  total: number
  done: number
  inProgress: number
  points: number
  donePoints: number
}

/** How far along an epic is, from its issues (`children`: those under it). */
export function epicProgress(children: Issue[], statuses: ProjectStatus[]): EpicProgress {
  const p: EpicProgress = { total: children.length, done: 0, inProgress: 0, points: 0, donePoints: 0 }
  for (const c of children) {
    const category = categoryOf(c, statuses)
    p.points += c.story_points ?? 0
    if (category === 'done') {
      p.done += 1
      p.donePoints += c.story_points ?? 0
    } else if (category === 'in_progress') p.inProgress += 1
  }
  return p
}

/**
 * Ranks for `moving` (in that order) placed together into `list` (sorted by
 * rank, may hold some of them) at `index` among the rest. Evenly spread
 * between the neighbours; null when they are too close (rerank first).
 */
export function blockRanks(list: Issue[], index: number, moving: string[]): number[] | null {
  const others = list.filter((i) => !moving.includes(i.id))
  const before = others[index - 1]?.rank
  const after = others[index]?.rank
  const n = moving.length
  const at = (f: (k: number) => number) => Array.from({ length: n }, (_, k) => f(k))
  if (before == null && after == null) return at((k) => (k + 1) * 1024)
  if (before == null) return at((k) => after! - (n - k) * 1024)
  if (after == null) return at((k) => before + (k + 1) * 1024)
  const step = (after - before) / (n + 1)
  return step > 1e-6 ? at((k) => before + step * (k + 1)) : null
}

/** How a click picks a row: it alone, in or out of the rest, or all from the last one picked. */
export type PickMode = 'only' | 'toggle' | 'range'

/**
 * The selection after a click on `id`. `order`: the rows as listed, for a
 * range (from `anchor`, the last one picked, when it is listed with them).
 * Clicking the only selected row again lets it go.
 */
export function nextSelection(current: string[], id: string, mode: PickMode, order: string[], anchor: string | null): string[] {
  if (mode === 'only') return current.length === 1 && current[0] === id ? [] : [id]
  if (mode === 'range' && anchor && order.includes(anchor) && order.includes(id)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y)
    return [...new Set([...current, ...order.slice(a, b + 1)])]
  }
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
}

/** What the epic menu acts on: one issue, or the selected ones. */
export interface EpicTarget {
  name: string // 'WEB-5', or '3 issues'
  epicId: string | null // the epic they share, if they share one
  hasEpic: boolean // any of them is under an epic
}

export function epicTargetOf(issues: Issue[]): EpicTarget {
  const ids = [...new Set(issues.map((i) => i.parent_id))]
  return {
    name: issues.length === 1 ? issues[0].key : `${issues.length} issues`,
    epicId: ids.length === 1 ? ids[0] : null,
    hasEpic: issues.some((i) => !!i.parent_id),
  }
}
