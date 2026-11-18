// One issue on a line, opening it: type, key, title, due date (red when
// late), status and priority; tinted and marked when flagged. Home's and Work's lists; an optional second
// line says something more (Work's Recent activity: who did what, when).
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Box, Stack, Typography } from '@mui/material'
import { formatDate, todayIso } from '../lib/constants'
import type { Issue } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { FlagMark, PriorityIcon, StatusLozenge, TypeIcon } from './IssueBits'
import { flaggedSx } from './issue/flagging'
import { useIssueHref } from './useIssueHref'

export default function IssueRow({ issue: i, below }: { issue: Issue; below?: ReactNode }) {
  const { typeById, statusById } = useWorkspace()
  const href = useIssueHref()
  const late = !!i.due_date && i.due_date < todayIso()
  return (
    <Stack direction="row" spacing={1} component={Link} to={href(i.key)} data-issue={i.key}
      sx={[{ alignItems: below ? 'flex-start' : 'center', py: 0.75, px: 1, borderRadius: 1, textDecoration: 'none', color: 'inherit',
        '&:hover': { bgcolor: 'action.hover' } }, flaggedSx(i)]}>
      <Box sx={{ display: 'flex', pt: below ? 0.25 : 0 }}><TypeIcon type={typeById(i.type_id)} /></Box>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{i.key}</Typography>
          <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>{i.title}</Typography>
          <FlagMark issue={i} />
        </Stack>
        {below && <Typography variant="caption" component="div" noWrap sx={{ color: 'text.secondary' }}>{below}</Typography>}
      </Box>
      {i.due_date && (
        <Typography variant="caption" sx={{ color: late ? 'error.main' : 'text.secondary', whiteSpace: 'nowrap', pt: below ? 0.25 : 0 }}>
          {late ? 'Overdue · ' : ''}{formatDate(i.due_date, false)}
        </Typography>
      )}
      <Box sx={{ display: { xs: 'none', sm: 'block' } }}><StatusLozenge status={statusById(i.status_id)} /></Box>
      <PriorityIcon priority={i.priority} />
    </Stack>
  )
}
