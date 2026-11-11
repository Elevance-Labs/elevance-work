// Your own Google Calendar, read-only, through the `google-calendar` Edge
// Function. Google sign-in itself asks for read-only calendar access offline
// (CALENDAR_SIGN_IN); when Google sends you back with a refresh token,
// AuthProvider hands it here (takeCalendarGrant) and the next read passes it
// to the function, which keeps it. Connect is the fallback for an account
// whose sign-in left no grant. The browser never calls Google itself.
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { COMPANY_DOMAIN, addDays } from './constants'
import type { GoogleCalendarEvent } from './types'

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
// Mirrored by MAX_RANGE_DAYS in supabase/functions/google-calendar.
export const MAX_RANGE_DAYS = 100

// Set while Connect's consent screen is open: the route to come back to.
const CONNECTING = 'el-work:connecting-calendar'

export type GoogleCalendarResult =
  | { connected: true; email: string; events: GoogleCalendarEvent[] }
  | { connected: false; lapsed?: boolean }

async function call<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('google-calendar', { body })
  if (error) {
    const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context
    const message = await context?.json?.().then((b) => b?.error).catch(() => undefined)
    return { data: null, error: message ?? 'Google Calendar is not reachable right now.' }
  }
  return { data: data as T, error: null }
}

function stored(area: 'session' | 'local') {
  return {
    get: (key: string) => {
      try {
        return window[`${area}Storage`].getItem(key)
      } catch {
        return null
      }
    },
    set: (key: string, value: string) => {
      try {
        window[`${area}Storage`].setItem(key, value)
      } catch {
        // Without storage the worst case is handing a grant over twice.
      }
    },
    clear: (key: string) => {
      try {
        window[`${area}Storage`].removeItem(key)
      } catch {
        // As above.
      }
    },
  }
}
const tab = stored('session')
const device = stored('local')

// A fingerprint (not the token) of the last grant the function kept. Supabase
// keeps Google's refresh token in the stored session until it next refreshes,
// so every reload would otherwise hand the same grant over again.
const HANDED = 'el-work:calendar-grant'
function fingerprint(token: string) {
  let h = 5381
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * What every Google sign-in asks for, on top of who you are: read-only access
 * to your calendar's events, offline, so the function can keep reading it.
 * Google asks once; after that, signing in shows no extra screen.
 */
export const CALENDAR_SIGN_IN = {
  scopes: CALENDAR_SCOPE,
  queryParams: { access_type: 'offline', include_granted_scopes: 'true' },
} as const

/**
 * Google's `prompt` for a sign-in. Google hands over a refresh token only when
 * it shows its consent screen, and skips that screen for an account that
 * consented before. So until this browser has seen a grant kept, sign-in asks
 * for the consent screen explicitly; after that, signing in shows nothing extra.
 */
export function calendarSignInPrompt(chooser: boolean) {
  const consent = device.get(HANDED) === null
  return [consent && 'consent', chooser && 'select_account'].filter(Boolean).join(' ') || undefined
}

/**
 * The fallback, when sign-in didn't leave a grant (Google sends a refresh
 * token only on a fresh consent, so an account that consented before needs
 * this once): Google's consent screen again, back to `returnTo` afterwards.
 */
export async function connectGoogleCalendar(email: string, returnTo: string) {
  tab.set(CONNECTING, returnTo)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      scopes: CALENDAR_SIGN_IN.scopes,
      queryParams: { ...CALENDAR_SIGN_IN.queryParams, hd: COMPANY_DOMAIN, login_hint: email, prompt: 'consent' },
    },
  })
  if (error) tab.clear(CONNECTING)
  return error?.message ?? null
}

let pendingGrant: string | null = null
// Connect was pressed, but Google came back without a grant: said once, on the next read.
let missingGrant = false
// The hand-over of that grant to the function, while it is in flight and, if
// it failed, for the rest of this page load: its error, or null once kept.
let handOver: Promise<string | null> | null = null

/**
 * Called by AuthProvider on every session it is given. Google's refresh token
 * is on the session only just after a Google sign-in; when it is there and
 * new, keep it for the next read, which hands it to the function. Returns the
 * route to go back to after pressing Connect, if that is what this was.
 */
export function takeCalendarGrant(session: Session | null): string | null {
  const returnTo = tab.get(CONNECTING)
  if (returnTo !== null) tab.clear(CONNECTING)
  const token = session?.provider_refresh_token
  if (token && token !== pendingGrant && fingerprint(token) !== device.get(HANDED)) pendingGrant = token
  else if (returnTo !== null && !token) missingGrant = true
  return returnTo
}

/**
 * Your events touching the local days [from, to]; first hands over a fresh grant.
 *
 * Several readers can ask at once (the page re-reads when its range changes,
 * and the dashboard reads too). Only the first carries the grant, so the rest
 * wait for that hand-over rather than racing past it: a read that got in
 * before the grant was kept would be told "not connected" and offer Connect
 * again. A hand-over that failed keeps answering with why, instead of falling
 * back to "not connected" on the next read.
 */
export async function loadGoogleCalendar(from: string, to: string) {
  if (pendingGrant) {
    const grant = pendingGrant
    pendingGrant = null
    missingGrant = false
    handOver = call<{ connected: true }>({ action: 'connect', refresh_token: grant }).then((r) => {
      if (!r.error) device.set(HANDED, fingerprint(grant))
      return r.error
    })
  }
  if (handOver) {
    const failed = await handOver
    if (failed) return { data: null, error: failed }
    handOver = null
  }
  if (missingGrant) {
    missingGrant = false
    return { data: null, error: "Google didn't send calendar access. Try Connect again, and leave “See events on all your calendars” ticked." }
  }
  return call<GoogleCalendarResult>({
    action: 'events',
    time_min: new Date(`${from}T00:00:00`).toISOString(),
    time_max: new Date(`${addDays(to, 1)}T00:00:00`).toISOString(),
  })
}

