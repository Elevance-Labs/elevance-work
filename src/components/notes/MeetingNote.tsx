// Your note on a meeting from your Google Calendar: one per meeting (each
// occurrence of a repeating one is its own), written in place and saved as
// you type. The first words create it, titled after the meeting; it is an
// ordinary note from then on (the Notes page, search), private to you.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Link as MuiLink, Stack, TextField, Typography } from '@mui/material'
import { useMe } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/constants'
import { meetingDay } from '../../lib/calendar'
import type { GoogleCalendarEvent, Note } from '../../lib/types'
import { emitItemChange } from '../../workspace/itemEvents'

// How long typing pauses before it is saved.
const SAVE_AFTER_MS = 800

type Status = 'loading' | 'idle' | 'saving' | 'saved' | 'error'

export default function MeetingNote({ meeting, minRows = 6, autoFocus, sx }: {
  meeting: GoogleCalendarEvent
  minRows?: number
  autoFocus?: boolean
  sx?: object
}) {
  const me = useMe()
  const [note, setNote] = useState<Note | null>(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  // The latest text and note, for saves that run after a pause or on leaving.
  const latest = useRef({ text: '', note: null as Note | null, dirty: false })
  // Saves run one after another, so a second can't create the note twice.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    supabase.from('notes').select('*').eq('owner_id', me.id).eq('meeting_id', meeting.id).maybeSingle()
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) {
          setError(errorMessage(e))
          setStatus('error')
          return
        }
        const found = (data as Note | null) ?? null
        latest.current = { text: found?.body ?? '', note: found, dirty: false }
        setNote(found)
        setText(found?.body ?? '')
        setStatus('idle')
      })
    return () => {
      cancelled = true
    }
  }, [me.id, meeting.id])

  const save = useCallback(() => {
    queue.current = queue.current.then(async () => {
      const { text: body, note: current, dirty } = latest.current
      if (!dirty) return
      latest.current.dirty = false
      // Nothing written yet: nothing to keep.
      if (!current && !body.trim()) return
      setStatus('saving')
      let saved: Note | null = null
      let failure: { code?: string; message: string } | null = null
      if (current) {
        const r = await supabase.from('notes').update({ body }).eq('id', current.id).select('*').single()
        saved = r.data as Note | null
        failure = r.error
      } else {
        const r = await supabase.from('notes').insert({
          title: meeting.title.slice(0, 200), body, meeting_id: meeting.id,
          meeting_title: meeting.title.slice(0, 300), meeting_on: meetingDay(meeting),
        }).select('*').single()
        saved = r.data as Note | null
        failure = r.error
        // Made a moment ago somewhere else (another tab): write into that one.
        if (failure?.code === '23505') {
          const existing = await supabase.from('notes').select('*').eq('owner_id', me.id).eq('meeting_id', meeting.id).single()
          if (existing.data) {
            const r2 = await supabase.from('notes').update({ body }).eq('id', (existing.data as Note).id).select('*').single()
            saved = r2.data as Note | null
            failure = r2.error
          }
        }
      }
      if (failure || !saved) {
        latest.current.dirty = true
        setError(errorMessage(failure))
        setStatus('error')
        return
      }
      latest.current.note = saved
      setNote(saved)
      setError(null)
      setStatus(latest.current.dirty ? 'saving' : 'saved')
      emitItemChange('note')
    })
    return queue.current
  }, [me.id, meeting])

  // Leaving with unsaved words saves them.
  useEffect(() => () => {
    window.clearTimeout(timer.current)
    if (latest.current.dirty) save()
  }, [save])

  const change = (value: string) => {
    setText(value)
    latest.current.text = value
    latest.current.dirty = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, SAVE_AFTER_MS)
  }

  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? error : note ? '' : 'Only you see this note.'

  return (
    <Box sx={sx} data-meeting-note={meeting.id}>
      <TextField
        multiline fullWidth minRows={minRows} placeholder="Take notes on this meeting…" value={text}
        disabled={status === 'loading'} autoFocus={autoFocus}
        onChange={(e) => change(e.target.value)}
        onBlur={() => {
          window.clearTimeout(timer.current)
          save()
        }}
        slotProps={{ htmlInput: { 'aria-label': `Your notes on ${meeting.title}`, maxLength: 20000 } }}
        sx={{ '& .MuiInputBase-root': { bgcolor: 'background.paper', alignItems: 'flex-start' } }}
      />
      <Stack direction="row" sx={{ mt: 0.5, alignItems: 'center', minHeight: 20 }}>
        <Typography variant="caption" role="status" sx={{ color: status === 'error' ? 'error.main' : 'text.secondary', flexGrow: 1 }}>
          {label}
        </Typography>
        {note && (
          <MuiLink component={Link} to={`/notes?note=${note.id}`} variant="caption">Open in notes</MuiLink>
        )}
      </Stack>
    </Box>
  )
}
