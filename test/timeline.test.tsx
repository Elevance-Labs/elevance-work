// The epic timeline: which days it draws, where a bar sits, what dragging
// does to an epic's dates, its releases, and what the page offers someone who
// may edit against someone who may only read.
import { setupDom, reporter, text, button, click, dialog, freezeToday, waitFor, settle } from './setup'
setupDom()

const { timelineRows, timelineWindow, place, dragged, spanOf } = await import('../src/lib/timeline')
const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, PEOPLE, TODAY } = await import('./mockSupabase')
type Issue = import('../src/lib/types').Issue
type IssueType = import('../src/lib/types').IssueType
type ProjectStatus = import('../src/lib/types').ProjectStatus

const { check, done } = reporter()
freezeToday(TODAY)

// ---------------- the arithmetic ----------------
const types = [
  { id: 'epic', name: 'Epic', level: 'epic', icon: 'epic', color: '#904ee2', archived: false },
  { id: 'story', name: 'Story', level: 'standard', icon: 'story', color: '#63ba3c', archived: false },
] as IssueType[]
const statuses = [
  { id: 'todo', project_id: 'p', name: 'To Do', category: 'todo', position: 0, wip_limit: null },
  { id: 'done', project_id: 'p', name: 'Done', category: 'done', position: 1, wip_limit: null },
] as ProjectStatus[]
const make = (id: string, extra: Partial<Issue>) =>
  ({ id, key: `P-${id}`, number: 1, type_id: 'story', status_id: 'todo', parent_id: null, start_date: null, due_date: null, rank: 1, resolved_at: null, ...extra }) as Issue

check('a span runs from start to due', JSON.stringify(spanOf({ start_date: '2026-03-01', due_date: '2026-03-10' })) === '{"start":"2026-03-01","end":"2026-03-10"}')
check('one date alone is a single day', spanOf({ start_date: null, due_date: '2026-03-10' })?.start === '2026-03-10')
check('no dates, no span', spanOf({ start_date: null, due_date: null }) === null)
check('dates the wrong way round are still a span', spanOf({ start_date: '2026-03-10', due_date: '2026-03-01' })?.start === '2026-03-01')

const rows = timelineRows(
  [
    make('e1', { type_id: 'epic', start_date: '2026-03-01', due_date: '2026-03-31', rank: 2 }),
    make('e2', { type_id: 'epic', rank: 1 }),
    make('e3', { type_id: 'epic', rank: 0, resolved_at: '2026-01-01T00:00:00Z', status_id: 'done' }),
    make('s1', { parent_id: 'e1', status_id: 'done' }),
    make('s2', { parent_id: 'e1' }),
    make('s3', { parent_id: 'e2', start_date: '2026-04-05', due_date: '2026-04-09' }),
    make('s4', { parent_id: 'e2', due_date: '2026-04-20' }),
    make('loose', {}),
  ],
  types,
  statuses,
)
check('only epics are rows; open ones first, then by rank', rows.map((r) => r.epic.id).join() === 'e2,e1,e3', rows.map((r) => r.epic.id).join())
const e1 = rows.find((r) => r.epic.id === 'e1')!
const e2 = rows.find((r) => r.epic.id === 'e2')!
check('an epic counts its issues and how many are done', e1.children.length === 2 && e1.done === 1)
check('an epic with dates keeps its own', e1.own && e1.start === '2026-03-01' && e1.end === '2026-03-31')
check('one without borrows the stretch its issues cover', !e2.own && e2.start === '2026-04-05' && e2.end === '2026-04-20', `${e2.start}..${e2.end}`)
check('one with nothing dated has no bar', rows.find((r) => r.epic.id === 'e3')?.start === null)

const win = timelineWindow(['2026-03-10', '2026-05-02', null], '2026-04-15')
check('the window is whole months, with one to spare each side', win.from === '2026-02-01' && win.to === '2026-08-31', `${win.from}..${win.to}`)
check('its months add up to its days', win.months.reduce((n, m) => n + m.days, 0) === win.days && win.months[0].offset === 0)
const empty = timelineWindow([], '2026-04-15')
check('with nothing dated there is still room to plan: a month back, three ahead',
  empty.from <= '2026-03-01' && empty.to >= '2026-07-31', `${empty.from}..${empty.to}`)
check('a bar is placed by days from the window’s first', JSON.stringify(place(win, '2026-02-03', '2026-02-05')) === '{"offset":2,"length":3}')

check('dragging the bar moves both dates', JSON.stringify(dragged('2026-03-01', '2026-03-10', 'move', 3)) === '{"start":"2026-03-04","end":"2026-03-13"}')
check('dragging an end moves that date only', dragged('2026-03-01', '2026-03-10', 'end', -2).end === '2026-03-08' && dragged('2026-03-01', '2026-03-10', 'start', 2).start === '2026-03-03')
check('an end cannot cross the other', dragged('2026-03-01', '2026-03-10', 'end', -30).end === '2026-03-01' && dragged('2026-03-01', '2026-03-10', 'start', 30).start === '2026-03-10')
check('a month boundary is crossed correctly', dragged('2026-01-30', '2026-01-31', 'move', 2).end === '2026-02-02')

// ---------------- the page ----------------
const epic = () => table('issues').find((i) => i.key === 'WEB-1')!
const bar = () => document.querySelector<HTMLElement>('[data-bar="WEB-1"]')
const key = async (el: Element, k: string, mods: KeyboardEventInit = {}) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }))
  await settle()
}

reset()
Object.assign(epic(), { start_date: '2026-10-05', due_date: '2026-11-06' })
signInAs(PEOPLE.member)
await mountApp('/projects/WEB')
check('the project has a Timeline tab', [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent === 'Timeline'))
await mountApp('/projects/WEB/timeline')
check('the epic is a row', await waitFor(() => bar() !== null) && text().includes('Launch the new site'), text().slice(0, 300))
check('its bar says what it covers', bar()?.getAttribute('aria-label')?.includes('WEB-1 Launch the new site') === true, bar()?.getAttribute('aria-label') ?? '')
check('the sprint and the release are marked along the top', text().includes('WEB Sprint 1') && document.querySelector('[aria-label^="Release v1.0"]') !== null)
check('…the release by name, from its start to its date, and down the whole timeline',
  !!document.querySelector('[aria-label="Release v1.0, Oct 1 – Oct 30, 2026"]') && !!document.querySelector('[data-release-line="rl-1"]'),
  document.querySelector('[aria-label^="Release v1.0"]')?.getAttribute('aria-label'))
await click(document.querySelector('[data-release="rl-1"]'))
check('clicking a release opens it in a dialog, on the timeline', await waitFor(() => !!dialog()?.textContent?.includes('1 of 2 issues done')) &&
  location.pathname === '/projects/WEB/timeline')
await click(button('Close', dialog()!))
check('someone who can edit is told they can drag', text().includes('Drag a bar to move it'))

await key(bar()!, 'ArrowRight')
let write = captured.updates.filter((u) => u.table === 'issues').at(-1)
check('an arrow key moves the epic a day', write?.values.start_date === '2026-10-06' && write.values.due_date === '2026-11-07', JSON.stringify(write?.values))
check('only the two dates are written', Object.keys(write?.values ?? {}).sort().join() === 'due_date,start_date')
await key(bar()!, 'ArrowLeft', { shiftKey: true })
write = captured.updates.filter((u) => u.table === 'issues').at(-1)
check('with Shift it changes the due date alone', write?.values.start_date === '2026-10-06' && write.values.due_date === '2026-11-06', JSON.stringify(write?.values))
await key(bar()!, 'ArrowRight', { altKey: true })
write = captured.updates.filter((u) => u.table === 'issues').at(-1)
check('with Alt, the start alone', write?.values.start_date === '2026-10-07' && write.values.due_date === '2026-11-06', JSON.stringify(write?.values))

const opener = document.querySelector('[aria-label="Show the issues in WEB-1"]')
if (opener) {
  await click(opener)
  check('opening an epic lists its issues under it', document.querySelector('[aria-label="Hide the issues in WEB-1"]') !== null)
}

// Someone who can only read gets the picture, and nothing to move.
reset()
Object.assign(epic(), { start_date: '2026-10-05', due_date: '2026-11-06' })
signInAs(PEOPLE.viewer)
await mountApp('/projects/WEB/timeline')
await waitFor(() => bar() !== null)
const before = captured.updates.length
await key(bar()!, 'ArrowRight')
check('a viewer sees the bar but cannot move it', bar() !== null && captured.updates.length === before && !text().includes('Drag a bar'))

// No epics at all: the releases still have a timeline.
reset()
signInAs(PEOPLE.member)
table('issues').splice(0, table('issues').length, ...table('issues').filter((i) => i.type_id !== 't-epic'))
await mountApp('/projects/WEB/timeline')
check('a project with releases but no epics still has a timeline, with its releases',
  await waitFor(() => document.querySelector('[data-release="rl-1"]') !== null) && text().includes('No epics yet'))

// No dates at all: the epic is still listed, and says what to do.
reset()
signInAs(PEOPLE.member)
Object.assign(epic(), { start_date: null, due_date: null })
for (const i of table('issues')) if (i.parent_id === epic().id) Object.assign(i, { start_date: null, due_date: null })
await mountApp('/projects/WEB/timeline')
check('an undated epic is listed, with what to do about it',
  await waitFor(() => text().includes('Launch the new site')) && (text().includes('No dates yet') || bar() !== null))

done()
