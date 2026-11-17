// The latest changes to the project's issues.
import { Link } from 'react-router-dom'
import { Link as MuiLink, Stack, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { timeAgo } from '../../lib/constants'
import type { IssueEvent } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { featureOn } from '../../lib/projectFeatures'
import { PersonAvatar } from '../common'
import { useIssueHref } from '../useIssueHref'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { LoadError, Quiet } from './parts'
import { must, useWidgetQuery } from './useWidgetQuery'

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

export default function ActivityWidget({ project, header }: WidgetProps) {
  const { profileById } = useWorkspace()
  const href = useIssueHref()
  const q = useWidgetQuery(`${project.id}:activity`, async () => {
    const events = must(await supabase.from('issue_events').select('*').eq('project_id', project.id)
      .order('created_at', { ascending: false }).limit(10)) as IssueEvent[]
    const ids = [...new Set(events.map((e) => e.issue_id))]
    const issues = ids.length
      ? must(await supabase.from('issues').select('id, key, title').in('id', ids)) as { id: string; key: string; title: string }[]
      : []
    return { events, issues: new Map(issues.map((i) => [i.id, i])) }
  })

  if (q.error) return <>{header()}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading) return <>{header()}<WidgetLoading /></>
  // A project with Releases off doesn't mention them.
  const events = q.data!.events.filter((e) => e.field !== 'release' || featureOn(project, 'releases'))
  if (!events.length) return <>{header()}<Quiet>Nothing yet.</Quiet></>

  return (
    <>
      {header()}
      <Stack spacing={1.25}>
        {events.map((e) => {
          const issue = q.data!.issues.get(e.issue_id)
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
    </>
  )
}
