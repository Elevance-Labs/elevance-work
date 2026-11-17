// Where time goes, status by status: how many issues sit in each now, how
// many passed through, and how long they stayed, for the current sprint or
// a period. The in-progress status where work waits longest is flagged.
import { useState } from 'react'
import { Box, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material'
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined'
import { supabase } from '../../lib/supabase'
import { CATEGORY_HEX, todayIso } from '../../lib/constants'
import { fetchAll } from '../../lib/paging'
import { bottleneck, formatDays, timeInStatus, workItems } from '../../lib/insights'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { INSIGHT_COLUMNS, asIssues, statusEvents } from './data'
import { LoadError, PeriodSelect, Quiet } from './parts'
import { presetPeriod, type Period } from './helpers'
import { must, useWidgetQuery } from './useWidgetQuery'

const startOf = (day: string) => new Date(`${day}T00:00:00`).getTime()
const endOf = (day: string) => new Date(`${day}T23:59:59.999`).getTime()

export default function StatusTimeWidget({ project, header }: WidgetProps) {
  const { statusesOf, issueTypes } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const today = todayIso()
  const sprint = project.kind === 'scrum' ? meta?.sprints.find((s) => s.state === 'active' && s.started_at) : undefined
  const [picked, setPicked] = useState<Period | null>(null)
  const period = picked ?? (sprint ? { mode: 'sprint', from: sprint.start_date ?? today, to: today } : presetPeriod('30', today))

  // The window, as instants; the sprint's runs from when it started to now
  // (when the data was read: `asOf`).
  const from = period.mode === 'sprint' && sprint ? new Date(sprint.started_at!).getTime() : startOf(period.from)
  const until = (asOf: number) => (period.mode === 'sprint' ? asOf : Math.min(asOf, endOf(period.to)))
  const key = period.mode === 'sprint' ? `sprint:${sprint?.id}` : `${period.from}:${period.to}`

  const q = useWidgetQuery(meta ? `${project.id}:status_time:${key}` : null, async () => {
    const asOf = Date.now()
    const fromIso = new Date(from).toISOString()
    const toIso = new Date(until(asOf)).toISOString()
    const issues = asIssues(must(await fetchAll((f, t) => {
      let query = supabase.from('issues').select(INSIGHT_COLUMNS).eq('project_id', project.id)
      // The sprint's issues, or every issue alive in the period.
      query = period.mode === 'sprint' && sprint
        ? query.eq('sprint_id', sprint.id)
        : query.lte('created_at', toIso).or(`resolved_at.is.null,resolved_at.gte.${fromIso}`)
      return query.order('id').range(f, t)
    })))
    const items = workItems(issues, issueTypes)
    return { items, byIssue: await statusEvents(items.map((i) => i.id), fromIso), asOf }
  })

  const presets = [
    ...(sprint ? [{ mode: 'sprint', label: 'Sprint' }] : []),
    { mode: '14', label: '14 d' },
    { mode: '30', label: '30 d' },
    { mode: '90', label: '90 d' },
  ]
  const picker = (
    <PeriodSelect label="Period" value={period} today={today} presets={presets}
      onChange={(p) => setPicked(p.mode === 'sprint' && sprint ? { mode: 'sprint', from: sprint.start_date ?? today, to: today } : p)} />
  )
  if (q.error) return <>{header(picker)}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading) return <>{header(picker)}<WidgetLoading /></>
  if (!q.data!.items.length) return <>{header(picker)}<Quiet>No issues in this period.</Quiet></>

  const rows = timeInStatus(q.data!.items, q.data!.byIssue, statuses, from, until(q.data!.asOf))
  const slow = bottleneck(rows)
  return (
    <>
      {header(picker)}
      {slow && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <FlagOutlinedIcon fontSize="small" color="warning" />
          <Typography variant="body2">
            Work waits longest in <strong>{slow.status.name}</strong>: {formatDays(slow.median)} for half of it.
          </Typography>
        </Stack>
      )}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell align="right">Now</TableCell>
              <TableCell align="right">Passed through</TableCell>
              <TableCell align="right">Median time</TableCell>
              <TableCell align="right">Total time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const timed = r.status.category !== 'done'
              return (
                <TableRow key={r.status.id} data-status={r.status.name}>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: CATEGORY_HEX[r.status.category], flexShrink: 0 }} />
                      <Typography variant="body2" noWrap>{r.status.name}</Typography>
                      {slow?.status.id === r.status.id && (
                        <Tooltip title="The bottleneck"><FlagOutlinedIcon sx={{ fontSize: 16 }} color="warning" /></Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">{r.now}</TableCell>
                  <TableCell align="right">{r.passed}</TableCell>
                  <TableCell align="right">{timed ? formatDays(r.median) : '—'}</TableCell>
                  <TableCell align="right">{timed ? formatDays(r.passed ? r.total : null) : '—'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
      {period.mode !== 'sprint' && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
          Each issue’s time is counted inside the period only. Done statuses show counts, not time.
        </Typography>
      )}
    </>
  )
}
