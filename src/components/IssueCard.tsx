// An issue as a card, on the board; and as a compact row, on the backlog.
// Both can be dragged (dnd-kit sortable) and both carry a menu with the same
// moves, for touch screens, keyboards and anyone who'd rather not drag.
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box, Chip, IconButton, Menu, MenuItem, Paper, Stack, Typography, ListSubheader } from '@mui/material'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import { formatDate, todayIso } from '../lib/constants'
import type { Issue } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { PersonAvatar } from './common'
import { Labels, Points, PriorityIcon, StatusLozenge, TypeIcon } from './IssueBits'
import { useIssueHref } from './useIssueHref'

export interface MoveOption {
  label: string
  onSelect: () => void
  disabled?: boolean
}

export interface MoveGroup {
  title: string
  options: MoveOption[]
}

function MoveMenu({ issue, groups }: { issue: Issue; groups: MoveGroup[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!groups.length) return null
  return (
    <>
      <IconButton
        size="small"
        aria-label={`Move ${issue.key}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setAnchor(e.currentTarget)
        }}
        sx={{ p: 0.25 }}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        {groups.flatMap((g) => [
          <ListSubheader key={`h-${g.title}`} sx={{ lineHeight: '32px' }}>{g.title}</ListSubheader>,
          ...g.options.map((o) => (
            <MenuItem key={`${g.title}-${o.label}`} disabled={o.disabled} dense onClick={() => { setAnchor(null); o.onSelect() }}>
              {o.label}
            </MenuItem>
          )),
        ])}
      </Menu>
    </>
  )
}

function useDraggable(id: string, disabled: boolean) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  return {
    ref: setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 },
    handle: disabled ? {} : { ...attributes, ...listeners },
  }
}

export function BoardCard({ issue, moves, draggable = true, overlay }: { issue: Issue; moves: MoveGroup[]; draggable?: boolean; overlay?: boolean }) {
  const { typeById, profileById, statusById } = useWorkspace()
  const href = useIssueHref()
  const d = useDraggable(issue.id, !draggable || !!overlay)
  const done = statusById(issue.status_id)?.category === 'done'
  const overdue = !!issue.due_date && !done && issue.due_date < todayIso()
  return (
    <Paper
      ref={overlay ? undefined : d.ref}
      style={overlay ? undefined : d.style}
      {...d.handle}
      variant="outlined"
      data-issue={issue.key}
      sx={{
        p: 1.25,
        cursor: draggable ? 'grab' : 'pointer',
        touchAction: 'manipulation',
        boxShadow: overlay ? 6 : 0,
        '&:hover': { borderColor: 'primary.light' },
      }}
    >
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
        <Typography
          component={Link}
          to={href(issue.key)}
          variant="body2"
          sx={{ flexGrow: 1, color: 'text.primary', textDecoration: done ? 'line-through' : 'none', overflowWrap: 'anywhere',
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {issue.title}
        </Typography>
        <MoveMenu issue={issue} groups={moves} />
      </Stack>
      <Box sx={{ my: 0.75 }}><Labels labels={issue.labels} max={2} /></Box>
      {issue.due_date && (
        <Chip size="small" label={formatDate(issue.due_date, false)} color={overdue ? 'error' : 'default'} variant="outlined"
          sx={{ height: 20, fontSize: 11, mb: 0.75 }} />
      )}
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        <TypeIcon type={typeById(issue.type_id)} size={16} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, flexGrow: 1 }} noWrap>
          {issue.key}
        </Typography>
        <Points value={issue.story_points} />
        <PriorityIcon priority={issue.priority} size={18} />
        <PersonAvatar person={profileById(issue.assignee_id)} size={22} tooltip />
      </Stack>
    </Paper>
  )
}

export function BacklogRow({
  issue,
  moves,
  draggable = true,
  overlay,
  extra,
}: {
  issue: Issue
  moves: MoveGroup[]
  draggable?: boolean
  overlay?: boolean
  extra?: ReactNode
}) {
  const { typeById, profileById, statusById } = useWorkspace()
  const href = useIssueHref()
  const d = useDraggable(issue.id, !draggable || !!overlay)
  return (
    <Box
      ref={overlay ? undefined : d.ref}
      style={overlay ? undefined : d.style}
      {...d.handle}
      data-issue={issue.key}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.75,
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'divider',
        cursor: draggable ? 'grab' : 'default',
        touchAction: 'manipulation',
        boxShadow: overlay ? 6 : 0,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <TypeIcon type={typeById(issue.type_id)} />
      <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500, whiteSpace: 'nowrap' }}>{issue.key}</Typography>
      <Typography component={Link} to={href(issue.key)} variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0, color: 'text.primary', textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' } }}>
        {issue.title}
      </Typography>
      {extra}
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 1 }}>
        <Labels labels={issue.labels} max={1} />
        <StatusLozenge status={statusById(issue.status_id)} />
      </Box>
      <Points value={issue.story_points} />
      <PriorityIcon priority={issue.priority} size={18} />
      <PersonAvatar person={profileById(issue.assignee_id)} size={22} tooltip />
      <MoveMenu issue={issue} groups={moves} />
    </Box>
  )
}
