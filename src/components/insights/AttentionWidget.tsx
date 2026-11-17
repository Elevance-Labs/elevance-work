// Open work someone should look at today, worst first, each with why:
// blocked, overdue, in progress for longer than the team usually takes, or
// in the sprint or next release with nobody on it or no estimate.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Chip, Stack, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { todayIso } from '../../lib/constants'
import { fetchAll } from '../../lib/paging'
import { agingThreshold, cycleDays, formatDays, needsAttention, nextRelease, workItems, type AttentionKind } from '../../lib/insights'
import { featureOn } from '../../lib/projectFeatures'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { PriorityIcon, TypeIcon } from '../IssueBits'
import { useIssueHref } from '../useIssueHref'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { INSIGHT_COLUMNS, asIssues, loadRecentWork, openBlockers, recentWorkKey, statusEvents } from './data'
import { LoadError, Quiet } from './parts'
import { must, useWidgetQuery } from './useWidgetQuery'

const SHOWN = 6
const COLOR: Record<AttentionKind, 'error' | 'warning' | 'default'> = {
  blocked: 'error', overdue: 'error', aging: 'warning', unassigned: 'default', unestimated: 'default',
}

export default function AttentionWidget({ project, header }: WidgetProps) {
  const { statusesOf, issueTypes, typeById } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const href = useIssueHref()
  const statuses = statusesOf(project.id)
  const today = todayIso()
  const [all, setAll] = useState(false)

  const open = useWidgetQuery(`${project.id}:open`, async () => {
    const rows = asIssues(must(await fetchAll((from, to) =>
      supabase.from('issues').select(INSIGHT_COLUMNS).eq('project_id', project.id).is('resolved_at', null).order('id').range(from, to))))
    const inProgress = new Set(statuses.filter((s) => s.category === 'in_progress').map((s) => s.id))
    const [byIssue, blockers] = await Promise.all([
      statusEvents(rows.filter((i) => inProgress.has(i.status_id)).map((i) => i.id)),
      openBlockers(rows.map((i) => i.id)),
    ])
    return { rows, byIssue, blockers, asOf: Date.now() }
  })
  const recent = useWidgetQuery(recentWorkKey(project.id, today), () => loadRecentWork(project.id, today))

  const error = open.error ?? recent.error
  if (error) return <>{header()}<LoadError message={error} onRetry={() => { open.retry(); recent.retry() }} /></>
  if (open.loading || recent.loading || !meta) return <>{header()}<WidgetLoading /></>

  const items = open.data!.rows.filter((i) => typeById(i.type_id)?.level !== 'epic')
  const sprint = meta.sprints.find((s) => s.state === 'active')
  const release = featureOn(project, 'releases') ? nextRelease(meta.releases) : null
  const focus = new Set(items.filter((i) => (sprint && i.sprint_id === sprint.id) || (release && i.release_id === release.id)).map((i) => i.id))
  const finished = workItems(recent.data!.resolved, issueTypes)
  const agingDays = agingThreshold(finished.map((i) => cycleDays(i, recent.data!.byIssue, statuses)!))
  const list = needsAttention({
    open: items,
    byIssue: open.data!.byIssue,
    statuses,
    blockers: open.data!.blockers,
    focus,
    usesPoints: items.some((i) => (i.story_points ?? 0) > 0),
    unestimated: new Set(items.filter((i) => typeById(i.type_id)?.level === 'subtask').map((i) => i.id)),
    agingDays,
    today,
    now: open.data!.asOf,
  })

  const shown = all ? list : list.slice(0, SHOWN)
  return (
    <>
      {header(list.length > 0 && <Chip size="small" label={list.length} color={list.some((a) => COLOR[a.reasons[0].kind] === 'error') ? 'error' : 'default'} />)}
      {!list.length ? (
        <Quiet>Nothing needs attention: nothing blocked, overdue or stuck.</Quiet>
      ) : (
        <Stack spacing={1}>
          {shown.map(({ issue, reasons }) => (
            <Box key={issue.id} component={Link} to={href(issue.key)}
              sx={{ display: 'block', color: 'inherit', textDecoration: 'none', p: 1, mx: -1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                <TypeIcon type={typeById(issue.type_id)} tooltip={false} />
                <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500, whiteSpace: 'nowrap' }}>{issue.key}</Typography>
                <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>{issue.title}</Typography>
                <PriorityIcon priority={issue.priority} size={18} />
              </Stack>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                {reasons.map((r) => <Chip key={r.kind} size="small" variant="outlined" color={COLOR[r.kind]} label={r.text} data-reason={r.kind} />)}
              </Stack>
            </Box>
          ))}
          {list.length > SHOWN && (
            <Box><Button size="small" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${list.length}`}</Button></Box>
          )}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            “In progress” flags work started more than {formatDays(agingDays)} ago
            {finished.length >= 5 ? ': longer than 85% of recent work took.' : ' (two weeks until there is more finished work to learn from).'}
          </Typography>
        </Stack>
      )}
    </>
  )
}
