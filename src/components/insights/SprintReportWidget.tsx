// A finished sprint: what it completed, what it didn't, and what joined or
// left part-way. The latest closed sprint by default.
import { useState } from 'react'
import { Box, MenuItem, Paper, TextField, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { formatDateRange } from '../../lib/constants'
import { ISSUE_COLUMNS } from '../../lib/issues'
import { fetchAll, fetchByIds } from '../../lib/paging'
import { sprintReport } from '../../lib/reports'
import type { Issue, SprintIssue } from '../../lib/types'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { BacklogRow } from '../IssueCard'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { LoadError, Quiet } from './parts'
import { must, useWidgetQuery } from './useWidgetQuery'

export default function SprintReportWidget({ project, header }: WidgetProps) {
  const meta = useProjectMeta(project.id)
  const [chosen, setChosen] = useState('')
  const closed = (meta?.sprints ?? []).filter((s) => s.state === 'closed')
    .sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? ''))
  const sprint = closed.find((s) => s.id === chosen) ?? closed.at(-1)

  const q = useWidgetQuery(sprint ? `${project.id}:sprint_report:${sprint.id}` : null, async () => {
    const rows = must(await fetchAll<SprintIssue>((f, t) =>
      supabase.from('sprint_issues').select('*').eq('sprint_id', sprint!.id).order('issue_id').range(f, t)))
    const issues = rows.length
      ? must(await fetchByIds<Issue>(rows.map((r) => r.issue_id), (ids, f, t) =>
        supabase.from('issues').select(ISSUE_COLUMNS).in('id', ids).order('id').range(f, t)))
      : []
    return { rows, issues }
  })

  if (!meta) return <>{header()}<WidgetLoading /></>
  if (!sprint) return <>{header()}<Quiet>The report is written when a sprint is completed.</Quiet></>
  const picker = closed.length > 1 && (
    <TextField select size="small" value={sprint.id} onChange={(e) => setChosen(e.target.value)} sx={{ minWidth: 150 }}
      slotProps={{ htmlInput: { 'aria-label': 'Sprint' } }}>
      {[...closed].reverse().map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
    </TextField>
  )
  if (q.error) return <>{header(picker)}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading) return <>{header(picker)}<WidgetLoading /></>

  const r = sprintReport(sprint.id, q.data!.rows)
  const byId = new Map(q.data!.issues.map((i) => [i.id, i]))
  const list = (title: string, ids: string[]) => (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title} ({ids.length})</Typography>
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {ids.map((id) => byId.get(id)).filter((i): i is Issue => !!i).map((i) => <BacklogRow key={i.id} issue={i} moves={[]} draggable={false} />)}
        {!ids.length && <Typography variant="body2" sx={{ color: 'text.secondary', p: 1.5 }}>None.</Typography>}
      </Paper>
    </Box>
  )
  return (
    <>
      {header(picker)}
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {sprint.name} · {formatDateRange(sprint.start_date, sprint.end_date)}{sprint.goal ? ` · ${sprint.goal}` : ''}
      </Typography>
      {list('Completed', r.completed)}
      {list('Not completed', r.notCompleted)}
      {list('Added after the sprint started', r.added)}
      {list('Removed before it ended', r.removed)}
    </>
  )
}
