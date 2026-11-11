// Your day, in one place. Up front, the meeting you're in (or the next one
// today) from your Google Calendar, with your note on it open to type into.
// Then four panels: your agenda (meetings, releases, issues and todos due,
// anything overdue first), your todos, the issues assigned to you, and your
// pinned notes; and how your projects' sprints are going. Anything on the
// agenda opens in a dialog.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  Grid,
  LinearProgress,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  keyframes,
} from '@mui/material'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import EditNoteIcon from '@mui/icons-material/EditNote'
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined'
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined'
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined'
import { useMe } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { PRIORITIES, addDays, formatDate, formatTime, todayIso } from '../../lib/constants'
import { ISSUE_COLUMNS, categoryOf } from '../../lib/issues'
import { MEETING_COLOR, calendarItems, currentMeeting, itemsOn, meetingWhen, weekStart, type CalendarItem } from '../../lib/calendar'
import type { GoogleCalendarEvent, Issue, Release, Todo } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useIssueChanges } from '../../workspace/issueEvents'
import { useItemChanges } from '../../workspace/itemEvents'
import { useGoogleCalendar, type GoogleCalendarState } from '../../workspace/useGoogleCalendar'
import { Section } from '../../components/common'
import { PriorityIcon, ProjectAvatar, StatusLozenge, TypeIcon } from '../../components/IssueBits'
import { useIssueHref } from '../../components/useIssueHref'
import TodoList from '../../components/TodoList'
import NotesBoard from '../../components/notes/NotesBoard'
import MeetingNote from '../../components/notes/MeetingNote'
import { Attendees, MeetingDialog } from '../../components/calendar/ItemDialogs'
import { useItemDialog } from '../../components/calendar/useItemDialog'

function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function Card({ title, action, children, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <Paper variant="outlined" data-panel={id} sx={{ p: 2.5, height: '100%' }}>
      <Section title={title} action={action}>{children}</Section>
    </Paper>
  )
}

/** "in 25 min", "in 2 h 5 min", "12 min ago". */
function relative(ms: number) {
  const m = Math.round(Math.abs(ms) / 60_000)
  const text = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
  return ms >= 0 ? `in ${text}` : `${text} ago`
}

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(226, 72, 61, 0.55); }
  70% { box-shadow: 0 0 0 8px rgba(226, 72, 61, 0); }
  100% { box-shadow: 0 0 0 0 rgba(226, 72, 61, 0); }
`

// How long after a meeting ends it stays up front, to finish the note.
const JUST_ENDED_MS = 60 * 60_000

/**
 * The meeting that matters now: the one you're in, else the next one today,
 * else the one that just ended (so its note can be finished).
 */
function nowMeeting(meetings: GoogleCalendarEvent[], now: Date) {
  const found = currentMeeting(meetings, now)
  if (found) return { ...found, ended: false }
  const ended = meetings
    .filter((m) => !m.all_day && m.ends_at && new Date(m.ends_at) <= now && now.getTime() - new Date(m.ends_at).getTime() < JUST_ENDED_MS)
    .sort((a, b) => b.ends_at!.localeCompare(a.ends_at!))[0]
  return ended ? { meeting: ended, live: false, ended: true } : null
}

/** Up front: the meeting you're in, or the next one, with your note on it. */
function NowPanel({ google, today, onOpen }: { google: GoogleCalendarState; today: string; onOpen: (m: GoogleCalendarEvent) => void }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const todays = google.events.filter((m) => !m.all_day && m.starts_at && todayIso(new Date(m.starts_at)) === today)
  const found = nowMeeting(todays, now)
  const later = todays.filter((m) => new Date(m.starts_at!) > now && m.id !== found?.meeting.id)
  const tomorrow = google.events.filter((m) => !m.all_day && m.starts_at && todayIso(new Date(m.starts_at)) > today)
    .sort((a, b) => a.starts_at!.localeCompare(b.starts_at!))[0]

  const frame = (children: ReactNode) => (
    <Paper variant="outlined" data-panel="now"
      sx={{ p: { xs: 2, md: 3 }, mb: 2, overflow: 'hidden', position: 'relative',
        background: (t) => `linear-gradient(120deg, ${alpha(t.palette.primary.main, 0.1)} 0%, ${alpha(MEETING_COLOR, 0.07)} 55%, ${t.palette.background.paper} 100%)` }}>
      {children}
    </Paper>
  )

  if (google.status === 'loading') {
    return frame(
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
        <Box sx={{ flex: 1 }}><Skeleton width="30%" /><Skeleton variant="text" sx={{ fontSize: 32 }} width="70%" /><Skeleton width="50%" /></Box>
        <Skeleton variant="rounded" height={140} sx={{ flex: 1.3 }} />
      </Stack>,
    )
  }
  if (google.status !== 'on') {
    return frame(
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
        <EventOutlinedIcon sx={{ fontSize: 40, color: MEETING_COLOR }} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6">Your meetings, with notes</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {google.error ?? (google.lapsed
              ? 'Google no longer lets the app read your calendar. Connect it again to see your meetings here.'
              : 'Connect your Google Calendar to see the meeting you’re in here, and take notes on it as it happens. Only you see them.')}
          </Typography>
        </Box>
        <Button variant="contained" onClick={google.connect}>Connect Google Calendar</Button>
      </Stack>,
    )
  }
  if (!found) {
    return frame(
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <WbSunnyOutlinedIcon sx={{ fontSize: 40, color: 'warning.main' }} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6">{todays.length ? 'No more meetings today' : 'No meetings today'}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {tomorrow ? <>Next: <MuiLink component="button" onClick={() => onOpen(tomorrow)} sx={{ verticalAlign: 'baseline' }}>{tomorrow.title}</MuiLink>, {meetingWhen(tomorrow)}</>
              : 'Nothing else on your calendar this week.'}
          </Typography>
        </Box>
      </Stack>,
    )
  }

  const { meeting, live, ended } = found
  const start = new Date(meeting.starts_at!)
  const end = new Date(meeting.ends_at!)
  const elapsed = Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100))
  return frame(
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
      <Stack spacing={1.25} sx={{ flex: '1 1 45%', minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {live ? (
            <Chip size="small" color="error" label="Now"
              icon={<Box component="span" sx={{ width: 8, height: 8, ml: '8px !important', borderRadius: '50%', bgcolor: '#fff', animation: `${pulse} 1.6s infinite` }} />} />
          ) : (
            <Chip size="small" variant="outlined" label={ended ? 'Just ended' : 'Next'} />
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            {live ? `Ends ${relative(end.getTime() - now.getTime())}` : ended ? `Ended ${relative(end.getTime() - now.getTime())}` : `Starts ${relative(start.getTime() - now.getTime())}`}
          </Typography>
        </Stack>
        <ButtonBase onClick={() => onOpen(meeting)} sx={{ justifyContent: 'flex-start', textAlign: 'left', borderRadius: 1 }}>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>{meeting.title}</Typography>
        </ButtonBase>
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          {formatTime(meeting.starts_at!)} – {formatTime(meeting.ends_at!)}{meeting.location ? ` · ${meeting.location}` : ''}
        </Typography>
        {live && <LinearProgress variant="determinate" value={elapsed} sx={{ height: 6, borderRadius: 3, maxWidth: 360 }} aria-label="How far through" />}
        <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
          {meeting.meeting_url && !ended && (
            <Button variant="contained" startIcon={<VideocamOutlinedIcon />} href={meeting.meeting_url} target="_blank" rel="noopener noreferrer">
              Join
            </Button>
          )}
          <Button variant="outlined" onClick={() => onOpen(meeting)}>Details</Button>
        </Stack>
        <Attendees meeting={meeting} max={6} />
        {later.length > 0 && (
          <Box sx={{ pt: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>Later today</Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
              {later.slice(0, 5).map((m) => (
                <Chip key={m.id} size="small" onClick={() => onOpen(m)} label={`${formatTime(m.starts_at!)} ${m.title}`}
                  sx={{ bgcolor: alpha(MEETING_COLOR, 0.12), maxWidth: 240 }} />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
      <Box sx={{ flex: '1 1 55%', minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 1 }}>
          <EditNoteIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Typography variant="subtitle2">My notes on this meeting</Typography>
        </Stack>
        <MeetingNote key={meeting.id} meeting={meeting} minRows={7} />
      </Box>
    </Stack>,
  )
}

type Span = 'today' | 'week'
// Which the agenda shows: this viewer's own choice, remembered on this device.
const SPAN_KEY = 'el-work:agenda-span'
function storedSpan(): Span {
  try {
    return window.localStorage.getItem(SPAN_KEY) === 'week' ? 'week' : 'today'
  } catch {
    return 'today'
  }
}

type TodoRow = Todo & { issue: { key: string; title: string } | null }

type Entry =
  | { kind: 'calendar'; id: string; item: CalendarItem }
  | { kind: 'issue'; id: string; issue: Issue }
  | { kind: 'todo'; id: string; todo: TodoRow }

function dayHeading(day: string, today: string) {
  if (day === today) return 'Today'
  if (day === addDays(today, 1)) return 'Tomorrow'
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

/** One line of the agenda. Meetings and releases are tinted in their colour, issues show their type and status, todos a box to tick. */
function AgendaRow({ entry, today, noted, onTick, onOpen }: {
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

/** A number and what it counts, for the line under the greeting. */
function Stat({ n, label, tone }: { n: number; label: string; tone?: 'error' }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }} data-stat={label}>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: tone === 'error' && n ? 'error.main' : 'text.primary' }}>{n}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
    </Stack>
  )
}

export default function Dashboard() {
  const me = useMe()
  const { projects, activeSprints, statusesOf, typeById, statusById, projectById, roleOf } = useWorkspace()
  const href = useIssueHref()
  const [mine, setMine] = useState<Issue[] | null>(null)
  const [sprintIssues, setSprintIssues] = useState<Issue[]>([])
  const [releases, setReleases] = useState<Release[]>([])
  const [due, setDue] = useState<Issue[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [noted, setNoted] = useState<Set<string>>(new Set())
  const [span, setSpanState] = useState<Span>(storedSpan)
  const [meeting, setMeeting] = useState<GoogleCalendarEvent | null>(null)
  // Bumped when the agenda ticks a todo, so the todo card reads them again.
  const [todoVersion, setTodoVersion] = useState(0)
  const today = todayIso()
  // Everything up to Sunday is read once; Today shows only today's part of it.
  const weekEnd = addDays(weekStart(today), 6)
  const google = useGoogleCalendar(today, weekEnd)
  const myProjects = projects.filter((p) => !p.archived_at && roleOf(p.id) && roleOf(p.id) !== 'viewer')
  const sprints = activeSprints.filter((s) => myProjects.some((p) => p.id === s.project_id))
  const { open, dialog } = useItemDialog()

  const setSpan = (s: Span) => {
    setSpanState(s)
    try {
      window.localStorage.setItem(SPAN_KEY, s)
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }

  const loadTodos = useCallback(async () => {
    const { data } = await supabase.from('todos').select('*, issue:issues(key, title)')
      .is('done_at', null).not('due_on', 'is', null).lte('due_on', weekEnd).order('position')
    setTodos((data ?? []) as unknown as TodoRow[])
  }, [weekEnd])

  const load = useCallback(async () => {
    const [assigned, inSprints, upcoming, dueIssues] = await Promise.all([
      supabase.from('issues').select(ISSUE_COLUMNS).eq('assignee_id', me.id).is('resolved_at', null)
        .order('priority').order('due_date', { nullsFirst: false }).limit(50),
      sprints.length ? supabase.from('issues').select('id, status_id, sprint_id, story_points').in('sprint_id', sprints.map((s) => s.id)) : Promise.resolve({ data: [] }),
      supabase.from('releases').select('*').eq('status', 'unreleased').gte('release_date', today).lte('release_date', weekEnd),
      // Yours with a due date up to Sunday, overdue ones included.
      supabase.from('issues').select(ISSUE_COLUMNS).eq('assignee_id', me.id).is('resolved_at', null)
        .not('due_date', 'is', null).lte('due_date', weekEnd).order('due_date'),
      loadTodos(),
    ])
    setMine((assigned.data ?? []) as unknown as Issue[])
    setSprintIssues((inSprints.data ?? []) as unknown as Issue[])
    setDue((dueIssues.data ?? []) as unknown as Issue[])
    setReleases((upcoming.data ?? []) as Release[])
    // sprints is derived from the workspace each render; its ids are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id, today, weekEnd, loadTodos, sprints.map((s) => s.id).join()])

  useEffect(() => {
    load()
  }, [load])
  useIssueChanges(() => load())
  // A todo made with Create; the todo card reads its own list again too.
  useItemChanges(['todo'], () => load())

  // Which of this week's meetings you've written notes on.
  const meetingIds = google.events.map((m) => m.id).join(',')
  const loadNoted = useCallback(async () => {
    if (!meetingIds) return setNoted(new Set())
    const { data } = await supabase.from('notes').select('meeting_id').eq('owner_id', me.id).in('meeting_id', meetingIds.split(','))
    setNoted(new Set(((data ?? []) as { meeting_id: string }[]).map((n) => n.meeting_id)))
  }, [me.id, meetingIds])
  useEffect(() => {
    loadNoted()
  }, [loadNoted])
  useItemChanges(['note'], loadNoted)

  async function tick(t: TodoRow) {
    setTodos((ts) => ts.filter((x) => x.id !== t.id))
    await supabase.from('todos').update({ done_at: new Date().toISOString() }).eq('id', t.id)
    setTodoVersion((v) => v + 1)
    loadTodos()
  }

  // The agenda: overdue issues and todos first, then each day's meetings, releases, issues due and todos.
  const until = span === 'today' ? today : weekEnd
  const items = calendarItems({ meetings: google.events, releases, projects, isEpic: () => false, typeColor: () => undefined }, today, until)
  const priority = (i: Issue) => PRIORITIES.indexOf(i.priority)
  const overdue: (Entry & { day: string })[] = [
    ...due.filter((i) => i.due_date! < today).map((issue) => ({ kind: 'issue' as const, id: `issue:${issue.id}`, issue, day: issue.due_date! })),
    ...todos.filter((t) => t.due_on! < today).map((todo) => ({ kind: 'todo' as const, id: `todo:${todo.id}`, todo, day: todo.due_on! })),
  ].sort((a, b) => a.day.localeCompare(b.day))
  const days: { day: string; entries: Entry[] }[] = []
  for (let d = today; d <= until; d = addDays(d, 1)) {
    const entries: Entry[] = [
      ...itemsOn(items, d).map((item) => ({ kind: 'calendar' as const, id: `cal:${item.id}`, item })),
      ...due.filter((i) => i.due_date === d).sort((a, b) => priority(a) - priority(b))
        .map((issue) => ({ kind: 'issue' as const, id: `issue:${issue.id}`, issue })),
      ...todos.filter((t) => t.due_on === d).map((todo) => ({ kind: 'todo' as const, id: `todo:${todo.id}`, todo })),
    ]
    if (entries.length) days.push({ day: d, entries })
  }
  const rows = (entries: Entry[]) => (
    <Stack spacing={0.75}>
      {entries.map((e) => <AgendaRow key={e.id} entry={e} today={today} noted={noted} onTick={tick} onOpen={open} />)}
    </Stack>
  )
  const meetingsToday = google.events.filter((m) => !m.all_day && m.starts_at && todayIso(new Date(m.starts_at)) === today).length

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2.5, alignItems: { md: 'flex-end' } }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5" component="h1" sx={{ mb: 0.5 }}>{greeting()}, {me.full_name.split(' ')[0]}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </Typography>
        </Box>
        <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {google.status === 'on' && <Stat n={meetingsToday} label={meetingsToday === 1 ? 'meeting today' : 'meetings today'} />}
          <Stat n={due.filter((i) => i.due_date! >= today).length} label="issues due this week" />
          <Stat n={todos.filter((t) => t.due_on === today).length} label="todos today" />
          <Stat n={overdue.length} label="overdue" tone="error" />
        </Stack>
      </Stack>

      <NowPanel google={google} today={today} onOpen={setMeeting} />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card id="agenda" title="Agenda"
            action={(
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <ToggleButtonGroup size="small" exclusive value={span} onChange={(_, v) => v && setSpan(v)} aria-label="Agenda for">
                  <ToggleButton value="today" sx={{ py: 0.25 }}>Today</ToggleButton>
                  <ToggleButton value="week" sx={{ py: 0.25 }}>This week</ToggleButton>
                </ToggleButtonGroup>
                <Button size="small" component={Link} to="/calendar">Calendar</Button>
              </Stack>
            )}>
            {overdue.length > 0 && (
              <Box data-agenda="overdue" sx={{ mb: 2, p: 1.25, borderRadius: 1, bgcolor: (t) => alpha(t.palette.error.main, 0.07), border: 1,
                borderColor: (t) => alpha(t.palette.error.main, 0.3) }}>
                <Typography variant="caption" sx={{ display: 'block', mb: 0.75, fontWeight: 700, textTransform: 'uppercase', color: 'error.main' }}>
                  Overdue ({overdue.length})
                </Typography>
                {rows(overdue)}
              </Box>
            )}
            {!days.length && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {span === 'today' ? 'Nothing on your agenda today.' : 'Nothing on your agenda for the rest of the week.'}
              </Typography>
            )}
            {span === 'today' ? days[0] && rows(days[0].entries) : (
              <Stack spacing={2}>
                {days.map(({ day, entries }) => (
                  <Box key={day} data-agenda-day={day}>
                    <Typography variant="caption" sx={{ display: 'block', mb: 0.75, fontWeight: 700, textTransform: 'uppercase',
                      color: day === today ? 'primary.main' : 'text.secondary' }}>
                      {dayHeading(day, today)}
                    </Typography>
                    {rows(entries)}
                  </Box>
                ))}
              </Stack>
            )}
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card id="todos" title="Todos" action={<Button size="small" component={Link} to="/todos">All todos</Button>}>
            <TodoList compact key={todoVersion} onChange={loadTodos} />
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card id="issues" title={`Assigned to you${mine ? ` (${mine.length})` : ''}`}
            action={<Button size="small" component={Link} to="/issues?assignees=me&resolution=unresolved">View all</Button>}>
            {mine && !mine.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing open is assigned to you.</Typography>}
            <Stack spacing={0.5}>
              {(mine ?? []).slice(0, 12).map((i) => {
                const late = i.due_date && i.due_date < today
                return (
                  <Stack key={i.id} direction="row" spacing={1} component={Link} to={href(i.key)}
                    sx={{ alignItems: 'center', py: 0.75, px: 1, borderRadius: 1, textDecoration: 'none', color: 'inherit', '&:hover': { bgcolor: 'action.hover' } }}>
                    <TypeIcon type={typeById(i.type_id)} />
                    <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{i.key}</Typography>
                    <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>{i.title}</Typography>
                    {i.due_date && (
                      <Typography variant="caption" sx={{ color: late ? 'error.main' : 'text.secondary', whiteSpace: 'nowrap' }}>
                        {late ? 'Overdue · ' : ''}{formatDate(i.due_date, false)}
                      </Typography>
                    )}
                    <Box sx={{ display: { xs: 'none', sm: 'block' } }}><StatusLozenge status={statusById(i.status_id)} /></Box>
                    <PriorityIcon priority={i.priority} />
                  </Stack>
                )
              })}
            </Stack>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card id="notes" title="Pinned notes" action={<Button size="small" component={Link} to="/notes">All notes</Button>}>
            <NotesBoard compact scope={{ pinned: true }} />
          </Card>
        </Grid>
        {sprints.length > 0 && (
          <Grid size={12}>
            <Card title="Active sprints">
              <Grid container spacing={2}>
                {sprints.map((s) => {
                  const p = projectById(s.project_id)!
                  const list = sprintIssues.filter((i) => i.sprint_id === s.id)
                  const done = list.filter((i) => categoryOf(i, statusesOf(p.id)) === 'done').length
                  return (
                    <Grid key={s.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                      <Paper variant="outlined" component={Link} to={`/projects/${p.key}/board`} sx={{ p: 2, display: 'block', textDecoration: 'none', color: 'inherit' }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                          <ProjectAvatar project={p} />
                          <Typography variant="subtitle2" noWrap sx={{ flexGrow: 1 }}>{s.name}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>ends {formatDate(s.end_date, false)}</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" color="success" value={list.length ? (done / list.length) * 100 : 0} sx={{ height: 6, borderRadius: 3 }} />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{done} of {list.length} done</Typography>
                      </Paper>
                    </Grid>
                  )
                })}
              </Grid>
            </Card>
          </Grid>
        )}
      </Grid>
      {meeting && <MeetingDialog meeting={meeting} onClose={() => setMeeting(null)} />}
      {dialog}
    </Box>
  )
}
