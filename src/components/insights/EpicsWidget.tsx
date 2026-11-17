// Open epics under way: how far each has got against its dates.
import { Link } from 'react-router-dom'
import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { formatDate, todayIso } from '../../lib/constants'
import { fetchAll, fetchByIds } from '../../lib/paging'
import { epicHealth, epicInProgress } from '../../lib/insights'
import { timelineRows } from '../../lib/timeline'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { TypeIcon } from '../IssueBits'
import { useIssueHref } from '../useIssueHref'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { INSIGHT_COLUMNS, asIssues } from './data'
import { LoadError, Quiet, VerdictChip } from './parts'
import { must, useWidgetQuery } from './useWidgetQuery'

export default function EpicsWidget({ project, header }: WidgetProps) {
  const { statusesOf, issueTypes, typeById } = useWorkspace()
  const href = useIssueHref()
  const statuses = statusesOf(project.id)
  const today = todayIso()
  const epicTypes = issueTypes.filter((t) => t.level === 'epic').map((t) => t.id)

  const q = useWidgetQuery(`${project.id}:epics`, async () => {
    if (!epicTypes.length) return []
    const epics = asIssues(must(await fetchAll((f, t) => supabase.from('issues').select(INSIGHT_COLUMNS).eq('project_id', project.id)
      .in('type_id', epicTypes).is('resolved_at', null).order('id').range(f, t))))
    const children = epics.length
      ? asIssues(must(await fetchByIds(epics.map((e) => e.id), (ids, f, t) =>
        supabase.from('issues').select(INSIGHT_COLUMNS).in('parent_id', ids).order('id').range(f, t))))
      : []
    return [...epics, ...children]
  })

  if (q.error) return <>{header()}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading) return <>{header()}<WidgetLoading /></>
  const health = timelineRows(q.data!, issueTypes, statuses)
    .filter((r) => epicInProgress(r, statuses, today))
    .map((r) => epicHealth(r, statuses, today))
  // Slipping first, then by how far along.
  const order = { bad: 0, warn: 1, neutral: 2, good: 3 }
  health.sort((a, b) => order[a.verdict.tone] - order[b.verdict.tone] || b.done / (b.total || 1) - a.done / (a.total || 1))
  if (!health.length) return <>{header()}<Quiet>No epic is under way.</Quiet></>

  return (
    <>
      {header()}
      <Stack spacing={1.75}>
        {health.map((h) => {
          const e = h.row.epic
          return (
            <Box key={e.id} data-epic={e.key}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5, minWidth: 0 }}>
                <TypeIcon type={typeById(e.type_id)} />
                <Typography component={Link} to={href(e.key)} variant="body2" noWrap
                  sx={{ flexGrow: 1, minWidth: 0, color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                  {e.title}
                </Typography>
                <VerdictChip verdict={h.verdict} />
              </Stack>
              <LinearProgress variant="determinate" color="success" value={h.total ? (h.done / h.total) * 100 : 0}
                sx={{ height: 6, borderRadius: 3 }} aria-label={`${e.title}: ${h.done} of ${h.total} done`} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {h.done} of {h.total} done
                {h.points.total > 0 ? ` · ${h.points.done}/${h.points.total} points` : ''}
                {h.row.end ? ` · ends ${formatDate(h.row.end, false)}` : ''}
              </Typography>
            </Box>
          )
        })}
      </Stack>
    </>
  )
}
