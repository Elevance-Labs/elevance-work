// Sign-in and who reaches what: the AuthProvider's binding step, and the
// route, nav and tab gating for each role. The database enforces the same
// rules (test/sql/access.test.sql); this proves the app does not offer what
// it would refuse.
import { setupDom, reporter, text, button, buttons, click, navLabels, freezeToday, waitFor } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, authState, failNext, table, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)

// ---------------- signed out ----------------
reset()
await mountApp('/issues')
check('signed out, the login page shows', text().includes('Sign in with Google'))
check('signed out, no data is read', captured.reads.length === 0, captured.reads.join())

await click(button('Sign in with Google'))
const oauth = captured.auth.find((a) => a.call === 'signInWithOAuth')?.options as
  | { provider: string; options: { scopes?: string; queryParams: Record<string, string> } }
  | undefined
check('sign-in goes to Google', oauth?.provider === 'google', JSON.stringify(oauth))
check('the Google picker is narrowed to the company domain', oauth?.options.queryParams.hd === 'elevancelabs.com')
check('…and asks, once, for read-only access to your own calendar, offline',
  oauth?.options.scopes === 'https://www.googleapis.com/auth/calendar.events.readonly' && oauth.options.queryParams.access_type === 'offline',
  JSON.stringify(oauth))
check('…showing Google’s consent screen while this browser has no calendar grant, so the grant comes with signing in',
  oauth?.options.queryParams.prompt === 'consent select_account', JSON.stringify(oauth?.options.queryParams))
window.localStorage.setItem('el-work:calendar-grant', 'kept')
await click(button('Sign in with Google'))
const again = captured.auth.filter((a) => a.call === 'signInWithOAuth').at(-1)?.options as { options: { queryParams: Record<string, string> } } | undefined
check('…and once one is kept, signing in shows only the account chooser', again?.options.queryParams.prompt === 'select_account',
  JSON.stringify(again?.options.queryParams))
window.localStorage.removeItem('el-work:calendar-grant')

// ---------------- a session without a profile ----------------
reset()
signInAs(null)
await mountApp('/')
check('a session alone is not a login: bind_profile is asked', captured.rpcs.some((r) => r.name === 'bind_profile'))
check('refused, the user is signed out again', captured.auth.some((a) => a.call === 'signOut') && authState.session === null)
check('refused, the login page says why', text().includes('Sign-in refused') && text().includes('Sign in with Google'), text().slice(0, 200))

reset()
signInAs(PEOPLE.member)
failNext('rpc.bind_profile', { message: 'network down' })
await mountApp('/')
check('a failed check also signs out, and shows the error',
  authState.session === null && text().includes('Could not verify your account: network down'), text().slice(0, 200))

// ---------------- a member ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/')
check('a member lands on the dashboard', location.pathname === '/dashboard', location.pathname)
check('…greeted by name', text().includes('Sara'))
check('a member is offered the main areas and the issue list',
  navLabels().join() === 'Home,Calendar,Work,Todos,Notes,All issues', navLabels().join())
check('…and no Admin button', !document.querySelector('[aria-label="Admin"]'))

for (const path of ['/admin', '/admin/people', '/admin/issue-types', '/admin/workspace']) {
  reset()
  signInAs(PEOPLE.member)
  await mountApp(path)
  check(`a member sent to ${path} ends up on the dashboard`, location.pathname === '/dashboard', location.pathname)
}

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/settings')
check('a project member (not admin) is turned away from its settings', location.pathname === '/projects/WEB', location.pathname)
check('…and offered no Settings tab', !tabs().includes('Settings'), tabs().join())
check('a Scrum project has a backlog; every project its summary, board, timeline, issues, releases, reports, docs, your notes',
  tabs().join() === 'Summary,Backlog,Board,Timeline,Calendar,Issues,Releases,Reports,Docs,My notes', tabs().join())

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/OPS/backlog')
check('a Kanban project has no backlog: it goes to the board', location.pathname === '/projects/OPS/board', location.pathname)

// ---------------- someone in no project ----------------
reset()
signInAs(PEOPLE.outsider)
await mountApp('/projects')
check('the old projects list is now Work', location.pathname === '/work', location.pathname)
const cards = () => [...document.querySelectorAll('[data-project]')].map((c) => c.getAttribute('data-project')).join()
check('someone in no project has no projects of their own', cards() === '' && text().includes('You aren’t in a project yet'), cards())
await click(button('All projects'))
check('…and All projects shows only the open one', cards() === 'OPS', cards())
await mountApp('/projects/WEB')
check('a private project they are not in does not exist for them', text().includes("There's no project WEB you can see"), text().slice(0, 300))

// ---------------- a viewer ----------------
reset()
signInAs(PEOPLE.viewer)
await mountApp('/projects/WEB/board')
check('a viewer sees the board', text().includes('Hero banner'))
check('…as a viewer', text().includes('Viewer'))
check('…without the card menus that move issues', !document.querySelector('[aria-label^="Move WEB-"]'))
check('…nor a Create issue in the first column', !buttons('Create issue').length)

// ---------------- an admin ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB')
check('…and every project’s settings', tabs().includes('Settings'), tabs().join())
const admin = document.querySelector<HTMLAnchorElement>('header a[aria-label="Admin"]')
check('an admin has an Admin button in the header, not admin pages in the navigation',
  !!admin && !navLabels().some((l) => ['People', 'Issue types', 'Workspace'].includes(l ?? '')), navLabels().join())
await click(admin)
check('…which opens the admin page on People', await waitFor(() => location.pathname === '/admin/people'), location.pathname)
check('…with its tabs', tabs().join() === 'People,Issue types,Workspace', tabs().join())
await click(document.querySelector('[role="tab"][href$="/admin/workspace"]'))
check('…each its own page', await waitFor(() => location.pathname === '/admin/workspace'), location.pathname)
await mountApp('/work')
check('…and can create projects', !!button('Create project'))
check('…seeing every project as a card', cards() === 'OPS,WEB', cards())

reset()
signInAs(PEOPLE.member)
await mountApp('/work')
check('a member can’t create projects', !button('Create project'))

// ---------------- an archived project ----------------
reset()
table('projects').find((p) => p.key === 'WEB')!.archived_at = '2026-10-01T00:00:00Z'
signInAs(PEOPLE.member)
await mountApp('/projects/WEB')
check('an archived project leaves the navigation', !navLabels().includes('Website'), navLabels().join())
check('…and says it is read-only', text().includes('This project is archived'))
check('…and its members are only viewers', text().includes('Viewer'))

done()
