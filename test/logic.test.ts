// The pure rules in src/lib: reports rebuilt from history, the Summary's
// judgements and widgets, project features, the calendar's
// items and meetings, filters and their URL form, ranks, Google links, rich text, search, todo views.
import { setupDom, reporter } from './setup'
setupDom()

const { burndown, velocity, sprintReport, createdVsResolved, cumulativeFlow, stateAt, unitFor } =
  await import('../src/lib/reports')
const insights = await import('../src/lib/insights')
const widgetsLib = await import('../src/lib/widgets')
const features = await import('../src/lib/projectFeatures')
const { timelineRows } = await import('../src/lib/timeline')
const { monthGrid, calendarItems, datedWithin, currentMeeting, itemsOn, weekStart, weekDays, weekLabel, timedBlocks } = await import('../src/lib/calendar')
const { EMPTY_FILTER, applyFilter, filterFromSearch, filterToSearch, filterToQuery, filterFromQuery, matchesFilter, issuesToCsv } =
  await import('../src/lib/filters')
const { rankBetween, rankForIndex, parseIssueKey, normaliseLabels, activityLine } = await import('../src/lib/issues')
const { docTypeFromUrl, embedUrl } = await import('../src/lib/drive')
const { sanitizeHtml, mentionedIds, isBlankHtml } = await import('../src/lib/richText')
const { releaseNotes, notesText, releaseCountdown } = await import('../src/lib/releases')
const { roleIn } = await import('../src/lib/permissions')
const { suggestKey } = await import('../src/lib/projects')
const { matchesWords, searchTodos, searchNotes, isShortcut } = await import('../src/lib/search')
const { viewSearch } = await import('../src/lib/filters')
const todosLib = await import('../src/lib/todos')
type Issue = import('../src/lib/types').Issue
type IssueEvent = import('../src/lib/types').IssueEvent
type Sprint = import('../src/lib/types').Sprint
type GoogleCalendarEvent = import('../src/lib/types').GoogleCalendarEvent
type Release = import('../src/lib/types').Release
type Todo = import('../src/lib/types').Todo
type ProjectStatus = import('../src/lib/types').ProjectStatus

const { check, done } = reporter()

const statuses: ProjectStatus[] = [
  { id: 'todo', project_id: 'p', name: 'To Do', category: 'todo', position: 0, wip_limit: null },
  { id: 'doing', project_id: 'p', name: 'Doing', category: 'in_progress', position: 1, wip_limit: null },
  { id: 'done', project_id: 'p', name: 'Done', category: 'done', position: 2, wip_limit: null },
]
const issue = (id: string, extra: Partial<Issue> = {}): Issue => ({
  id, project_id: 'p', number: 1, key: id.toUpperCase(), type_id: 't', status_id: 'todo', title: id, priority: 'medium',
  assignee_id: null, reporter_id: null, parent_id: null, sprint_id: null, release_id: null, story_points: null, start_date: null,
  due_date: null, labels: [], rank: 1, custom: {}, resolved_at: null, created_at: '2026-10-01T09:00:00', updated_at: '2026-10-01T09:00:00',
  ...extra,
})
let eid = 0
const ev = (issue_id: string, field: string, at: string, from: string | null, to: string | null, extra: Partial<IssueEvent> = {}): IssueEvent => ({
  id: `e${eid++}`, issue_id, project_id: 'p', actor_id: null, field, from_value: null, to_value: null, from_id: from, to_id: to,
  created_at: at, ...extra,
})

// ---------------- rebuilding the past ----------------
const a = issue('a', { sprint_id: 's', story_points: 5, status_id: 'done' })
const history = [
  ev('a', 'sprint', '2026-10-05T10:00:00', null, 's'),
  ev('a', 'status', '2026-10-08T15:00:00', 'todo', 'done'),
  ev('a', 'story_points', '2026-10-06T10:00:00', null, null, { from_value: '3', to_value: '5' }),
]
const before = stateAt(a, history, new Date('2026-10-04T12:00:00').getTime())
check('before it was planned, it was in no sprint, at 3 points', before.sprint_id === null && before.story_points === 3 && before.status_id === 'todo',
  JSON.stringify(before))
const mid = stateAt(a, history, new Date('2026-10-07T12:00:00').getTime())
check('mid-sprint: in the sprint, re-estimated, not done', mid.sprint_id === 's' && mid.story_points === 5 && mid.status_id === 'todo', JSON.stringify(mid))
check('after: done', stateAt(a, history, Date.now()).status_id === 'done')

// ---------------- burndown ----------------
const sprint: Sprint = { id: 's', project_id: 'p', name: 'S1', goal: '', state: 'active', start_date: '2026-10-05', end_date: '2026-10-09',
  started_at: '2026-10-05T12:00:00', completed_at: null, created_at: '2026-10-01T00:00:00' }
const b = issue('b', { sprint_id: 's', story_points: 3 })
const burn = burndown(sprint, [a, b], [...history, ev('b', 'sprint', '2026-10-05T10:00:00', null, 's')], statuses, '2026-10-08', 'points')
check('burndown starts from the scope committed at the start', burn[0].remaining === 6 && burn[0].ideal === 6, JSON.stringify(burn))
check('…rises when work is re-estimated mid-sprint', burn[1].remaining === 8, JSON.stringify(burn.map((p) => p.remaining)))
check('…and burns as work is done', burn[3].remaining === 3, JSON.stringify(burn.map((p) => p.remaining)))
check('…has no future values', burn[4].remaining === null)
check('…and an ideal line to zero', burn[4].ideal === 0)
check('a sprint with no estimates burns by issue count', unitFor([issue('x', { sprint_id: 's' })], []) === 'issues')

// ---------------- velocity and the sprint report ----------------
const closed = (id: string, completed_at: string): Sprint => ({ ...sprint, id, state: 'closed', completed_at })
const rows = [
  { sprint_id: 's1', issue_id: 'a', committed: true, points_at_start: 5, points_at_end: 5, completed: true },
  { sprint_id: 's1', issue_id: 'b', committed: true, points_at_start: 3, points_at_end: 3, completed: false },
  { sprint_id: 's1', issue_id: 'c', committed: false, points_at_start: null, points_at_end: 2, completed: true },
  { sprint_id: 's1', issue_id: 'd', committed: true, points_at_start: 1, points_at_end: null, completed: null },
  { sprint_id: 's0', issue_id: 'e', committed: true, points_at_start: 4, points_at_end: 4, completed: true },
]
const v = velocity([closed('s1', '2026-10-20T00:00:00'), closed('s0', '2026-10-06T00:00:00'), sprint], rows)
check('velocity is per completed sprint, oldest first', v.map((x) => x.sprint.id).join() === 's0,s1')
check('…committed at the start against completed at the end', v[1].committed === 9 && v[1].completed === 7, JSON.stringify(v[1]))
const rep = sprintReport('s1', rows)
check('the sprint report sorts completed, not completed, added and removed',
  rep.completed.join() === 'a,c' && rep.notCompleted.join() === 'b' && rep.added.join() === 'c' && rep.removed.join() === 'd', JSON.stringify(rep))

// ---------------- created vs resolved, flow ----------------
const cr = createdVsResolved([
  issue('x', { created_at: '2026-10-19T10:00:00' }),
  issue('y', { created_at: '2026-10-20T10:00:00', resolved_at: '2026-10-21T10:00:00' }),
  issue('z', { created_at: '2026-01-01T10:00:00', resolved_at: '2026-10-21T11:00:00' }),
], 3, '2026-10-21')
check('created and resolved add up day by day', JSON.stringify(cr.map((p) => [p.created, p.resolved])) === '[[1,0],[2,0],[2,2]]', JSON.stringify(cr))

const flow = cumulativeFlow([a, b], history, statuses, 1, '2026-10-07')
check('cumulative flow counts by category as it was then', flow[0].todo === 2 && flow[0].done === 0, JSON.stringify(flow))


// ---------------- the calendar ----------------
const grid = monthGrid('2026-10')
check('a month grid is 6 weeks from the Monday before the 1st', grid.length === 42 && grid[0] === '2026-09-28' && grid[41] === '2026-11-08',
  `${grid[0]}..${grid[41]}`)
const meeting = (id: string, from: string, to: string, extra: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent => ({
  id, title: id, all_day: false, start_date: null, end_date: null, starts_at: new Date(from).toISOString(), ends_at: new Date(to).toISOString(),
  url: null, meeting_url: null, location: null, description: null, organizer: null, attendees: [], ...extra })
const src = { isEpic: (i: Issue) => i.type_id === 'epic', typeColor: () => undefined, projects: [{ id: 'p', key: 'WEB' } as never] }
const epic = issue('E', { key: 'WEB-1', title: 'Launch', type_id: 'epic', start_date: '2026-10-30', due_date: '2026-11-03' })
const dueOnly = issue('D', { key: 'WEB-2', title: 'Pricing', due_date: '2026-11-04' })
const startOnly = issue('S', { key: 'WEB-3', title: 'Footer', start_date: '2026-11-05', resolved_at: '2026-11-06T00:00:00Z' })
const rel = { id: 'r', project_id: 'p', name: 'v1', release_date: '2026-11-10', status: 'released' } as Release
const archived = { ...rel, id: 'ra', status: 'archived' } as Release
const todo = { id: 't', title: 'Brief', due_on: '2026-11-02', done_at: null } as Todo
const items = calendarItems({ ...src, issues: [epic, dueOnly, startOnly], releases: [rel, archived], todos: [todo] }, '2026-11-01', '2026-11-30')
const kindOn = (d: string) => itemsOn(items, d).map((i) => i.kind).join()
check('an epic spans its start to its due date, even from the month before', kindOn('2026-11-01') === 'epic' && kindOn('2026-11-03') === 'epic' &&
  itemsOn(items, '2026-11-01')[0].title === 'WEB-1 Launch', items.map((i) => `${i.kind}:${i.startDay}`).join())
check('an issue with only a due date, or only a start, is on that one day', kindOn('2026-11-04') === 'issue' &&
  itemsOn(items, '2026-11-05')[0]?.issue?.id === 'S' && itemsOn(items, '2026-11-05')[0].done)
check('a release is on its date (released ones faded, archived ones gone); a todo on its due day',
  kindOn('2026-11-10') === 'release' && itemsOn(items, '2026-11-10')[0].done && kindOn('2026-11-02') === 'epic,todo', kindOn('2026-11-02'))
const late = meeting('Late call', '2026-11-05T23:00:00', '2026-11-06T00:00:00')
const gItems = calendarItems({ ...src, meetings: [late] }, '2026-11-01', '2026-11-30')
check('a meeting ending at midnight covers only its own day, and carries the meeting for its dialog', gItems.length === 1 &&
  gItems[0].kind === 'meeting' && gItems[0].startDay === '2026-11-05' && gItems[0].endDay === '2026-11-05' && gItems[0].meeting === late)
check('issues dated in a range: overlapping start–due, or one date inside it', datedWithin('2026-11-01', '2026-11-30') ===
  'and(start_date.lte.2026-11-30,due_date.gte.2026-11-01),and(start_date.is.null,due_date.gte.2026-11-01,due_date.lte.2026-11-30),' +
  'and(due_date.is.null,start_date.gte.2026-11-01,start_date.lte.2026-11-30)')
const morning = [meeting('Standup', '2026-11-11T09:00:00', '2026-11-11T09:15:00'), meeting('Review', '2026-11-11T11:00:00', '2026-11-11T12:00:00'),
  meeting('Holiday', '2026-11-11T00:00:00', '2026-11-12T00:00:00', { all_day: true, start_date: '2026-11-11', end_date: '2026-11-11' }),
  meeting('Tomorrow', '2026-11-12T09:00:00', '2026-11-12T10:00:00')]
const nowAt = (t: string) => currentMeeting(morning, new Date(`2026-11-11T${t}:00`))
check('the meeting now is the one under way', nowAt('09:05')?.meeting.id === 'Standup' && nowAt('09:05')?.live === true)
check('…else the next one today, never an all-day entry or tomorrow’s', nowAt('09:20')?.meeting.id === 'Review' && nowAt('09:20')?.live === false &&
  nowAt('12:30') === null)

check('a week runs Monday to Sunday', weekStart('2026-10-21') === '2026-10-19' && weekStart('2026-10-19') === '2026-10-19' &&
  weekStart('2026-10-25') === '2026-10-19' && weekDays('2026-10-25').at(-1) === '2026-10-25')
check('a week is named by its days, across months and years', weekLabel('2026-10-21') === 'Oct 19 – 25, 2026' &&
  weekLabel('2026-10-28') === 'Oct 26 – Nov 1, 2026' && weekLabel('2026-12-30') === 'Dec 28, 2026 – Jan 3, 2027',
  `${weekLabel('2026-10-21')} | ${weekLabel('2026-10-28')} | ${weekLabel('2026-12-30')}`)
const at = (day: string, time: string) => new Date(`${day}T${time}:00`)
const timed = (id: string, from: string, to: string, day = '2026-10-21', endDay = day) => ({
  id, kind: 'meeting' as const, title: id, startDay: day, endDay, startsAt: at(day, from), endsAt: at(endDay, to), color: '#000', done: false })
const blocks = timedBlocks([timed('a', '09:00', '10:00'), timed('b', '09:30', '11:00'), timed('c', '10:00', '10:30'), timed('d', '13:00', '13:05'),
  { ...timed('allday', '00:00', '00:00'), startsAt: null, endsAt: null }], '2026-10-21')
const blockOf = (id: string) => blocks.find((x) => x.item.id === id)!
check('timed items are placed by minutes from midnight; all-day ones are not', blocks.length === 4 && blockOf('a').start === 540 && blockOf('a').end === 600)
check('overlapping items share the width, each in the first free column', blockOf('a').col === 0 && blockOf('b').col === 1 && blockOf('c').col === 0 &&
  blockOf('a').cols === 2 && blockOf('b').cols === 2 && blockOf('c').cols === 2, JSON.stringify(blocks.map((x) => [x.item.id, x.col, x.cols])))
check('…and one on its own has the whole width; a short one is still tall enough to read', blockOf('d').cols === 1 && blockOf('d').end - blockOf('d').start === 20)
const overnight = timed('night', '22:00', '02:00', '2026-10-21', '2026-10-22')
check('an item past midnight is clipped to each day it touches', timedBlocks([overnight], '2026-10-21')[0]?.end === 1440 &&
  timedBlocks([overnight], '2026-10-22')[0]?.start === 0 && timedBlocks([overnight], '2026-10-22')[0]?.end === 120)

// ---------------- filters ----------------
const f = { ...EMPTY_FILTER, assignees: ['me', 'none'], labels: ['seo'], text: 'hero', due: 'overdue' as const }
const params = filterToSearch(f)
check('a filter round-trips through the URL', JSON.stringify(filterFromSearch(params)) === JSON.stringify(f), params.toString())
check('…carrying only what differs from empty', params.toString() === 'assignees=me%2Cnone&labels=seo&text=hero&due=overdue', params.toString())
check('a saved query that doesn’t fit is ignored, not trusted', JSON.stringify(filterFromQuery({ assignees: 'me', types: [1, 't'] as unknown as string[], sort: 'key' }))
  === JSON.stringify({ ...EMPTY_FILTER, types: ['t'], sort: 'key' }))
check('filterToQuery is what saved filters store', JSON.stringify(filterToQuery(f)) === '{"assignees":["me","none"],"labels":["seo"],"text":"hero","due":"overdue"}')

const calls: string[] = []
const fake = new Proxy({}, {
  get: (_t, op: string) => (...args: unknown[]) => {
    calls.push(`${op}(${args.map((x) => JSON.stringify(x)).join(',')})`)
    return fake
  },
}) as Parameters<typeof applyFilter>[0]
applyFilter(fake, { ...f, categories: ['done'], sprints: ['open', 'backlog'] }, { me: 'p1', statuses, activeSprintIds: ['s9'], today: '2026-10-21' })
check('me and unassigned become one or()', calls.includes('or("assignee_id.is.null,assignee_id.in.(p1)")'), calls.join(' '))
check('a category becomes its statuses', calls.includes('in("status_id",["done"])'), calls.join(' '))
check('open sprints and the backlog become one or()', calls.includes('or("sprint_id.is.null,sprint_id.in.(s9)")'), calls.join(' '))
check('labels overlap', calls.includes('overlaps("labels",["seo"])'))
check('words are a web search', calls.includes('textSearch("search","hero",{"type":"websearch","config":"simple"})'))
check('overdue is due before today and unresolved', calls.includes('lt("due_date","2026-10-21")') && calls.includes('is("resolved_at",null)'))
check('sorted by recent change by default', calls.at(-1) === 'order("updated_at",{"ascending":false})')

const ctx = { me: 'p1', statuses, activeSprintIds: [], today: '2026-10-21' }
check('the board’s filter matches loaded issues the same way',
  matchesFilter(issue('q', { assignee_id: 'p1', title: 'Hero', labels: ['seo'] }), { ...EMPTY_FILTER, assignees: ['me'], text: 'her' }, ctx) &&
  !matchesFilter(issue('q', { assignee_id: 'p2' }), { ...EMPTY_FILTER, assignees: ['me'] }, ctx) &&
  matchesFilter(issue('q'), { ...EMPTY_FILTER, assignees: ['none'] }, ctx))
check('CSV quotes values and defuses formulas', issuesToCsv([{ A: '=1+1', B: 'say "hi"', C: null }]) === '"A","B","C"\r\n"\'=1+1","say ""hi""",""')

// ---------------- ranks and keys ----------------
check('a rank between two neighbours is their midpoint', rankBetween(1024, 2048) === 1536)
check('…the top goes before the first, the end after the last', rankBetween(null, 1024) === 0 && rankBetween(2048, null) === 3072)
check('…and neighbours too close to split ask for a rerank', rankBetween(1, 1 + 1e-9) === null)
const col = [issue('x', { rank: 1024 }), issue('y', { rank: 2048 }), issue('z', { rank: 3072 })]
check('moving to an index ignores where it was', rankForIndex(col, 0, 'z') === 0 && rankForIndex(col, 1, 'x') === 2560)
check('issue keys parse, any case', JSON.stringify(parseIssueKey(' web-12 ')) === '{"projectKey":"WEB","number":12}' && parseIssueKey('hello') === null)
check('labels are stored lower-case, hyphenated, unique', JSON.stringify(normaliseLabels([' Front End ', 'front-end', 'SEO', ''])) === '["front-end","seo"]')
check('a project key is suggested from its name', suggestKey('Mobile App') === 'MA' && suggestKey('Website') === 'WEBS' && suggestKey('2nd Brain') === 'B')

// ---------------- access mirror ----------------
const people = { admin: { id: 'a', app_role: 'admin', active: true }, m: { id: 'm', app_role: 'member', active: true }, gone: { id: 'g', app_role: 'member', active: false } }
const proj = (visibility: 'open' | 'private', archived_at: string | null = null) => ({ id: 'p', visibility, archived_at }) as never
const mem = [{ project_id: 'p', profile_id: 'm', role: 'member' as const }, { project_id: 'p', profile_id: 'g', role: 'admin' as const }]
check('roleIn mirrors role_in_project',
  roleIn(proj('private'), people.admin as never, []) === 'admin' && roleIn(proj('private'), people.m as never, mem) === 'member' &&
  roleIn(proj('private'), people.m as never, []) === null && roleIn(proj('open'), people.m as never, []) === 'viewer' &&
  roleIn(proj('private', 'x'), people.m as never, mem) === 'viewer' && roleIn(proj('private'), people.gone as never, mem) === null)

// ---------------- Google links ----------------
check('Google links are recognised by kind', docTypeFromUrl('https://docs.google.com/spreadsheets/d/abc/edit') === 'spreadsheet' &&
  docTypeFromUrl('https://drive.google.com/drive/folders/xyz') === 'folder' && docTypeFromUrl('https://evil.example/docs.google.com') === null &&
  docTypeFromUrl('http://docs.google.com/document/d/a') === null)
check('…and previewed through /preview', embedUrl('https://docs.google.com/document/d/abc_123/edit#heading=h') === 'https://docs.google.com/document/d/abc_123/preview' &&
  embedUrl('https://drive.google.com/drive/folders/xyz') === null)

// ---------------- rich text ----------------
const dirty = '<p onclick="x()">Hi <span data-type="mention" data-id="11111111-1111-1111-1111-111111111111" data-label="Sara" class="mention">@Sara</span>' +
  '<span data-id="22222222-2222-2222-2222-222222222222">sneaky</span><script>alert(1)</script><img src=x onerror=y></p>'
const clean = sanitizeHtml(dirty)
check('sanitising keeps mentions', clean.includes('data-type="mention"') && clean.includes('data-id="11111111-1111-1111-1111-111111111111"'), clean)
check('…drops scripts, handlers and images', !/script|onclick|onerror|<img/.test(clean), clean)
check('…and data-ids on anything but a mention', !clean.includes('22222222'), clean)
const table = sanitizeHtml('<table style="min-width: 75px"><colgroup><col style="min-width: 25px"></colgroup><tbody>' +
  '<tr><th><p>Env</p></th><th colspan="2" onclick="x()"><p>URL</p></th></tr><tr><td><p>prod</p></td><td rowspan="1"><p>a</p></td></tr></tbody></table>')
check('…keeps tables, with their cell spans', /<table><colgroup><col><\/colgroup><tbody><tr><th><p>Env<\/p><\/th><th colspan="2"><p>URL/.test(table) &&
  table.includes('rowspan="1"'), table)
check('…without the editor\'s inline widths or handlers', !/style|onclick/.test(table), table)
check('a table of empty cells is blank', isBlankHtml('<table><tbody><tr><td><p></p></td></tr></tbody></table>'))
check('mentions are read from editor HTML', JSON.stringify(mentionedIds(clean)) === '["11111111-1111-1111-1111-111111111111"]')
check('blank editor HTML is blank', isBlankHtml('<p></p>') && isBlankHtml('<p>&nbsp;</p>') && !isBlankHtml(clean))

// ---------------- release notes ----------------
const types = [
  { id: 'story', name: 'Story', level: 'standard', icon: 'story', color: '', archived: false },
  { id: 'bug', name: 'Bug', level: 'standard', icon: 'bug', color: '', archived: false },
  { id: 'sub', name: 'Sub-task', level: 'subtask', icon: 'subtask', color: '', archived: false },
] as never
const notes = releaseNotes([
  issue('n1', { type_id: 'bug', status_id: 'done', key: 'W-2', number: 2, title: 'Broken link' }),
  issue('n2', { type_id: 'story', status_id: 'done', key: 'W-1', number: 1, title: 'Hero' }),
  issue('n3', { type_id: 'sub', status_id: 'done', key: 'W-3', number: 3 }),
  issue('n4', { type_id: 'story', status_id: 'todo', key: 'W-4', number: 4 }),
], types, statuses)
check('release notes: stories first, then fixes; sub-tasks roll up; unfinished left out',
  notes.sections.map((s) => s.title).join() === 'New and changed,Bug fixes' && notes.unfinished.length === 1, JSON.stringify(notes.sections.map((s) => s.title)))
check('…as plain text to paste', notesText('Site', { name: 'v1', release_date: null, description: '' } as never, notes.sections) ===
  'Site v1\n\nNew and changed\n• W-1 Hero\n\nBug fixes\n• W-2 Broken link')

// ---------------- a release's days left ----------------
const relRow = (extra: object) => ({ status: 'unreleased', release_date: '2026-10-30', released_at: null, ...extra }) as never
const due = (extra: object, today = '2026-10-21') => releaseCountdown(relRow(extra), today)
check('a release counts the days left to its date', due({})?.text.startsWith('9 days left') && due({})?.tone === 'later', JSON.stringify(due({})))
check('…three or fewer are soon', due({}, '2026-10-29')?.text.startsWith('1 day left') && due({}, '2026-10-27')?.tone === 'soon')
check('…its day says due today', due({}, '2026-10-30')?.text.startsWith('Due today') && due({}, '2026-10-30')?.tone === 'soon')
check('…past it, how late', due({}, '2026-11-01')?.text.startsWith('2 days late') && due({}, '2026-10-31')?.text.startsWith('1 day late') &&
  due({}, '2026-11-01')?.tone === 'overdue')
check('…released says so; no date or archived says nothing', due({ status: 'released', released_at: '2026-10-28T10:00:00Z' })?.tone === 'done' &&
  due({ release_date: null }) === null && due({ status: 'archived' }) === null)

// ---------------- notes ----------------
const { matchesNote, noteFilterFromParams, noteFilterToParams, noteHeading, meetingLabel, EMPTY_NOTE_FILTER } = await import('../src/lib/notes')
type NoteRow = import('../src/lib/notes').NoteRow
const aNote = (extra: Partial<NoteRow>): NoteRow => ({ id: 'n', owner_id: 'me', title: '', body: '', color: 'yellow', label_ids: [],
  project_id: null, pinned: false, meeting_id: null, meeting_title: null, meeting_on: null, archived_at: null, created_at: '', updated_at: '', ...extra })
const noteCtx = { labels: new Map([['l1', { id: 'l1', owner_id: 'me', name: 'Clients', created_at: '' }]]),
  projectName: (id: string | null) => (id === 'pw' ? 'Website' : undefined) }
const match = (n: NoteRow, f: Partial<typeof EMPTY_NOTE_FILTER>) => matchesNote(n, { ...EMPTY_NOTE_FILTER, ...f }, noteCtx)
const n1 = aNote({ title: 'Call', body: 'Ask about Pricing', label_ids: ['l1', 'gone'], project_id: 'pw', meeting_id: 'g', meeting_title: 'Standup',
  meeting_on: '2026-10-21' })
check('note search: every word, any case, across text, labels, project and meeting',
  match(n1, { text: 'pricing CLIENTS website standup' }) && !match(n1, { text: 'pricing invoices' }))
check('note filters: label, no label (ignoring removed ones), colour, project',
  match(n1, { label: 'l1' }) && !match(n1, { label: 'none' }) && match(aNote({ label_ids: ['gone'] }), { label: 'none' }) &&
  !match(n1, { color: 'blue' }) && match(n1, { project: 'pw' }) && !match(n1, { project: 'other' }))
const archivedNote = aNote({ body: 'Old', archived_at: '2026-10-22T00:00:00Z' })
check('archived notes are only in the archive, which holds nothing else',
  !match(archivedNote, {}) && match(archivedNote, { archived: true, text: 'old' }) && !match(n1, { archived: true }))
check('the archive is in the address', noteFilterToParams({ ...EMPTY_NOTE_FILTER, archived: true }).toString() === 'archived=1' &&
  noteFilterFromParams(new URLSearchParams('archived=1')).archived)
const parsed = noteFilterFromParams(new URLSearchParams('q=a+b&label=l1&color=neon&project=pw'))
check('note filters in the address drop a colour that doesn’t exist, and round-trip',
  parsed.color === '' && parsed.text === 'a b' && noteFilterToParams(parsed).toString() === 'q=a+b&label=l1&project=pw')
check('a note without a title is headed by its first line', noteHeading({ title: ' ', body: '\nFirst\nSecond' }) === 'First')
check('a note on a meeting names it and its day', meetingLabel(n1) === 'Standup · Oct 21' &&
  meetingLabel({ meeting_title: 'Standup', meeting_on: null }) === 'Standup')
const { byPinnedThenRecent } = await import('../src/lib/notes')
const sorted = [aNote({ id: 'old-pin', pinned: true, updated_at: '2026-10-01' }), aNote({ id: 'new', updated_at: '2026-10-09' }),
  aNote({ id: 'new-pin', pinned: true, updated_at: '2026-10-05' })].sort(byPinnedThenRecent).map((n) => n.id)
check('pinned notes come first, then the latest edited', sorted.join() === 'new-pin,old-pin,new', sorted.join())

// ---------------- search ----------------
check('every word must match, in any of the texts, ignoring case', matchesWords('hero PHOTO', 'Choose the hero', 'a photo') &&
  !matchesWords('hero video', 'Choose the hero photo') && !matchesWords('  ', 'anything'))
const todoHit = (title: string, extra: Record<string, unknown> = {}) =>
  ({ title, notes: '', due_on: null, done_at: null, position: 0, ...extra }) as { title: string; notes: string; due_on: string | null; done_at: string | null; position: number }
const todoOrder = searchTodos([
  todoHit('Old photo', { done_at: '2026-10-01T00:00:00Z' }),
  todoHit('Book the photographer', { due_on: '2026-10-25' }),
  todoHit('Photo for the hero', { due_on: '2026-10-30' }),
  todoHit('Unrelated'),
], 'photo').map((t) => t.title)
check('todos: open ones first, a title starting with the words first, then soonest due; done last',
  todoOrder.join() === 'Photo for the hero,Book the photographer,Old photo', todoOrder.join())
check('…at most a few', searchTodos(Array.from({ length: 9 }, (_, i) => todoHit(`Photo ${i}`)), 'photo').length === 5)
const noteOrder = searchNotes([
  { title: '', body: 'pricing ideas', updated_at: '2026-10-02' },
  { title: 'Plan', body: 'Pricing first', updated_at: '2026-10-05' },
], 'pricing').map((n) => n.title || n.body)
check('notes: by title or text, a heading starting with the words first', noteOrder.join() === 'pricing ideas,Plan', noteOrder.join())
const key = (k: string, mods: Partial<KeyboardEvent>) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods })
check('Cmd or Ctrl with the letter is a shortcut; the letter alone, or with Shift, is not',
  isShortcut(key('s', { metaKey: true }), 's') && isShortcut(key('K', { ctrlKey: true }), 'k') &&
  !isShortcut(key('s', {}), 's') && !isShortcut(key('s', { metaKey: true, shiftKey: true }), 's'))

// ---------------- todo views ----------------
{
  const { inView, weekEnd, groupOpen, dueLabel, duePresets, parseSmartViews, openCount, defaultDue } = todosLib
  type TodoRow = import('../src/lib/todos').TodoRow
  const WED = '2026-10-21'
  const td = (id: string, due_on: string | null, list: string | null = null, done = false) =>
    ({ id, title: id, due_on, done_at: done ? '2026-10-20T10:00:00Z' : null, position: 0, place: list ? [{ list_id: list }] : [] }) as unknown as TodoRow
  const all = [td('late', '2026-10-19', 'work'), td('now', WED), td('tmrw', '2026-10-22', 'work'), td('sun', '2026-10-25'),
    td('mon', '2026-10-26'), td('none', null), td('lateDone', '2026-10-19', null, true)]
  const ids = (view: string) => all.filter((t) => inView(t, view, WED)).map((t) => t.id).join()
  check('a week ends on Sunday (weeks start on Monday)', weekEnd(WED) === '2026-10-25' && weekEnd('2026-10-25') === '2026-10-25' &&
    weekEnd('2026-10-26') === '2026-11-01')
  check('the Inbox holds what you haven’t filed; a list, what you filed there', ids('inbox') === 'now,sun,mon,none,lateDone' && ids('work') === 'late,tmrw')
  check('Today: due today and overdue (not overdue ones done)', ids('today') === 'late,now', ids('today'))
  check('Tomorrow: due tomorrow', ids('tomorrow') === 'tmrw')
  check('This week: overdue and through Sunday', ids('week') === 'late,now,tmrw,sun', ids('week'))
  check('counts are of open todos', openCount(all, 'inbox', WED) === 4)
  check('a new todo in Today or This week is due today, in Tomorrow tomorrow, in a list undated',
    defaultDue('today', WED) === WED && defaultDue('week', WED) === WED && defaultDue('tomorrow', WED) === '2026-10-22' && defaultDue('work', WED) === '')
  const open = all.filter((t) => !t.done_at)
  check('a list groups by Overdue, Today, Upcoming and No date',
    groupOpen(open, 'inbox', WED).map((g) => `${g.key}:${g.rows.length}`).join() === 'overdue:1,today:1,upcoming:3,none:1')
  check('…This week by day, empty days dropped',
    groupOpen(open.filter((t) => inView(t, 'week', WED)), 'week', WED).map((g) => g.label).join() === 'Overdue,Today,Tomorrow,Sunday, Oct 25',
    groupOpen(open.filter((t) => inView(t, 'week', WED)), 'week', WED).map((g) => g.label).join())
  check('due days read as words close by', dueLabel(WED, WED) === 'Today' && dueLabel('2026-10-22', WED) === 'Tomorrow' &&
    dueLabel('2026-10-20', WED) === 'Yesterday' && dueLabel('2026-10-24', WED) === 'Saturday' && dueLabel('2026-11-30', WED) === 'Nov 30')
  check('quick picks: today, tomorrow, Saturday, next Monday', duePresets(WED).map((p) => p.date).join() === '2026-10-21,2026-10-22,2026-10-24,2026-10-26')
  check('…without repeats (on a Saturday, the weekend is today)', duePresets('2026-10-24').map((p) => p.label).join() === 'Today,Tomorrow,Next week')
  check('smart views shown: all at first, then as chosen, unknown ones ignored',
    parseSmartViews(null).join() === 'today,tomorrow,week' && parseSmartViews('').join() === '' && parseSmartViews('week,bogus').join() === 'week')
}

// ---------------- pinned views and recent activity ----------------
check('a saved filter and the address showing it are the same view, whatever the order or extras',
  viewSearch({ assignees: ['me'], resolution: 'unresolved' }) === viewSearch(new URLSearchParams('resolution=unresolved&issue=WEB-1&assignees=me')))
check('…and different filters are different views',
  viewSearch({ assignees: ['me'] }) !== viewSearch(new URLSearchParams('assignees=me&resolution=unresolved')))
check('the last thing done to an issue, in words',
  activityLine({ kind: 'comment', field: null, to_value: null }) === 'commented' &&
  activityLine({ kind: 'change', field: 'created', to_value: 'WEB-1' }) === 'created the issue' &&
  activityLine({ kind: 'change', field: 'status', to_value: 'Done' }) === 'set Status to Done' &&
  activityLine({ kind: 'change', field: 'priority', to_value: 'high' }) === 'set Priority to High' &&
  activityLine({ kind: 'change', field: 'assignee', to_value: null }) === 'cleared Assignee',
  activityLine({ kind: 'change', field: 'priority', to_value: 'high' }))

// ---------------- the Summary's judgements (insights) ----------------
{
  const at = (day: string, time = '10:00') => `${day}T${time}:00`
  const T = (id: string, level: 'epic' | 'standard' | 'subtask') =>
    ({ id, name: id, level, icon: 'task', color: '#000', archived: false }) as import('../src/lib/types').IssueType
  const types = [T('t', 'standard'), T('ep', 'epic'), T('sub', 'subtask')]
  check('work items are the standard level only',
    insights.workItems([issue('w'), issue('e', { type_id: 'ep' }), issue('s', { type_id: 'sub' })], types).map((i) => i.id).join() === 'w')

  // Cycle time: from the first move into progress, else from creation.
  const moved = issue('m', { created_at: at('2026-10-01'), resolved_at: at('2026-10-06'), status_id: 'done' })
  const never = issue('n', { created_at: at('2026-10-01'), resolved_at: at('2026-10-03'), status_id: 'done' })
  const byIssue = insights.groupEvents([
    ev('m', 'status', at('2026-10-04'), 'todo', 'doing'),
    ev('m', 'status', at('2026-10-05'), 'doing', 'todo'),
    ev('m', 'status', at('2026-10-05', '12:00'), 'todo', 'doing'),
    ev('m', 'status', at('2026-10-06'), 'doing', 'done'),
  ])
  check('cycle time runs from the first move into progress', insights.cycleDays(moved, byIssue, statuses) === 2)
  check('…or from creation when it never showed as in progress', insights.cycleDays(never, byIssue, statuses) === 2)
  check('…and an open issue has none', insights.cycleDays(issue('o'), byIssue, statuses) === null)
  check('median and percentile', insights.median([5, 1, 3]) === 3 && insights.median([1, 2, 3, 4]) === 2.5 &&
    insights.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.85) === 9)
  check('aging waits for five finished items, then uses their 85th percentile',
    insights.agingThreshold([1, 2]) === 14 && insights.agingThreshold([1, 2, 3, 4, 10]) === 10 &&
    insights.agingThreshold([1, 2, 2, 2, 3, 4, 10]) === 4)

  const weeks = insights.flowSeries([moved, never], byIssue, statuses, 3, '2026-10-07')
  check('flow counts what finished each week, oldest first', weeks.map((w) => w.completed).join() === '0,0,2' && weeks[2].medianCycle === 2,
    JSON.stringify(weeks))
  check('throughput samples skip the weeks before anything ever finished', insights.throughputSamples(weeks).join() === '2')

  // Monte Carlo, with a generator that always draws the same week.
  const fixed = () => 0
  check('a forecast replays the remaining work against past weeks',
    JSON.stringify(insights.monteCarlo(6, [4], 3, fixed)) === '[11,11,11]')
  check('…finishing part-way through a week', insights.monteCarlo(2, [4], 1, fixed)![0] === 4)
  check('…and needs some finished work to draw on', insights.monteCarlo(3, [0, 0], 10, fixed) === null)
  const seeded = insights.mulberry32(insights.seedOf('rl-1'))
  const again = insights.mulberry32(insights.seedOf('rl-1'))
  check('the generator is seeded: the same release forecasts the same', seeded() === again() && seeded() === again())

  // Releases
  const R = (id: string, release_date: string | null, extra: Partial<Release> = {}): Release => ({ id, project_id: 'p', name: id, description: '',
    start_date: null, release_date, status: 'unreleased', released_at: null, created_at: at('2026-10-01'), ...extra })
  check('the next release is the soonest unreleased, undated last',
    insights.nextRelease([R('late', '2026-12-01'), R('undated', null), R('soon', '2026-11-01'), R('shipped', '2026-10-01', { status: 'released' })])?.id === 'soon')
  check('…or an undated one when nothing has a date', insights.nextRelease([R('undated', null)])?.id === 'undated')
  check('…or none', insights.nextRelease([R('shipped', null, { status: 'released' })]) === null)

  const rel = R('r', '2026-10-31', { start_date: '2026-10-01' })
  const open4 = ['a', 'b', 'c', 'd'].map((id) => issue(id, { release_id: 'r', story_points: 1 }))
  const doneOne = issue('z', { release_id: 'r', status_id: 'done', story_points: 2, assignee_id: 'p1' })
  const h = insights.releaseHealth(rel, [...open4, doneOne], statuses, [4, 4, 4], '2026-10-21', fixed)
  check('a release counts its work and points', h.total === 5 && h.done === 1 && h.points.total === 6 && h.points.done === 2 && h.unassigned === 4)
  check('…forecasts from recent throughput', h.forecast?.p50 === 7 && h.forecast.chance === 1, JSON.stringify(h.forecast))
  check('…and is on track when it will likely make its date', h.verdict.label === 'On track' && h.verdict.tone === 'good')
  const slow = insights.releaseHealth(rel, open4, statuses, [1, 1, 1], '2026-10-21', fixed)
  check('…off track when it likely won\'t', slow.verdict.label === 'Off track', JSON.stringify(slow.forecast))
  const coin = insights.releaseHealth(rel, open4, statuses, [4, 4, 1, 1], '2026-10-21', insights.mulberry32(7))
  check('…at risk in between', coin.verdict.label === 'At risk', JSON.stringify(coin.forecast))
  const young = insights.releaseHealth(rel, open4, statuses, [4, 4], '2026-10-21', fixed)
  check('without three weeks of history, no forecast: time gone against work done', young.forecast === null && young.verdict.label === 'At risk')
  check('…a release past its date is overdue', insights.releaseHealth(rel, open4, statuses, [4, 4, 4], '2026-11-02', fixed).verdict.label === 'Overdue')
  check('…one with nothing open is ready', insights.releaseHealth(rel, [doneOne], statuses, [], '2026-11-02').verdict.label === 'Ready')
  check('…and one without a date says so', insights.releaseHealth(R('u', null), open4, statuses, [4, 4, 4], '2026-10-21', fixed).verdict.label === 'No date')

  // Sprints
  const pts = (remaining: (number | null)[], start = 10) =>
    remaining.map((r, i) => ({ day: `d${i}`, ideal: start - (start * i) / (remaining.length - 1), remaining: r }))
  const active = sprint
  check('a sprint burning at pace is on track', insights.sprintHealth(active, pts([10, 8, 6, null, null, null]), 'points').verdict.label === 'On track')
  check('…one that will leave a little is at risk', insights.sprintHealth(active, pts([10, 8, 6, 3, null]), 'points').verdict.label === 'At risk',
    JSON.stringify(insights.sprintHealth(active, pts([10, 8, 6, 3, null]), 'points')))
  const spilling = insights.sprintHealth(active, pts([10, 10, 9, null, null, null]), 'points')
  check('…one that will leave more says how much will spill', spilling.verdict.label === 'Will spill ~8 points' && spilling.verdict.tone === 'bad',
    spilling.verdict.label)
  check('…on day one it is too early', insights.sprintHealth(active, pts([10, null, null]), 'points').verdict.label === 'Too early')
  check('…a closed sprint says what spilled',
    insights.sprintHealth({ ...active, state: 'closed' }, pts([3, 2, 1], 3), 'issues').verdict.label === 'Spilled 1 issue')
  const scope = insights.scopeChange(active, insights.groupEvents([
    ev('x', 'sprint', at('2026-10-06'), null, 's'), ev('y', 'sprint', at('2026-10-04'), null, 's'), ev('z', 'sprint', at('2026-10-07'), 's', null),
  ]))
  check('scope added and removed after a sprint started', scope.added.join() === 'x' && scope.removed.join() === 'z')

  // Time in status: clipped to the window at both ends.
  const t = issue('t', { status_id: 'done', created_at: at('2026-10-01') })
  const tEvents = insights.groupEvents([
    ev('t', 'status', at('2026-10-02'), 'todo', 'doing'),
    ev('t', 'status', at('2026-10-08'), 'doing', 'done'),
  ])
  const win = (d: string) => new Date(at(d)).getTime()
  const tis = insights.timeInStatus([t], tEvents, statuses, win('2026-10-04'), win('2026-10-06'))
  check('time in status counts only the window', tis.find((r) => r.status.id === 'doing')?.total === 2 &&
    tis.find((r) => r.status.id === 'todo')?.passed === 0, JSON.stringify(tis.map((r) => [r.status.id, r.total, r.passed, r.now])))
  check('…and where it stood at the window\'s end', tis.find((r) => r.status.id === 'doing')?.now === 1)
  const whole = insights.timeInStatus([t], tEvents, statuses, win('2026-09-01'), win('2026-10-09'))
  check('…from its creation when that is later', whole.find((r) => r.status.id === 'todo')?.total === 1 &&
    whole.find((r) => r.status.id === 'doing')?.total === 6 && whole.find((r) => r.status.id === 'done')?.now === 1)
  check('the bottleneck is the slowest in-progress status', insights.bottleneck(whole)?.status.id === 'doing')

  // On time
  const sprintsById = new Map([['s', { end_date: '2026-10-09' }]])
  check('on time by the due date', insights.onTime({ resolved_at: at('2026-10-05'), due_date: '2026-10-05', sprint_id: null }, [], sprintsById) === true &&
    insights.onTime({ resolved_at: at('2026-10-06'), due_date: '2026-10-05', sprint_id: null }, [], sprintsById) === false)
  check('…else within its sprint', insights.onTime({ resolved_at: at('2026-10-09'), due_date: null, sprint_id: 's' }, [], sprintsById) === true &&
    insights.onTime({ resolved_at: at('2026-10-10'), due_date: null, sprint_id: 's' }, [], sprintsById) === false)
  check('…late if it ever spilled', insights.onTime({ resolved_at: at('2026-10-09'), due_date: null, sprint_id: 's' }, [{ completed: false }], sprintsById) === false)
  check('…not judged without either, or while open', insights.onTime({ resolved_at: at('2026-10-09'), due_date: null, sprint_id: null }, [], sprintsById) === null &&
    insights.onTime({ resolved_at: null, due_date: '2026-10-01', sprint_id: null }, [], sprintsById) === null)

  const finished = [
    issue('p1a', { assignee_id: 'p1', resolved_at: at('2026-10-05'), due_date: '2026-10-05', story_points: 3 }),
    issue('p1b', { assignee_id: 'p1', resolved_at: at('2026-10-07'), due_date: '2026-10-05', story_points: 2 }),
    issue('p2a', { assignee_id: 'p2', resolved_at: at('2026-10-05'), story_points: 8 }),
    issue('nobody', { resolved_at: at('2026-10-05'), story_points: 13 }),
  ]
  const people = insights.personStats(finished, [], [], new Map(), statuses)
  check('people: finished work per assignee, most points first, unassigned left out',
    people.map((p) => `${p.assignee}:${p.issues}:${p.points}`).join() === 'p2:1:8,p1:2:5', JSON.stringify(people))
  check('…with the on-time rate of what could be judged', people[1].rate === 0.5 && people[1].judged === 2 && people[0].rate === null)
  const board = insights.leaderboard(people)
  check('the leaderboard ranks by points', board.unit === 'points' && board.rows[0].assignee === 'p2')
  const byCount = insights.leaderboard(insights.personStats(finished.map((i) => ({ ...i, story_points: null })), [], [], new Map(), statuses))
  check('…by issues when nothing is estimated', byCount.unit === 'issues' && byCount.rows[0].assignee === 'p1')

  // Epics
  const epic = issue('E', { type_id: 'ep', start_date: '2026-10-01', due_date: '2026-10-31' })
  const kids = [issue('k1', { parent_id: 'E', status_id: 'done' }), issue('k2', { parent_id: 'E', status_id: 'doing' }), issue('k3', { parent_id: 'E' }),
    issue('k4', { parent_id: 'E' })]
  const [row] = timelineRows([epic, ...kids], types, statuses)
  check('an epic under way is in progress', insights.epicInProgress(row, statuses, '2026-10-21'))
  check('…on track while its work keeps up with its time', insights.epicHealth(row, statuses, '2026-10-08').verdict.label === 'On track')
  check('…at risk when its time runs ahead of its work', insights.epicHealth(row, statuses, '2026-10-21').verdict.label === 'At risk')
  check('…overdue past its end', insights.epicHealth(row, statuses, '2026-11-02').verdict.label === 'Overdue')
  const [idle] = timelineRows([issue('I', { type_id: 'ep' }), issue('i1', { parent_id: 'I' })], types, statuses)
  check('an epic with nothing started and no dates isn\'t in progress', !insights.epicInProgress(idle, statuses, '2026-10-21'))

  // Needs attention
  const now = new Date(at('2026-10-21')).getTime()
  const list = insights.needsAttention({
    open: [
      issue('blocked', { number: 1 }),
      issue('late', { number: 2, due_date: '2026-10-19' }),
      issue('stuck', { number: 3, status_id: 'doing', created_at: at('2026-10-01') }),
      issue('fresh', { number: 4, status_id: 'doing', created_at: at('2026-10-20') }),
      issue('focus', { number: 5 }),
      issue('fine', { number: 6, assignee_id: 'p1', story_points: 1 }),
    ],
    byIssue: new Map(),
    statuses,
    blockers: new Map([['blocked', ['X-9']]]),
    focus: new Set(['focus', 'fine']),
    usesPoints: true,
    agingDays: 5,
    today: '2026-10-21',
    now,
  })
  check('needs attention: blocked and overdue first, then stuck, then unowned sprint work',
    list.map((a) => a.issue.id).join() === 'blocked,late,stuck,focus', list.map((a) => a.issue.id).join())
  check('…each saying why', list[0].reasons[0].text === 'Blocked by X-9' && list[1].reasons[0].text === '2 days overdue' &&
    list[3].reasons.map((r) => r.kind).join() === 'unassigned,unestimated', JSON.stringify(list.map((a) => a.reasons)))
}

// ---------------- widgets and project features ----------------
{
  type P = Parameters<typeof widgetsLib.widgetsFor>[0]
  const scrum: P = { kind: 'scrum', disabled_features: [], summary_widgets: null }
  check('a project shows its kind\'s default widgets', widgetsLib.widgetsFor(scrum).join() === widgetsLib.defaultWidgets('scrum').join())
  check('…Kanban has no sprint widgets', !widgetsLib.widgetsFor({ ...scrum, kind: 'kanban' }).includes('sprint'))
  check('the admins\' choice, minus unknown and other-kind keys',
    widgetsLib.widgetsFor({ ...scrum, kind: 'kanban', summary_widgets: ['velocity', 'gone', 'flow', 'flow', 'people'] }).join() === 'flow,people')
  check('…and minus widgets whose feature is off',
    !widgetsLib.widgetsFor({ ...scrum, disabled_features: ['releases'] }).includes('release') &&
    !widgetsLib.availableWidgets({ ...scrum, disabled_features: ['releases'] }).some((w) => w.key === 'release'))
  check('toggling adds at the end or removes', widgetsLib.toggleWidget(['flow'], 'people', true).join() === 'flow,people' &&
    widgetsLib.toggleWidget(['flow', 'people'], 'flow', false).join() === 'people')
  check('moving swaps neighbours and stops at the ends', widgetsLib.moveWidget(['a', 'b', 'c'] as never[], 'c' as never, -1).join() === 'a,c,b' &&
    widgetsLib.moveWidget(['a', 'b'] as never[], 'a' as never, -1).join() === 'a,b')
  check('the default saves as null, to follow later defaults', widgetsLib.layoutToSave(scrum, widgetsLib.defaultWidgets('scrum')) === null)
  check('a widget hidden only by a feature being off is kept when saving',
    JSON.stringify(widgetsLib.layoutToSave({ ...scrum, disabled_features: ['releases'], summary_widgets: ['release', 'flow'] }, ['people'])) ===
    '["people","release"]')

  const proj = { disabled_features: [] as import('../src/lib/types').ProjectFeature[] }
  check('every feature starts on', features.featureOn(proj, 'releases') && features.featureOn(proj, 'board'))
  check('Board can go while Issues stays', features.canDisable(proj, 'board'))
  check('…but not the last of the two', !features.canDisable({ disabled_features: ['issues'] }, 'board'))
  check('turning off keeps a stable order', features.withFeature({ disabled_features: ['docs'] }, 'board', false).join() === 'board,docs' &&
    features.withFeature({ disabled_features: ['docs', 'board'] }, 'docs', true).join() === 'board')
  check('a tab\'s path names its feature', features.tabFeature('/releases/abc') === 'releases' && features.tabFeature('/settings') === null &&
    features.tabFeature('') === null)
  check('a link to a turned-off tab lands on the summary',
    features.projectTabHref({ key: 'WEB', disabled_features: ['calendar'] }, 'calendar') === '/projects/WEB' &&
    features.projectTabHref({ key: 'WEB', disabled_features: [] }, 'calendar') === '/projects/WEB/calendar')
}

done()
