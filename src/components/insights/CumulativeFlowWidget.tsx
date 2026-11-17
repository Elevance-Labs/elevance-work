// How much work sits in each stage, day by day; a widening band is a
// bottleneck. Only issues still open at the window's start (or newer) are
// read; those finished before it are a constant layer of done, counted.
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { CATEGORY_HEX, CATEGORY_LABELS, addDays, formatDate, todayIso } from '../../lib/constants'
import { fetchAll } from '../../lib/paging'
import { cumulativeFlow } from '../../lib/reports'
import type { Issue, IssueEvent } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { StackedAreaChart } from '../charts'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { LoadError } from './parts'
import { must, useWidgetQuery } from './useWidgetQuery'
import { DaysToggle } from './CreatedResolvedWidget'

export default function CumulativeFlowWidget({ project, header }: WidgetProps) {
  const { statusesOf } = useWorkspace()
  const statuses = statusesOf(project.id)
  const today = todayIso()
  const [days, setDays] = useState(30)
  const since = new Date(`${addDays(today, -(days - 1))}T00:00:00`).toISOString()

  const q = useWidgetQuery(`${project.id}:cumulative_flow:${days}:${today}`, async () => {
    const [issues, doneBefore, events] = await Promise.all([
      fetchAll<Issue>((f, t) => supabase.from('issues').select('id, status_id, story_points, sprint_id, created_at, resolved_at')
        .eq('project_id', project.id).or(`resolved_at.is.null,resolved_at.gte.${since}`).order('id').range(f, t)),
      supabase.from('issues').select('id', { count: 'exact', head: true }).eq('project_id', project.id).lt('resolved_at', since),
      fetchAll<IssueEvent>((f, t) => supabase.from('issue_events').select('id, issue_id, field, from_id, to_id, from_value, created_at')
        .eq('project_id', project.id).eq('field', 'status').gte('created_at', since).order('id').range(f, t)),
    ])
    if (doneBefore.error) must(doneBefore)
    return { issues: must(issues), doneBefore: doneBefore.count ?? 0, events: must(events) }
  })

  const toggle = <DaysToggle days={days} onChange={setDays} />
  if (q.error) return <>{header(toggle)}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading) return <>{header(toggle)}<WidgetLoading /></>
  const flow = cumulativeFlow(q.data!.issues, q.data!.events, statuses, days, today)
    .map((p) => ({ ...p, done: p.done + q.data!.doneBefore }))
  return (
    <>
      {header(toggle)}
      <StackedAreaChart title="Cumulative flow" height={200} labels={flow.map((p) => formatDate(p.day, false))}
        series={(['done', 'in_progress', 'todo'] as const).map((c) => ({ label: CATEGORY_LABELS[c], color: CATEGORY_HEX[c], values: flow.map((p) => p[c]) }))} />
    </>
  )
}
