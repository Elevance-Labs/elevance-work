// Releases (planning, releasing, notes as a Google Doc), the project summary
// and its widgets (the old reports among them), and the project's docs.
import { setupDom, reporter, text, button, click, dialog, type, choose, freezeToday, waitFor, menuItem, settleLazy, write, field } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, failNext, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

// New tabs: recorded, and handed back as a tab the app can point somewhere.
const opened: string[] = []
const tab = { location: { href: '' }, close() {} }
window.open = ((url?: string) => {
  opened.push(String(url ?? ''))
  return tab
}) as unknown as typeof window.open

// ---------------- releases ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/releases')
check('releases are listed with their progress', text().includes('v1.0') && text().includes('1 of 2 issues done'))
check('…but a member doesn\'t plan them', !button('New release'))

reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/releases')
await click(button('New release'))
await type('Name', 'v1.1')
await click(button('Save', dialog()!))
check('a release needs its date', !!dialog() && !captured.inserts.some((i) => i.table === 'releases'))
await type('Release date', '2026-11-30')
await click(button('Save', dialog()!))
const rel = captured.inserts.find((i) => i.table === 'releases')?.rows[0]
check('a manager plans a release', rel?.name === 'v1.1' && rel.project_id === 'pr-web' && rel.release_date === '2026-11-30', JSON.stringify(rel))

reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/releases/rl-1')
const notesCard = () => document.querySelector<HTMLElement>('[data-release-notes]')
const approvalCard = () => document.querySelector<HTMLElement>('[data-approval]')
check('a release leads with its notes, then its issues', !!notesCard() && notesCard()!.textContent!.includes('No release notes yet') &&
  !!(notesCard()!.compareDocumentPosition(document.querySelector('[data-release-issues]')!) & Node.DOCUMENT_POSITION_FOLLOWING) &&
  text().includes('Hero banner') && text().includes('Fix the footer links'))
const description = document.querySelector('[data-release-description]')
check('…its internal description above the notes', description?.textContent === 'First public site' &&
  !!(description.compareDocumentPosition(notesCard()!) & Node.DOCUMENT_POSITION_FOLLOWING))
check('…its dates beside, and the outlook counting the issues', !!document.querySelector('[data-release-details]')?.textContent?.includes('Release date') &&
  !document.querySelector('[data-release-details]')?.textContent?.includes('First public site') &&
  !document.querySelector('[data-release-details]')?.textContent?.includes('issues done') &&
  await waitFor(() => document.querySelector('[data-outlook]')?.textContent?.includes('1 of 2 issues done')))
await click(button('Draft from done issues', notesCard()!))
await settleLazy()
check('notes are drafted from what is done', notesCard()!.querySelector('.ProseMirror[aria-label="Release notes"]')?.textContent?.includes('WEB-3 Fix the footer links'))
await write('Release notes', '<p>A faster site.</p><h2>Bug fixes</h2><ul><li><p>WEB-3 Fix the footer links</p></li></ul>')
await click(button('Save notes'))
const savedNotes = captured.updates.find((u) => u.table === 'releases' && 'notes' in u.values)
check('…and saved on the release', String(savedNotes?.values.notes).includes('A faster site.') && JSON.stringify(savedNotes?.filters) === '[["id","eq","rl-1"]]')
check('…then shown on top', await waitFor(() => notesCard()?.textContent?.includes('A faster site.') && !!button('Edit notes')))
await click(button('Save as Google Doc'))
const docCall = captured.functions.find((f) => (f.body as { action?: string }).action === 'create_doc')
const body = docCall?.body as { project_id: string; doc_type: string; html: string; title: string } | undefined
check('…and can be saved as a Google Doc in the project folder', body?.project_id === 'pr-web' && body.doc_type === 'document' &&
  body.html.includes('A faster site.') && body.html.includes('<h2>Bug fixes</h2>') && !body.html.includes('First public site') && body.title.includes('v1.0'),
  JSON.stringify(body))
check('with no approvers it needs no sign-off', approvalCard()?.dataset.approval === 'none')

// Approvers: Sara (a member) and Omar (a viewer).
reset()
table('release_approvers').push(
  { release_id: 'rl-1', profile_id: 'p-sara', decision: null, comment: '', decided_at: null, added_by: 'p-amna', created_at: TODAY },
  { release_id: 'rl-1', profile_id: 'p-omar', decision: null, comment: '', decided_at: null, added_by: 'p-amna', created_at: TODAY },
)
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/releases/rl-1')
check('a release waits for its approvers', approvalCard()?.textContent?.includes('Awaiting approval (0 of 2)') &&
  button('Release')?.hasAttribute('disabled') === true, approvalCard()?.textContent ?? '')
await click(button('Remove Omar Farooq'))
const removed = captured.deletes.find((d) => d.table === 'release_approvers')
check('a manager removes an approver who hasn\'t decided', JSON.stringify(removed?.filters) === '[["release_id","eq","rl-1"],["profile_id","eq","p-omar"]]',
  JSON.stringify(removed))

signInAs(PEOPLE.member)
await mountApp('/projects/WEB/releases/rl-1')
check('an approver sees where it stands, but not the manager\'s controls', !!button('Approve') && !button('Release') && !button('Edit notes'))
await click(button('Reject'))
await click(button('Reject', dialog()!))
check('a rejection says why', !!dialog() && !captured.rpcs.some((r) => r.name === 'release_decide'))
await click(button('Cancel', dialog()!))
await click(button('Approve'))
await click(button('Approve', dialog()!))
const decided = captured.rpcs.find((r) => r.name === 'release_decide')
check('an approver approves', decided?.args?.p_decision === 'approved' && decided.args.p_release === 'rl-1', JSON.stringify(decided))
check('…approved by all, it is locked', await waitFor(() => approvalCard()?.dataset.approval === 'approved' && text().includes('Approved')))

signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/releases/rl-1')
check('locked: the details and notes don\'t change, no approver is added',
  button('Edit')?.hasAttribute('disabled') === true && button('Write notes')?.hasAttribute('disabled') === true && !field('Add an approver'))
await click(button('Remove WEB-2 from the release'))
check('taking an issue out asks the approvers again', await waitFor(() => approvalCard()?.dataset.approval === 'pending'),
  approvalCard()?.dataset.approval)
check('…and unlocks it', button('Edit')?.hasAttribute('disabled') === false)

table('release_approvers').forEach((a) => Object.assign(a, { decision: 'approved', decided_at: TODAY }))
table('issues').find((i) => i.id === 'i-web-2')!.release_id = 'rl-1'
await mountApp('/projects/WEB/releases/rl-1')
await click(button('Release'))
check('releasing an approved release keeps its unfinished issues (moving them would ask again)',
  dialog()?.textContent?.includes('1 of 2 issues are done') && dialog()?.textContent?.includes('would ask the approvers again') &&
  !field('The 1 unfinished issue', dialog()!))
await click(button('Release', dialog()!))
const released = captured.updates.find((u) => u.table === 'releases' && u.values.status === 'released')
check('…then it is released', JSON.stringify(released?.filters) === '[["id","eq","rl-1"]]' &&
  !captured.updates.some((u) => u.table === 'issues' && u.values.release_id === null && JSON.stringify(u.filters).includes('"in"')))
check('…and shows as released', await waitFor(() => text().includes('Unrelease')))

// Without approvers, unfinished work can leave the release as it goes.
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/releases/rl-1')
await click(button('Release'))
await choose('The 1 unfinished issue', 'Remove from any release')
await click(button('Release', dialog()!))
const moved = captured.updates.find((u) => u.table === 'issues')
check('unfinished work leaves the release first', moved?.values.release_id === null && JSON.stringify(moved.filters) === '[["id","in",["i-web-2"]]]',
  JSON.stringify(moved))

// Archiving: any release, and back to where it was.
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/releases/rl-1')
await click(button('Archive'))
const archived = captured.updates.find((u) => u.table === 'releases')
check('a release not yet out can be archived', archived?.values.status === 'archived' && JSON.stringify(archived.filters) === '[["id","eq","rl-1"]]')
check('…and comes back unreleased', await waitFor(() => !!button('Unarchive')) && !button('Release') && !!button('Delete'))
await click(button('Unarchive'))
check('…when it never went out', captured.updates.filter((u) => u.table === 'releases').at(-1)?.values.status === 'unreleased')

// ---------------- the summary ----------------
const widget = (key: string) => document.querySelector<HTMLElement>(`[data-widget="${key}"]`)
const widgetText = (key: string) => widget(key)?.textContent ?? ''
const widgetsShown = () => [...document.querySelectorAll<HTMLElement>('[data-widget]')].map((w) => w.dataset.widget).join()

reset()
// WEB-3 (2 points, done on the 16th in the sprint) was Sara's; WEB-6 blocks the hero banner.
Object.assign(table('issues').find((i) => i.id === 'i-web-3')!, { assignee_id: 'p-sara' })
table('issue_links').push({ id: 'l-1', source_id: 'i-web-6', target_id: 'i-web-2', kind: 'blocks', created_at: TODAY })
signInAs(PEOPLE.member)
await mountApp('/projects/WEB')
check('a Scrum summary shows its default widgets, in order', await waitFor(() =>
  widgetsShown() === 'release,sprint,attention,status_time,people,leaderboard,epics,flow,activity'), widgetsShown())
check('the next release leads, with its progress', await waitFor(() => widgetText('release').includes('v1.0') &&
  widgetText('release').includes('1 of 2 issues done') && widgetText('release').includes('2 of 7 points')), widgetText('release'))
check('…a verdict from time gone against work done (too little history to forecast)',
  widget('release')?.querySelector('[data-verdict]')?.textContent === 'On track' && widgetText('release').includes('three weeks of finished work'))
check('…and what is blocked', widgetText('release').includes('1 blocked'))
check('the sprint says it will spill at this pace', await waitFor(() => widget('sprint')?.querySelector('[data-verdict]')?.textContent === 'Will spill ~5 points'),
  widgetText('sprint'))
check('…over its burndown', !!widget('sprint')?.querySelector('svg[aria-label="WEB Sprint 1 burndown"]'))
check('needs attention names what is blocked and overdue', await waitFor(() =>
  !!widget('attention')?.querySelector('[data-reason="blocked"]') && widgetText('attention').includes('Blocked by WEB-6') &&
  widgetText('attention').includes('1 day overdue')), widgetText('attention'))
check('…but not a sub-task for having no estimate', !widgetText('attention').includes('Not estimated'), widgetText('attention'))
check('time in status lists the workflow for the sprint', await waitFor(() => !!widget('status_time')?.querySelector('[data-status="In Progress"]')),
  widgetText('status_time'))
check('people: what each finished, and on time', await waitFor(() => widgetText('people').includes('Sara Iqbal') && widgetText('people').includes('100%')),
  widgetText('people'))
check('the leaderboard ranks the sprint', await waitFor(() => widget('leaderboard')?.querySelector('[data-rank="1"]')?.textContent?.includes('Sara Iqbal')))
check('epics under way, with their progress', await waitFor(() => widgetText('epics').includes('Launch the new site') && widgetText('epics').includes('0 of 1 done')))
check('the summary asks only for what each widget needs', captured.selects.filter((q) => q.table === 'issues').every((q) => q.filters.length > 0),
  JSON.stringify(captured.selects.filter((q) => q.table === 'issues' && !q.filters.length)))
check('a member doesn\'t customise it', !button('Customize'))

await click([...widget('people')!.querySelectorAll('button')].find((b) => b.textContent === '30 d'))
check('people over a period reads that period only', await waitFor(() => captured.selects.some((q) => q.table === 'issues' &&
  q.filters.some(([c, op]) => c === 'resolved_at' && op === 'gte') && q.filters.some(([c, op]) => c === 'resolved_at' && op === 'lte'))))

// A widget that fails says so, and the rest carry on.
reset()
table('projects').find((p) => p.id === 'pr-web')!.summary_widgets = ['attention', 'epics']
signInAs(PEOPLE.member)
failNext('issue_links.select', { message: 'boom' })
await mountApp('/projects/WEB')
check('a project shows the widgets its admins chose', await waitFor(() => widgetsShown() === 'attention,epics'), widgetsShown())
check('a widget that fails offers to retry', await waitFor(() => widgetText('attention').includes('Couldn’t load') && !!button('Retry', widget('attention')!)))
check('…while the others load', await waitFor(() => widgetText('epics').includes('Launch the new site')))
await click(button('Retry', widget('attention')!))
check('…and retrying loads it', await waitFor(() => widgetText('attention').includes('1 day overdue')), widgetText('attention'))

// Kanban
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/OPS')
check('a Kanban summary has flow where a sprint would be, and no sprint widget', await waitFor(() =>
  widgetsShown() === 'release,flow,attention,status_time,people,leaderboard,epics,activity'), widgetsShown())
check('…with nothing to release, it says so', await waitFor(() => widgetText('release').includes('No release planned')))
check('…nor finished', await waitFor(() => widgetText('flow').includes('Nothing finished in the last 12 weeks')))

// Customising, by a project admin; the old reports are widgets to add.
reset()
table('sprints').find((s) => s.id === 'sp-1')!.state = 'closed'
table('sprints').find((s) => s.id === 'sp-1')!.completed_at = '2026-10-20T12:00:00Z'
table('sprint_issues').push(
  { sprint_id: 'sp-1', issue_id: 'i-web-2', committed: true, points_at_start: 5, points_at_end: 5, completed: false },
  { sprint_id: 'sp-1', issue_id: 'i-web-3', committed: true, points_at_start: 2, points_at_end: 2, completed: true },
  { sprint_id: 'sp-1', issue_id: 'i-web-6', committed: false, points_at_start: null, points_at_end: 1, completed: true },
)
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB')
await click(button('Customize'))
check('a project admin customises the summary', await waitFor(() => dialog()?.textContent?.includes('Customize the summary')))
const toggle = (label: string) => dialog()!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
await click(toggle('Velocity'))
await click(toggle('Sprint report'))
await click(toggle('Recent activity'))
await click(button('Move Next release down', dialog()!))
await click(button('Save', dialog()!))
const saved = captured.updates.find((u) => u.table === 'projects')
check('…saving the layout for everyone', JSON.stringify(saved?.values.summary_widgets) ===
  '["sprint","release","attention","status_time","people","leaderboard","epics","flow","velocity","sprint_report"]', JSON.stringify(saved?.values))
check('…which shows at once', await waitFor(() => widgetsShown().startsWith('sprint,release') && !!widget('velocity')))
check('the closed sprint spilled', await waitFor(() => widget('sprint')?.querySelector('[data-verdict]')?.textContent === 'Spilled 5 points'),
  widgetText('sprint'))
check('velocity compares committed with completed', await waitFor(() => !!widget('velocity')?.querySelector('svg[aria-label="Velocity"]') &&
  widgetText('velocity').includes('average completed (points)')))
check('the sprint report lists completed, not completed and added work', await waitFor(() =>
  /Completed \(2\)/.test(widgetText('sprint_report')) && /Not completed \(1\)/.test(widgetText('sprint_report')) &&
  /Added after the sprint started \(1\)/.test(widgetText('sprint_report'))), widgetText('sprint_report').slice(0, 300))

reset()
table('projects').find((p) => p.id === 'pr-ops')!.summary_widgets = ['created_resolved', 'cumulative_flow']
signInAs(PEOPLE.member)
await mountApp('/projects/OPS')
check('created vs resolved and cumulative flow are widgets too', await waitFor(() =>
  !!document.querySelector('svg[aria-label="Created vs resolved"]') && !!document.querySelector('svg[aria-label="Cumulative flow"]')))

// The Reports tab is gone; its address lands on the summary.
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/reports?report=velocity')
check('the old reports address lands on the summary', await waitFor(() => location.pathname === '/projects/WEB'), location.pathname)

// Reading past the 1000-row page.
reset()
for (let n = 0; n < 1005; n++) {
  table('issue_events').push({ id: `ev-${String(n).padStart(4, '0')}`, issue_id: 'i-web-2', project_id: 'pr-web', actor_id: null, field: 'title',
    from_value: null, to_value: null, from_id: null, to_id: null, created_at: TODAY })
}
const { fetchAll } = await import('../src/lib/paging')
const { supabase } = await import('./mockSupabase')
const before = captured.selects.length
const all = await fetchAll((from, to) => supabase.from('issue_events').select('id').order('id').range(from, to))
check('paging reads every row, a thousand at a time', all.data?.length === 1005 && captured.selects.length - before === 2,
  `${all.data?.length} in ${captured.selects.length - before}`)

// ---------------- docs ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/docs')
check('a project with no docs says so', text().includes('No documents yet.'))
opened.length = 0
await click(button('New'))
await click(menuItem('Google Sheet'))
await type('Title', 'Content plan')
await click(button('Create in Drive', dialog()!))
const sheet = captured.functions.find((f) => (f.body as { action?: string }).action === 'create_doc')?.body as Record<string, unknown> | undefined
check('a new Google Sheet is made through the drive function', sheet?.doc_type === 'spreadsheet' && sheet.title === 'Content plan' &&
  sheet.project_id === 'pr-web' && sheet.issue_id === null, JSON.stringify(sheet))
check('…opened in a new tab', opened.length === 1 && opened[0].startsWith('https://docs.google.com/'), opened.join())
check('…and listed', await waitFor(() => text().includes('Content plan')))

await click(button('Drive folder'))
check('the project’s Drive folder opens through the function', captured.functions.some((f) => (f.body as { action?: string }).action === 'project_folder'))
check('…in a new tab', await waitFor(() => tab.location.href === 'https://drive.google.com/drive/folders/folder-1'), tab.location.href)
check('…staying on the page', location.pathname === '/projects/WEB/docs')

done()
