// The parts of a project its admins can turn off (projects.disabled_features).
// Off only hides a part in the app: its data stays (an issue keeps its release
// while Releases is off) and nobody's access changes. One of Issues and Board
// always stays on; the database's check says so too.
import type { Project, ProjectFeature } from './types'

export interface FeatureInfo {
  key: ProjectFeature
  label: string
  help: string
}

export const FEATURES: FeatureInfo[] = [
  { key: 'board', label: 'Board', help: 'Columns by status; drag issues across.' },
  { key: 'issues', label: 'Issues', help: 'The project’s issue list, with filters.' },
  { key: 'timeline', label: 'Timeline', help: 'Epics on a calendar of months.' },
  { key: 'calendar', label: 'Calendar', help: 'The project’s dates beside your meetings.' },
  { key: 'releases', label: 'Releases', help: 'Versions, their notes and dates. Off hides the release field on issues; the values are kept.' },
  { key: 'docs', label: 'Docs', help: 'Google Drive documents linked to the project.' },
]

/** Issues and Board: a project keeps at least one way to see its issues. */
const ONE_OF: ProjectFeature[] = ['issues', 'board']

type WithFeatures = Pick<Project, 'disabled_features'>

export function featureOn(project: WithFeatures | null | undefined, feature: ProjectFeature) {
  return !(project?.disabled_features ?? []).includes(feature)
}

/** Whether this feature may be turned off now: not the last of Issues and Board. */
export function canDisable(project: WithFeatures, feature: ProjectFeature) {
  if (!featureOn(project, feature) || !ONE_OF.includes(feature)) return true
  return ONE_OF.some((f) => f !== feature && featureOn(project, f))
}

/** The project's disabled list with one feature turned on or off, in a stable order. */
export function withFeature(project: WithFeatures, feature: ProjectFeature, on: boolean): ProjectFeature[] {
  const off = new Set(project.disabled_features ?? [])
  if (on) off.delete(feature)
  else off.add(feature)
  return FEATURES.map((f) => f.key).filter((k) => off.has(k))
}

// The project tab each feature is, by its path under /projects/:key.
const TAB_OF: Record<string, ProjectFeature> = {
  board: 'board',
  issues: 'issues',
  timeline: 'timeline',
  calendar: 'calendar',
  releases: 'releases',
  docs: 'docs',
}

/** The feature a path under the project belongs to (`releases/abc` → releases), if any. */
export function tabFeature(subpath: string): ProjectFeature | null {
  return TAB_OF[subpath.split('/').filter(Boolean)[0] ?? ''] ?? null
}

/** A link to one of a project's tabs, or its Summary when that tab is off. */
export function projectTabHref(project: Pick<Project, 'key' | 'disabled_features'>, tab: ProjectFeature) {
  const base = `/projects/${project.key}`
  return featureOn(project, tab) ? `${base}/${tab}` : base
}
