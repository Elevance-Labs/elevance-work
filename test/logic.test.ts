// The pure rules in src/lib: reports rebuilt from history, the calendar's
// items and meetings, filters and their URL form, ranks, Google links, rich text, search.
import { setupDom, reporter } from './setup'
setupDom()

const { burndown, velocity, sprintReport, createdVsResolved, cumulativeFlow, stateAt, breakdown, workload, recentCounts, unitFor } =
  await import('../src/lib/reports')
const { monthGrid, calendarItems, datedWithin, currentMeeting, itemsOn, weekStart, weekDays, weekLabel, timedBlocks } = await import('../src/lib/calendar')
const { EMPTY_FILTER, applyFilter, filterFromSearch, filterToSearch, filterToQuery, filterFromQuery, matchesFilter, issuesToCsv } =
  await import('../src/lib/filters')
const { rankBetween, rankForIndex, parseIssueKey, normaliseLabels } = await import('../src/lib/issues')
const { docTypeFromUrl, embedUrl } = await import('../src/lib/drive')
const { sanitizeHtml, mentionedIds, isBlankHtml } = await import('../src/lib/richText')
const { releaseNotes, notesText } = await import('../src/lib/releases')
const { roleIn } = await import('../src/lib/permissions')
const { suggestKey } = await import('../src/lib/projects')
const { matchesWords, searchTodos, searchNotes, isShortcut } = await import('../src/lib/search')
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

check('breakdown keeps the given order', breakdown([a, b, issue('c', { status_id: 'doing' })], (i) => i.status_id, ['todo', 'doing', 'done'])
  .map((s) => s.key).join() === 'todo,doing,done')
check('workload counts open work per person', JSON.stringify(workload([issue('m', { assignee_id: 'p1', story_points: 2 }), issue('n', { assignee_id: 'p1' }),
  issue('o', { resolved_at: '2026-10-01' })])) === '[{"assignee":"p1","issues":2,"points":2}]')
check('recent counts look back seven days', recentCounts([issue('r', { created_at: '2026-10-20T10:00:00', updated_at: '2026-10-20T10:00:00' })], '2026-10-21')
  .created === 1)

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

done()
