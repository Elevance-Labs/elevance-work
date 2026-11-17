// Small parts shared by the todo add bar and a todo's row: the due-day menu,
// the list menu, a list's colour dot, and the icon that becomes a chip once
// it has a value.
import { type ReactElement, type ReactNode } from 'react'
import { Box, Chip, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, TextField, Tooltip, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import NextWeekOutlinedIcon from '@mui/icons-material/NextWeekOutlined'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined'
import WeekendOutlinedIcon from '@mui/icons-material/WeekendOutlined'
import { todayIso } from '../../lib/constants'
import { duePresets } from '../../lib/todos'
import type { TodoList } from '../../lib/types'

const PRESET_ICONS: Record<string, ReactElement> = {
  Today: <TodayOutlinedIcon fontSize="small" />,
  Tomorrow: <WbSunnyOutlinedIcon fontSize="small" />,
  'This weekend': <WeekendOutlinedIcon fontSize="small" />,
  'Next week': <NextWeekOutlinedIcon fontSize="small" />,
}

const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })

/** Pick a due day: the quick picks, no date, or any day. */
export function DueMenu({ anchor, value, onPick, onClose }: {
  anchor: HTMLElement | null
  value: string
  onPick: (date: string) => void
  onClose: () => void
}) {
  const today = todayIso()
  const pick = (d: string) => {
    onPick(d)
    onClose()
  }
  return (
    <Menu anchorEl={anchor} open={!!anchor} onClose={onClose} slotProps={{ list: { dense: true, 'aria-label': 'Due date' } }}>
      {duePresets(today).map((p) => (
        <MenuItem key={p.label} selected={value === p.date} onClick={() => pick(p.date)}>
          <ListItemIcon>{PRESET_ICONS[p.label]}</ListItemIcon>
          <ListItemText>{p.label}</ListItemText>
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 2 }}>{weekday(p.date)}</Typography>
        </MenuItem>
      ))}
      {value && (
        <MenuItem onClick={() => pick('')}>
          <ListItemIcon><EventBusyOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>No date</ListItemText>
        </MenuItem>
      )}
      <Divider />
      {/* Keys typed here are the date's, not the menu's type-to-select. */}
      <Box sx={{ px: 2, py: 1 }} onKeyDown={(e) => e.stopPropagation()}>
        <TextField type="date" size="small" fullWidth label="Pick a date" value={value}
          onChange={(e) => e.target.value && pick(e.target.value)}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'aria-label': 'Pick a date' } }} />
      </Box>
    </Menu>
  )
}

export function ListDot({ color, size = 10 }: { color: string; size?: number }) {
  return <Box component="span" sx={{ width: size, height: size, borderRadius: '50%', bgcolor: color, flexShrink: 0, display: 'inline-block' }} />
}

/** Pick one of your lists, or the Inbox (null). */
export function ListMenu({ anchor, lists, value, onPick, onClose, title }: {
  anchor: HTMLElement | null
  lists: TodoList[]
  value: string | null
  onPick: (listId: string | null) => void
  onClose: () => void
  title?: string
}) {
  const pick = (id: string | null) => {
    onClose()
    if (id !== value) onPick(id)
  }
  const tick = (on: boolean) => (on ? <CheckIcon fontSize="small" sx={{ ml: 2, color: 'primary.main' }} /> : null)
  return (
    <Menu anchorEl={anchor} open={!!anchor} onClose={onClose} slotProps={{ list: { dense: true, 'aria-label': title ?? 'List' } }}>
      {title && <Typography variant="caption" sx={{ px: 2, py: 0.5, display: 'block', color: 'text.secondary', fontWeight: 700 }}>{title}</Typography>}
      <MenuItem onClick={() => pick(null)}>
        <ListItemIcon><InboxOutlinedIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Inbox</ListItemText>
        {tick(value === null)}
      </MenuItem>
      {lists.map((l) => (
        <MenuItem key={l.id} onClick={() => pick(l.id)}>
          <ListItemIcon><ListDot color={l.color} /></ListItemIcon>
          <ListItemText>{l.name}</ListItemText>
          {tick(value === l.id)}
        </MenuItem>
      ))}
    </Menu>
  )
}

/** An icon button until it has a value, then a small chip showing it (click to change, × to clear). */
export function AttrButton({ icon, chipIcon, label, value, onOpen, onClear, avatar }: {
  icon: ReactElement
  // Shown in the chip instead of the icon (a list's colour).
  chipIcon?: ReactElement
  label: string
  value?: ReactNode
  onOpen: (el: HTMLElement) => void
  onClear?: () => void
  avatar?: ReactElement
}) {
  if (value)
    return (
      <Chip size="small" variant="outlined" icon={avatar ? undefined : (chipIcon ?? icon)} avatar={avatar} label={value}
        aria-label={label} onClick={(e) => onOpen(e.currentTarget)} onDelete={onClear}
        sx={{ maxWidth: 220, borderRadius: 1.5, '& .MuiChip-icon': { ml: 0.75 } }} />
    )
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={(e) => onOpen(e.currentTarget)} sx={{ color: 'text.secondary' }}>
        {icon}
      </IconButton>
    </Tooltip>
  )
}
