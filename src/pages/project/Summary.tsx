// A project at a glance: the last seven days, where the work stands, who
// holds it, how the epics and the sprint are going, and what just happened.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Box, Grid, LinearProgress, Link as MuiLink, Paper, Stack, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { CATEGORY_HEX, CATEGORY_LABELS, PRIORITIES, PRIORITY_HEX, PRIORITY_LABELS, formatDate, formatDateRange, timeAgo, todayIso } from '../../lib/constants'
import { ISSUE_COLUMNS, categoryOf } from '../../lib/issues'
import { breakdown, recentCounts, timeProgress, workload } from '../../lib/reports'
import type { Issue, IssueEvent, StatusCategory } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { useIssueChanges } from '../../workspace/issueEvents'
import { Loading, PersonAvatar, PersonName, Section } from '../../components/common'
import { BarList, Donut, StatTile } from '../../components/charts'
import { PriorityIcon, TypeIcon } from '../../components/IssueBits'
import { useIssueHref } from '../../components/useIssueHref'
import { useProject } from './projectContext'

const FIELD_VERBS: Record<string, string> = {
  created: 'created',
  status: 'moved',
  assignee: 'reassigned',
  priority: 'reprioritised',
  sprint: 'replanned',
  release: 'changed the release of',
  title: 'renamed',
  description: 'updated',
  story_points: 're-estimated',
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Section title={title} action={action}>{children}</Section>
    </Paper>
  )
}

export default function Summary() {
  const { project } = useProject()
  const { statusesOf, typeById, profileById, issueTypes } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const href = useIssueHref()
  const statuses = statusesOf(project.id)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [events, setEvents] = useState<IssueEvent[]>([])

  const load = useCallback(async () => {
    const [i, e] = await Promise.all([
      supabase.from('issues').select(ISSUE_COLUMNS).eq('project_id', project.id),
      supabase.from('issue_events').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(25),
    ])
    setIssues((i.data ?? []) as unknown as Issue[])
    setEvents((e.data ?? []) as IssueEvent[])
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])
  useIssueChanges(() => load())

  if (!issues) return <Loading />
  const today = todayIso()
  const counts = recentCounts(issues, today)
  const byCategory = breakdown(issues, (i) => categoryOf(i, statuses), ['todo', 'in_progress', 'done'])
  const byStatus = breakdown(issues, (i) => i.status_id, statuses.map((s) => s.id))
  const byPriority = breakdown(issues.filter((i) => !i.resolved_at), (i) => i.priority, PRIORITIES)
  const byType = breakdown(issues, (i) => i.type_id)
  const load_ = workload(issues)
  const epicLevel = new Set(issueTypes.filter((t) => t.level === 'epic').map((t) => t.id))
  const epics = issues.filter((i) => epicLevel.has(i.type_id) && !i.resolved_at)
  const sprint = meta?.sprints.find((s) => s.state === 'active')
  const sprintIssues = sprint ? issues.filter((i) => i.sprint_id === sprint.id) : []
  const sprintDone = sprintIssues.filter((i) => categoryOf(i, statuses) === 'done').length
  const releases = (meta?.releases ?? []).filter((r) => r.status === 'unreleased').slice(0, 4)
  const issueByKey = new Map(issues.map((i) => [i.id, i]))

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 6, md: 3 }}><StatTile value={counts.created} label="created" hint="in the last 7 days" /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><StatTile value={counts.updated} label="updated" hint="in the last 7 days" /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><StatTile value={counts.resolved} label="completed" hint="in the last 7 days" /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><StatTile value={counts.dueSoon} label="due soon" hint="in the next 7 days" /></Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Card title="Status overview">
          {issues.length ? (
            <Donut
              title="Issues by status category"
              slices={byCategory.map((s) => ({ label: CATEGORY_LABELS[s.key as StatusCategory], value: s.count, color: CATEGORY_HEX[s.key as StatusCategory] }))}
              center={<Box><Typography variant="h5">{issues.length}</Typography><Typography variant="caption" sx={{ color: 'text.secondary' }}>issues</Typography></Box>}
            />
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>No issues yet.</Typography>
          )}
          {byStatus.length > 0 && (
            <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 2 }}>
              {byStatus.map((s) => `${statuses.find((x) => x.id === s.key)?.name}: ${s.count}`).join(' · ')}
            </Typography>
          )}
        </Card>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Card title="Open work by priority">
          <BarList rows={byPriority.map((p) => ({
            label: <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><PriorityIcon priority={p.key as Issue['priority']} /><Typography variant="body2">{PRIORITY_LABELS[p.key as Issue['priority']]}</Typography></Stack>,
            value: p.count,
            color: PRIORITY_HEX[p.key as Issue['priority']],
          }))} />
          {!byPriority.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing open.</Typography>}
        </Card>
      </Grid>

      {sprint && (
        <Grid size={{ xs: 12, md: 6 }}>
          <Card title="Active sprint" action={<MuiLink component={Link} to={`/projects/${project.key}/board`} variant="body2">Board</MuiLink>}>
            <Typography variant="subtitle1">{sprint.name}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
              {formatDateRange(sprint.start_date, sprint.end_date)}{sprint.goal ? ` · ${sprint.goal}` : ''}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{sprintDone} of {sprintIssues.length} issues done</Typography>
            <LinearProgress variant="determinate" color="success" value={sprintIssues.length ? (sprintDone / sprintIssues.length) * 100 : 0} sx={{ mb: 1, height: 8, borderRadius: 4 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Time elapsed</Typography>
            <LinearProgress variant="determinate" value={(timeProgress(sprint.start_date, sprint.end_date, today) ?? 0) * 100} sx={{ height: 8, borderRadius: 4 }} />
          </Card>
        </Grid>
      )}

      <Grid size={{ xs: 12, md: 6 }}>
        <Card title="Team workload">
          <BarList total={issues.filter((i) => !i.resolved_at).length || 1} rows={load_.map((w) => ({
            label: <PersonName person={profileById(w.assignee)} size={22} />,
            value: w.issues,
            hint: `${w.points} points open`,
          }))} />
          {!load_.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing open.</Typography>}
        </Card>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Card title="Types of work">
          <BarList total={issues.length || 1} rows={byType.map((t) => ({
            label: <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><TypeIcon type={typeById(t.key)} /><Typography variant="body2">{typeById(t.key)?.name}</Typography></Stack>,
            value: t.count,
            color: typeById(t.key)?.color,
          }))} />
        </Card>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Card title="Epic progress">
          {!epics.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>No open epics.</Typography>}
          <Stack spacing={1.5}>
            {epics.map((e) => {
              const children = issues.filter((i) => i.parent_id === e.id)
              const done = children.filter((c) => categoryOf(c, statuses) === 'done').length
              return (
                <Box key={e.id}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                    <TypeIcon type={typeById(e.type_id)} />
                    <Typography component={Link} to={href(e.key)} variant="body2" noWrap sx={{ flexGrow: 1, color: 'text.primary', textDecoration: 'none' }}>{e.title}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{done}/{children.length}</Typography>
                  </Stack>
                  <LinearProgress variant="determinate" color="success" value={children.length ? (done / children.length) * 100 : 0} sx={{ height: 6, borderRadius: 3 }} />
                </Box>
              )
            })}
          </Stack>
        </Card>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Card title="Upcoming releases" action={<MuiLink component={Link} to={`/projects/${project.key}/releases`} variant="body2">All releases</MuiLink>}>
          {!releases.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>None planned.</Typography>}
          <Stack spacing={1}>
            {releases.map((r) => {
              const rIssues = issues.filter((i) => i.release_id === r.id)
              const done = rIssues.filter((i) => categoryOf(i, statuses) === 'done').length
              return (
                <Stack key={r.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <MuiLink component={Link} to={`/projects/${project.key}/releases/${r.id}`} variant="body2" sx={{ fontWeight: 500, flexGrow: 1 }}>{r.name}</MuiLink>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{done}/{rIssues.length} done · {formatDate(r.release_date)}</Typography>
                </Stack>
              )
            })}
          </Stack>
        </Card>
      </Grid>

      <Grid size={12}>
        <Card title="Recent activity">
          {!events.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing yet.</Typography>}
          <Stack spacing={1.25}>
            {events.map((e) => {
              const issue = issueByKey.get(e.issue_id)
              const actor = profileById(e.actor_id)
              return (
                <Stack key={e.id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <PersonAvatar person={actor} size={26} />
                  <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                    <strong>{actor?.full_name ?? 'Someone'}</strong> {FIELD_VERBS[e.field] ?? 'changed'}{' '}
                    {issue ? <MuiLink component={Link} to={href(issue.key)}>{issue.key} {issue.title}</MuiLink> : 'an issue'}
                    {e.field === 'status' && e.to_value ? ` to ${e.to_value}` : ''}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{timeAgo(e.created_at)}</Typography>
                </Stack>
              )
            })}
          </Stack>
        </Card>
      </Grid>
    </Grid>
  )
}
