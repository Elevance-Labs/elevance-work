// One line of Home's agenda. Meetings and releases are tinted in their
// colour, issues show their type and status, todos a box to tick.
import { Link } from 'react-router-dom'
import { Box, ButtonBase, Checkbox, Link as MuiLink, Stack, Tooltip, Typography, alpha } from '@mui/material'
import EditNoteIcon from '@mui/icons-material/EditNote'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined'
import { formatDate, formatTime } from '../../lib/constants'
import type { CalendarItem } from '../../lib/calendar'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { PriorityIcon, StatusLozenge, TypeIcon } from '../IssueBits'
import { useIssueHref } from '../useIssueHref'
import type { Entry, TodoRow } from './useAgenda'

export default function AgendaRow({ entry, today, noted, onTick, onOpen }: {
  entry: Entry
  today: string
  noted: Set<string>
  onTick: (t: TodoRow) => void
  onOpen: (item: CalendarItem) => void
}) {
  const { typeById, statusById } = useWorkspace()
  const href = useIssueHref()
  const row = { alignItems: 'center', minHeight: 40, py: 0.5, px: 1, borderRadius: 1 } as const

  if (entry.kind === 'calendar') {
    const { item } = entry
    const Icon = item.kind === 'release' ? RocketLaunchOutlinedIcon : EventOutlinedIcon
    const hasNote = item.meeting && noted.has(item.meeting.id)
    return (
      <ButtonBase onClick={() => onOpen(item)} data-agenda={item.kind}
        sx={{ ...row, display: 'flex', gap: 1.25, width: '100%', textAlign: 'left', bgcolor: alpha(item.color, 0.1),
          borderLeft: `3px solid ${item.color}`, borderRadius: '0 4px 4px 0', '&:hover': { bgcolor: alpha(item.color, 0.18) } }}>
        <Icon sx={{ fontSize: 18, color: item.color, flexShrink: 0 }} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" noWrap>{item.title}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{item.kind === 'release' ? 'Release' : 'Meeting'}</Typography>
        </Box>
        {hasNote && (
          <Tooltip title="You have notes on this meeting">
            <EditNoteIcon aria-label="Has your notes" sx={{ fontSize: 18, color: 'text.secondary' }} />
          </Tooltip>
        )}
        <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', fontWeight: 600 }}>
          {item.startsAt ? formatTime(item.startsAt.toISOString()) : 'All day'}
        </Typography>
      </ButtonBase>
    )
  }

  if (entry.kind === 'issue') {
    const { issue: i } = entry
    const overdue = !!i.due_date && i.due_date < today
    return (
      <Stack direction="row" spacing={1.25} component={Link} to={href(i.key)} data-agenda="issue"
        sx={{ ...row, textDecoration: 'none', color: 'inherit', border: 1, borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
        <TypeIcon type={typeById(i.type_id)} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline', minWidth: 0 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', fontWeight: 600 }}>{i.key}</Typography>
            <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{i.title}</Typography>
          </Stack>
          <Typography variant="caption" sx={{ color: overdue ? 'error.main' : 'text.secondary' }}>
            {overdue ? `Issue overdue · due ${formatDate(i.due_date, false)}` : 'Issue due'}
          </Typography>
        </Box>
        <Box sx={{ display: { xs: 'none', sm: 'block' } }}><StatusLozenge status={statusById(i.status_id)} /></Box>
        <PriorityIcon priority={i.priority} />
      </Stack>
    )
  }

  const { todo: t } = entry
  const overdue = !!t.due_on && t.due_on < today
  return (
    <Stack direction="row" spacing={0.5} data-agenda="todo" sx={{ ...row, pl: 0, border: 1, borderStyle: 'dashed', borderColor: 'divider' }}>
      <Checkbox size="small" checked={false} onChange={() => onTick(t)} slotProps={{ input: { 'aria-label': `Done: ${t.title}` } }} sx={{ p: 0.5 }} />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" noWrap>{t.title}</Typography>
        <Typography variant="caption" sx={{ color: overdue ? 'error.main' : 'text.secondary' }}>
          {overdue ? `Todo overdue · due ${formatDate(t.due_on, false)}` : 'Todo'}
        </Typography>
      </Box>
      {t.issue && (
        <MuiLink component={Link} to={href(t.issue.key)} variant="caption" sx={{ whiteSpace: 'nowrap' }}>{t.issue.key}</MuiLink>
      )}
    </Stack>
  )
}
