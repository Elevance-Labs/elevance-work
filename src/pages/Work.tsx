// Work: your projects, then your issues. The projects you belong to (all of
// them for a workspace admin; "All projects" adds the open ones) as cards
// with their active sprint's progress, side by side on a phone. Under them
// two tabs, kept in the address (?tab=): the open issues assigned to you,
// and Recent activity on the issues you watch (you watch what you report,
// are assigned or comment on), each with who last did what.
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import { useAuth, useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { PROJECT_KIND_LABELS, errorMessage, formatDate, timeAgo } from '../lib/constants'
import { ISSUE_COLUMNS, activityLine, categoryOf } from '../lib/issues'
import type { Issue, Project, WatchedActivity } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { useIssueChanges } from '../workspace/issueEvents'
import { EmptyState, Loading, PageHeader } from '../components/common'
import { ProjectAvatar } from '../components/IssueBits'
import IssueRow from '../components/IssueRow'
import CreateProject from '../components/CreateProject'

type SprintIssue = Pick<Issue, 'id' | 'status_id' | 'sprint_id'>

function ProjectCard({ project: p, sprintIssues, compact }: { project: Project; sprintIssues: SprintIssue[]; compact: boolean }) {
  const { activeSprints, statusesOf } = useWorkspace()
  const sprint = activeSprints.find((s) => s.project_id === p.id)
  const list = sprint ? sprintIssues.filter((i) => i.sprint_id === sprint.id) : []
  const done = list.filter((i) => categoryOf(i, statusesOf(p.id)) === 'done').length
  return (
    <Card variant="outlined" data-project={p.key}
      sx={{ height: '100%', opacity: p.archived_at ? 0.7 : 1, ...(compact && { width: 220, flexShrink: 0, scrollSnapAlign: 'start' }) }}>
      <CardActionArea component={Link} to={`/projects/${p.key}`} sx={{ p: compact ? 1.5 : 2, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
          <ProjectAvatar project={p} size={compact ? 28 : 36} />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="subtitle2" noWrap>{p.name}</Typography>
            <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }} noWrap>
              {p.key} · {PROJECT_KIND_LABELS[p.kind]}{p.archived_at ? ' · Archived' : ''}
            </Typography>
          </Box>
        </Stack>
        {sprint ? (
          <Box sx={{ mt: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: 'baseline' }}>
              <Typography variant="caption" noWrap sx={{ flexGrow: 1, fontWeight: 600 }}>{sprint.name}</Typography>
              {sprint.end_date && <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>ends {formatDate(sprint.end_date, false)}</Typography>}
            </Stack>
            <LinearProgress variant="determinate" color="success" value={list.length ? (done / list.length) * 100 : 0}
              aria-label={`${sprint.name}: ${done} of ${list.length} done`} sx={{ height: 6, borderRadius: 3 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{done} of {list.length} done</Typography>
          </Box>
        ) : !compact && p.description ? (
          <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {p.description}
          </Typography>
        ) : null}
      </CardActionArea>
    </Card>
  )
}

type TabKey = 'mine' | 'activity'

export default function Work() {
  const me = useMe()
  const { isAdmin } = useAuth()
  const { projects, memberships, activeSprints, profileById } = useWorkspace()
  const theme = useTheme()
  const phone = !useMediaQuery(theme.breakpoints.up('md'))
  const [params, setParams] = useSearchParams()
  const tab: TabKey = params.get('tab') === 'activity' ? 'activity' : 'mine'
  const [all, setAll] = useState(false)
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [sprintIssues, setSprintIssues] = useState<SprintIssue[]>([])
  const [mine, setMine] = useState<Issue[] | null>(null)
  const [activity, setActivity] = useState<{ a: WatchedActivity; issue: Issue }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const member = new Set(memberships.map((m) => m.project_id))
  // Open projects you aren't in: only worth a toggle when there are some.
  const others = !isAdmin && projects.some((p) => !member.has(p.id) && !p.archived_at)
  const shown = projects.filter((p) => (archived || !p.archived_at) && (isAdmin || all || member.has(p.id)))
  const sprintIds = activeSprints.filter((s) => shown.some((p) => p.id === s.project_id)).map((s) => s.id).join(',')

  useEffect(() => {
    if (!sprintIds) return setSprintIssues([])
    supabase.from('issues').select('id, status_id, sprint_id').in('sprint_id', sprintIds.split(','))
      .then(({ data }) => setSprintIssues((data ?? []) as SprintIssue[]))
  }, [sprintIds])

  const loadMine = useCallback(async () => {
    const { data, error: e } = await supabase.from('issues').select(ISSUE_COLUMNS).eq('assignee_id', me.id).is('resolved_at', null)
      .order('priority').order('due_date', { nullsFirst: false }).limit(50)
    if (e) setError(errorMessage(e))
    setMine((data ?? []) as unknown as Issue[])
  }, [me.id])

  const loadActivity = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('watched_activity', { p_limit: 50 })
    if (e) {
      setError(errorMessage(e))
      return setActivity([])
    }
    const rows = (data ?? []) as WatchedActivity[]
    if (!rows.length) return setActivity([])
    const { data: issues } = await supabase.from('issues').select(ISSUE_COLUMNS).in('id', rows.map((r) => r.issue_id))
    const byId = new Map(((issues ?? []) as unknown as Issue[]).map((i) => [i.id, i]))
    setActivity(rows.flatMap((a) => (byId.has(a.issue_id) ? [{ a, issue: byId.get(a.issue_id)! }] : [])))
  }, [])

  const load = useCallback(() => (tab === 'mine' ? loadMine() : loadActivity()), [tab, loadMine, loadActivity])
  useEffect(() => {
    load()
  }, [load])
  useIssueChanges(() => load())

  const setTab = (t: TabKey) => {
    const next = new URLSearchParams(params)
    if (t === 'mine') next.delete('tab')
    else next.set('tab', t)
    setParams(next, { replace: true })
  }

  const who = (id: string | null) => (id === me.id ? 'You' : profileById(id)?.full_name ?? 'Someone')

  return (
    <>
      <PageHeader
        title="Work"
        actions={isAdmin && (
          <Button variant="contained" size={phone ? 'small' : 'medium'} startIcon={<AddIcon />} onClick={() => setCreating(true)}>
            {phone ? 'Project' : 'Create project'}
          </Button>
        )}
      />

      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{isAdmin || all ? 'Projects' : 'Your projects'}</Typography>
        {others && <Chip size="small" label="All projects" variant={all ? 'filled' : 'outlined'} color={all ? 'primary' : 'default'}
          onClick={() => setAll((v) => !v)} aria-pressed={all} />}
        {projects.some((p) => p.archived_at) && (
          <Chip size="small" label="Archived" variant={archived ? 'filled' : 'outlined'} color={archived ? 'primary' : 'default'}
            onClick={() => setArchived((v) => !v)} aria-pressed={archived} />
        )}
      </Stack>
      {!shown.length ? (
        <EmptyState icon={<FolderOutlinedIcon />} title={others ? 'You aren’t in a project yet' : 'No projects yet'}>
          {isAdmin ? 'Create the first one.' : others ? 'All projects shows the open ones. Ask a workspace admin to add you to one.'
            : 'Ask a workspace admin to add you to one.'}
        </EmptyState>
      ) : (
        <Box data-projects
          sx={phone
            ? { display: 'flex', gap: 1.5, overflowX: 'auto', scrollSnapType: 'x mandatory', mx: -2, px: 2, pb: 1 }
            : { display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {shown.map((p) => <ProjectCard key={p.id} project={p} sprintIssues={sprintIssues} compact={phone} />)}
        </Box>
      )}

      <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)} variant={phone ? 'fullWidth' : 'standard'}
        sx={{ mt: 3, mb: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="mine" label={`My issues${tab === 'mine' && mine ? ` (${mine.length})` : ''}`} />
        <Tab value="activity" label="Recent activity" />
      </Tabs>
      {error && <Typography variant="body2" sx={{ color: 'error.main', my: 1 }}>{error}</Typography>}

      {tab === 'mine' && (!mine ? <Loading /> : (
        <>
          {!mine.length && <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>Nothing open is assigned to you.</Typography>}
          <Stack spacing={0.25}>{mine.map((i) => <IssueRow key={i.id} issue={i} />)}</Stack>
          {mine.length > 0 && (
            <Button size="small" component={Link} to="/issues?assignees=me&resolution=unresolved" sx={{ mt: 1 }}>View in Issues</Button>
          )}
        </>
      ))}

      {tab === 'activity' && (!activity ? <Loading /> : (
        <>
          {!activity.length && (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
              Nothing yet. You watch the issues you report, are assigned or comment on, and anything you watch from an issue.
            </Typography>
          )}
          <Stack spacing={0.25} data-activity>
            {activity.map(({ a, issue }) => (
              <IssueRow key={issue.id} issue={issue} below={`${who(a.actor_id)} ${activityLine(a)} · ${timeAgo(a.at)}`} />
            ))}
          </Stack>
        </>
      ))}

      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </>
  )
}
