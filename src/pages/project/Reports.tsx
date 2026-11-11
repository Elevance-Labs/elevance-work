// Reports, all drawn from the issues, their history and the sprint
// snapshots: burndown, velocity and the sprint report (Scrum), created vs
// resolved and cumulative flow (any project).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Grid, MenuItem, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { CATEGORY_HEX, CATEGORY_LABELS, formatDate, formatDateRange, formatPoints, todayIso } from '../../lib/constants'
import { ISSUE_COLUMNS } from '../../lib/issues'
import { average, burndown, createdVsResolved, cumulativeFlow, sprintReport, unitFor, velocity, type Unit } from '../../lib/reports'
import type { Issue, IssueEvent, SprintIssue } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { EmptyState, Loading } from '../../components/common'
import { BarChart, LineChart, StackedAreaChart, StatTile } from '../../components/charts'
import { BacklogRow } from '../../components/IssueCard'
import { useProject } from './projectContext'

type ReportKey = 'burndown' | 'velocity' | 'sprint' | 'created' | 'flow'

const REPORTS: { key: ReportKey; label: string; scrum?: boolean; help: string }[] = [
  { key: 'burndown', label: 'Burndown', scrum: true, help: 'Work left in a sprint, day by day, against a steady line to zero.' },
  { key: 'velocity', label: 'Velocity', scrum: true, help: 'Committed against completed, for each finished sprint.' },
  { key: 'sprint', label: 'Sprint report', scrum: true, help: 'What a sprint finished, what it didn’t, and what joined part-way.' },
  { key: 'created', label: 'Created vs resolved', help: 'Whether work is arriving faster than it is finished.' },
  { key: 'flow', label: 'Cumulative flow', help: 'How much work sits in each stage over time; widening bands are bottlenecks.' },
]

const short = (iso: string) => formatDate(iso, false)

export default function Reports() {
  const { project } = useProject()
  const { statusesOf } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const [params, setParams] = useSearchParams()
  const available = REPORTS.filter((r) => !r.scrum || project.kind === 'scrum')
  const report = (available.find((r) => r.key === params.get('report'))?.key ?? (params.get('sprint') ? 'sprint' : available[0].key)) as ReportKey
  const [days, setDays] = useState(30)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [events, setEvents] = useState<IssueEvent[]>([])
  const [rows, setRows] = useState<SprintIssue[]>([])

  const sprints = useMemo(() => meta?.sprints.filter((s) => s.state !== 'future') ?? [], [meta])
  const sprintId = params.get('sprint') ?? sprints.find((s) => s.state === 'active')?.id ?? sprints.at(-1)?.id ?? ''
  const sprint = sprints.find((s) => s.id === sprintId)

  useEffect(() => {
    if (!meta) return
    let cancelled = false
    ;(async () => {
      const [i, e, r] = await Promise.all([
        supabase.from('issues').select(ISSUE_COLUMNS).eq('project_id', project.id),
        supabase.from('issue_events').select('*').eq('project_id', project.id).in('field', ['status', 'sprint', 'story_points']),
        meta.sprints.length
          ? supabase.from('sprint_issues').select('*').in('sprint_id', meta.sprints.map((s) => s.id))
          : Promise.resolve({ data: [] }),
      ])
      if (cancelled) return
      setIssues((i.data ?? []) as unknown as Issue[])
      setEvents((e.data ?? []) as IssueEvent[])
      setRows((r.data ?? []) as SprintIssue[])
    })()
    return () => {
      cancelled = true
    }
  }, [project.id, meta])

  if (!meta || !issues) return <Loading />
  const today = todayIso()
  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) p.set(k, v)
    setParams(p, { replace: true })
  }

  const sprintPicker = (
    <TextField select label="Sprint" value={sprint?.id ?? ''} onChange={(e) => set({ sprint: e.target.value })} sx={{ minWidth: 220 }}>
      {[...sprints].reverse().map((s) => <MenuItem key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</MenuItem>)}
    </TextField>
  )
  const daysPicker = (
    <ToggleButtonGroup exclusive size="small" value={days} onChange={(_, v) => v && setDays(v)}>
      {[14, 30, 90].map((d) => <ToggleButton key={d} value={d}>{d} days</ToggleButton>)}
    </ToggleButtonGroup>
  )

  let body
  if (report === 'burndown') {
    if (!sprint) body = <EmptyState title="No sprint has started yet" />
    else {
      const inSprint = new Set([
        ...issues.filter((i) => i.sprint_id === sprint.id).map((i) => i.id),
        ...rows.filter((r) => r.sprint_id === sprint.id).map((r) => r.issue_id),
        ...events.filter((e) => e.field === 'sprint' && (e.to_id === sprint.id || e.from_id === sprint.id)).map((e) => e.issue_id),
      ])
      const relevant = issues.filter((i) => inSprint.has(i.id))
      const unit: Unit = unitFor(relevant, rows.filter((r) => r.sprint_id === sprint.id))
      const points = burndown(sprint, relevant, events, statuses, today, unit)
      body = (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {formatDateRange(sprint.start_date, sprint.end_date)} · in {unit === 'points' ? 'story points' : 'issues (nothing is estimated)'}
          </Typography>
          <LineChart title="Sprint burndown" labels={points.map((p) => short(p.day))} series={[
            { label: 'Remaining', color: '#e2483d', values: points.map((p) => p.remaining) },
            { label: 'Guideline', color: '#8590a2', values: points.map((p) => p.ideal), dashed: true },
          ]} />
        </>
      )
    }
  } else if (report === 'velocity') {
    const unit: Unit = rows.some((r) => (r.points_at_start ?? 0) > 0 || (r.points_at_end ?? 0) > 0) ? 'points' : 'issues'
    const v = velocity(meta.sprints, rows, unit).slice(-8)
    body = v.length ? (
      <>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 6, md: 3 }}><StatTile value={formatPoints(average(v.map((x) => x.completed)))} label={`average completed (${unit})`} /></Grid>
          <Grid size={{ xs: 6, md: 3 }}><StatTile value={formatPoints(average(v.map((x) => x.committed)))} label={`average committed (${unit})`} /></Grid>
        </Grid>
        <BarChart title="Velocity" labels={v.map((x) => x.sprint.name)} series={[
          { label: 'Committed', color: '#c1c7d0', values: v.map((x) => x.committed) },
          { label: 'Completed', color: '#22a06b', values: v.map((x) => x.completed) },
        ]} />
      </>
    ) : <EmptyState title="No completed sprints yet">Velocity appears once a sprint is completed.</EmptyState>
  } else if (report === 'sprint') {
    if (!sprint) body = <EmptyState title="No sprint has started yet" />
    else {
      const r = sprintReport(sprint.id, rows)
      const byId = new Map(issues.map((i) => [i.id, i]))
      const list = (title: string, ids: string[]) => (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{title} ({ids.length})</Typography>
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            {ids.map((id) => byId.get(id)).filter((i): i is Issue => !!i).map((i) => <BacklogRow key={i.id} issue={i} moves={[]} draggable={false} />)}
            {!ids.length && <Typography variant="body2" sx={{ color: 'text.secondary', p: 1.5 }}>None.</Typography>}
          </Paper>
        </Box>
      )
      body = sprint.state === 'closed' ? (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {formatDateRange(sprint.start_date, sprint.end_date)}{sprint.goal ? ` · ${sprint.goal}` : ''}
          </Typography>
          {list('Completed', r.completed)}
          {list('Not completed', r.notCompleted)}
          {list('Added after the sprint started', r.added)}
          {list('Removed before it ended', r.removed)}
        </>
      ) : (
        <EmptyState title={`${sprint.name} is still running`}>The report is written when the sprint is completed; see the burndown meanwhile.</EmptyState>
      )
    }
  } else if (report === 'created') {
    const series = createdVsResolved(issues, days, today)
    body = <LineChart title="Created vs resolved" labels={series.map((p) => short(p.day))} series={[
      { label: 'Created', color: '#e2483d', values: series.map((p) => p.created) },
      { label: 'Resolved', color: '#22a06b', values: series.map((p) => p.resolved) },
    ]} />
  } else {
    const flow = cumulativeFlow(issues, events, statuses, days, today)
    body = <StackedAreaChart title="Cumulative flow" labels={flow.map((p) => short(p.day))}
      series={(['done', 'in_progress', 'todo'] as const).map((c) => ({ label: CATEGORY_LABELS[c], color: CATEGORY_HEX[c], values: flow.map((p) => p[c]) }))} />
  }

  const info = REPORTS.find((r) => r.key === report)!
  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <TextField select label="Report" value={report} onChange={(e) => set({ report: e.target.value })} sx={{ minWidth: 220 }}>
          {available.map((r) => <MenuItem key={r.key} value={r.key}>{r.label}</MenuItem>)}
        </TextField>
        {(report === 'burndown' || report === 'sprint') && sprints.length > 0 && sprintPicker}
        {(report === 'created' || report === 'flow') && daysPicker}
      </Stack>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6">{info.label}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>{info.help}</Typography>
        {body}
      </Paper>
    </Box>
  )
}
