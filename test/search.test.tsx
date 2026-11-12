// Issue lists and filters: what a filter asks the database, that it lives in
// the URL, saving and sharing filters, search (Cmd/Ctrl+S) and Create (Cmd/Ctrl+K).
import { setupDom, reporter, text, button, click, dialog, type, typeInto, labelled, submit, menuItem, checkbox, choose, field, freezeToday, settle, settleLazy, waitFor, options } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

const issueQueries = () => captured.selects.filter((s) => s.table === 'issues' && s.columns.includes('rank'))
const lastFilters = () => JSON.stringify(issueQueries().at(-1)?.filters ?? [])
const rows = () => [...document.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '')

// The router applies a URL change as a transition, which jsdom commits a
// little later: wait for the list to ask again.
async function pick(selectLabel: string, option: string) {
  const before = issueQueries().length
  const sel = labelled(selectLabel)
  const combo = sel?.closest('.MuiInputBase-root')?.querySelector('[role="combobox"]')
  if (!combo) throw new Error(`pick: no select labelled ${selectLabel}`)
  combo.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, button: 0 }))
  await settle()
  await click(options().find((o) => o.textContent?.trim() === option))
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.querySelector('.MuiBackdrop-invisible')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => issueQueries().length > before, 4000)
  await settle()
}

// ---------------- the Issues page ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/issues')
check('every issue you can see is listed, newest change first', rows().length === 8, rows().length)
check('…counted', text().includes('8 issues'))

await pick('Assignee', 'Me')
check('a filter goes into the URL', location.search.includes('assignees=me'), location.search)
check('…and into the query, as you', lastFilters().includes('["assignee_id","in",["p-sara"]]'), lastFilters())
check('…and narrows the list', rows().length === 3 && rows().every((r) => r.includes('Sara Iqbal')), rows().join(' | '))

await pick('Assignee', 'Unassigned')
check('“unassigned” with people becomes one or()', lastFilters().includes('assignee_id.is.null') || lastFilters().includes('["assignee_id","is",null]'), lastFilters())

reset()
signInAs(PEOPLE.member)
await mountApp('/issues?text=footer')
check('words search the issues’ text', lastFilters().includes('["search","fts","footer"]'), lastFilters())
check('…and find them', rows().length === 1 && rows()[0].includes('Fix the footer links'), rows().join(' | '))

reset()
signInAs(PEOPLE.member)
await mountApp('/issues?text=web-5')
check('a key goes straight to that issue', lastFilters().includes('["key","eq","WEB-5"]'), lastFilters())

reset()
signInAs(PEOPLE.member)
await mountApp('/issues?categories=done&priorities=high,highest&sort=priority')
const statusFilter = issueQueries().at(-1)?.filters.find((f) => f[0] === 'status_id')
check('a URL’s filter is applied on load: done statuses only',
  JSON.stringify([...(statusFilter?.[2] as string[] ?? [])].sort()) === '["st-ops-done","st-web-done"]', lastFilters())
check('…and priorities', lastFilters().includes('["priority","in",["high","highest"]]'))
check('…sorted by priority', issueQueries().length > 0)

reset()
signInAs(PEOPLE.member)
await mountApp('/issues?due=overdue')
check('overdue means due before today and unresolved', lastFilters().includes(`["due_date","lt","${TODAY}"]`) && lastFilters().includes('["resolved_at","is",null]'),
  lastFilters())
check('…and finds the late one', rows().length === 1 && rows()[0].includes('Pricing page'), rows().join(' | '))

// ---------------- a project's issues ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/OPS/issues')
check('a project’s Issues tab is limited to it', lastFilters().includes('["project_id","in",["pr-ops"]]') && rows().length === 2, lastFilters())
check('…and offers its own statuses', !!labelled('Status'))
await pick('Status', 'Doing')
check('…by id', lastFilters().includes('["status_id","in",["st-ops-doing"]]'), lastFilters())
check('…keeping the project out of the URL', !location.search.includes('projects='), location.search)

// ---------------- saved filters ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/issues?assignees=me&resolution=unresolved')
await click(button('Filters'))
await click(menuItem('Save current filter…'))
await type('Name', 'My open work')
await click(checkbox('Share with everyone in the workspace'))
await click(button('Save', dialog()!))
const saved = captured.inserts.find((i) => i.table === 'saved_filters')?.rows[0]
check('a filter is saved by name, shared if you say so', saved?.name === 'My open work' && saved.shared === true &&
  JSON.stringify(saved.query) === '{"assignees":["me"],"resolution":"unresolved"}', JSON.stringify(saved))

reset()
table('saved_filters').push({ id: 'sf-1', owner_id: 'p-amna', name: 'Open bugs', shared: true, query: { types: ['t-bug'], resolution: 'unresolved' },
  created_at: '2026-10-01T00:00:00Z' })
signInAs(PEOPLE.member)
await mountApp('/issues')
await click(button('Filters'))
check('shared filters are offered, with who made them', !!menuItem('Open bugsAmna Khan') ||
  [...document.querySelectorAll('[role="menuitem"]')].some((m) => m.textContent?.includes('Open bugs') && m.textContent.includes('Amna Khan')))
const beforeSaved = issueQueries().length
await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((m) => m.textContent?.includes('Open bugs')))
await waitFor(() => issueQueries().length > beforeSaved, 4000)
check('picking one applies it', location.search.includes('types=t-bug') && lastFilters().includes('["type_id","in",["t-bug"]]'), location.search)
check('…not yours, so no delete', !button('Delete Open bugs'))

// ---------------- search (Cmd/Ctrl+S) ----------------
// Search and Create load on first use.
const shortcut = async (key: string) => {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))
  await waitFor(() => (key === 's' ? labelled(SEARCH) : document.querySelector('[data-create]')), 4000)
  await settle()
}
const SEARCH = 'Search issues, todos and notes'
const result = (id: string) => document.querySelector<HTMLElement>(`[data-result="${id}"]`)
const groups = () => [...document.querySelectorAll('#search-results .MuiListSubheader-root')].map((h) => h.textContent).join()
const enter = async () => {
  labelled(SEARCH)?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
}

reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
const saveEvent = new window.KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true })
window.dispatchEvent(saveEvent)
check('Cmd/Ctrl+S opens search instead of saving the page', await waitFor(() => labelled(SEARCH), 4000) && saveEvent.defaultPrevented)
await typeInto(SEARCH, 'WEB-3')
await waitFor(() => result('issue:i-web-3'))
await enter()
check('a key opens that issue where you are', await waitFor(() => location.pathname === '/dashboard' && location.search === '?issue=WEB-3'), location.search)
check('…in the dialog, search closed', await waitFor(() => dialog()?.textContent?.includes('Fix the footer links'), 4000) && !labelled(SEARCH))

reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await click(labelled('Search'))
check('the header’s search opens it too', await waitFor(() => labelled(SEARCH), 4000))
await typeInto(SEARCH, 'hero')
check('one box finds issues, todos and notes, grouped in that order', await waitFor(() => result('issue:i-web-2') &&
  result('todo:td-omar-shared') && result('note:nt-launch')) && groups() === 'Issues,Todos,Notes', groups())
check('…issues searched in the database, a few at most', captured.selects.some((q) => q.table === 'issues' &&
  JSON.stringify(q.filters).includes('["search","fts","hero"]')))
await click(result('all-issues'))
check('…and the rest of the issues on the Issues page', await waitFor(() => location.pathname === '/issues' && location.search === '?text=hero'),
  `${location.pathname}${location.search}`)

reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await shortcut('s')
await typeInto(SEARCH, 'pricing')
check('notes are found by their text', await waitFor(() => result('note:nt-launch') && result('issue:i-web-5')) && groups() === 'Issues,Notes', groups())
await typeInto(SEARCH, 'private')
await waitFor(() => !result('note:nt-launch'))
check('…only your own notes, and only todos you’re on', !text().includes('Omar private') && !text().includes('Not for Sara'))
check('archived notes aren’t searched', captured.selects.some((s) => s.table === 'notes' &&
  JSON.stringify(s.filters) === '[["owner_id","eq","p-sara"],["archived_at","is",null]]'))
await typeInto(SEARCH, 'retro')
await settle(250)
check('…so an archived one isn’t found', !result('note:nt-old') && !text().includes('Old retro'))
await typeInto(SEARCH, 'domain')
check('a note on a meeting is found by its text; there are no calendar events to find',
  await waitFor(() => !!result('note:nt-standup')) && groups() === 'Notes' && !text().includes('Events'), groups())
labelled(SEARCH)?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
await settle()
check('arrow keys move through the results', result('all-issues')?.getAttribute('aria-selected') === 'true')
labelled(SEARCH)?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
await settle()
await enter()
check('…and Enter opens one: a note, on the notes page', await waitFor(() => location.pathname === '/notes' &&
  !!dialog()?.textContent?.includes('Ask about the domain')), `${location.pathname}${location.search}`)

reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await shortcut('s')
await typeInto(SEARCH, 'gift')
await waitFor(() => result('note:nt-gifts'))
await click(result('note:nt-gifts'))
check('a note opens on the notes page', await waitFor(() => location.pathname === '/notes' && dialog()?.textContent?.includes('Edit note')) &&
  (dialog()?.querySelector('input') as HTMLInputElement | null)?.value === 'Gift ideas')

// ---------------- Create (Cmd/Ctrl+K) ----------------
const createChoice = (kind: string) => document.querySelector<HTMLElement>(`[data-create="${kind}"]`)
const letter = async (key: string) => {
  // Wherever focus is: in a browser the dialog, not a choice, has it at first.
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
  await settleLazy()
}

reset()
signInAs(PEOPLE.member)
await mountApp('/todos')
await shortcut('k')
check('Cmd/Ctrl+K offers an issue, a todo or a note; no events (meetings are made in Google Calendar)',
  ['issue', 'todo', 'note'].every((k) => createChoice(k)) && !createChoice('event'))
await letter('2')
check('…each by its number: 2, a todo', dialog()?.textContent?.includes('New todo'))
await type('Todo', 'Order the banners', dialog()!)
await submit(dialog()?.querySelector('input'))
const created = captured.inserts.filter((i) => i.table === 'todos').at(-1)?.rows[0]
check('…added', created?.title === 'Order the banners' && JSON.stringify(created.shared_with) === '[]', JSON.stringify(created))
check('…and the page underneath shows it', await waitFor(() => !!document.querySelector('input[value="Order the banners"]')))

await shortcut('k')
await letter('3')
check('3, a note', dialog()?.textContent?.includes('New note'))
await click(button('Close', dialog()!))

await click(button('Create'))
await waitFor(() => createChoice('note'))
check('the Create button asks too, rather than starting an issue', !dialog()?.textContent?.includes('Create issue'))
await click(createChoice('todo'))
await settleLazy()
check('a todo, by clicking it, which can be about a project', !!dialog()?.textContent?.includes('New todo') && !!field('Project (optional)', dialog()!))
await type('Todo', 'Plan the offsite', dialog()!)
await choose('Project (optional)', 'Operations', dialog()!)
await click(button('Add', dialog()!))
const projectTodo = captured.inserts.filter((i) => i.table === 'todos').at(-1)?.rows[0]
check('…saved with its project', projectTodo?.title === 'Plan the offsite' && projectTodo.project_id === 'pr-ops', JSON.stringify(projectTodo))

await shortcut('k')
await letter('1')
check('1, an issue', await waitFor(() => dialog()?.textContent?.includes('Create issue')))

// ---------------- CSV ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/issues')
let downloaded = ''
const realCreate = document.createElement.bind(document)
document.createElement = ((tag: string) => {
  const el = realCreate(tag)
  if (tag === 'a') (el as HTMLAnchorElement).click = () => { downloaded = (el as HTMLAnchorElement).download }
  return el
}) as typeof document.createElement
await click(button('Download as CSV'))
document.createElement = realCreate
check('the list downloads as a CSV', /^issues-\d{4}-\d{2}-\d{2}\.csv$/.test(downloaded), downloaded)

done()
