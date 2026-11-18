// An issue as a card, on the board; and as a compact row, on the backlog.
// Both can be dragged (dnd-kit sortable) and both carry a menu with the same
// moves, for touch screens, keyboards and anyone who'd rather not drag. A
// backlog row can be selected, to move several together.
import { useState, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box, Checkbox, Chip, IconButton, Menu, MenuItem, Paper, Stack, Typography, ListSubheader, alpha } from '@mui/material'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import { formatDate, todayIso } from '../lib/constants'
import type { PickMode } from '../lib/backlog'
import type { Issue } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { PersonAvatar } from './common'
import { FlagMark, Labels, Points, PriorityIcon, StatusLozenge, TypeIcon } from './IssueBits'
import { flaggedSx } from './issue/flagging'
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
      sx={[
        {
          p: 1.25,
          cursor: draggable ? 'grab' : 'pointer',
          touchAction: 'manipulation',
          boxShadow: overlay ? 6 : 0,
          '&:hover': { borderColor: 'primary.light' },
        },
        flaggedSx(issue),
        !!issue.flag_reason && { borderColor: 'warning.main' },
      ]}
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
        <FlagMark issue={issue} size={16} />
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
  selected = false,
  onPick,
}: {
  issue: Issue
  moves: MoveGroup[]
  draggable?: boolean
  overlay?: boolean
  extra?: ReactNode
  selected?: boolean
  // Selecting the row: a click alone, Cmd/Ctrl to add or drop it, Shift for
  // a range; its checkbox (shown on hover, always on touch) adds or drops.
  onPick?: (mode: PickMode) => void
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
      aria-selected={onPick ? selected : undefined}
      onClick={onPick && ((e: MouseEvent) => {
        // Not a click on something in the row (the row itself is a drag handle, a button).
        const hit = (e.target as HTMLElement).closest('a, button, input, [role="button"]')
        if (hit && hit !== e.currentTarget) return
        // A tap adds or drops the row, as there is no Cmd on a touch screen.
        const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch'
        onPick(e.shiftKey ? 'range' : e.metaKey || e.ctrlKey || touch ? 'toggle' : 'only')
      })}
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: onPick ? 0.5 : 1.5,
          py: 0.75,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          cursor: draggable ? 'grab' : 'default',
          touchAction: 'manipulation',
          boxShadow: overlay ? 6 : 0,
          '&:hover': { bgcolor: 'action.hover' },
          '& .pick': { opacity: selected ? 1 : 0 },
          '&:hover .pick, & .pick:focus-within, [data-selecting="true"] & .pick': { opacity: 1 },
          '@media (hover: none)': { '& .pick': { opacity: 1 } },
        },
        flaggedSx(issue),
        selected && ((t) => ({
          bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.22 : 0.1),
          boxShadow: `inset 3px 0 0 ${t.palette.primary.main}`,
          '&:hover': { bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.28 : 0.14) },
        })),
      ]}
    >
      {onPick && (
        <Checkbox className="pick" size="small" checked={selected} onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onChange={() => onPick('toggle')}
          slotProps={{ input: { 'aria-label': `Select ${issue.key}` } }} sx={{ p: 0.25 }} />
      )}
      <TypeIcon type={typeById(issue.type_id)} />
      <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500, whiteSpace: 'nowrap' }}>{issue.key}</Typography>
      <Typography component={Link} to={href(issue.key)} variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0, color: 'text.primary', textDecoration: 'none',
        '&:hover': { textDecoration: 'underline' } }}>
        {issue.title}
      </Typography>
      <FlagMark issue={issue} />
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
