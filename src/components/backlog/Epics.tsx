// The backlog's epics: the panel beside the lists (as Jira's), each epic
// with how far along it is, a click filtering the lists to it and a dropped
// row joining it, its icon opening the epic; the chip a row carries for its
// epic; and the menu that puts an issue under an epic or takes it out.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useDroppable } from '@dnd-kit/core'
import {
  Box,
  Button,
  ButtonBase,
  Divider,
  IconButton,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  type Theme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { formatPoints } from '../../lib/constants'
import { NO_EPIC, epicDropId, epicProgress, type EpicProgress, type EpicTarget } from '../../lib/backlog'
import { isDone } from '../../lib/issues'
import type { Issue, ProjectStatus } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { FlagMark } from '../IssueBits'
import { useIssueHref } from '../useIssueHref'

const FALLBACK = '#904ee2'

/** An epic's colour: its type's. */
function useEpicColor() {
  const { typeById } = useWorkspace()
  return (epic: Issue) => typeById(epic.type_id)?.color ?? FALLBACK
}

const tint = (color: string, strength = 1) => (t: Theme) =>
  alpha(color, (t.palette.mode === 'dark' ? 0.3 : 0.14) * strength)

/** A row's epic, as a small tinted lozenge; a button when it can be changed. */
export function EpicLozenge({ epic, onClick }: { epic: Issue; onClick?: (anchor: HTMLElement) => void }) {
  const color = useEpicColor()(epic)
  const href = useIssueHref()
  const sx = {
    display: 'inline-block',
    maxWidth: { xs: 96, sm: 160 },
    px: 0.75,
    py: 0.125,
    borderRadius: 0.75,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: '18px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flexShrink: 1,
    minWidth: 0,
    bgcolor: tint(color),
    color: 'text.primary',
    boxShadow: `inset 3px 0 0 ${color}`,
    pl: 1,
  } as const
  if (!onClick) {
    return (
      <Tooltip title={`Epic: ${epic.key} ${epic.title}. Click to open.`}>
        <Box component={Link} to={href(epic.key)} onPointerDown={(e) => e.stopPropagation()}
          sx={[sx, { textDecoration: 'none', '&:hover': { bgcolor: tint(color, 1.8) } }]}>
          {epic.title}
        </Box>
      </Tooltip>
    )
  }
  return (
    <Tooltip title={`Epic: ${epic.key} ${epic.title}. Click to change.`}>
      <ButtonBase
        aria-label={`Epic ${epic.title}: change`}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClick(e.currentTarget)
        }}
        sx={[sx, { '&:hover': { bgcolor: tint(color, 1.8) } }]}
      >
        {epic.title}
      </ButtonBase>
    </Tooltip>
  )
}

/**
 * The menu that puts an issue (or several) under one of the open epics, or
 * takes them out. A search box once there are more than a few.
 */
export function EpicMenu({
  anchor,
  target,
  epics,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null
  target: EpicTarget | null
  epics: Issue[]
  onPick: (epicId: string | null) => void
  onClose: () => void
}) {
  const color = useEpicColor()
  const href = useIssueHref()
  const [q, setQ] = useState('')
  const currentEpic = epics.find((e) => e.id === target?.epicId)
  const t = q.trim().toLowerCase()
  const shown = epics.filter((e) => !t || e.key.toLowerCase().includes(t) || e.title.toLowerCase().includes(t))
  const close = () => {
    setQ('')
    onClose()
  }
  return (
    <Menu anchorEl={anchor} open={!!anchor && !!target} onClose={close} onClick={(e) => e.stopPropagation()}
      slotProps={{ paper: { sx: { width: 300, maxHeight: 420 } }, list: { 'aria-label': target ? `Epic for ${target.name}` : 'Epic', dense: true } }}>
      <ListSubheader sx={{ lineHeight: '32px' }}>{target?.hasEpic ? 'Change epic' : 'Add to epic'}{target?.name.includes(' ') ? ` of ${target.name}` : ''}</ListSubheader>
      {epics.length > 6 && (
        <Box sx={{ px: 1.5, pb: 1 }} onKeyDown={(e) => e.stopPropagation()}>
          <TextField autoFocus fullWidth size="small" placeholder="Find an epic" value={q} onChange={(e) => setQ(e.target.value)}
            slotProps={{ htmlInput: { 'aria-label': 'Find an epic' } }} />
        </Box>
      )}
      {shown.map((e) => {
        const current = target?.epicId === e.id
        return (
          <MenuItem key={e.id} selected={current} onClick={() => { close(); if (!current) onPick(e.id) }} sx={{ gap: 1 }}>
            <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 1, bgcolor: color(e), flexShrink: 0 }} />
            <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0 }}>{e.key}</Typography>
            <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>{e.title}</Typography>
            {current && <CheckIcon fontSize="small" color="primary" />}
          </MenuItem>
        )
      })}
      {!shown.length && (
        <Typography variant="body2" sx={{ color: 'text.secondary', px: 2, py: 1 }}>
          {epics.length ? 'No epic matches.' : 'No open epics yet. Create one in the Epics panel.'}
        </Typography>
      )}
      {target?.hasEpic && <Divider />}
      {currentEpic && (
        <MenuItem component={Link} to={href(currentEpic.key)} onClick={close} sx={{ gap: 1 }}>
          <OpenInNewIcon fontSize="small" sx={{ color: 'text.secondary' }} /> Open {currentEpic.key}
        </MenuItem>
      )}
      {target?.hasEpic && (
        <MenuItem onClick={() => { close(); onPick(null) }} sx={{ color: 'error.main' }}>Remove from epic</MenuItem>
      )}
    </Menu>
  )
}

function ProgressBar({ p }: { p: EpicProgress }) {
  const pct = (n: number) => (p.total ? (n / p.total) * 100 : 0)
  return (
    <Box role="img" aria-label={`${p.done} of ${p.total} done`}
      sx={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', bgcolor: 'background.muted' }}>
      <Box sx={{ width: `${pct(p.done)}%`, bgcolor: 'success.main' }} />
      <Box sx={{ width: `${pct(p.inProgress)}%`, bgcolor: 'info.main' }} />
    </Box>
  )
}

/** One entry of the panel: a button that filters, and a place to drop a row. */
function Entry({
  dropId,
  selected,
  onSelect,
  label,
  accent,
  action,
  children,
}: {
  dropId?: string
  selected: boolean
  onSelect: () => void
  label: string
  accent?: string
  // Beside the button, not in it (top right): e.g. opening the epic.
  action?: ReactNode
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? 'epic-all', disabled: !dropId })
  return (
    <Box ref={setNodeRef} sx={{ position: 'relative' }}>
      <ButtonBase
        aria-pressed={selected}
        aria-label={label}
        onClick={onSelect}
        sx={(t) => ({
          display: 'block',
          width: '100%',
          textAlign: 'left',
          px: 1.5,
          pr: action ? 4.5 : 1.5,
          py: 1,
          borderRadius: 1,
          boxShadow: accent ? `inset 3px 0 0 ${accent}` : undefined,
          bgcolor: isOver
            ? alpha(t.palette.primary.main, 0.16)
            : selected
              ? alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.2 : 0.1)
              : 'transparent',
          outline: isOver ? `2px dashed ${t.palette.primary.main}` : selected ? `1px solid ${alpha(t.palette.primary.main, 0.5)}` : 'none',
          outlineOffset: -1,
          '&:hover': { bgcolor: isOver || selected ? undefined : 'action.hover' },
        })}
      >
        {children}
      </ButtonBase>
      {action && <Box sx={{ position: 'absolute', top: 4, right: 4 }}>{action}</Box>}
    </Box>
  )
}

/** Writing a new epic's name, as the backlog's own quick create. */
function CreateEpic({ onCreate }: { onCreate: (title: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  if (!open) {
    return (
      <Button size="small" startIcon={<AddIcon />} onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start', ml: 0.5 }}>
        Create epic
      </Button>
    )
  }
  return (
    <Box component="form" sx={{ display: 'flex', gap: 0.75, px: 1, alignItems: 'center' }}
      onSubmit={async (e) => {
        e.preventDefault()
        if (!title.trim() || saving.current) return
        saving.current = true
        setBusy(true)
        const ok = await onCreate(title.trim())
        saving.current = false
        setBusy(false)
        if (ok) {
          setTitle('')
          setOpen(false)
        }
      }}>
      <TextField autoFocus fullWidth size="small" placeholder="Name the epic" value={title} disabled={busy}
        onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        slotProps={{ htmlInput: { 'aria-label': 'New epic name', maxLength: 255 } }} />
      <Button type="submit" size="small" variant="contained" loading={busy} sx={{ minWidth: 0 }}>Add</Button>
    </Box>
  )
}

/**
 * The Epics panel: all issues, each epic (open ones; the done ones on
 * request) with its progress from `issues` (all of the project's, done or
 * not), then the issues under no epic (`withoutEpic`: how many are listed). A click
 * filters the backlog to it; dropping a row on one moves the row there.
 */
export function EpicsPanel({
  epics,
  issues,
  withoutEpic,
  statuses,
  selected,
  onSelect,
  onClose,
  onCreate,
  onOpenEpic,
}: {
  epics: Issue[]
  issues: Issue[]
  withoutEpic: number
  statuses: ProjectStatus[]
  selected: string
  onSelect: (epic: string) => void
  onClose: () => void
  onCreate?: (title: string) => Promise<boolean>
  // An epic opened from its icon (a phone closes the panel).
  onOpenEpic?: () => void
}) {
  const color = useEpicColor()
  const href = useIssueHref()
  const [showDone, setShowDone] = useState(false)
  const byEpic = useMemo(() => {
    const m = new Map<string, Issue[]>()
    for (const i of issues) if (i.parent_id) m.set(i.parent_id, [...(m.get(i.parent_id) ?? []), i])
    return m
  }, [issues])
  const done = epics.filter((e) => isDone(e, statuses))
  const shown = epics.filter((e) => showDone || !isDone(e, statuses) || e.id === selected)
  const pick = (id: string) => onSelect(selected === id ? '' : id)

  return (
    <Paper variant="outlined" component="aside" aria-label="Epics" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', pl: 1 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>Epics</Typography>
        <Tooltip title="Close the epics panel">
          <IconButton size="small" aria-label="Close the epics panel" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Stack>
      <Entry selected={!selected} onSelect={() => onSelect('')} label="All issues">
        <Typography variant="body2" sx={{ fontWeight: 500 }}>All issues</Typography>
      </Entry>
      {shown.map((e) => {
        const p = epicProgress(byEpic.get(e.id) ?? [], statuses)
        return (
          <Entry key={e.id} dropId={epicDropId(e.id)} selected={selected === e.id} onSelect={() => pick(e.id)}
            label={`Epic ${e.title}`} accent={color(e)}
            action={
              <Tooltip title={`Open ${e.key}`}>
                <IconButton component={Link} to={href(e.key)} size="small" aria-label={`Open ${e.key}`} onClick={onOpenEpic}
                  sx={{ color: 'text.secondary' }}>
                  <OpenInNewIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            }>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 500, flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                textDecoration: isDone(e, statuses) ? 'line-through' : 'none' }}>
                {e.title}
              </Typography>
              <FlagMark issue={e} size={14} />
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', my: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>{e.key}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                · {p.total ? `${p.done} of ${p.total} done` : 'No issues yet'}{p.points ? ` · ${formatPoints(p.points)} pts` : ''}
              </Typography>
            </Stack>
            {p.total > 0 && <ProgressBar p={p} />}
          </Entry>
        )
      })}
      {!epics.length && (
        <Typography variant="body2" sx={{ color: 'text.secondary', px: 1.5, py: 1 }}>
          No epics yet. An epic groups the issues of one larger piece of work.
        </Typography>
      )}
      {done.length > 0 && (
        <Button size="small" onClick={() => setShowDone((v) => !v)} sx={{ alignSelf: 'flex-start', ml: 0.5, color: 'text.secondary' }}>
          {showDone ? 'Hide done epics' : `Show done epics (${done.length})`}
        </Button>
      )}
      {onCreate && <CreateEpic onCreate={onCreate} />}
      <Divider sx={{ my: 0.5 }} />
      <Entry dropId={epicDropId(NO_EPIC)} selected={selected === NO_EPIC} onSelect={() => pick(NO_EPIC)} label="Issues without epic">
        <Typography variant="body2" sx={{ fontWeight: 500 }}>Issues without epic</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{withoutEpic} issue{withoutEpic === 1 ? '' : 's'}</Typography>
      </Entry>
    </Paper>
  )
}
