// Releases (planning, releasing, notes as a Google Doc), the project summary,
// the reports, and the project's docs.
import { setupDom, reporter, text, button, click, dialog, type, choose, freezeToday, waitFor, menuItem } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, PEOPLE, TODAY } = await import('./mockSupabase')

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
await click(button('New release'))
await type('Name', 'v1.1')
await click(button('Save', dialog()!))
const rel = captured.inserts.find((i) => i.table === 'releases')?.rows[0]
check('a release is planned', rel?.name === 'v1.1' && rel.project_id === 'pr-web', JSON.stringify(rel))

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/releases/rl-1')
check('a release shows its issues', text().includes('Hero banner') && text().includes('Fix the footer links'))
await click(button('Release'))
check('releasing says what is done', dialog()?.textContent?.includes('1 of 2 issues are done'))
await choose('The 1 unfinished issue', 'Remove from any release')
await click(button('Release', dialog()!))
const moved = captured.updates.find((u) => u.table === 'issues')
check('unfinished work leaves the release first', moved?.values.release_id === null && JSON.stringify(moved.filters) === '[["id","in",["i-web-2"]]]',
  JSON.stringify(moved))
const released = captured.updates.find((u) => u.table === 'releases')
check('…then it is released', released?.values.status === 'released' && JSON.stringify(released.filters) === '[["id","eq","rl-1"]]')
check('…and shows as released', await waitFor(() => text().includes('Unrelease')))

await click([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Release notes'))
check('release notes group what shipped', text().includes('Bug fixes') && text().includes('WEB-3'))
await click(button('Save as Google Doc'))
const docCall = captured.functions.find((f) => (f.body as { action?: string }).action === 'create_doc')
const body = docCall?.body as { project_id: string; doc_type: string; html: string; title: string } | undefined
check('…and can be saved as a Google Doc in the project folder', body?.project_id === 'pr-web' && body.doc_type === 'document' &&
  body.html.includes('<h2>Bug fixes</h2>') && body.html.includes('WEB-3 Fix the footer links') && body.title.includes('v1.0'), JSON.stringify(body))

// ---------------- the summary ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB')
check('the summary shows the status overview', !!document.querySelector('svg[aria-label="Issues by status category"]') || text().includes('Status overview'))
check('…the active sprint', text().includes('Active sprint') && text().includes('WEB Sprint 1'))
check('…epic progress', text().includes('Launch the new site') && text().includes('0/1'))
check('…and the upcoming release', text().includes('v1.0') && text().includes('1/2 done'))

// ---------------- reports ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/reports')
check('a Scrum project opens on the burndown', !!document.querySelector('svg[aria-label="Sprint burndown"]'))
check('…for the active sprint, in story points', text().includes('in story points'))
await choose('Report', 'Velocity')
check('velocity waits for a completed sprint', await waitFor(() => text().includes('No completed sprints yet')))
await choose('Report', 'Created vs resolved')
check('created vs resolved is drawn', await waitFor(() => !!document.querySelector('svg[aria-label="Created vs resolved"]')))
await choose('Report', 'Cumulative flow')
check('so is cumulative flow', await waitFor(() => !!document.querySelector('svg[aria-label="Cumulative flow"]')))

reset()
table('sprints').find((s) => s.id === 'sp-1')!.state = 'closed'
table('sprints').find((s) => s.id === 'sp-1')!.completed_at = '2026-10-20T12:00:00Z'
table('sprint_issues').push(
  { sprint_id: 'sp-1', issue_id: 'i-web-2', committed: true, points_at_start: 5, points_at_end: 5, completed: false },
  { sprint_id: 'sp-1', issue_id: 'i-web-3', committed: true, points_at_start: 2, points_at_end: 2, completed: true },
  { sprint_id: 'sp-1', issue_id: 'i-web-6', committed: false, points_at_start: null, points_at_end: 1, completed: true },
)
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/reports?report=sprint&sprint=sp-1')
check('the sprint report lists completed, not completed and added work',
  /Completed \(2\)/.test(text()) && /Not completed \(1\)/.test(text()) && /Added after the sprint started \(1\)/.test(text()), text().slice(0, 400))
await choose('Report', 'Velocity')
check('velocity compares committed with completed', await waitFor(() => !!document.querySelector('svg[aria-label="Velocity"]')) &&
  text().includes('average completed (points)'))

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/OPS/reports')
check('a Kanban project has no sprint reports', !text().includes('Burndown') && !!document.querySelector('svg[aria-label="Created vs resolved"]'))

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
