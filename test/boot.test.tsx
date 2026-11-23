// Starting up after a fresh sign-in: back from Google with a code to exchange.
// The profile may be bound only now, so the workspace is read after
// bind_profile, never beside it (reads raced against a first binding could
// come back part empty). A session restored from the device reads beside it:
// see access.test.tsx.
import { setupDom, reporter } from './setup'
setupDom('http://localhost/elevance-work/?code=abc#/dashboard')

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB')
const bind = captured.calls.indexOf('rpc.bind_profile')
const firstRead = captured.calls.indexOf('profiles.select')
check('a fresh sign-in binds first, then reads the workspace', bind >= 0 && firstRead > bind, captured.calls.slice(0, 8).join())
check('…only your memberships, once your profile is known',
  captured.selects.find((s) => s.table === 'project_members')?.filters.some((f) => f[0] === 'profile_id'))
check('…once', captured.selects.filter((s) => s.table === 'profiles' && s.columns.startsWith('id, email, full_name')).length === 1)
check('…and the app opens', location.pathname === '/projects/WEB', location.pathname)

done()
