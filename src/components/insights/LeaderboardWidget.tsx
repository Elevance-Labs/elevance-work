// Who finished the most lately: this sprint (Scrum, while one runs) or the
// last 30 days, by points (issues when nothing is estimated), then by how
// much of it was on time.
import { Box, Stack, Typography } from '@mui/material'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import { addDays, formatPoints, isoDate, todayIso } from '../../lib/constants'
import { leaderboard, personStats } from '../../lib/insights'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { PersonName } from '../common'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { LoadError, Quiet } from './parts'
import { loadFinished } from './data'
import { useWidgetQuery } from './useWidgetQuery'

// Gold, silver, bronze: data colours, the same in both modes.
const MEDALS = ['#d4a017', '#9ea7b3', '#b0773c']

export default function LeaderboardWidget({ project, header }: WidgetProps) {
  const { statusesOf, issueTypes, profileById } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const today = todayIso()
  const sprint = project.kind === 'scrum' ? meta?.sprints.find((s) => s.state === 'active' && s.started_at) : undefined
  const window_ = sprint ? { from: isoDate(new Date(sprint.started_at!)), to: today } : { from: addDays(today, -29), to: today }

  const q = useWidgetQuery(meta ? `${project.id}:people:${window_.from}:${window_.to}` : null,
    () => loadFinished(project.id, window_, issueTypes))

  const scope = <Typography variant="caption" sx={{ color: 'text.secondary' }}>{sprint ? sprint.name : 'Last 30 days'}</Typography>
  if (q.error) return <>{header(scope)}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading || !meta) return <>{header(scope)}<WidgetLoading /></>
  const { unit, rows } = leaderboard(personStats(q.data!.items, q.data!.sprintRows, meta.sprints, q.data!.byIssue, statuses))
  if (!rows.length) return <>{header(scope)}<Quiet>Nothing finished yet {sprint ? 'this sprint' : 'in the last 30 days'}.</Quiet></>

  return (
    <>
      {header(scope)}
      <Stack spacing={1}>
        {rows.slice(0, 10).map((s, i) => (
          <Stack key={s.assignee} direction="row" spacing={1.5} sx={{ alignItems: 'center' }} data-rank={i + 1}>
            <Box sx={{ width: 24, textAlign: 'center', flexShrink: 0 }}>
              {i < 3
                ? <EmojiEventsIcon sx={{ color: MEDALS[i], fontSize: 20, verticalAlign: 'middle' }} titleAccess={`Number ${i + 1}`} />
                : <Typography variant="body2" sx={{ color: 'text.secondary' }}>{i + 1}</Typography>}
            </Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}><PersonName person={profileById(s.assignee)} size={24} /></Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {unit === 'points' ? `${formatPoints(s.points)} pts` : `${s.issues} done`}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', width: 72, textAlign: 'right' }}>
              {s.rate === null ? '—' : `${Math.round(s.rate * 100)}% on time`}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </>
  )
}
