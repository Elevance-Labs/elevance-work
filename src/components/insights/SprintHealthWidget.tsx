// Whether the sprint will finish: its burndown, the pace so far carried to
// the end date, what joined after it started, and what the last one spilled.
// Any started sprint can be picked; the active one by default.
import { useState } from 'react'
import { MenuItem, Stack, TextField, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { formatDate, formatDateRange, formatPoints, todayIso } from '../../lib/constants'
import { fetchAll, fetchByIds } from '../../lib/paging'
import { burndown, unitFor } from '../../lib/reports'
import { groupEvents, scopeChange, sprintHealth } from '../../lib/insights'
import type { IssueEvent, SprintIssue } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { LineChart } from '../charts'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { INSIGHT_COLUMNS, asIssues } from './data'
import { LoadError, Quiet, VerdictChip } from './parts'
import { must, useWidgetQuery } from './useWidgetQuery'

export default function SprintHealthWidget({ project, header }: WidgetProps) {
  const { statusesOf } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const today = todayIso()
  const [chosen, setChosen] = useState('')

  const started = (meta?.sprints ?? []).filter((s) => s.state !== 'future' && s.started_at)
  const sprint = started.find((s) => s.id === chosen) ?? started.find((s) => s.state === 'active') ?? started.at(-1)
  // The sprint closed before this one, for what it spilled.
  const previous = sprint && started
    .filter((s) => s.state === 'closed' && s.id !== sprint.id && (s.completed_at ?? '') <= (sprint.started_at ?? ''))
    .sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? '')).at(-1)

  const q = useWidgetQuery(sprint ? `${project.id}:sprint:${sprint.id}:${sprint.state}` : null, async () => {
    const s = sprint!
    const [rows, events, current] = await Promise.all([
      fetchAll<SprintIssue>((from, to) => supabase.from('sprint_issues').select('*')
        .in('sprint_id', [s.id, ...(previous ? [previous.id] : [])]).order('issue_id').range(from, to)),
      // Only what moved since it started: undoing later moves rebuilds any earlier day.
      fetchAll<IssueEvent>((from, to) => supabase.from('issue_events').select('id, issue_id, field, from_id, to_id, from_value, to_value, created_at')
        .eq('project_id', project.id).in('field', ['status', 'sprint', 'story_points']).gte('created_at', s.started_at!)
        .order('id').range(from, to)),
      fetchAll((from, to) => supabase.from('issues').select(INSIGHT_COLUMNS).eq('sprint_id', s.id).order('id').range(from, to)),
    ])
    const sprintRows = must(rows)
    const evs = must(events)
    const issues = asIssues(must(current))
    // Issues that were in it at some point but have left.
    const have = new Set(issues.map((i) => i.id))
    const others = [
      ...sprintRows.filter((r) => r.sprint_id === s.id).map((r) => r.issue_id),
      ...evs.filter((e) => e.field === 'sprint' && (e.from_id === s.id || e.to_id === s.id)).map((e) => e.issue_id),
    ].filter((id) => !have.has(id))
    const left = others.length
      ? asIssues(must(await fetchByIds(others, (ids, from, to) =>
        supabase.from('issues').select(INSIGHT_COLUMNS).in('id', ids).order('id').range(from, to))))
      : []
    return { issues: [...issues, ...left], events: evs, rows: sprintRows }
  })

  if (!meta) return <>{header()}<WidgetLoading /></>
  if (!sprint) return <>{header()}<Quiet>No sprint has started yet. Start one from the backlog to see its health here.</Quiet></>

  const picker = started.length > 1 && (
    <TextField select size="small" value={sprint.id} onChange={(e) => setChosen(e.target.value)} sx={{ minWidth: 150 }}
      slotProps={{ htmlInput: { 'aria-label': 'Sprint' } }}>
      {[...started].reverse().map((s) => <MenuItem key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</MenuItem>)}
    </TextField>
  )
  if (q.error) return <>{header(picker)}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading) return <>{header(picker)}<WidgetLoading /></>

  const { issues, events, rows } = q.data!
  const unit = unitFor(issues, rows.filter((r) => r.sprint_id === sprint.id))
  const points = burndown(sprint, issues, events, statuses, today, unit)
  const health = sprintHealth(sprint, points, unit)
  const scope = scopeChange(sprint, groupEvents(events))
  const spilled = previous ? rows.filter((r) => r.sprint_id === previous.id && r.completed === false).length : null
  const unitWord = unit === 'points' ? 'points' : 'issues'

  return (
    <>
      {header(<>{picker}<VerdictChip verdict={health.verdict} /></>)}
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        {formatDateRange(sprint.start_date, sprint.end_date)} · in {unitWord}
        {health.remaining !== null && sprint.state === 'active' ? ` · ${formatPoints(health.remaining)} left` : ''}
        {health.projected !== null && sprint.state === 'active' && health.projected > 0 ? ` · ~${formatPoints(health.projected)} at the end at this pace` : ''}
      </Typography>
      {points.length > 0 && (
        <LineChart title={`${sprint.name} burndown`} height={200} labels={points.map((p) => formatDate(p.day, false))} series={[
          { label: 'Remaining', color: '#e2483d', values: points.map((p) => p.remaining) },
          { label: 'Guideline', color: '#8590a2', values: points.map((p) => p.ideal), dashed: true },
        ]} />
      )}
      <Stack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="body2" sx={{ color: scope.added.length ? 'warning.main' : 'text.secondary' }}>
          {scope.added.length ? `${scope.added.length} added since it started` : 'No scope added'}
        </Typography>
        {scope.removed.length > 0 && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{scope.removed.length} removed</Typography>}
        {spilled !== null && previous && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {previous.name} spilled {spilled} issue{spilled === 1 ? '' : 's'}
          </Typography>
        )}
      </Stack>
    </>
  )
}
