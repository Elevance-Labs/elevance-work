import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { COMPANY_DOMAIN } from '../lib/constants'
import { SSO_PARAM, ssoHint } from '../lib/suite'
import { CALENDAR_SIGN_IN, calendarSignInPrompt, takeCalendarGrant } from '../lib/googleCalendar'
import type { Profile } from '../lib/types'

interface AuthState {
  loading: boolean
  profile: Profile | null
  error: string | null
  // Workspace admin: every project's admin, plus people, issue types and settings.
  isAdmin: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  // Re-read your own profile (after renaming yourself).
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const NOT_ALLOWED = `Sign-in refused. You need an @${COMPANY_DOMAIN} Google account that a workspace admin has added. Ask an admin if you think this is a mistake.`

// Supabase reports OAuth failures as error_description in the query string or hash.
function readOAuthError(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('error_description')
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#\/?/, '')).get('error_description')
  return fromQuery ?? fromHash
}

// A sibling app's switcher hands the person over with their company email in
// the address (`?sso=`). It is read once, as the page loads, and taken out of
// the address so that a reload, a bookmark or the return from Google never
// carries it again.
function takeSsoHint(): string | null {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(SSO_PARAM)) return null
  const hint = ssoHint(url.search, COMPANY_DOMAIN)
  url.searchParams.delete(SSO_PARAM)
  window.history.replaceState(window.history.state, '', url)
  return hint
}
const handedOver = takeSsoHint()

const withPrompt = (params: Record<string, string>, prompt: string | undefined) => (prompt ? { ...params, prompt } : params)
let handOverStarted = false

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionReady, setSessionReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [binding, setBinding] = useState(false)
  const [error, setError] = useState<string | null>(readOAuthError)
  const [handOverFailed, setHandOverFailed] = useState(false)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Just signed in with Google: keep its calendar grant, if it sent one, for
      // the google-calendar function; back from Connect, return to where we were.
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        const returnTo = takeCalendarGrant(session)
        if (returnTo) window.location.hash = returnTo
      }
      setUserId(session?.user.id ?? null)
      setSessionReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Handed over from a sibling app with no session here: go straight to
  // Google, naming the account, with no chooser. Google already knows them, so
  // it comes back signed in without showing a screen. Tried once per page
  // load; whatever Google returns, the address no longer carries the hint.
  const handingOver = sessionReady && !userId && handedOver !== null && !handOverFailed
  useEffect(() => {
    if (!handingOver || handOverStarted) return
    handOverStarted = true
    supabase.auth
      .signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          scopes: CALENDAR_SIGN_IN.scopes,
          // No chooser; Google's consent screen only if this browser has no calendar grant yet.
          queryParams: withPrompt({ ...CALENDAR_SIGN_IN.queryParams, hd: COMPANY_DOMAIN, login_hint: handedOver as string }, calendarSignInPrompt(false)),
        },
      })
      .then(({ error: signInError }) => {
        if (!signInError) return
        setError(signInError.message)
        setHandOverFailed(true)
      })
  }, [handingOver])

  // A session alone is not enough: the user must match an active profile.
  useEffect(() => {
    if (!sessionReady) return
    if (!userId) {
      setProfile(null)
      return
    }
    let cancelled = false
    setBinding(true)
    supabase
      .rpc('bind_profile')
      .maybeSingle()
      .then(async ({ data, error: rpcError }) => {
        if (cancelled) return
        if (rpcError || !data) {
          setError(rpcError ? `Could not verify your account: ${rpcError.message}` : NOT_ALLOWED)
          await supabase.auth.signOut()
        } else {
          setProfile(data as Profile)
        }
        setBinding(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionReady, userId])

  const refreshProfile = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase.from('profiles').select('*').eq('id', profile.id).maybeSingle()
    if (data) setProfile(data as Profile)
  }, [profile])

  const value = useMemo<AuthState>(
    () => ({
      loading: !sessionReady || binding || handingOver || (!!userId && !profile),
      profile,
      error,
      isAdmin: profile?.app_role === 'admin',
      signIn: async () => {
        setError(null)
        const { error: signInError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            // Read-only access to your own Google Calendar comes with signing in.
            scopes: CALENDAR_SIGN_IN.scopes,
            // hd only pre-filters the Google account picker; the database enforces the domain.
            queryParams: withPrompt({ ...CALENDAR_SIGN_IN.queryParams, hd: COMPANY_DOMAIN }, calendarSignInPrompt(true)),
          },
        })
        if (signInError) setError(signInError.message)
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
      refreshProfile,
    }),
    [sessionReady, binding, handingOver, userId, profile, error, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** The signed-in profile, inside the signed-in part of the app. */
export function useMe() {
  const { profile } = useAuth()
  if (!profile) throw new Error('useMe used while signed out')
  return profile
}
