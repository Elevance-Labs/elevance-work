// Home: your day, in one place. On a wide screen: up front, the meeting
// you're in (or the next one today) from your Google Calendar, with your note
// on it open to type into; then four panels: your agenda (meetings,
// releases, issues and todos due, anything overdue first), your todos, the
// issues assigned to you, and your pinned notes. Anything on the agenda
// opens in a dialog. On a phone, Home is the compact PhoneHome: the meeting
// now, a strip of days and that day's agenda (the bottom bar's other tabs
// hold the rest).
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Box,
  Button,
  Grid,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useMe } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { addDays, todayIso } from '../../lib/constants'
import { ISSUE_COLUMNS } from '../../lib/issues'
import { weekStart } from '../../lib/calendar'
import type { GoogleCalendarEvent, Issue } from '../../lib/types'
import { useIssueChanges } from '../../workspace/issueEvents'
import { Section } from '../../components/common'
import IssueRow from '../../components/IssueRow'
import TodoList from '../../components/TodoList'
import NotesBoard from '../../components/notes/NotesBoard'
import { MeetingDialog } from '../../components/calendar/ItemDialogs'
import { useItemDialog } from '../../components/calendar/useItemDialog'
import AgendaRow from '../../components/home/AgendaRow'
import { NowPanel } from '../../components/home/NowPanel'
import PhoneHome from '../../components/home/PhoneHome'
import { dayHeading, useAgenda, type Entry } from '../../components/home/useAgenda'

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
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  return wide ? <WideHome /> : <PhoneHome />
}

function WideHome() {
  const me = useMe()
  const [mine, setMine] = useState<Issue[] | null>(null)
  const [span, setSpanState] = useState<Span>(storedSpan)
  const [meeting, setMeeting] = useState<GoogleCalendarEvent | null>(null)
  const today = todayIso()
  // Everything up to Sunday is read once; Today shows only today's part of it.
  const weekEnd = addDays(weekStart(today), 6)
  const { google, due, todos, noted, overdue, entriesOn, tick, loadTodos, todoVersion } = useAgenda(today, weekEnd)
  const { open, dialog } = useItemDialog()

  const setSpan = (s: Span) => {
    setSpanState(s)
    try {
      window.localStorage.setItem(SPAN_KEY, s)
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }

  const loadMine = useCallback(async () => {
    const { data } = await supabase.from('issues').select(ISSUE_COLUMNS).eq('assignee_id', me.id).is('resolved_at', null)
      .order('priority').order('due_date', { nullsFirst: false }).limit(50)
    setMine((data ?? []) as unknown as Issue[])
  }, [me.id])
  useEffect(() => {
    loadMine()
  }, [loadMine])
  useIssueChanges(() => loadMine())

  // The agenda: overdue issues and todos first, then each day's meetings, releases, issues due and todos.
  const until = span === 'today' ? today : weekEnd
  const days: { day: string; entries: Entry[] }[] = []
  for (let d = today; d <= until; d = addDays(d, 1)) {
    const entries = entriesOn(d)
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
            {new Date(`${today}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
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
              {(mine ?? []).slice(0, 12).map((i) => <IssueRow key={i.id} issue={i} />)}
            </Stack>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card id="notes" title="Pinned notes" action={<Button size="small" component={Link} to="/notes">All notes</Button>}>
            <NotesBoard compact scope={{ pinned: true }} />
          </Card>
        </Grid>
      </Grid>
      {meeting && <MeetingDialog meeting={meeting} onClose={() => setMeeting(null)} />}
      {dialog}
    </Box>
  )
}
