// Getting around: the Work page (your projects, your issues, recent activity
// on what you watch), saved filters pinned to the navigation, and on a phone
// the bottom bar and the compact Home.
import { setupDom, reporter, text, button, click, navLabels, freezeToday, waitFor, setScreen, labelled, typeInto, settle } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, googleCalendar, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

const cards = () => [...document.querySelectorAll('[data-project]')].map((c) => c.getAttribute('data-project')).join()
const tab = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(name))

// ---------------- Work ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/work')
check('Work shows the projects you are in, as cards', cards() === 'OPS,WEB', cards())
check('…each with its active sprint’s progress', await waitFor(() =>
  document.querySelector('[data-project="WEB"]')?.textContent?.includes('WEB Sprint 1') &&
  document.querySelector('[data-project="WEB"]')?.textContent?.includes('1 of 3 done')))
check('My issues is the first tab: your open issues', await waitFor(() => tab('My issues')?.textContent === 'My issues (3)') &&
  text().includes('Hero banner') && !text().includes('Fix the footer links'), tab('My issues')?.textContent)
check('…asking only for yours, unresolved', captured.selects.some((s) => s.table === 'issues' &&
  JSON.stringify(s.filters) === '[["assignee_id","eq","p-sara"],["resolved_at","is",null]]'))

await click(tab('Recent activity'))
check('Recent activity is kept in the address', await waitFor(() => location.search === '?tab=activity'), location.search)
check('…read with watched_activity', captured.rpcs.some((r) => r.name === 'watched_activity'))
const activity = () => document.querySelector('[data-activity]')?.textContent ?? ''
check('…listing the issues you watch, with who last did what', await waitFor(() => activity().includes('WEB-2') &&
  activity().includes('Amna Khan commented')), activity())

table('issue_events').push({ id: 'e-1', issue_id: 'i-web-2', project_id: 'pr-web', actor_id: 'p-sara', field: 'status',
  from_value: 'To Do', to_value: 'In Review', from_id: null, to_id: null, created_at: new Date().toISOString() })
await mountApp('/work?tab=activity')
check('a later change takes over, in words, and you are You', await waitFor(() => activity().includes('You set Status to In Review')), activity())

// ---------------- pinned views ----------------
reset()
signInAs(PEOPLE.member)
table('saved_filters').push({ id: 'sf-1', owner_id: 'p-sara', name: 'My open', query: { assignees: ['me'] }, shared: false, created_at: TODAY })
table('saved_filters').push({ id: 'sf-2', owner_id: 'p-amna', name: 'Amna private', query: {}, shared: false, created_at: TODAY })
await mountApp('/issues')
check('no pins, no views under Issues', navLabels().join() === 'Home,Calendar,Work,Todos,Notes,All issues', navLabels().join())
await click(button('Filters'))
check('only filters you can read are offered', !!button('Pin My open') && !button('Pin Amna private'))
await click(button('Pin My open'))
check('pinning one writes your pin', captured.inserts.some((i) => i.table === 'saved_filter_pins' && i.rows[0].filter_id === 'sf-1'))
check('…and it shows under Issues', await waitFor(() => navLabels().includes('My open')), navLabels().join())
await click(document.body.querySelector('.MuiBackdrop-root'))
await click(document.querySelector('.MuiDrawer-root a[aria-label="My open"]'))
check('it opens the Issues page with its filter', await waitFor(() => location.pathname === '/issues' && location.search === '?assignees=me'),
  location.pathname + location.search)
check('…and is the current page in the navigation', await waitFor(() =>
  document.querySelector('.MuiDrawer-root .Mui-selected')?.getAttribute('aria-label') === 'My open'))
await mountApp('/issues')
check('a pin stays (it is in the database)', await waitFor(() => navLabels().includes('My open')))
check('…and All issues is current on the whole list', document.querySelector('.MuiDrawer-root .Mui-selected')?.getAttribute('aria-label') === 'All issues')
await click(button('Filters'))
await click(button('Unpin My open'))
check('unpinning takes it away', await waitFor(() => !navLabels().includes('My open')) &&
  captured.deletes.some((d) => d.table === 'saved_filter_pins'))
check('a wide screen has no bottom bar', !document.querySelector('nav[aria-label="Main"]'))

// ---------------- a phone ----------------
reset()
signInAs(PEOPLE.member)
setScreen({ width: 390 })
const local = (d: string, t: string) => new Date(`${d}T${t}:00`).toISOString()
googleCalendar.connected = true
googleCalendar.events = [
  { id: 'g-design', title: 'Design review', all_day: false, start_date: null, end_date: null, starts_at: local(TODAY, '11:45'),
    ends_at: local(TODAY, '12:30'), url: '', meeting_url: 'https://meet.google.com/abc', location: null, description: null, organizer: null, attendees: [] },
  { id: 'g-client', title: 'Client call', all_day: false, start_date: null, end_date: null, starts_at: local('2026-10-22', '09:00'),
    ends_at: local('2026-10-22', '10:00'), url: '', meeting_url: null, location: null, description: null, organizer: null, attendees: [] },
]
await mountApp('/dashboard')
const bar = () => document.querySelector('nav[aria-label="Main"]')
const barTabs = () => [...(bar()?.querySelectorAll('a') ?? [])].map((a) => a.textContent).join()
const barCurrent = () => bar()?.querySelector('.Mui-selected')?.textContent
check('a phone has the bottom bar: Home, Work, Todos, Notes', barTabs() === 'Home,Work,Todos,Notes', barTabs())
check('…on Home', barCurrent() === 'Home', barCurrent())
// The page must end above the bar. The phone's padding is a media rule (MUI
// puts responsive values there), so the bottom padding has to be in it too:
// a plain padding-bottom would lose to it and the end of the page would sit
// behind the bar.
const mainRules = [...document.styleSheets].flatMap((s) => [...s.cssRules]).map((r) => r.cssText)
  .filter((t) => [...document.querySelector('main')!.classList].some((c) => t.includes(`.${c}`)))
const phoneRule = mainRules.find((t) => t.startsWith('@media (min-width:0px)')) ?? ''
check('…and the page ends above it, not behind it', phoneRule.includes('calc(72px + env(safe-area-inset-bottom))'), mainRules.join(' | '))
check('Home is the compact one: no greeting, no panels', !text().includes('Good afternoon') && !document.querySelector('[data-panel="todos"]'))
const now = () => document.querySelector('[data-panel="now"]')
check('the meeting now is one card, with Join and Note', await waitFor(() => !!now()?.textContent?.includes('Design review')) &&
  button('Join', now()!)?.getAttribute('href') === 'https://meet.google.com/abc' && !!button('Note', now()!))
await click(button('Note', now()!))
const sheet = () => document.querySelector('[data-panel="meeting-note"]')
check('Note opens your note on it in a sheet', await waitFor(() => !!sheet() && !!labelled('Your notes on Design review', sheet()!)))
await typeInto('Your notes on Design review', 'Ask about launch', sheet()!)
await click(button('Done', sheet()!))
check('…saved as the meeting’s note', await waitFor(() => captured.inserts.some((i) => i.table === 'notes' &&
  i.rows[0].meeting_id === 'g-design' && i.rows[0].body === 'Ask about launch'), 3000))

const days = () => [...document.querySelectorAll('[data-week-strip] [data-day]')]
check('a strip of the next seven days, from today', days().length === 7 && days()[0].getAttribute('data-day') === TODAY &&
  days()[0].getAttribute('aria-pressed') === 'true')
check('today: the overdue first, then today’s agenda', !!document.querySelector('[data-agenda="overdue"]') && text().includes('2 overdue'))
await click(days()[1])
check('picking a day keeps it in the address', await waitFor(() => location.search === '?date=2026-10-22'), location.search)
check('…and shows that day’s agenda, without the overdue', text().includes('Tomorrow') && text().includes('Client call') &&
  !document.querySelector('[data-agenda="overdue"]'))
check('the full calendar is a tap away', document.querySelector('a[aria-label="Calendar"]')?.getAttribute('href') === '/calendar')

for (const [path, want] of [['/calendar', 'Home'], ['/work', 'Work'], ['/issues', 'Work'], ['/projects/WEB/board', 'Work'], ['/todos', 'Todos'], ['/notes', 'Notes']]) {
  await mountApp(path)
  await settle()
  check(`${path} sits under ${want} in the bottom bar`, barCurrent() === want, barCurrent())
}
await mountApp('/work')
check('on a phone the project cards sit side by side, to scroll', cards() === 'OPS,WEB')
setScreen({ width: 1280 })

done()
