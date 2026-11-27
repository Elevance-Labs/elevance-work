// Test cases: the project's Tests tab as a sheet (typing, choosing, copy and
// paste with Google Sheets, statuses with their reasons, undo, moving and
// deleting), its filters, a viewer's read-only sheet, an issue's own cases,
// and the project's lists in Settings.
import {
  setupDom, reporter, text, button, buttons, click, choose, dialog, labelled, typeInto, type, field, options, settle, settleLazy, waitFor, valueOf,
} from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, table, PEOPLE } = await import('./mockSupabase')

const { check, done } = reporter()

const sink = (root: ParentNode = document) => root.querySelector<HTMLTextAreaElement>('textarea[aria-roledescription="spreadsheet"]')!
const rowKeys = (root: ParentNode = document) =>
  [...root.querySelectorAll('tbody tr[data-row]')].map((r) => r.getAttribute('data-row')).filter((k) => k !== 'new')
const cell = (row: string, col: string, root: ParentNode = document) =>
  root.querySelector<HTMLElement>(`tr[data-row="${row}"] td[data-col="${col}"]`)
const cellText = (row: string, col: string) => cell(row, col)?.textContent ?? ''
const lastInsert = (t: string) => captured.inserts.filter((i) => i.table === t).at(-1)
const updatesOf = (t: string) => captured.updates.filter((u) => u.table === t)

/** Click a cell, as a person selects it. */
async function pick(row: string, col: string, opts: MouseEventInit = {}, root: ParentNode = document) {
  const td = cell(row, col, root)
  if (!td) throw new Error(`pick: no cell ${row}/${col}`)
  td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, ...opts }))
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await settle()
}

/** A key, where focus is (the sheet, or the editor open over a cell). */
async function key(k: string, opts: KeyboardEventInit = {}, target: Element | null = document.activeElement) {
  target!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }))
  await settle()
}

/** A clipboard event on the sheet; returns what it put on the clipboard. */
async function clip(kind: 'paste' | 'copy' | 'cut', textIn = '', root: ParentNode = document) {
  const data = new Map([['text/plain', textIn]])
  const ev = new Event(kind, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'clipboardData', { value: { getData: (t: string) => data.get(t) ?? '', setData: (t: string, v: string) => data.set(t, v) } })
  sink(root).dispatchEvent(ev)
  await settle(60)
  return data.get('text/plain')
}

// ---------------- the sheet ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/tests')
check('the project has a Tests tab', [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent === 'Tests' && t.getAttribute('aria-selected') === 'true'))
check('its cases are listed in order, with their keys', JSON.stringify(rowKeys()) === '["WEB-T1","WEB-T2","WEB-T3"]', JSON.stringify(rowKeys()))
check('…their issue, type, level and areas', cellText('WEB-T1', 'issue') === 'WEB-2' && cellText('WEB-T1', 'type') === 'Functional' &&
  cellText('WEB-T2', 'level') === 'Smoke' && cellText('WEB-T2', 'areas') === 'HomeMobile', cellText('WEB-T2', 'areas'))
check('…and their latest result: status, environment, reason, who and when', cellText('WEB-T2', 'status') === 'FailQA' &&
  cellText('WEB-T2', 'result').includes('Text overlaps the photo') && cellText('WEB-T2', 'result').includes('Amna'), cellText('WEB-T2', 'status'))
check('a case not run yet says so', cellText('WEB-T3', 'status') === 'Not run')
check('how they stand is counted', text().includes('3 cases · 1 pass · 1 fail · 1 not run'))
check('results are recorded on the first environment until you choose', valueOf('Environment') === 'Dev', valueOf('Environment'))

// A new case: type into the last row.
await pick('new', 'title')
await key('L')
check('typing opens the cell with what was typed', labelled<HTMLTextAreaElement>('Summary')?.value === 'L')
await typeInto('Summary', 'Login with Google')
await key('Enter')
const added = lastInsert('test_cases')?.rows[0]
check('Enter adds the case', added?.title === 'Login with Google' && added.project_id === 'pr-web' && !added.issue_id, JSON.stringify(added))
check('…at the end, with its own key', await waitFor(() => rowKeys().at(-1) === 'WEB-T4'), JSON.stringify(rowKeys()))
await key('S')
check('…and the next new row is ready to type into', !!cell('new', 'title')?.querySelector('textarea[aria-label="Summary"]'))
await typeInto('Summary', 'Sign out')
await key('Tab')
check('Tab adds it too and moves along its row', await waitFor(() => rowKeys().at(-1) === 'WEB-T5'), JSON.stringify(rowKeys()))
await key('C')
await typeInto('Description', 'Click the avatar\nthen Sign out')
await key('Enter')
const signOut = table('test_cases').find((c) => c.title === 'Sign out')
check('…so its description goes on the same case', await waitFor(() => signOut?.description === 'Click the avatar\nthen Sign out'),
  JSON.stringify(signOut))
check('a summary is never left empty', (await pick('WEB-T5', 'title'), await key('Delete'), table('test_cases').find((c) => c.key === 'WEB-T5')?.title === 'Sign out'))

// Choosing from the project's lists.
await pick('WEB-T3', 'type')
await key('Enter')
check('a type is chosen from the project’s list', JSON.stringify(options().map((o) => o.textContent)) ===
  '["Functional","UI","Negative","Edge case","Integration","Clear"]', JSON.stringify(options().map((o) => o.textContent)))
await typeInto('Type', 'neg')
check('…typing narrows it', JSON.stringify(options().map((o) => o.textContent)) === '["Negative","Clear"]',
  JSON.stringify(options().map((o) => o.textContent)))
await key('Enter')
check('…and Enter takes it', updatesOf('test_cases').at(-1)?.values.type === 'Negative' && cellText('WEB-T3', 'type') === 'Negative')

await pick('WEB-T3', 'areas')
await key('h')
await typeInto('Impacted areas', 'home, checkout')
await key('Enter')
check('areas are typed comma-separated, spelt as the project already spells them',
  JSON.stringify(updatesOf('test_cases').at(-1)?.values.areas) === '["Home","checkout"]', JSON.stringify(updatesOf('test_cases').at(-1)?.values))

await pick('WEB-T3', 'level')
await clip('paste', 'Critical')
check('a value not on the list is refused, saying why', text().includes('"Critical" isn\'t one of this project\'s test levels.'))
check('…and nothing is written', updatesOf('test_cases').at(-1)?.values.level === undefined)

await pick('WEB-T3', 'issue')
await clip('paste', '5')
check('an issue is named by its key, or its number in the project', updatesOf('test_cases').at(-1)?.values.issue_id === 'i-web-5' &&
  await waitFor(() => cellText('WEB-T3', 'issue') === 'WEB-5'), JSON.stringify(updatesOf('test_cases').at(-1)))
await clip('paste', 'WEB-99')
check('…and one that isn’t there is refused', text().includes("There's no issue WEB-99 in Website."))

// Statuses.
await pick('WEB-T3', 'status')
await key('p')
const passed = lastInsert('test_results')?.rows
check('P in the Status column records a pass, on the chosen environment',
  JSON.stringify(passed) === '[{"case_id":"tc-3","status":"pass","reason":"","environment":"Dev"}]', JSON.stringify(passed))
check('…which the case then shows', await waitFor(() => cellText('WEB-T3', 'status') === 'PassDev'), cellText('WEB-T3', 'status'))
await key('f')
check('F asks why it failed', dialog()?.textContent?.includes('Why did it fail?') && dialog()?.textContent?.includes('on Dev'))
check('…and won’t mark it without a reason', button('Mark fail', dialog()!)?.hasAttribute('disabled'))
await typeInto('Reason', 'The privacy link is a 404', dialog()!)
await click(button('Mark fail', dialog()!))
check('…then records the failure with it', lastInsert('test_results')?.rows[0].status === 'fail' &&
  lastInsert('test_results')?.rows[0].reason === 'The privacy link is a 404')
check('…shown on the case', await waitFor(() => cellText('WEB-T3', 'result').includes('The privacy link is a 404') && cellText('WEB-T3', 'status') === 'FailDev'))
await key('z', { metaKey: true })
check('undo takes the result back', await waitFor(() => captured.deletes.some((d) => d.table === 'test_results') && cellText('WEB-T3', 'status') === 'PassDev'),
  cellText('WEB-T3', 'status'))

await pick('WEB-T1', 'status')
await key('ArrowDown', { shiftKey: true })
await key('ArrowDown', { shiftKey: true })
check('the toolbar says what a mark will cover', text().includes('Mark 3 cases:'))
await click(button('Pass'))
check('marking a selection records each case in one go', JSON.stringify(lastInsert('test_results')?.rows.map((r) => r.case_id)) === '["tc-1","tc-2","tc-3"]')

// Copying out.
await pick('WEB-T1', 'title')
await key('ArrowRight', { shiftKey: true })
await key('ArrowDown', { shiftKey: true })
const copied = await clip('copy')
check('copying a block gives tab-separated rows, as Google Sheets takes them',
  copied === 'Hero shows the new photo\tOpen the home page\nHero is readable on a phone\t', JSON.stringify(copied))

// Pasting a sheet in, with its header.
await pick('new', 'title')
await clip('paste', 'Summary\tExpected result\tType\tLevel\tImpacted areas\tStatus\tReason\n' +
  'Sign up\tAccount made\tfunctional\tregression\tcheckout, Home\tFail\tThe email never arrives\n' +
  '"Sign in\nwith a password"\t\tUI\tsmoke\t\tPass\t\n')
const pastedRows = lastInsert('test_cases')?.rows
check('a pasted sheet with its header adds its rows as cases, columns matched by name and values spelt as the project does',
  JSON.stringify(pastedRows?.map((r) => [r.title, r.expected, r.type, r.level, r.areas])) ===
  '[["Sign up","Account made","Functional","Regression",["checkout","Home"]],["Sign in with a password","","UI","Smoke",[]]]',
  JSON.stringify(pastedRows))
check('…and records their statuses, a failure with its reason', await waitFor(() => {
  const results = table('test_results')
  const up = table('test_cases').find((c) => c.title === 'Sign up')
  const inn = table('test_cases').find((c) => c.title === 'Sign in with a password')
  return results.some((r) => r.case_id === up?.id && r.status === 'fail' && r.reason === 'The email never arrives') &&
    results.some((r) => r.case_id === inn?.id && r.status === 'pass')
}))

// Pasting over cells.
const before = updatesOf('test_cases').length
await pick('WEB-T1', 'title')
await clip('paste', 'Hero photo\tOpen /\nHero on a phone\tOpen / on a phone')
const overwrite = updatesOf('test_cases').slice(before)
check('a block pasted over cells changes them, one update per case', overwrite.length === 2 &&
  overwrite.some((u) => u.values.title === 'Hero photo' && u.values.description === 'Open /' && JSON.stringify(u.filters) === '[["id","eq","tc-1"]]') &&
  overwrite.some((u) => u.values.title === 'Hero on a phone' && JSON.stringify(u.filters) === '[["id","eq","tc-2"]]'), JSON.stringify(overwrite))
await key('z', { ctrlKey: true })
check('…and one undo puts both back', await waitFor(() => cellText('WEB-T1', 'title') === 'Hero shows the new photo' &&
  cellText('WEB-T2', 'title') === 'Hero is readable on a phone'), cellText('WEB-T1', 'title'))

await pick('WEB-T1', 'expected')
await key('Delete')
check('Delete clears a cell', updatesOf('test_cases').at(-1)?.values.expected === '' && cellText('WEB-T1', 'expected') === '')

// Order.
await pick('WEB-T1', 'title')
await key('ArrowDown', { altKey: true, shiftKey: true })
check('Alt+Shift+↓ moves a case down', await waitFor(() => JSON.stringify(rowKeys().slice(0, 3)) === '["WEB-T2","WEB-T1","WEB-T3"]') &&
  Number(updatesOf('test_cases').at(-1)?.values.rank) > 2048 && Number(updatesOf('test_cases').at(-1)?.values.rank) < 3072,
  JSON.stringify(rowKeys()))

// Deleting.
await pick('WEB-T3', 'title')
await key('Backspace', { metaKey: true })
check('Cmd+Delete asks before deleting', dialog()?.textContent?.includes('Delete WEB-T3?'))
await click(button('Delete', dialog()!))
check('…then deletes it', await waitFor(() => !rowKeys().includes('WEB-T3')) &&
  JSON.stringify(captured.deletes.find((d) => d.table === 'test_cases')?.filters) === '[["id","in",["tc-3"]]]')

// ---------------- filters ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/tests?status=fail')
check('a filter in the address shows only what matches', JSON.stringify(rowKeys()) === '["WEB-T2"]', JSON.stringify(rowKeys()))
check('…counted', text().includes('1 case · 1 fail'))
await mountApp('/projects/WEB/tests?status=none')
check('…“not run” is a status too', JSON.stringify(rowKeys()) === '["WEB-T3"]')
await mountApp('/projects/WEB/tests?q=phone')
check('search reads the cases’ text', JSON.stringify(rowKeys()) === '["WEB-T2"]')
await mountApp('/projects/WEB/tests?for=WEB-2')
check('filtered to an issue, its cases', JSON.stringify(rowKeys()) === '["WEB-T1","WEB-T2"]')
await pick('new', 'title')
await key('N')
await typeInto('Summary', 'No photo, no hero')
await key('Enter')
check('…and a new case there is written for it', await waitFor(() => lastInsert('test_cases')?.rows[0].issue_id === 'i-web-2'),
  JSON.stringify(lastInsert('test_cases')?.rows))

// ---------------- groups ----------------
const groupNames = () => [...document.querySelectorAll('tr[data-group]')].map((g) => g.querySelector('[data-group-name]')?.textContent)
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/tests')
await choose('Group by', 'Type')
check('cases can be grouped by type, in the project’s order', await waitFor(() => JSON.stringify(groupNames()) === '["Functional","UI"]') &&
  JSON.stringify(rowKeys()) === '["WEB-T1","WEB-T3","WEB-T2"]', JSON.stringify([groupNames(), rowKeys()]))
check('…which the address keeps', location.search === '?group=type', location.search)
check('…each group counting its own', !!document.querySelector('tr[data-group="type:Functional"]')?.textContent?.includes('2 cases · 1 pass · 1 not run'))
await click(button('Collapse Functional'))
check('a group folds away', JSON.stringify(rowKeys()) === '["WEB-T2"]' && !!button('Expand Functional'), JSON.stringify(rowKeys()))
await click(button('Expand Functional'))
check('…and back', JSON.stringify(rowKeys()) === '["WEB-T1","WEB-T3","WEB-T2"]', JSON.stringify(rowKeys()))
await click(document.querySelector('tr[data-group="type:Functional"] [data-group-name]'))
check('clicking a group’s name selects its cases', text().includes('Mark 2 cases:'))
await click(button('Pass'))
check('…to mark them all at once', JSON.stringify(lastInsert('test_results')?.rows.map((r) => r.case_id)) === '["tc-1","tc-3"]')
await pick('WEB-T3', 'title')
await key('ArrowDown', { altKey: true, shiftKey: true })
check('a case moves only within its group', !updatesOf('test_cases').some((u) => 'rank' in u.values))
await key('ArrowUp', { altKey: true, shiftKey: true })
check('…where it can', await waitFor(() => JSON.stringify(rowKeys()) === '["WEB-T3","WEB-T1","WEB-T2"]'), JSON.stringify(rowKeys()))

await mountApp('/projects/WEB/tests?group=area')
check('grouped by area, a case is under each of its areas', JSON.stringify(groupNames()) === '["Footer","Home","Mobile"]' &&
  JSON.stringify(rowKeys()) === '["WEB-T3","WEB-T1","WEB-T2","WEB-T2"]', JSON.stringify([groupNames(), rowKeys()]))
const second = document.querySelectorAll('tr[data-row="WEB-T2"]')[1].querySelector<HTMLElement>('td[data-col="expected"]')!
second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
await settle()
await key('Enter')
check('…and edits the row it was opened on', !!document.querySelectorAll('tr[data-row="WEB-T2"]')[1].querySelector('textarea[aria-label="Expected result"]') &&
  !document.querySelectorAll('tr[data-row="WEB-T2"]')[0].querySelector('textarea'))
await typeInto('Expected result', 'Text stays clear of the photo')
await key('Enter')
check('…which is the one case, shown twice', await waitFor(() =>
  [...document.querySelectorAll('tr[data-row="WEB-T2"] td[data-col="expected"]')].every((td) => td.textContent === 'Text stays clear of the photo')))

await mountApp('/projects/WEB/tests?group=issue')
check('grouped by issue, by its key and title, then those without', JSON.stringify(groupNames()) === '["WEB-2 Hero banner","No issue"]',
  JSON.stringify(groupNames()))
await mountApp('/projects/WEB/tests?group=level&status=fail')
check('groups hold what the filter shows', JSON.stringify(groupNames()) === '["Smoke"]' && JSON.stringify(rowKeys()) === '["WEB-T2"]')

// ---------------- a viewer ----------------
reset()
signInAs(PEOPLE.viewer)
await mountApp('/projects/WEB/tests')
check('a viewer reads the cases', JSON.stringify(rowKeys()) === '["WEB-T1","WEB-T2","WEB-T3"]')
check('…with no new row, nothing to mark, no environment', !cell('new', 'title') && buttons('Pass').length === 0 && !field('Environment'))
await pick('WEB-T1', 'title')
await key('x')
check('…typing changes nothing', !labelled('Summary') && !captured.updates.length)
await key('p')
check('…nor records anything', !captured.inserts.length)
check('…but they can copy', (await clip('copy')) === 'Hero shows the new photo')

// ---------------- an issue's cases ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/board?issue=WEB-2')
await settleLazy()
const issueDialog = dialog()!
check('an issue shows the cases written for it', !!issueDialog?.textContent?.includes('Test cases (2)') &&
  JSON.stringify(rowKeys(issueDialog)) === '["WEB-T1","WEB-T2"]', JSON.stringify(rowKeys(issueDialog)))
check('…asking for just those', captured.selects.some((s) => s.table === 'test_cases' &&
  JSON.stringify(s.filters) === '[["project_id","eq","pr-web"],["issue_id","eq","i-web-2"]]'))
check('…without its issue column', !cell('WEB-T1', 'issue', issueDialog))
await pick('WEB-T1', 'title', {}, issueDialog)
await key('Enter')
await key('Escape')
check('Escape leaves the edit, not the issue', !labelled('Summary') && !!dialog()?.textContent?.includes('Test cases (2)'))
await pick('new', 'title', {}, issueDialog)
await key('A')
await typeInto('Summary', 'Alt text is read out', dialog()!)
await key('Enter')
check('a case added on the issue is written for it', await waitFor(() => lastInsert('test_cases')?.rows[0].issue_id === 'i-web-2'))

await mountApp('/projects/WEB/board?issue=WEB-5')
await settleLazy()
check('an issue without cases offers to add them', !!button('Add test cases', dialog()!) && !dialog()!.querySelector('table[role="grid"]'))
await click(button('Add test cases', dialog()!))
check('…opening the sheet on the first summary', !!dialog()?.querySelector('textarea[aria-label="Summary"]'))
await typeInto('Summary', 'Prices show in PKR', dialog()!)
await key('Enter')
check('…for that issue', await waitFor(() => lastInsert('test_cases')?.rows[0].issue_id === 'i-web-5'))

reset()
signInAs(PEOPLE.viewer)
await mountApp('/projects/WEB/board?issue=WEB-5')
await settleLazy()
check('a viewer isn’t offered to add cases', !dialog()?.textContent?.includes('Test cases'))

// ---------------- the project's lists ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/settings?tab=tests')
check('a project admin keeps the lists in Settings', !!field('Types') && !!field('Levels') && !!field('Environments'))
await type('Environments', 'UAT')
field('Environments')!.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
await settle(60)
await click(button('Save'))
const saved = updatesOf('projects').at(-1)
check('…saved together', JSON.stringify(saved?.values.test_environments) === '["Dev","QA","Staging","UAT"]' &&
  JSON.stringify(saved?.values.test_types) === '["Functional","UI","Negative","Edge case","Integration"]', JSON.stringify(saved?.values))

done()
