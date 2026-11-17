// The Summary's widgets: which exist, for which kind of project, which
// project features each needs, and which a project shows (its admins'
// choice in projects.summary_widgets, else the default for its kind). The
// components are in components/insights/registry; this is the pure part.
import { featureOn } from './projectFeatures'
import type { Project, ProjectFeature, ProjectKind } from './types'

export type WidgetKey =
  | 'release'
  | 'sprint'
  | 'flow'
  | 'attention'
  | 'status_time'
  | 'people'
  | 'leaderboard'
  | 'epics'
  | 'activity'
  | 'velocity'
  | 'sprint_report'
  | 'created_resolved'
  | 'cumulative_flow'

export interface WidgetInfo {
  key: WidgetKey
  title: string
  help: string
  kinds: ProjectKind[]
  needs?: ProjectFeature[]
  // A whole row, or half of one on a wide screen.
  width: 'full' | 'half'
}

const BOTH: ProjectKind[] = ['scrum', 'kanban']

export const WIDGETS: WidgetInfo[] = [
  { key: 'release', title: 'Next release', kinds: BOTH, needs: ['releases'], width: 'full',
    help: 'The next release: how much is done, and when it will likely be finished at the team’s recent pace.' },
  { key: 'sprint', title: 'Sprint health', kinds: ['scrum'], width: 'half',
    help: 'Work left day by day against a steady line to zero, and whether the pace so far finishes the sprint.' },
  { key: 'flow', title: 'Cycle time & throughput', kinds: BOTH, width: 'half',
    help: 'Issues finished each week, and how long they took from first in progress to done.' },
  { key: 'attention', title: 'Needs attention', kinds: BOTH, width: 'half',
    help: 'Open work that is blocked, overdue, in progress for longer than usual, or unassigned in the sprint or next release.' },
  { key: 'status_time', title: 'Time in status', kinds: BOTH, width: 'full',
    help: 'How many issues sit in each status and how long they spend there. The slowest in-progress status is the bottleneck.' },
  { key: 'people', title: 'People', kinds: BOTH, width: 'half',
    help: 'What each person finished, and how much of it on time: by its due date, or within its sprint when it has none.' },
  { key: 'leaderboard', title: 'Leaderboard', kinds: BOTH, width: 'half',
    help: 'Who finished the most this sprint (or the last 30 days), by points, then by on-time rate.' },
  { key: 'epics', title: 'Epics in progress', kinds: BOTH, width: 'half',
    help: 'Open epics under way: their progress against their dates.' },
  { key: 'activity', title: 'Recent activity', kinds: BOTH, width: 'full', help: 'The latest changes to the project’s issues.' },
  { key: 'velocity', title: 'Velocity', kinds: ['scrum'], width: 'half', help: 'Committed against completed, for each finished sprint.' },
  { key: 'sprint_report', title: 'Sprint report', kinds: ['scrum'], width: 'full',
    help: 'What a finished sprint completed, what it didn’t, and what joined or left part-way.' },
  { key: 'created_resolved', title: 'Created vs resolved', kinds: BOTH, width: 'half',
    help: 'Whether work arrives faster than it is finished.' },
  { key: 'cumulative_flow', title: 'Cumulative flow', kinds: BOTH, width: 'half',
    help: 'How much work sits in each stage over time; a widening band is a bottleneck.' },
]

const DEFAULTS: Record<ProjectKind, WidgetKey[]> = {
  scrum: ['release', 'sprint', 'attention', 'status_time', 'people', 'leaderboard', 'epics', 'flow', 'activity'],
  kanban: ['release', 'flow', 'attention', 'status_time', 'people', 'leaderboard', 'epics', 'activity'],
}

const byKey = new Map(WIDGETS.map((w) => [w.key, w]))
export const widgetInfo = (key: WidgetKey) => byKey.get(key)!

type ProjectShape = Pick<Project, 'kind' | 'disabled_features' | 'summary_widgets'>

/** The widgets this project can show: its kind's, minus those needing a feature it turned off. */
export function availableWidgets(project: ProjectShape): WidgetInfo[] {
  return WIDGETS.filter((w) => w.kinds.includes(project.kind) && (w.needs ?? []).every((f) => featureOn(project, f)))
}

/** The kind's default widgets. */
export const defaultWidgets = (kind: ProjectKind): WidgetKey[] => [...DEFAULTS[kind]]

/**
 * What the Summary shows, in order: the admins' choice, else the default.
 * Keys this build doesn't know, of the other kind, or needing a feature that
 * is off are skipped (they come back if it is turned on again).
 */
export function widgetsFor(project: ProjectShape): WidgetKey[] {
  const can = new Set(availableWidgets(project).map((w) => w.key))
  const chosen = (project.summary_widgets ?? DEFAULTS[project.kind]) as string[]
  return [...new Set(chosen)].filter((k): k is WidgetKey => can.has(k as WidgetKey))
}

/** A layout with a widget shown (at the end) or hidden. */
export function toggleWidget(list: WidgetKey[], key: WidgetKey, on: boolean): WidgetKey[] {
  const rest = list.filter((k) => k !== key)
  return on ? [...rest, key] : rest
}

/** A layout with a widget moved one place up (-1) or down (+1). */
export function moveWidget(list: WidgetKey[], key: WidgetKey, by: -1 | 1): WidgetKey[] {
  const i = list.indexOf(key)
  const j = i + by
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/**
 * What to save: the shown list, plus any saved keys hidden only because a
 * feature is off right now (so turning it back on restores them). The
 * default is saved as null, so the project follows later defaults.
 */
export function layoutToSave(project: ProjectShape, shown: WidgetKey[]): string[] | null {
  const available = new Set(availableWidgets(project).map((w) => w.key))
  const kept = ((project.summary_widgets ?? DEFAULTS[project.kind]) as string[])
    .filter((k) => byKey.has(k as WidgetKey) && byKey.get(k as WidgetKey)!.kinds.includes(project.kind) && !available.has(k as WidgetKey))
  const out = [...shown, ...kept.filter((k) => !shown.includes(k as WidgetKey))]
  const def = DEFAULTS[project.kind]
  return out.length === def.length && out.every((k, i) => k === def[i]) ? null : out
}
