// The board and the backlog: what each shows, moving issues between columns
// and sprints (by each card's menu, as on a phone), and a sprint from
// creation through start to completion.
import { setupDom, reporter, text, button, buttons, click, dialog, type, typeInto, choose, labelled, submit, menuItem, freezeToday, waitFor } from './setup'
setupDom()

const { mountApp } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

const column = (name: string) => document.querySelector(`[data-column="${name}"]`)
const list = (name: string) => document.querySelector(`[data-list="${name}"]`)
const lastUpdate = (t: string) => captured.updates.filter((u) => u.table === t).at(-1)

// ---------------- the Scrum board ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/board')
check('the board shows the active sprint', text().includes('WEB Sprint 1') && text().includes('Ship the hero'))
check('…its issues in their status columns',
  !!column('In Progress')?.textContent?.includes('Hero banner') && !!column('Done')?.textContent?.includes('Fix the footer links'))
check('…sub-tasks as cards too', !!column('To Do')?.textContent?.includes('Headline copy'))
check('…but not what is outside the sprint', !text().includes('Pricing page') && !text().includes('Launch the new site'))
check('the board reads only the sprint’s issues',
  captured.selects.some((s) => s.table === 'issues' && JSON.stringify(s.filters).includes('["sprint_id","eq","sp-1"]')))
check('it listens for other people’s changes', captured.channels.includes('board:pr-web'))
check('a column shows its count against its WIP limit', text().includes('1 / 2'))

await click(button('Move WEB-2'))
await click(menuItem('In Review'))
const move = lastUpdate('issues')
check('a card’s menu moves it to another status', move?.values.status_id === 'st-web-review' && typeof move.values.rank === 'number' &&
  JSON.stringify(move.filters) === '[["id","eq","i-web-2"]]', JSON.stringify(move))
check('…and it shows there at once', !!column('In Review')?.textContent?.includes('Hero banner'))

failNext('issues.update', { code: '42501', message: 'new row violates row-level security policy for table "issues"' })
await click(button('Move WEB-4'))
await click(menuItem('Done'))
check('a refused move goes back, and says why',
  !!column('To Do')?.textContent?.includes('Headline copy') && text().includes("You don't have permission to do that."))

await typeInto('Filter this board', 'footer')
check('the quick filter narrows the cards', !text().includes('Hero banner') && text().includes('Fix the footer links'))
await typeInto('Filter this board', '')
await click(button('Only my issues'))
check('“Only my issues” keeps yours', text().includes('Hero banner') && !text().includes('Headline copy'))

// Lanes by assignee
await click(button('Only my issues'))
await choose('Group by', 'Assignee')
check('lanes by assignee', text().includes('Sara Iqbal') && text().includes('Amna Khan') && text().includes('Unassigned'))

// No active sprint
reset()
table('sprints').find((s) => s.id === 'sp-1')!.state = 'closed'
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/board')
check('with no active sprint, the board points to the backlog', text().includes('No active sprint') && text().includes('backlog'))

// ---------------- the Kanban board ----------------
reset()
table('issues').push({ ...table('issues').find((i) => i.key === 'OPS-2')!, id: 'i-ops-3', number: 3, key: 'OPS-3', title: 'Old and done',
  status_id: 'st-ops-done', resolved_at: '2026-09-01T10:00:00Z' })
signInAs(PEOPLE.member)
await mountApp('/projects/OPS/board')
check('a Kanban board shows everything open', text().includes('Laptop for Hina') && text().includes('Renew the domain'))
check('…asking only for unresolved or recently resolved work',
  captured.selects.some((s) => s.table === 'issues' &&
    JSON.stringify(s.filters).includes('[["resolved_at","is",null],["resolved_at","gte","2026-10-07"]]')),
  JSON.stringify(captured.selects.filter((s) => s.table === 'issues').map((s) => s.filters)))
check('…so work done weeks ago has dropped off', !text().includes('Old and done'))
await click(button('Create issue'))
check('“Create issue” in the first column opens the create dialog there', await waitFor(() => dialog()?.textContent?.includes('Create issue')))

// ---------------- the backlog ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/backlog')
check('the backlog lists the active sprint, the planned one, then the backlog',
  !!list('WEB Sprint 1') && !!list('WEB Sprint 2') && !!list('Backlog'))
check('…with unplanned work in the backlog', !!list('Backlog')?.textContent?.includes('Pricing page') &&
  !!list('Backlog')?.textContent?.includes('Contact form'))
check('…but not epics or sub-tasks, which aren’t planned', !list('Backlog')?.textContent?.includes('Launch the new site') &&
  !list('WEB Sprint 1')?.textContent?.includes('Headline copy'))
check('a planned sprint can’t start while one is active', (buttons('Start sprint')[0] as HTMLButtonElement | undefined)?.disabled === true)

await click(button('Move WEB-5'))
await click(menuItem('WEB Sprint 2'))
check('a row’s menu plans it into a sprint', lastUpdate('issues')?.values.sprint_id === 'sp-2', JSON.stringify(lastUpdate('issues')))
check('…and it moves there', !!list('WEB Sprint 2')?.textContent?.includes('Pricing page'))

await click(button('Create sprint'))
const newSprint = captured.inserts.find((i) => i.table === 'sprints')?.rows[0]
check('Create sprint adds the next one, named for the project', newSprint?.name === 'WEB Sprint 3' && newSprint.project_id === 'pr-web',
  JSON.stringify(newSprint))
check('…and shows it', await waitFor(() => !!list('WEB Sprint 3')))

// Quick create in the backlog
const backlog = list('Backlog')!
await click(button('Create issue', backlog))
await typeInto('New issue summary', 'Newsletter signup', list('Backlog')!)
await submit(labelled('New issue summary', list('Backlog')!))
const quick = captured.inserts.filter((i) => i.table === 'issues').at(-1)?.rows[0]
check('an issue is created right in the backlog', quick?.title === 'Newsletter signup' && quick.sprint_id === null && quick.type_id === 't-story',
  JSON.stringify(quick))
check('…and listed there', !!list('Backlog')?.textContent?.includes('Newsletter signup'))

// Complete the active sprint
await click(button('Complete sprint'))
check('completing tells you what is done and what isn’t', /1 issue done \(2 points\),\s*1 still open/.test(dialog()?.textContent ?? ''), dialog()?.textContent ?? '')
await choose('Move the open issues to', 'WEB Sprint 2')
await click(button('Complete sprint', dialog()!))
const completeCall = captured.rpcs.find((r) => r.name === 'sprint_complete')
check('it calls sprint_complete with where the open work goes', completeCall?.args?.p_sprint === 'sp-1' && completeCall.args.p_move_to === 'sp-2',
  JSON.stringify(completeCall))
check('…and the sprint leaves the backlog', await waitFor(() => !list('WEB Sprint 1')))
check('…its open work now in the next sprint', !!list('WEB Sprint 2')?.textContent?.includes('Hero banner'))

// Start the next one
await click(buttons('Start sprint')[0])
check('starting asks for dates, from today for two weeks', !!dialog()?.querySelector(`input[value="${TODAY}"]`) &&
  !!dialog()?.querySelector('input[value="2026-11-03"]'))
await type('Sprint goal', 'Pricing and contact')
await click(button('Start', dialog()!))
const startCall = captured.rpcs.find((r) => r.name === 'sprint_start')
check('it calls sprint_start with the dates and goal', startCall?.args?.p_sprint === 'sp-2' && startCall.args.p_start === TODAY &&
  startCall.args.p_end === '2026-11-03' && startCall.args.p_goal === 'Pricing and contact', JSON.stringify(startCall))
check('…and it shows as active', await waitFor(() => list('WEB Sprint 2')?.textContent?.includes('Active')))

// Deleting a planned sprint
const third = table('sprints').find((x) => x.name === 'WEB Sprint 3')!.id
await click(button('WEB Sprint 3 actions'))
await click(menuItem('Delete sprint'))
await click(button('Delete', dialog()!))
check('a planned sprint can be deleted', captured.deletes.some((d) => d.table === 'sprints' && JSON.stringify(d.filters) === `[["id","eq","${third}"]]`))

// ---------------- what a viewer can't do ----------------
reset()
signInAs(PEOPLE.viewer)
await mountApp('/projects/WEB/backlog')
check('a viewer sees the backlog', !!list('Backlog'))
check('…with no planning controls', !button('Create sprint') && !button('Complete sprint') && !button('Create issue') &&
  !document.querySelector('[aria-label^="Move WEB-"]'))

done()
