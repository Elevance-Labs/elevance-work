// What clicking something on the calendar (or the dashboard's agenda) opens
// (useItemDialog): always a dialog over the page, never a trip elsewhere. A meeting shows its
// details from Google Calendar and your note on it; a release its dates and
// progress; a todo lets you tick it off or move it; an issue or epic opens
// the issue dialog (?issue=KEY).
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloseIcon from '@mui/icons-material/Close'
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined'
import HighlightOffIcon from '@mui/icons-material/HighlightOff'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined'
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined'
import { supabase } from '../../lib/supabase'
import { RELEASE_STATUS_COLORS, RELEASE_STATUS_LABELS, errorMessage, formatDate, formatDateRange, todayIso } from '../../lib/constants'
import { categoryOf } from '../../lib/issues'
import { meetingWhen } from '../../lib/calendar'
import type { GoogleCalendarEvent, Issue, Release, Todo } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { emitItemChange } from '../../workspace/itemEvents'
import { ProjectAvatar } from '../IssueBits'
import { useIssueHref } from '../useIssueHref'
import MeetingNote from '../notes/MeetingNote'

function Shell({ title, subtitle, onClose, actions, children, maxWidth = 'sm' }: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
  maxWidth?: 'xs' | 'sm' | 'md'
}) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth={maxWidth} aria-labelledby="item-dialog-title">
      <DialogTitle id="item-dialog-title" sx={{ pr: 6 }}>
        {title}
        {subtitle && <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.25 }}>{subtitle}</Typography>}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>{children}</Stack>
      </DialogContent>
      {actions && <DialogActions>{actions}</DialogActions>}
    </Dialog>
  )
}

const RESPONSE: Record<GoogleCalendarEvent['attendees'][number]['response'], { label: string; icon: ReactNode }> = {
  accepted: { label: 'Going', icon: <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} /> },
  declined: { label: 'Not going', icon: <HighlightOffIcon sx={{ fontSize: 14, color: 'error.main' }} /> },
  tentative: { label: 'Maybe', icon: <HelpOutlineIcon sx={{ fontSize: 14, color: 'warning.main' }} /> },
  needsAction: { label: 'Not answered', icon: <HelpOutlineIcon sx={{ fontSize: 14, color: 'text.disabled' }} /> },
}

/** People at a meeting, by name where Google has one; your colleagues by their profile's name. */
export function Attendees({ meeting, max = 12 }: { meeting: GoogleCalendarEvent; max?: number }) {
  const { profiles } = useWorkspace()
  const [all, setAll] = useState(false)
  const nameOf = (email: string, name: string | null) =>
    profiles.find((p) => p.email.toLowerCase() === email.toLowerCase())?.full_name ?? name ?? email
  const shown = all ? meeting.attendees : meeting.attendees.slice(0, max)
  if (!meeting.attendees.length) return null
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
        {meeting.attendees.length} {meeting.attendees.length === 1 ? 'guest' : 'guests'}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
        {shown.map((a) => {
          const name = nameOf(a.email, a.name)
          return (
            <Tooltip key={a.email} title={`${a.email} · ${RESPONSE[a.response].label}`}>
              <Chip size="small" variant="outlined" label={name}
                avatar={<Avatar sx={{ bgcolor: 'transparent !important' }}>{RESPONSE[a.response].icon}</Avatar>} />
            </Tooltip>
          )
        })}
        {!all && meeting.attendees.length > max && (
          <Chip size="small" label={`+${meeting.attendees.length - max} more`} onClick={() => setAll(true)} />
        )}
      </Stack>
    </Box>
  )
}

/** A meeting from your Google Calendar: its details, a way in, and your note on it. */
export function MeetingDialog({ meeting, onClose }: { meeting: GoogleCalendarEvent; onClose: () => void }) {
  const [more, setMore] = useState(false)
  const long = (meeting.description?.length ?? 0) > 280
  return (
    <Shell title={meeting.title} subtitle={meetingWhen(meeting)} onClose={onClose} maxWidth="md"
      actions={(
        <>
          {meeting.url && (
            <Button size="small" startIcon={<OpenInNewIcon />} href={meeting.url} target="_blank" rel="noopener noreferrer" sx={{ mr: 'auto' }}>
              Google Calendar
            </Button>
          )}
          {meeting.meeting_url && (
            <Button variant="contained" startIcon={<VideocamOutlinedIcon />} href={meeting.meeting_url} target="_blank" rel="noopener noreferrer">
              Join
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      )}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
        <Stack spacing={1.5} sx={{ flex: '1 1 40%', minWidth: 0 }}>
          {meeting.location && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <PlaceOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.25 }} />
              <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{meeting.location}</Typography>
            </Stack>
          )}
          {meeting.organizer && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Organised by {meeting.organizer.name ?? meeting.organizer.email}
            </Typography>
          )}
          <Attendees meeting={meeting} />
          {meeting.description && (
            <Box>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.secondary',
                ...(long && !more ? { display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}) }}>
                {meeting.description}
              </Typography>
              {long && <Button size="small" onClick={() => setMore((m) => !m)} sx={{ px: 0 }}>{more ? 'Less' : 'More'}</Button>}
            </Box>
          )}
          {!meeting.location && !meeting.organizer && !meeting.attendees.length && !meeting.description && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>No more details in Google Calendar.</Typography>
          )}
        </Stack>
        <Box sx={{ flex: '1 1 60%', minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>My notes</Typography>
          <MeetingNote meeting={meeting} minRows={10} />
        </Box>
      </Stack>
    </Shell>
  )
}

/** A release: when, how far along, and the way to its page. */
export function ReleaseDialog({ release, onClose }: { release: Release; onClose: () => void }) {
  const { projectById, statusesOf } = useWorkspace()
  const navigate = useNavigate()
  const project = projectById(release.project_id)
  const [issues, setIssues] = useState<Pick<Issue, 'id' | 'status_id'>[] | null>(null)
  useEffect(() => {
    let cancelled = false
    supabase.from('issues').select('id, status_id').eq('release_id', release.id).then(({ data }) => {
      if (!cancelled) setIssues((data ?? []) as Pick<Issue, 'id' | 'status_id'>[])
    })
    return () => {
      cancelled = true
    }
  }, [release.id])
  const done = issues?.filter((i) => categoryOf(i, statusesOf(release.project_id)) === 'done').length ?? 0
  const page = project && `/projects/${project.key}/releases/${release.id}`
  return (
    <Shell onClose={onClose} maxWidth="xs"
      title={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>{project && <ProjectAvatar project={project} />}<span>{release.name}</span></Stack>}
      subtitle={project?.name}
      actions={(
        <>
          {page && <Button onClick={() => { onClose(); navigate(page) }}>Open release</Button>}
          <Button variant="contained" onClick={onClose}>Close</Button>
        </>
      )}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Chip size="small" color={RELEASE_STATUS_COLORS[release.status]} label={RELEASE_STATUS_LABELS[release.status]} />
        <Typography variant="body2">
          {release.start_date ? formatDateRange(release.start_date, release.release_date) : `Release date ${formatDate(release.release_date)}`}
        </Typography>
      </Stack>
      {release.description && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{release.description}</Typography>}
      {issues && (
        <Box>
          <LinearProgress variant="determinate" color="success" value={issues.length ? (done / issues.length) * 100 : 0} sx={{ height: 6, borderRadius: 3 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {issues.length ? `${done} of ${issues.length} issues done` : 'No issues in it yet'}
          </Typography>
        </Box>
      )}
    </Shell>
  )
}

type TodoRow = Todo & { issue?: { key: string; title: string } | null }

/** A todo: tick it off, or move its day. */
export function TodoDialog({ todo, onClose, onChanged }: { todo: TodoRow; onClose: () => void; onChanged?: () => void }) {
  const { projectById } = useWorkspace()
  const href = useIssueHref()
  const [row, setRow] = useState(todo)
  const [error, setError] = useState<string | null>(null)
  const project = projectById(row.project_id)
  const today = todayIso()

  async function update(patch: Partial<Todo>) {
    setRow((r) => ({ ...r, ...patch }))
    const { error: e } = await supabase.from('todos').update(patch).eq('id', todo.id)
    if (e) {
      setError(errorMessage(e))
      setRow(todo)
      return
    }
    emitItemChange('todo')
    onChanged?.()
  }

  return (
    <Shell title="Todo" onClose={onClose} maxWidth="xs"
      actions={(
        <>
          <Button component={Link} to="/todos" onClick={onClose}>All todos</Button>
          <Button variant="contained" onClick={onClose}>Done</Button>
        </>
      )}>
      <FormControlLabel
        control={<Checkbox checked={!!row.done_at} onChange={(e) => update({ done_at: e.target.checked ? new Date().toISOString() : null })} />}
        label={<Typography sx={{ textDecoration: row.done_at ? 'line-through' : 'none' }}>{row.title}</Typography>}
      />
      <TextField type="date" label="Due on" value={row.due_on ?? ''} onChange={(e) => update({ due_on: e.target.value || null })}
        slotProps={{ inputLabel: { shrink: true } }}
        helperText={!row.done_at && row.due_on && row.due_on < today ? 'Overdue' : ' '}
        error={!row.done_at && !!row.due_on && row.due_on < today} />
      {(row.issue || project) && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          {row.issue && <Chip size="small" variant="outlined" label={`${row.issue.key} ${row.issue.title}`} component={Link} to={href(row.issue.key)} clickable onClick={onClose} />}
          {project && <Chip size="small" variant="outlined" avatar={<ProjectAvatar project={project} size={18} />} label={project.name} />}
        </Stack>
      )}
      {error && <Typography variant="body2" sx={{ color: 'error.main' }}>{error}</Typography>}
    </Shell>
  )
}
