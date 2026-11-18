// One release's outlook, as the Summary judges it: progress, the time gone
// against the work done, the Monte Carlo forecast over the team's recent
// pace, and what stands in the way. Shared by the Summary's release widget
// and the release page (same cache keys, so one load serves both).
import { useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { todayIso } from '../../lib/constants'
import { fetchAll } from '../../lib/paging'
import { flowSeries, releaseHealth, throughputSamples, workItems, type ReleaseHealth } from '../../lib/insights'
import type { Project, Release } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { INSIGHT_COLUMNS, asIssues, loadRecentWork, openBlockers, recentWorkKey } from './data'
import { must, useWidgetQuery } from './useWidgetQuery'

export interface ReleaseOutlookData {
  health: ReleaseHealth | null
  /** Open work items blocked by an open issue. */
  blocked: number
  loading: boolean
  error: string | null
  retry: () => void
}

export function useReleaseHealth(project: Pick<Project, 'id'>, release: Release | null): ReleaseOutlookData {
  const { statusesOf, issueTypes } = useWorkspace()
  const today = todayIso()
  const items = useWidgetQuery(release ? `${project.id}:release:${release.id}` : null, async () => {
    const rows = asIssues(must(await fetchAll((from, to) =>
      supabase.from('issues').select(INSIGHT_COLUMNS).eq('release_id', release!.id).order('id').range(from, to))))
    const open = rows.filter((i) => !i.resolved_at).map((i) => i.id)
    return { rows, blockers: await openBlockers(open) }
  })
  const recent = useWidgetQuery(release ? recentWorkKey(project.id, today) : null, () => loadRecentWork(project.id, today))

  const computed = useMemo(() => {
    if (!release || !items.data || !recent.data) return null
    const statuses = statusesOf(project.id)
    const work = workItems(items.data.rows, issueTypes)
    const samples = throughputSamples(flowSeries(workItems(recent.data.resolved, issueTypes), recent.data.byIssue, statuses, 8, today))
    return {
      health: releaseHealth(release, work, statuses, samples, today),
      blocked: work.filter((i) => !i.resolved_at && items.data!.blockers.has(i.id)).length,
    }
  }, [release, items.data, recent.data, issueTypes, statusesOf, project.id, today])

  return {
    health: computed?.health ?? null,
    blocked: computed?.blocked ?? 0,
    loading: items.loading || recent.loading,
    error: items.error ?? recent.error,
    retry: () => {
      items.retry()
      recent.retry()
    },
  }
}
