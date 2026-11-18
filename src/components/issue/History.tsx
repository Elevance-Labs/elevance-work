import { Stack, Typography } from '@mui/material'
import { formatDayTime, timeAgo } from '../../lib/constants'
import { HISTORY_FIELD_LABELS, flagChange, historyValue } from '../../lib/issues'
import type { IssueEvent } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { PersonAvatar } from '../common'

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
                    : e.field === 'flag'
                      ? flagChange(e.from_value, e.to_value)
                      : <>changed <strong>{HISTORY_FIELD_LABELS[e.field] ?? e.field}</strong></>}
              </Typography>
              {/* A flag: its reason (on removal, the one it had). */}
              {e.field === 'flag' && (
                <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
                  {e.from_value && e.to_value ? `${e.from_value} → ${e.to_value}` : e.to_value ?? e.from_value}
                </Typography>
              )}
              {e.field !== 'created' && e.field !== 'description' && e.field !== 'flag' && (
                <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                  {historyValue(e.field, e.from_value)} → {historyValue(e.field, e.to_value)}
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
