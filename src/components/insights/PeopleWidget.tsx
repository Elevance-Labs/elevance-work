// What each person finished, and how much of it on time (by its due date;
// without one, within its sprint), all time or over a period.
import { useState } from 'react'
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material'
import { formatPoints, todayIso } from '../../lib/constants'
import { formatDays, personStats } from '../../lib/insights'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { PersonName } from '../common'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { loadFinished } from './data'
import { LoadError, PeriodSelect, Quiet } from './parts'
import { presetPeriod, type Period } from './helpers'
import { useWidgetQuery } from './useWidgetQuery'

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`)

export default function PeopleWidget({ project, header }: WidgetProps) {
  const { statusesOf, issueTypes, profileById } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const today = todayIso()
  const [period, setPeriod] = useState<Period>({ mode: 'all', from: today, to: today })
  const window_ = period.mode === 'all' ? null : { from: period.from, to: period.to }

  const q = useWidgetQuery(`${project.id}:people:${window_ ? `${window_.from}:${window_.to}` : 'all'}`,
    () => loadFinished(project.id, window_, issueTypes))

  const picker = (
    <PeriodSelect label="Period" value={period} today={today}
      presets={[{ mode: 'all', label: 'All time' }, { mode: '30', label: '30 d' }, { mode: '90', label: '90 d' }]}
      onChange={(p) => setPeriod(p.mode === 'all' ? { mode: 'all', from: today, to: today } : p.mode === 'custom' && period.mode === 'all' ? { ...presetPeriod('30', today), mode: 'custom' } : p)} />
  )
  if (q.error) return <>{header(picker)}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading || !meta) return <>{header(picker)}<WidgetLoading /></>
  const stats = personStats(q.data!.items, q.data!.sprintRows, meta.sprints, q.data!.byIssue, statuses)
  if (!stats.length) return <>{header(picker)}<Quiet>Nobody finished assigned work in this period.</Quiet></>
  const usesPoints = stats.some((s) => s.points > 0)

  return (
    <>
      {header(picker)}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Person</TableCell>
              <TableCell align="right">Done</TableCell>
              {usesPoints && <TableCell align="right">Points</TableCell>}
              <TableCell align="right">
                <Tooltip title="Finished by the due date; with none, within its sprint without spilling. Issues with neither aren't judged.">
                  <span>On time</span>
                </Tooltip>
              </TableCell>
              <TableCell align="right">Cycle time</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {stats.map((s) => (
              <TableRow key={s.assignee} data-person={s.assignee}>
                <TableCell sx={{ maxWidth: 180 }}><PersonName person={profileById(s.assignee)} size={22} /></TableCell>
                <TableCell align="right">{s.issues}</TableCell>
                {usesPoints && <TableCell align="right">{formatPoints(s.points)}</TableCell>}
                <TableCell align="right">
                  <Tooltip title={s.judged ? `${s.onTime} of ${s.judged} judged` : 'Nothing with a due date or a sprint'}>
                    <Typography variant="body2" component="span" sx={{ color: s.rate === null ? 'text.secondary' : s.rate >= 0.8 ? 'success.main' : s.rate >= 0.5 ? 'warning.main' : 'error.main' }}>
                      {pct(s.rate)}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">{formatDays(s.medianCycle)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </>
  )
}
