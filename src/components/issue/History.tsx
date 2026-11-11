import { Stack, Typography } from '@mui/material'
import { PRIORITY_LABELS, formatDate, formatDayTime, timeAgo } from '../../lib/constants'
import type { IssueEvent, IssuePriority } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { PersonAvatar } from '../common'

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  type: 'Type',
  sprint: 'Sprint',
  release: 'Release',
  parent: 'Parent',
  story_points: 'Story points',
  title: 'Summary',
  due_date: 'Due date',
  labels: 'Labels',
  description: 'Description',
}

function display(e: IssueEvent, v: string | null) {
  if (v === null || v === '') return 'None'
  if (e.field === 'priority') return PRIORITY_LABELS[v as IssuePriority] ?? v
  if (e.field === 'due_date') return formatDate(v)
  return v
}

export default function History({ events }: { events: IssueEvent[] }) {
  const { profileById } = useWorkspace()
  const sorted = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return (
    <Stack spacing={2}>
      {sorted.map((e) => {
        const actor = profileById(e.actor_id)
        return (
          <Stack key={e.id} direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <PersonAvatar person={actor} size={28} />
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="body2">
                <strong>{actor?.full_name ?? 'Someone'}</strong>{' '}
                {e.field === 'created'
                  ? 'created the issue'
                  : e.field === 'description'
                    ? 'updated the description'
                    : <>changed <strong>{FIELD_LABELS[e.field] ?? e.field}</strong></>}
              </Typography>
              {e.field !== 'created' && e.field !== 'description' && (
                <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                  {display(e, e.from_value)} → {display(e, e.to_value)}
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: 'text.secondary' }} title={formatDayTime(e.created_at)}>
                {timeAgo(e.created_at)}
              </Typography>
            </Stack>
          </Stack>
        )
      })}
    </Stack>
  )
}
