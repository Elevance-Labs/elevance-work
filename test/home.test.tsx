// Your own corner: the dashboard (the meeting now and your note on it, your
// agenda, todos, issues and pinned notes), todos, and the notifications bell.
import { setupDom, choose, reporter, text, button, click, typeInto, labelled, submit, freezeToday, waitFor, settleLazy, dialog } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, googleCalendar, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

// ---------------- the dashboard ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
check('the dashboard lists your open issues', text().includes('Assigned to you (3)') && text().includes('Hero banner') &&
  text().includes('Laptop for Hina') && !text().includes('Fix the footer links'))
check('…asking only for yours, unresolved', captured.selects.some((s) => s.table === 'issues' &&
  JSON.stringify(s.filters) === '[["assignee_id","eq","p-sara"],["resolved_at","is",null]]'))
check('…flagging the overdue one', text().includes('Overdue · Oct 20'))
check('today’s and overdue todos are there', text().includes('Today (1)') && text().includes('Overdue (1)'))
const agenda = () => document.querySelector('[data-agenda="overdue"]')?.parentElement
const kinds = (root: Element | null | undefined) => [...(root?.querySelectorAll('[data-agenda]') ?? [])].map((r) => `${r.getAttribute('data-agenda')}:${r.textContent}`)
check('the agenda shows today by default', !!button('Today', document.querySelector('[aria-label="Agenda for"]')!)?.classList.contains('Mui-selected'))
const overdueBox = document.querySelector('[data-agenda="overdue"]')
check('overdue issues and todos are pinned first, oldest first, in their own box', !!overdueBox &&
  overdueBox.textContent!.startsWith('Overdue (2)') && kinds(overdueBox).length === 2 &&
  kinds(overdueBox)[0].startsWith('todo:Book the photographer') && kinds(overdueBox)[1].startsWith('issue:WEB-5Pricing page'), JSON.stringify(kinds(overdueBox)))
check('…before anything else on the agenda', agenda()?.querySelector('[data-agenda]') === overdueBox)
const todays = kinds(agenda()).filter((k) => !k.startsWith('overdue'))
check('today: the todo due today, marked as what it is', todays.some((k) => k.startsWith('todo:Write the brief')), JSON.stringify(todays))
check('…and nothing from later in the week', !agenda()?.textContent?.includes('Tomorrow') && !text().includes('WEB v1.0'))

await click(button('This week'))
const dayOf = (d: string) => document.querySelector(`[data-agenda-day="${d}"]`)
check('this week groups by day, from today to Sunday', !!dayOf('2026-10-21')?.textContent?.startsWith('Today') &&
  !dayOf('2026-10-22') && !dayOf('2026-10-26'))
check('…the overdue still on top', agenda()?.querySelector('[data-agenda]') === document.querySelector('[data-agenda="overdue"]'))
check('…and no sprints on it', !text().includes('Sprint ends'))
check('the choice is remembered on this device', window.localStorage.getItem('el-work:agenda-span') === 'week')

await click(document.querySelector<HTMLInputElement>('[data-agenda-day="2026-10-21"] [data-agenda="todo"] input'))
const ticked = captured.updates.find((u) => u.table === 'todos')
check('a todo can be ticked off from the agenda', typeof ticked?.values.done_at === 'string' && JSON.stringify(ticked.filters) === '[["id","eq","td-1"]]')
check('…and leaves it, and the todo card', await waitFor(() => !text().includes('Write the brief')))
window.localStorage.removeItem('el-work:agenda-span')
check('the active sprint’s progress', text().includes('Active sprints') && text().includes('1 of 3 done'))
const panel = (id: string) => document.querySelector(`[data-panel="${id}"]`)
check('four panels: agenda, todos, issues and pinned notes', ['agenda', 'todos', 'issues', 'notes'].every((id) => !!panel(id)))
check('pinned notes show, and only those', await waitFor(() => !!panel('notes')?.textContent?.includes('Launch plan')) &&
  !panel('notes')?.textContent?.includes('Gift ideas') &&
  captured.selects.some((s) => s.table === 'notes' && JSON.stringify(s.filters) === '[["owner_id","eq","p-sara"],["pinned","eq",true]]'))
check('without Google Calendar, the dashboard offers to connect it for your meetings',
  !!panel('now')?.textContent?.includes('Your meetings, with notes') && !!button('Connect Google Calendar', panel('now')!))

// Your Google Calendar: a meeting under way at noon, one later today, one tomorrow.
const local = (d: string, t: string) => new Date(`${d}T${t}:00`).toISOString()
const gEvent = (id: string, title: string, d: string, from: string, to: string, extra = {}) => ({ id, title, all_day: false, start_date: null,
  end_date: null, starts_at: local(d, from), ends_at: local(d, to), url: `https://www.google.com/calendar/event?eid=${id}`, meeting_url: null,
  location: null, description: null, organizer: null, attendees: [], ...extra })
reset()
signInAs(PEOPLE.member)
googleCalendar.connected = true
googleCalendar.events = [
  gEvent('g-design', 'Design review', TODAY, '11:45', '12:30', { meeting_url: 'https://meet.google.com/abc-defg-hij',
    attendees: [{ email: PEOPLE.admin.email, name: null, response: 'accepted' }] }),
  gEvent('g-retro', 'Retro', TODAY, '15:00', '15:30'),
  gEvent('g-client', 'Client call', '2026-10-22', '09:00', '10:00'),
]
await mountApp('/dashboard')
const now = () => panel('now')
check('the meeting under way is up front', await waitFor(() => !!now()?.textContent?.includes('Design review')) &&
  !!now()?.textContent?.includes('Now') && /Ends in \d+ min/.test(now()?.textContent ?? ''), now()?.textContent)
check('…with a way to join, its guests, and what’s later today', button('Join', now()!)?.getAttribute('href') === 'https://meet.google.com/abc-defg-hij' &&
  !!now()?.textContent?.includes('Amna Khan') && !!now()?.textContent?.includes('Later today') && !!now()?.textContent?.includes('Retro'))
check('…and your notes on it, right there', !!labelled('Your notes on Design review', now()!))
await typeInto('Your notes on Design review', 'Ship the dark mode first', now()!)
check('notes taken there are saved as the meeting’s note', await waitFor(() => captured.inserts.some((i) => i.table === 'notes' &&
  i.rows[0].meeting_id === 'g-design' && i.rows[0].body === 'Ship the dark mode first' && i.rows[0].meeting_on === TODAY), 3000))
check('…and the agenda marks the meeting as noted', await waitFor(() => !!document.querySelector('[data-agenda="meeting"] [aria-label="Has your notes"]')))
check('the day at a glance counts today’s meetings', !!document.querySelector('[data-stat="meetings today"]')?.textContent?.startsWith('2'))
const meetingRows = () => [...document.querySelectorAll('[data-agenda="meeting"]')].map((r) => r.textContent)
check('today’s meetings are on the agenda, in order', meetingRows().length === 2 && !!meetingRows()[0]?.startsWith('Design review') &&
  !!meetingRows()[1]?.startsWith('Retro'), JSON.stringify(meetingRows()))
await click([...document.querySelectorAll('[data-agenda="meeting"]')].find((r) => r.textContent?.startsWith('Retro')))
check('clicking one opens it in a dialog, with your notes', !!dialog()?.textContent?.includes('Retro') &&
  !!labelled('Your notes on Retro', dialog()!) && location.pathname === '/dashboard')
await click(button('Close', dialog()!))
await click(button('This week'))
check('…and this week’s on their day', await waitFor(() => !!document.querySelector('[data-agenda-day="2026-10-22"]')?.textContent?.includes('Client call')) &&
  !!document.querySelector('[data-agenda-day="2026-10-22"] [data-agenda="meeting"]')?.textContent?.includes('Meeting9:00 AM'),
  document.querySelector('[data-agenda-day="2026-10-22"]')?.textContent ?? '')
window.localStorage.removeItem('el-work:agenda-span')

reset()
signInAs(PEOPLE.member)
googleCalendar.connected = true
googleCalendar.events = [gEvent('g-late', 'Late sync', TODAY, '16:00', '16:30')]
await mountApp('/dashboard')
check('before the next meeting, it says when it starts', await waitFor(() => !!now()?.textContent?.includes('Late sync')) &&
  !!now()?.textContent?.includes('Next') && /Starts in 4 h/.test(now()?.textContent ?? ''), now()?.textContent)

reset()
signInAs(PEOPLE.member)
googleCalendar.connected = true
googleCalendar.events = [gEvent('g-early', 'Early sync', TODAY, '08:00', '08:30'), gEvent('g-client', 'Client call', '2026-10-22', '09:00', '10:00')]
await mountApp('/dashboard')
check('when today’s meetings are over, it says so, and what’s next', await waitFor(() => !!now()?.textContent?.includes('No more meetings today')) &&
  !!now()?.textContent?.includes('Client call'), now()?.textContent)

// ---------------- todos ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/todos')
await typeInto('New todo', 'Send the invoice')
await click(button('Tomorrow'))
await submit(labelled('New todo'))
const todo = captured.inserts.find((i) => i.table === 'todos')?.rows[0]
check('a todo is added with its due day', todo?.title === 'Send the invoice' && todo.due_on === '2026-10-22' && todo.issue_id === null, JSON.stringify(todo))
check('…and listed as upcoming', text().includes('Upcoming (1)') && text().includes('Send the invoice') ||
  !!document.querySelector('input[value="Send the invoice"]'))

await typeInto('New todo', 'Plan the launch party')
await choose('Project (optional)', 'Website')
await submit(labelled('New todo'))
const projectTodo = captured.inserts.filter((i) => i.table === 'todos').at(-1)?.rows[0]
check('a todo can be about a project, without an issue', projectTodo?.project_id === 'pr-web' && projectTodo.issue_id === null,
  JSON.stringify(projectTodo))
check('…and shows its project', await waitFor(() => !!document.querySelector('[data-todo] a[href$="/projects/WEB/calendar"]')))

await click(labelled('Done: Write the brief'))
const doneUpdate = captured.updates.find((u) => u.table === 'todos')
check('ticking a todo marks it done', typeof doneUpdate?.values.done_at === 'string' && JSON.stringify(doneUpdate.filters) === '[["id","eq","td-1"]]',
  JSON.stringify(doneUpdate))
check('…and it moves to done', text().includes('Show 2 done'), text().match(/Show \d+ done/)?.[0])

await click(button('Delete Book the photographer'))
check('a todo can be deleted', captured.deletes.some((d) => d.table === 'todos' && JSON.stringify(d.filters) === '[["id","eq","td-2"]]'))

// Shared todos: Omar put Sara on one of his; his other one stays his.
check('a todo someone put you on is on your list, their others are not', !text().includes('Omar private todo'))
await click(button('Show 2 done'))
check('…you can tick it and edit it, but not delete it', !!labelled('Done: Choose the hero photo') && !button('Delete Choose the hero photo'))

await typeInto('New todo', 'Draft the FAQ')
await choose('Add people (optional)', 'Omar Farooq')
await submit(labelled('New todo'))
const sharedTodo = captured.inserts.filter((i) => i.table === 'todos').at(-1)?.rows[0]
check('people can be put on a new todo', sharedTodo?.title === 'Draft the FAQ' && JSON.stringify(sharedTodo.shared_with) === '["p-omar"]',
  JSON.stringify(sharedTodo))

await click(labelled('People on Choose the hero photo'))
check('…the people on a todo show who made it', text().includes('Omar Farooq made this todo'))
await click(button('Leave this todo'))
check('…and you can leave one you were put on', captured.rpcs.some((r) => r.name === 'todo_leave' && r.args?.p_todo === 'td-omar-shared') &&
  await waitFor(() => !document.querySelector('[data-todo="td-omar-shared"]')))

reset()
signInAs(PEOPLE.viewer)
await mountApp('/todos')
check('whoever made a todo can delete it', !!button('Delete Omar private todo'))
await click(button('Show 1 done'))
await click(labelled('People on Choose the hero photo'))
check('…and sees the people on it', text().includes('People you add see this todo'))

// ---------------- notifications ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
check('the bell counts unread notifications', !!labelled('Notifications (1 unread)', document) || !!button('Notifications (1 unread)'))
check('…and listens for new ones', captured.channels.includes('notifications:p-sara'))
await click(button('Notifications (1 unread)'))
check('it says who did what, on which issue', text().includes('Amna Khan commented') && text().includes('WEB-2 · Hero banner'))
check('…quoting the comment', text().includes('“Use the new photo”'))
await click([...document.querySelectorAll('.MuiPopover-paper .MuiListItemButton-root')].find((b) => b.textContent?.includes('commented')))
check('opening one marks it read', captured.updates.some((u) => u.table === 'notifications' && typeof u.values.read_at === 'string' &&
  JSON.stringify(u.filters) === '[["id","in",["n-1"]]]'))
check('…and opens the issue where you are', location.pathname === '/dashboard' && location.search === '?issue=WEB-2')
await settleLazy()
check('…in the dialog', await waitFor(() => dialog()?.textContent?.includes('Hero banner')))

reset()
table('notifications').push({ ...table('notifications')[0], id: 'n-2', kind: 'assigned', issue_id: 'i-web-5' })
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await click(button('Notifications (2 unread)'))
await click(button('Mark all read'))
check('mark all read updates only your unread ones', captured.updates.some((u) => u.table === 'notifications' &&
  JSON.stringify(u.filters) === '[["recipient_id","eq","p-sara"],["read_at","is",null]]'))
check('…and the count clears', !!button('Notifications'))

done()
