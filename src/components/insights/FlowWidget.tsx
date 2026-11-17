// How fast work moves: issues finished each week and how long they took, over
// twelve weeks. Two charts, not one with two scales.
import { Grid, Typography } from '@mui/material'
import { formatDate, todayIso } from '../../lib/constants'
import { cycleDays, flowSeries, formatDays, median, workItems } from '../../lib/insights'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { BarChart, LineChart } from '../charts'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { RECENT_WEEKS, loadRecentWork, recentWorkKey } from './data'
import { Figure, LoadError, Quiet } from './parts'
import { useWidgetQuery } from './useWidgetQuery'

export default function FlowWidget({ project, header }: WidgetProps) {
  const { statusesOf, issueTypes } = useWorkspace()
  const statuses = statusesOf(project.id)
  const today = todayIso()
  const q = useWidgetQuery(recentWorkKey(project.id, today), () => loadRecentWork(project.id, today))

  if (q.error) return <>{header()}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading) return <>{header()}<WidgetLoading /></>
  const done = workItems(q.data!.resolved, issueTypes)
  if (!done.length) return <>{header()}<Quiet>Nothing finished in the last {RECENT_WEEKS} weeks.</Quiet></>

  const weeks = flowSeries(done, q.data!.byIssue, statuses, RECENT_WEEKS, today)
  const labels = weeks.map((w) => formatDate(w.end, false))
  const cycles = done.map((i) => cycleDays(i, q.data!.byIssue, statuses)!)
  const recent4 = weeks.slice(-4)
  return (
    <>
      {header()}
      <Grid container spacing={2} sx={{ mb: 1.5 }}>
        <Grid size={4}><Figure value={done.length} label={`finished in ${RECENT_WEEKS} weeks`} /></Grid>
        <Grid size={4}>
          <Figure value={Math.round((recent4.reduce((s, w) => s + w.completed, 0) / recent4.length) * 10) / 10} label="a week, lately" />
        </Grid>
        <Grid size={4}><Figure value={formatDays(median(cycles))} label="median cycle time" /></Grid>
      </Grid>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>Finished per week</Typography>
      <BarChart title="Issues finished per week" height={150} labels={labels}
        series={[{ label: 'Finished', color: '#22a06b', values: weeks.map((w) => w.completed) }]} />
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 1 }}>Median cycle time (days)</Typography>
      <LineChart title="Median cycle time per week, in days" height={150} labels={labels}
        series={[{ label: 'Median cycle time', color: '#1d7afc', values: weeks.map((w) => (w.medianCycle === null ? null : Math.round(w.medianCycle * 10) / 10)) }]} />
    </>
  )
}
