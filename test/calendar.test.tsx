// The calendar: the week (by default) and day timelines, what a month shows
// (epics across their days, your issues, releases, your todos; no sprints),
// that clicking anything opens a dialog and nothing is created here; your
// Google Calendar as the source of meetings, and a note taken on one; and a
// project's own Calendar tab.
import { setupDom, reporter, text, button, click, dialog, chooseLabelled, labelled, typeInto, freezeToday, waitFor } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, authState, googleCalendar, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

const day = (iso: string) => document.querySelector(`[data-day="${iso}"]`)
const allDay = (iso: string) => document.querySelector(`[data-allday="${iso}"]`)
const viewButton = (name: string) => button(name, document.querySelector('[aria-label="View"]')!)
const layer = (name: string) => button(name, document.querySelector('[aria-label="Show"]')!)
const item = (iso: string, title: string, root: ParentNode | null = day(iso)) =>
  [...(root?.querySelectorAll<HTMLElement>('[data-item]') ?? [])].find((b) => b.textContent?.includes(title))

// The epic gets dates, so it spans part of this week.
const datedEpic = () => Object.assign(table('issues').find((i) => i.key === 'WEB-1')!, { start_date: '2026-10-19', due_date: '2026-10-23' })

reset()
datedEpic()
signInAs(PEOPLE.member)
await mountApp('/calendar')
check('the calendar opens on this week', text().includes('Oct 19 – 25, 2026') && !!viewButton('Week')?.classList.contains('Mui-selected') &&
  document.querySelectorAll('[data-day]').length === 7 && !!day('2026-10-19') && !!day('2026-10-25'))
check('…with a day and a month view', !!viewButton('Day') && !!viewButton('Month'))
check('…and nothing to create: meetings are made in Google Calendar', !button('New event') && !text().includes('New event'))
check('its layers: your meetings, epics, your issues, releases, your todos; no sprints',
  ['My meetings', 'Epics', 'My issues', 'Releases', 'My todos'].every((l) => !!layer(l)) && !layer('Sprints') && !layer('Events'))
check('an epic spans its start to its due date', await waitFor(() => !!item('2026-10-19', 'WEB-1 Launch the new site', allDay('2026-10-19'))) &&
  !!item('2026-10-23', 'WEB-1', allDay('2026-10-23')) && !item('2026-10-24', 'WEB-1', allDay('2026-10-24')))
check('your issue sits on its due day, your todo on its day',
  !!item('2026-10-20', 'WEB-5 Pricing page', allDay('2026-10-20')) && !!item(TODAY, 'Write the brief', allDay(TODAY)))
check('the sprint is no longer on the calendar', !text().includes('WEB Sprint 1'))

await click(item('2026-10-20', 'WEB-5', allDay('2026-10-20')))
check('clicking an issue opens it over the calendar', await waitFor(() => new URLSearchParams(location.search).get('issue') === 'WEB-5') &&
  location.pathname === '/calendar', location.search)

reset()
datedEpic()
signInAs(PEOPLE.member)
await mountApp('/calendar')
await waitFor(() => !!item(TODAY, 'Write the brief', allDay(TODAY)))
await click(item(TODAY, 'Write the brief', allDay(TODAY)))
check('clicking a todo opens it in a dialog', dialog()?.textContent?.includes('Write the brief') && !!dialog()?.textContent?.includes('All todos'))
await click(dialog()!.querySelector('input[type="checkbox"]'))
check('…where it can be ticked off', captured.updates.some((u) => u.table === 'todos' && typeof u.values.done_at === 'string' &&
  JSON.stringify(u.filters) === '[["id","eq","td-1"]]'))
await click(button('Close', dialog()!))

await click(button('Open Oct 22, 2026'))
check('a day’s heading opens that day alone', await waitFor(() => document.querySelectorAll('[data-day]').length === 1) &&
  !!day('2026-10-22') && location.search === '?view=day&date=2026-10-22' && text().includes('Thursday, October 22, 2026') &&
  !!viewButton('Day')?.classList.contains('Mui-selected'), location.search)
await click(button('Previous day'))
check('days move', await waitFor(() => !!day('2026-10-21')) && location.search === '?view=day&date=2026-10-21')

await click(viewButton('Month'))
check('the month is a click away', await waitFor(() => text().includes('October 2026')) && location.search === '?month=2026-10' &&
  document.querySelectorAll('[data-day]').length === 42, location.search)
check('a release shows on its date', await waitFor(() => !!item('2026-10-30', 'WEB v1.0')))
await click(item('2026-10-30', 'WEB v1.0'))
check('clicking a release opens it in a dialog, with its progress', await waitFor(() => !!dialog()?.textContent?.includes('1 of 2 issues done')) &&
  !!button('Open release', dialog()!) && location.pathname === '/calendar', dialog()?.textContent)
await click(button('Close', dialog()!))

await click(layer('Releases'))
check('a layer can be hidden', await waitFor(() => !item('2026-10-30', 'WEB v1.0')))
await click(layer('Releases'))
check('…and is remembered', JSON.parse(window.localStorage.getItem('el-work:calendar-layers') ?? '[]').includes('release'))

await chooseLabelled('Project', 'Operations')
check('choosing a project leaves only its dates', await waitFor(() => !item('2026-10-30', 'WEB v1.0')) && !item('2026-10-20', 'WEB-5'))

await click(button('Open Oct 28, 2026'))
check('a day’s number in the month opens that day', await waitFor(() => location.search === '?view=day&date=2026-10-28'), location.search)

// ---------------- your Google Calendar: where meetings come from ----------------
const googleEvents = [
  { id: 'g1', title: 'Client call', all_day: false, start_date: null, end_date: null,
    starts_at: '2026-10-22T16:00:00.000Z', ends_at: '2026-10-22T17:00:00.000Z',
    url: 'https://www.google.com/calendar/event?eid=g1', meeting_url: 'https://meet.google.com/abc-defg-hij', location: 'Room 2',
    description: 'Agenda:\nPricing', organizer: { email: 'amna@elevancelabs.com', name: null },
    attendees: [{ email: 'sara@elevancelabs.com', name: null, response: 'accepted' }, { email: 'client@acme.com', name: 'Jo Client', response: 'tentative' }] },
  { id: 'g2', title: 'Conference', all_day: true, start_date: '2026-10-26', end_date: '2026-10-27',
    starts_at: null, ends_at: null, url: 'https://www.google.com/calendar/event?eid=g2', meeting_url: null, location: null,
    description: null, organizer: null, attendees: [] },
]
const googleCalls = () => captured.functions.filter((f) => f.name === 'google-calendar').map((f) => f.body as Record<string, unknown>)

window.localStorage.clear()
reset()
signInAs(PEOPLE.member)
await mountApp('/calendar')
check('not connected: you are offered to connect', await waitFor(() => !!button('Connect Google Calendar')))
const asked = googleCalls()[0]
check('…after asking for the week shown', asked?.action === 'events' &&
  new Date(String(asked.time_min)).getTime() === new Date('2026-10-19T00:00:00').getTime() &&
  new Date(String(asked.time_max)).getTime() === new Date('2026-10-26T00:00:00').getTime(), JSON.stringify(asked))
await click(button('Connect Google Calendar'))
const oauth = captured.auth.find((a) => a.call === 'signInWithOAuth')?.options as
  { options: { scopes: string; queryParams: Record<string, string> } } | undefined
check('connecting asks Google for read-only calendar access, offline, for your own account',
  oauth?.options.scopes === 'https://www.googleapis.com/auth/calendar.events.readonly' &&
  oauth.options.queryParams.access_type === 'offline' && oauth.options.queryParams.prompt === 'consent' &&
  oauth.options.queryParams.login_hint === PEOPLE.member.email, JSON.stringify(oauth))
check('…remembering where to come back to', window.sessionStorage.getItem('el-work:connecting-calendar') === '/calendar')

// Back from Google with a refresh token.
reset()
signInAs(PEOPLE.member)
window.sessionStorage.setItem('el-work:connecting-calendar', '/calendar')
authState.session!.provider_refresh_token = 'rt-1'
googleCalendar.events = googleEvents
await mountApp('/calendar')
const calls = googleCalls()
check('the grant is handed to the function before reading', calls[0]?.action === 'connect' && calls[0].refresh_token === 'rt-1' &&
  calls[1]?.action === 'events', JSON.stringify(calls))
check('…once only', window.sessionStorage.getItem('el-work:connecting-calendar') === null && window.location.hash === '#/calendar')
const call = () => item('2026-10-22', 'Client call')
check('your meetings show at their hour', await waitFor(() => !!call()) && getComputedStyle(call()!).top === `${9 * 48 + 1}px`)
check('…said to be yours alone', text().includes(`Meetings from your Google Calendar (${PEOPLE.member.email}), visible only to you.`) &&
  !button('Connect Google Calendar') && !button('Disconnect'))
check('…and never a link out of the app', !call()!.getAttribute('href') && call()!.tagName === 'BUTTON')

await click(call())
const meeting = dialog()
check('clicking a meeting opens it in a dialog', !!meeting?.textContent?.includes('Client call') && !!meeting.textContent.includes('Room 2') &&
  !!meeting.textContent.includes('Agenda:') && location.pathname === '/calendar')
check('…with its guests, colleagues by name', !!meeting?.textContent?.includes('Sara Iqbal') && !!meeting.textContent.includes('Jo Client'))
check('…a way to join, and Google Calendar a click away', button('Join', meeting!)?.getAttribute('href') === 'https://meet.google.com/abc-defg-hij' &&
  button('Google Calendar', meeting!)?.getAttribute('target') === '_blank')
check('…and your notes on it, ready to write', !!labelled('Your notes on Client call', meeting!))
await typeInto('Your notes on Client call', 'They want annual pricing', meeting!)
check('a note is saved as you type, about this meeting', await waitFor(() => captured.inserts.some((i) => i.table === 'notes'), 3000))
const made = captured.inserts.find((i) => i.table === 'notes')?.rows[0]
check('…titled after it, with its day', made?.meeting_id === 'g1' && made.title === 'Client call' && made.meeting_title === 'Client call' &&
  made.meeting_on === '2026-10-22' && made.body === 'They want annual pricing', JSON.stringify(made))
check('…and said so, with the way to it among your notes', await waitFor(() => !!dialog()?.textContent?.includes('Saved')) &&
  !!dialog()?.querySelector('a[href*="/notes?note="]'))
await typeInto('Your notes on Client call', 'They want annual pricing, and SSO', dialog()!)
check('…more words change the same note', await waitFor(() => captured.updates.some((u) => u.table === 'notes' &&
  u.values.body === 'They want annual pricing, and SSO'), 3000) && captured.inserts.filter((i) => i.table === 'notes').length === 1)
await click(button('Close', dialog()!))
await click(call())
check('opening the meeting again shows your note', await waitFor(() =>
  (labelled<HTMLTextAreaElement>('Your notes on Client call', dialog()!)?.value ?? '') === 'They want annual pricing, and SSO'))
await click(button('Close', dialog()!))

await click(layer('My meetings'))
check('the meetings layer can be hidden', await waitFor(() => !call()))
await click(layer('My meetings'))
check('…and shown again', await waitFor(() => !!call()))

await click(button('Next week'))
check('an all-day one spans its days, inclusive', await waitFor(() => !!item('2026-10-26', 'Conference', allDay('2026-10-26'))) &&
  !!item('2026-10-27', 'Conference', allDay('2026-10-27')) && !item('2026-10-28', 'Conference', allDay('2026-10-28')))

// Signing in with Google brings the grant: no Connect needed.
window.localStorage.clear()
reset()
signInAs(PEOPLE.member)
authState.session!.provider_refresh_token = 'rt-signin'
googleCalendar.events = googleEvents
await mountApp('/calendar')
check('a grant from signing in is handed over, without pressing Connect',
  googleCalls()[0]?.action === 'connect' && googleCalls()[0].refresh_token === 'rt-signin' &&
  await waitFor(() => !!call()) && !button('Connect Google Calendar'), JSON.stringify(googleCalls()))

// Supabase keeps that token in the stored session: a reload doesn't hand it over again.
reset()
signInAs(PEOPLE.member)
authState.session!.provider_refresh_token = 'rt-signin'
googleCalendar.connected = true
await mountApp('/calendar')
check('…and a reload doesn’t hand the same grant over again', !googleCalls().some((c) => c.action === 'connect'), JSON.stringify(googleCalls()))

// Connect pressed, but Google sent no grant back: said, not silently asked again.
reset()
signInAs(PEOPLE.member)
window.sessionStorage.setItem('el-work:connecting-calendar', '/calendar')
await mountApp('/calendar')
check('Connect coming back without a grant says so', await waitFor(() => text().includes('Google didn\'t send calendar access')),
  text().slice(0, 300))

reset()
signInAs(PEOPLE.member)
googleCalendar.lapsed = true
await mountApp('/calendar')
check('a lapsed connection asks you to connect again', await waitFor(() => text().includes('Google no longer lets the app read your calendar')))

reset()
datedEpic()
signInAs(PEOPLE.member)
failNext('functions.google-calendar', { code: '', message: 'Google Calendar isn’t reachable right now.' })
await mountApp('/calendar')
check('when Google is down the calendar still shows, with a note', await waitFor(() => text().includes('Google Calendar isn’t reachable right now.')) &&
  await waitFor(() => !!item('2026-10-21', 'WEB-1', allDay('2026-10-21'))))

// ---------------- a project's calendar ----------------
window.localStorage.clear()
reset()
datedEpic()
signInAs(PEOPLE.member)
googleCalendar.connected = true
googleCalendar.events = googleEvents
await mountApp('/projects/WEB/calendar?month=2026-10')
check('a project has a Calendar tab, after Timeline', await waitFor(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)
  return tabs.indexOf('Calendar') === tabs.indexOf('Timeline') + 1 && tabs.includes('Calendar')
}))
check('…showing its releases and epics', await waitFor(() => !!item('2026-10-30', 'WEB v1.0')) && !!item('2026-10-20', 'WEB-1 Launch'))
check('…and your todos on it (an issue’s todo is in its project)', !!item('2026-10-19', 'Book the photographer'))
check('…not your other todos, nor other issues until asked', !item(TODAY, 'Write the brief') && !item('2026-10-20', 'WEB-5'))
check('…nor your meetings, unless you turn them on', !item('2026-10-22', 'Client call') &&
  !googleCalls().some((c) => c.action === 'events'))
await click(layer('Issues'))
check('turning on Issues shows every dated issue in it', await waitFor(() => !!item('2026-10-20', 'WEB-5 Pricing page')))
await click(layer('My meetings'))
check('…and My meetings, your own', await waitFor(() => !!item('2026-10-22', 'Client call')))
check('nothing from another project', !text().includes('OPS-'))

done()
