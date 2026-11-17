// Plain helpers the Summary's widgets share: periods and links into the
// issue list.
import { addDays } from '../../lib/constants'
import { EMPTY_FILTER, filterToSearch, type IssueFilter } from '../../lib/filters'
import { featureOn } from '../../lib/projectFeatures'
import type { Project } from '../../lib/types'

/** A period: a preset number of days back to today, or a custom from–to. */
export interface Period {
  // A preset ('30' days, 'sprint', 'all', …) or 'custom'.
  mode: string
  from: string
  to: string
}

export function presetPeriod(mode: string, today: string): Period {
  const days = Number(mode)
  return { mode, from: Number.isFinite(days) ? addDays(today, -(days - 1)) : today, to: today }
}

/** The project's issue list filtered so; the workspace list when its Issues tab is off. */
export function issuesHref(project: Pick<Project, 'id' | 'key' | 'disabled_features'>, filter: Partial<IssueFilter>) {
  const f: IssueFilter = { ...EMPTY_FILTER, ...filter }
  if (featureOn(project, 'issues')) return `/projects/${project.key}/issues?${filterToSearch(f)}`
  return `/issues?${filterToSearch({ ...f, projects: [project.id] })}`
}
