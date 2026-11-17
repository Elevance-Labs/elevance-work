// The meeting that matters now, from your Google Calendar: the one you're
// in, else the next one today, else the one that just ended (so its note can
// be finished). NowPanel is Home's wide version, with your note on it open
// to type into; NowCard is the phone's one compact card, its note a tap away.
import { useEffect, useState, type ReactNode } from 'react'
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  LinearProgress,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Typography,
  alpha,
  keyframes,
} from '@mui/material'
import EditNoteIcon from '@mui/icons-material/EditNote'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined'
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined'
import { formatTime, todayIso } from '../../lib/constants'
import { MEETING_COLOR, currentMeeting, meetingWhen } from '../../lib/calendar'
import type { GoogleCalendarEvent } from '../../lib/types'
import type { GoogleCalendarState } from '../../workspace/useGoogleCalendar'
import MeetingNote from '../notes/MeetingNote'
import { Attendees } from '../calendar/ItemDialogs'

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

/** The time now, ticking every 30 seconds. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

const todaysMeetings = (google: GoogleCalendarState, today: string) =>
  google.events.filter((m) => !m.all_day && m.starts_at && todayIso(new Date(m.starts_at)) === today)

/** "Now · Ends in 12 min", "Next · Starts in 1 h", "Just ended · Ended 5 min ago". */
function Status({ live, ended, start, end, now }: { live: boolean; ended: boolean; start: Date; end: Date; now: Date }) {
  return (
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
  )
}

/** Up front: the meeting you're in, or the next one, with your note on it. */
export function NowPanel({ google, today, onOpen }: { google: GoogleCalendarState; today: string; onOpen: (m: GoogleCalendarEvent) => void }) {
  const now = useNow()
  const todays = todaysMeetings(google, today)
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
        <Status live={live} ended={ended} start={start} end={end} now={now} />
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

/**
 * The phone's version: one compact card for the meeting now (or next, or
 * just ended), with Join and Note. Nothing when there is no such meeting
 * (the agenda lists the day's meetings anyway); a one-line offer to connect
 * when the calendar isn't.
 */
export function NowCard({ google, today, onOpen, onNote }: {
  google: GoogleCalendarState
  today: string
  onOpen: (m: GoogleCalendarEvent) => void
  onNote: (m: GoogleCalendarEvent) => void
}) {
  const now = useNow()
  if (google.status === 'loading') return <Skeleton variant="rounded" height={64} sx={{ mb: 1.5 }} />
  if (google.status !== 'on') {
    return (
      <Stack direction="row" spacing={1} data-panel="now" sx={{ alignItems: 'center', mb: 1.5, p: 1, pl: 1.5, borderRadius: 1, bgcolor: alpha(MEETING_COLOR, 0.08) }}>
        <EventOutlinedIcon fontSize="small" sx={{ color: MEETING_COLOR }} />
        <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
          {google.error ?? (google.lapsed ? 'Reconnect your calendar to see meetings.' : 'See your meetings here.')}
        </Typography>
        <Button size="small" onClick={google.connect}>Connect</Button>
      </Stack>
    )
  }
  const found = nowMeeting(todaysMeetings(google, today), now)
  if (!found) return null
  const { meeting, live, ended } = found
  return (
    <Paper variant="outlined" data-panel="now"
      sx={{ mb: 1.5, p: 1.5, borderLeft: `4px solid ${MEETING_COLOR}`, bgcolor: (t) => alpha(MEETING_COLOR, t.palette.mode === 'dark' ? 0.12 : 0.05) }}>
      <Status live={live} ended={ended} start={new Date(meeting.starts_at!)} end={new Date(meeting.ends_at!)} now={now} />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
        <ButtonBase onClick={() => onOpen(meeting)} sx={{ flexGrow: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', borderRadius: 1, display: 'block' }}>
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>{meeting.title}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {formatTime(meeting.starts_at!)} – {formatTime(meeting.ends_at!)}
          </Typography>
        </ButtonBase>
        {meeting.meeting_url && !ended && (
          <Button size="small" variant="contained" startIcon={<VideocamOutlinedIcon />} href={meeting.meeting_url} target="_blank" rel="noopener noreferrer">
            Join
          </Button>
        )}
        <Button size="small" variant="outlined" startIcon={<EditNoteIcon />} onClick={() => onNote(meeting)}>Note</Button>
      </Stack>
    </Paper>
  )
}
