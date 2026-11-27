// Project features: what a project's admins turn off goes from its tabs, its
// addresses land on the summary, and Releases off hides the release field
// (keeping its value), the release widget and release dates on calendars.
import { setupDom, reporter, text, button, click, dialog, choose, freezeToday, waitFor, field, settleLazy } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)
const web = () => table('projects').find((p) => p.id === 'pr-web')!
const lastUpdate = (t: string) => captured.updates.filter((u) => u.table === t).at(-1)

// ---------------- tabs ----------------
reset()
web().disabled_features = ['timeline', 'releases', 'docs']
signInAs(PEOPLE.member)
await mountApp('/projects/WEB')
check('a feature turned off has no tab', tabs().join() === 'Summary,Backlog,Board,Calendar,Issues,Tests', tabs().join())

for (const path of ['/projects/WEB/releases', '/projects/WEB/releases/rl-1', '/projects/WEB/docs', '/projects/WEB/timeline']) {
  reset()
  web().disabled_features = ['timeline', 'releases', 'docs']
  signInAs(PEOPLE.member)
  await mountApp(path)
  check(`…and ${path.slice(14)} lands on the summary`, await waitFor(() => location.pathname === '/projects/WEB'), location.pathname)
}

reset()
table('projects').find((p) => p.id === 'pr-ops')!.disabled_features = ['board']
signInAs(PEOPLE.member)
await mountApp('/projects/OPS/backlog')
check('a Kanban project without a board sends its backlog address to the summary', await waitFor(() => location.pathname === '/projects/OPS'),
  location.pathname)

// ---------------- Releases off ----------------
reset()
web().disabled_features = ['releases']
signInAs(PEOPLE.member)
await mountApp('/projects/WEB')
check('with Releases off the summary has no release widget', await waitFor(() => !!document.querySelector('[data-widget="sprint"]')) &&
  !document.querySelector('[data-widget="release"]'))

await mountApp('/projects/WEB/board?issue=WEB-2')
await settleLazy()
check('…the issue view hides the release field', await waitFor(() => !!field('Sprint', dialog()!)) && !field('Release', dialog()!))
check('…while the issue keeps its release', table('issues').find((i) => i.id === 'i-web-2')!.release_id === 'rl-1')

reset()
web().disabled_features = ['releases']
signInAs(PEOPLE.member)
async function openCreateIssue() {
  await click(button('Create'))
  await waitFor(() => document.querySelector('[data-create]'), 4000)
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', bubbles: true }))
  await waitFor(() => dialog()?.textContent?.includes('Create issue'), 4000)
}
await mountApp('/projects/WEB/board')
await openCreateIssue()
await choose('Project', 'Website (WEB)', dialog()!)
check('…creating an issue in the project offers no release', await waitFor(() => !!field('Story points', dialog()!)) && !field('Release', dialog()!))

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/board')
await openCreateIssue()
await choose('Project', 'Website (WEB)', dialog()!)
check('(with Releases on, it does)', await waitFor(() => !!field('Release', dialog()!)))

reset()
web().disabled_features = ['releases']
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/calendar?view=month&month=2026-10')
await settleLazy()
check('…the project calendar has no releases layer or dates', await waitFor(() => text().includes('Epics')) &&
  !text().includes('v1.0') && !text().includes('Releases'), text().slice(0, 300))

reset()
web().disabled_features = ['releases']
signInAs(PEOPLE.member)
await mountApp('/calendar?month=2026-10')
await settleLazy()
check('…nor the workspace calendar', await waitFor(() => text().includes('Calendar')) && !text().includes('WEB v1.0'))

reset()
signInAs(PEOPLE.member)
await mountApp('/calendar?month=2026-10')
await settleLazy()
check('(with Releases on, the release is on the calendar)', await waitFor(() => text().includes('WEB v1.0')))

// ---------------- settings ----------------
reset()
web().disabled_features = ['issues']
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/settings?tab=features')
const sw = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
check('features are switches in the settings', await waitFor(() => !!sw('Docs')) && sw('Docs')!.checked && !sw('Issues')!.checked)
check('…and the last of Issues and Board can\'t be turned off', sw('Board')!.disabled)
await click(sw('Docs'))
check('turning one off saves the project\'s list', await waitFor(() => JSON.stringify(lastUpdate('projects')?.values) ===
  '{"disabled_features":["issues","docs"]}'), JSON.stringify(lastUpdate('projects')))
check('…and its tab goes', await waitFor(() => !tabs().includes('Docs')), tabs().join())
await click(sw('Issues'))
check('turning one back on brings its tab back', await waitFor(() => tabs().includes('Issues')) && !sw('Board')!.disabled, tabs().join())

done()
