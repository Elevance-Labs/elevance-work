// Committed against completed, for each of the last eight finished sprints.
import { Grid } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { formatPoints } from '../../lib/constants'
import { fetchAll } from '../../lib/paging'
import { average, velocity, type Unit } from '../../lib/reports'
import type { SprintIssue } from '../../lib/types'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { BarChart } from '../charts'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { Figure, LoadError, Quiet } from './parts'
import { must, useWidgetQuery } from './useWidgetQuery'

export default function VelocityWidget({ project, header }: WidgetProps) {
  const meta = useProjectMeta(project.id)
  const closed = (meta?.sprints ?? []).filter((s) => s.state === 'closed')
  const q = useWidgetQuery(meta ? `${project.id}:velocity:${closed.length}` : null, async () => closed.length
    ? must(await fetchAll<SprintIssue>((f, t) =>
      supabase.from('sprint_issues').select('*').in('sprint_id', closed.map((s) => s.id)).order('issue_id').range(f, t)))
    : [])

  if (q.error) return <>{header()}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading || !meta) return <>{header()}<WidgetLoading /></>
  const rows = q.data!
  const unit: Unit = rows.some((r) => (r.points_at_start ?? 0) > 0 || (r.points_at_end ?? 0) > 0) ? 'points' : 'issues'
  const v = velocity(meta.sprints, rows, unit).slice(-8)
  if (!v.length) return <>{header()}<Quiet>Velocity appears once a sprint is completed.</Quiet></>
  return (
    <>
      {header()}
      <Grid container spacing={2} sx={{ mb: 1 }}>
        <Grid size={6}><Figure value={formatPoints(average(v.map((x) => x.completed)))} label={`average completed (${unit})`} /></Grid>
        <Grid size={6}><Figure value={formatPoints(average(v.map((x) => x.committed)))} label={`average committed (${unit})`} /></Grid>
      </Grid>
      <BarChart title="Velocity" height={200} labels={v.map((x) => x.sprint.name)} series={[
        { label: 'Committed', color: '#8590a2', values: v.map((x) => x.committed) },
        { label: 'Completed', color: '#22a06b', values: v.map((x) => x.completed) },
      ]} />
    </>
  )
}
