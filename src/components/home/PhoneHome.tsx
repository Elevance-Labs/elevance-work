// Home on a phone: today and the week ahead, as compact as it gets. One
// line for the date (with what's overdue), the meeting now as one card
// (Join, and your note on it in a sheet), a strip of the next seven days
// (a dot where something's on; the day picked kept in ?date=), and that
// day's agenda, overdue first on today. The full calendar is a tap away.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Box, Button, ButtonBase, Chip, Drawer, IconButton, Stack, Tooltip, Typography, alpha } from '@mui/material'
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined'
import { addDays, todayIso } from '../../lib/constants'
import type { GoogleCalendarEvent } from '../../lib/types'
import MeetingNote from '../notes/MeetingNote'
import { MeetingDialog } from '../calendar/ItemDialogs'
import { useItemDialog } from '../calendar/useItemDialog'
import AgendaRow from './AgendaRow'
import { NowCard } from './NowPanel'
import { dayHeading, useAgenda, type Entry } from './useAgenda'

const DAYS = 7

export default function PhoneHome() {
  const today = todayIso()
  const until = addDays(today, DAYS - 1)
  const { google, noted, overdue, entriesOn, tick } = useAgenda(today, until)
  const [params, setParams] = useSearchParams()
  const picked = params.get('date')
  const day = picked && picked >= today && picked <= until ? picked : today
  const [meeting, setMeeting] = useState<GoogleCalendarEvent | null>(null)
  const [noteFor, setNoteFor] = useState<GoogleCalendarEvent | null>(null)
  const { open, dialog } = useItemDialog()

  const pick = (d: string) => {
    const next = new URLSearchParams(params)
    if (d === today) next.delete('date')
    else next.set('date', d)
    setParams(next, { replace: true })
  }

  const days = Array.from({ length: DAYS }, (_, n) => addDays(today, n))
  const entries = entriesOn(day)
  const rows = (list: Entry[]) => (
    <Stack spacing={0.75}>
      {list.map((e) => <AgendaRow key={e.id} entry={e} today={today} noted={noted} onTick={tick} onOpen={open} />)}
    </Stack>
  )

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
        <Typography variant="h6" component="h1" sx={{ fontWeight: 700, flexGrow: 1 }} noWrap>
          {new Date(`${today}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
        </Typography>
        {overdue.length > 0 && <Chip size="small" color="error" variant="outlined" label={`${overdue.length} overdue`} />}
        <Tooltip title="Calendar">
          <IconButton component={Link} to="/calendar" aria-label="Calendar" edge="end">
            <CalendarMonthOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      <NowCard google={google} today={today} onOpen={setMeeting} onNote={setNoteFor} />

      <Box role="group" aria-label="Day" data-week-strip
        sx={{ display: 'grid', gridTemplateColumns: `repeat(${DAYS}, 1fr)`, gap: 0.5, mb: 1.5 }}>
        {days.map((d) => {
          const date = new Date(`${d}T00:00:00`)
          const selected = d === day
          const busy = entriesOn(d).length > 0 || (d === today && overdue.length > 0)
          return (
            <ButtonBase key={d} onClick={() => pick(d)} aria-pressed={selected} data-day={d}
              aria-label={date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              sx={{
                flexDirection: 'column', py: 0.75, borderRadius: 2, gap: 0.25,
                bgcolor: selected ? 'primary.main' : 'transparent', color: selected ? 'primary.contrastText' : 'text.primary',
                '&:hover': { bgcolor: selected ? 'primary.dark' : 'action.hover' },
              }}>
              <Typography variant="caption" sx={{ lineHeight: 1.2, color: selected ? 'inherit' : 'text.secondary', fontWeight: 600 }}>
                {date.toLocaleDateString(undefined, { weekday: 'narrow' })}
              </Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.2, fontWeight: d === today || selected ? 700 : 500, color: !selected && d === today ? 'primary.main' : 'inherit' }}>
                {date.getDate()}
              </Typography>
              <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: busy ? (selected ? 'primary.contrastText' : 'primary.main') : 'transparent' }} />
            </ButtonBase>
          )
        })}
      </Box>

      {day === today && overdue.length > 0 && (
        <Box data-agenda="overdue" sx={{ mb: 1.5, p: 1, borderRadius: 1, bgcolor: (t) => alpha(t.palette.error.main, 0.07), border: 1,
          borderColor: (t) => alpha(t.palette.error.main, 0.3) }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 0.5, fontWeight: 700, textTransform: 'uppercase', color: 'error.main' }}>
            Overdue ({overdue.length})
          </Typography>
          {rows(overdue)}
        </Box>
      )}
      <Typography variant="caption" sx={{ display: 'block', mb: 0.75, fontWeight: 700, textTransform: 'uppercase', color: day === today ? 'primary.main' : 'text.secondary' }}>
        {dayHeading(day, today)}
      </Typography>
      {entries.length ? rows(entries) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing on {day === today ? 'today' : 'this day'}.</Typography>
      )}

      <Drawer anchor="bottom" open={!!noteFor} onClose={() => setNoteFor(null)}
        slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))', maxHeight: '85vh' } } }}>
        {noteFor && (
          <Box data-panel="meeting-note">
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, flexGrow: 1 }}>{noteFor.title}</Typography>
              <Button onClick={() => setNoteFor(null)}>Done</Button>
            </Stack>
            <MeetingNote key={noteFor.id} meeting={noteFor} minRows={8} />
          </Box>
        )}
      </Drawer>
      {meeting && <MeetingDialog meeting={meeting} onClose={() => setMeeting(null)} />}
      {dialog}
    </Box>
  )
}
