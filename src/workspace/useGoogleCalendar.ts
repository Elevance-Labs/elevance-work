// Your own Google Calendar for a range of local days: whether it's connected,
// its meetings, and connecting. Used by the calendars and the dashboard;
// only you ever see your events. There is no disconnecting from the app: the
// connection lapses only when Google withdraws it, or you're deactivated.
import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMe } from '../auth/AuthProvider'
import { connectGoogleCalendar, loadGoogleCalendar } from '../lib/googleCalendar'
import type { GoogleCalendarEvent } from '../lib/types'

export interface GoogleCalendarState {
  // 'loading' until the first answer; 'off' when not connected; 'error' when it couldn't be read.
  status: 'loading' | 'off' | 'on' | 'error'
  email: string | null
  events: GoogleCalendarEvent[]
  error: string | null
  // Was connected, but Google no longer accepts the grant (revoked or expired).
  lapsed: boolean
  connect: () => Promise<void>
}

/** enabled: false reads nothing (a view where meetings are switched off). */
export function useGoogleCalendar(from: string, to: string, enabled = true): GoogleCalendarState {
  const me = useMe()
  const location = useLocation()
  const [status, setStatus] = useState<GoogleCalendarState['status']>('loading')
  const [email, setEmail] = useState<string | null>(null)
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lapsed, setLapsed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    loadGoogleCalendar(from, to).then(({ data, error: e }) => {
      if (cancelled) return
      if (e || !data) {
        setStatus('error')
        setError(e)
        setEvents([])
      } else if (data.connected) {
        setStatus('on')
        setEmail(data.email)
        setEvents(data.events)
        setError(null)
        setLapsed(false)
      } else {
        setStatus('off')
        setEvents([])
        setError(null)
        setLapsed(!!data.lapsed)
      }
    })
    return () => {
      cancelled = true
    }
  }, [from, to, enabled])

  const connect = useCallback(async () => {
    const e = await connectGoogleCalendar(me.email, location.pathname + location.search)
    if (e) {
      setStatus('error')
      setError(e)
    }
  }, [me.email, location.pathname, location.search])

  return { status, email, events, error, lapsed, connect }
}
