// Creating issues and working on one: the create dialog, every field in the
// issue view, comments, sub-tasks, links, watching, attachments and docs
// (through the drive function), and deleting.
import {
  setupDom, reporter, text, button, click, dialog, type, typeInto, choose, labelled, submit, settleLazy, write, pickFile, menuItem,
  freezeToday, settle, waitFor,
} from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

// Create asks what to make; 1 is an issue.
async function openCreateIssue() {
  await click(button('Create'))
  await waitFor(() => document.querySelector('[data-create]'), 4000)
  document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', bubbles: true }))
  await waitFor(() => dialog()?.textContent?.includes('Create issue'), 4000)
}
const lastInsert = (t: string) => captured.inserts.filter((i) => i.table === t).at(-1)?.rows[0]
const lastUpdate = (t: string) => captured.updates.filter((u) => u.table === t).at(-1)

// ---------------- the create dialog ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/issues')
await openCreateIssue()
await settleLazy()
check('Create opens the create dialog', dialog()?.textContent?.includes('Create issue'), dialog()?.textContent?.slice(0, 80))
await click(button('Create', dialog()!))
check('a summary is required (the browser holds the form back)', !captured.inserts.some((i) => i.table === 'issues'))
await choose('Project', 'Website (WEB)')
await type('Summary', 'Cookie banner')
await write('Description', '<p>Needed for <strong>GDPR</strong></p>')
await choose('Type', 'Bug')
await choose('Priority', 'High')
await choose('Sprint', 'WEB Sprint 1 (active)')
await click(button('Create', dialog()!))
const created = lastInsert('issues')
check('the issue is inserted with what was entered', created?.title === 'Cookie banner' && created.type_id === 't-bug' &&
  created.priority === 'high' && created.sprint_id === 'sp-1' && String(created.description).includes('<strong>GDPR</strong>'),
  JSON.stringify(created))
check('…in the project chosen', created?.project_id === 'pr-web', String(created?.project_id))
check('…and the dialog closes', await waitFor(() => !dialog()))
check('the list underneath reloads with it', await waitFor(() => text().includes('Cookie banner')))

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/issues')
await openCreateIssue()
await settleLazy()
await choose('Project', 'Website (WEB)')
await choose('Type', 'Sub-task')
await type('Summary', 'Orphan')
await click(button('Create', dialog()!))
check('a sub-task needs a parent', dialog()?.textContent?.includes('A sub-task needs a parent issue.'))
check('…so nothing is sent', !captured.inserts.some((i) => i.table === 'issues'))

table('fields').push({ id: 'f-browser', project_id: 'pr-web', name: 'Browser', kind: 'select', options: ['Chrome', 'Safari'],
  issue_type_ids: null, required: true, position: 0 })
reset()
table('fields').push({ id: 'f-browser', project_id: 'pr-web', name: 'Browser', kind: 'select', options: ['Chrome', 'Safari'],
  issue_type_ids: null, required: true, position: 0 })
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/issues')
await openCreateIssue()
await settleLazy()
await choose('Project', 'Website (WEB)')
await type('Summary', 'Needs a browser')
await click(button('Create', dialog()!))
check('a required custom field holds the form back', !captured.inserts.some((i) => i.table === 'issues') &&
  /Browser\s*\*/.test(dialog()?.textContent ?? ''))
await choose('Browser', 'Safari')
await click(button('Create', dialog()!))
check('…and its value goes into custom, keyed by field', JSON.stringify(lastInsert('issues')?.custom) === '{"f-browser":"Safari"}',
  JSON.stringify(lastInsert('issues')))

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/issues')
await openCreateIssue()
await settleLazy()
await choose('Project', 'Website (WEB)')
await type('Summary', 'Will fail')
failNext('issues.insert', { code: '23514', message: 'Only a member of this project can be assigned.' })
await click(button('Create', dialog()!))
check('the database’s refusal is shown in the dialog', dialog()?.textContent?.includes('Only a member of this project can be assigned.'))

// ---------------- the issue view ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/issues?issue=WEB-2')
await settleLazy()
check('?issue=KEY opens the issue over the page', dialog()?.textContent?.includes('Hero banner') && location.pathname === '/projects/WEB/issues')
check('…with its parent epic in the breadcrumb', dialog()?.textContent?.includes('WEB-1'))
check('…its sub-task', dialog()?.textContent?.includes('Headline copy'))
check('…and its comment', dialog()?.textContent?.includes('Use the new photo'))
check('…your todos on it, and the ones you were put on', await waitFor(() => !!document.querySelector('[data-todo="td-2"]')) &&
  dialog()?.textContent?.includes('Show 1 done') && !dialog()?.textContent?.includes('Omar private todo'))
await typeInto('New todo', 'Call the studio', dialog()!)
await submit(labelled('New todo', dialog()!))
const issueTodo = captured.inserts.find((i) => i.table === 'todos')?.rows[0]
check('…and a todo added there is tied to the issue', issueTodo?.title === 'Call the studio' && issueTodo.issue_id === 'i-web-2',
  JSON.stringify(issueTodo))

await choose('Status', 'In Review', dialog()!)
check('changing the status saves it', lastUpdate('issues')?.values.status_id === 'st-web-review' &&
  JSON.stringify(lastUpdate('issues')?.filters) === '[["id","eq","i-web-2"]]', JSON.stringify(lastUpdate('issues')))
await choose('Priority', 'Highest', dialog()!)
check('…and the priority', lastUpdate('issues')?.values.priority === 'highest')
await choose('Sprint', 'Backlog', dialog()!)
check('…and the sprint', lastUpdate('issues')?.values.sprint_id === null)
await choose('Release', 'None', dialog()!)
check('…and the release', lastUpdate('issues')?.values.release_id === null)

await click(button('Change type', dialog()!))
check('the type icon offers the types of its level', !!menuItem('Bug') && !menuItem('Epic') && !menuItem('Sub-task'))
await click(menuItem('Bug'))
check('…and picking one saves it', lastUpdate('issues')?.values.type_id === 't-bug', JSON.stringify(lastUpdate('issues')))

await click(button('Change epic', dialog()!))
await click(button('Remove epic'))
check('the epic is removed from the breadcrumb', lastUpdate('issues')?.values.parent_id === null, JSON.stringify(lastUpdate('issues')))
check('…which then offers to add one', await waitFor(() => !!button('Add epic', dialog()!)))

const titleEl = [...dialog()!.querySelectorAll('h1')].find((h) => h.textContent === 'Hero banner')
await click(titleEl)
await typeInto('Summary', 'Hero banner, take two', dialog()!)
labelled('Summary', dialog()!)!.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
await settle()
check('the summary is edited in place', lastUpdate('issues')?.values.title === 'Hero banner, take two', JSON.stringify(lastUpdate('issues')))

failNext('issues.update', { code: '23514', message: 'That sprint is completed or not in this project.' })
await choose('Sprint', 'WEB Sprint 2', dialog()!)
check('a refused change says why', dialog()?.textContent?.includes('That sprint is completed or not in this project.'))

// Watching
const watchers = () => table('issue_watchers').filter((w) => w.issue_id === 'i-web-2' && w.profile_id === 'p-sara').length
await click(button('Stop watching', dialog()!))
check('Stop watching removes you', watchers() === 0)
await click(button('Watch', dialog()!))
check('Watch adds you back', watchers() === 1)

// Comments, with a mention
await click(button('Add a comment…', dialog()!))
await write('Comment', `<p>Over to <span data-type="mention" data-id="p-amna" data-label="Amna Khan">@Amna Khan</span></p>`, dialog()!)
await click(button('Save', dialog()!))
const comment = lastInsert('comments')
check('a comment is saved with its mention', comment?.issue_id === 'i-web-2' && String(comment.body).includes('data-id="p-amna"'), JSON.stringify(comment))
check('…sanitised: only the mention keeps its data attributes', !String(comment?.body).includes('<script'))
check('…and shows at once', dialog()?.textContent?.includes('Over to @Amna Khan'))

// A comment with a table and a file
await click(button('Add a comment…', dialog()!))
const editor = dialog()!.querySelector('.ProseMirror[aria-label="Comment"]') as HTMLElement & { editor: { getHTML(): string } }
await click(button('Insert table', dialog()!))
check('the table button puts a table with a header row in the comment',
  /<table.*<th.*<td/.test(editor.editor.getHTML()), editor.editor.getHTML())
await click(button('Table options', dialog()!))
await click(menuItem('Add row below'))
check('…and its menu adds rows', editor.editor.getHTML().match(/<tr>/g)?.length === 4, editor.editor.getHTML())
await write('Comment', '<p>Sizes</p><table><tbody><tr><th><p>Size</p></th><th><p>Px</p></th></tr><tr><td><p>Hero</p></td><td><p>1600</p></td></tr></tbody></table>', dialog()!)
await pickFile(new File(['png'], 'hero-sizes.png', { type: 'image/png' }), 'Attach files to the comment', dialog()!)
check('a picked file waits with the comment', dialog()?.textContent?.includes('hero-sizes.png') &&
  !captured.functions.some((f) => f.body instanceof FormData))
await click(button('Save', dialog()!))
await settle(100)
const tableComment = lastInsert('comments')
check('the comment is saved with its table', /<table>.*<th><p>Size<\/p><\/th>.*<td><p>1600<\/p><\/td>/.test(String(tableComment?.body)),
  String(tableComment?.body))
const commentUpload = captured.functions.find((f) => f.name === 'drive' && f.body instanceof FormData)?.body as FormData | undefined
const savedComment = table('comments').find((c) => String(c.body).includes('Size'))
check('…then its file goes to Drive with the comment', commentUpload?.get('issue_id') === 'i-web-2' &&
  !!savedComment && commentUpload?.get('comment_id') === savedComment.id, JSON.stringify([...(commentUpload?.entries() ?? [])]))
const withComment = dialog()?.querySelector('[role="group"][aria-label="Files with this comment"]')
check('…and shows under the comment', withComment?.textContent?.includes('hero-sizes.png') &&
  !!dialog()?.querySelector('table th')?.textContent?.includes('Size'))
check('…as well as with the issue’s attachments', dialog()?.textContent?.includes('in a comment'))

// Sub-tasks
await click(button('Add', [...dialog()!.querySelectorAll('h2')].find((h) => h.textContent?.startsWith('Sub-tasks'))!.closest('div')!.parentElement!))
await typeInto('New sub-task', 'Alt text', dialog()!)
await submit(labelled('New sub-task', dialog()!))
const sub = lastInsert('issues')
check('a sub-task is created under the issue', sub?.parent_id === 'i-web-2' && sub.type_id === 't-sub' && sub.title === 'Alt text', JSON.stringify(sub))
check('…and listed', dialog()?.textContent?.includes('Alt text'))

// Attachments go to Drive through the function
await pickFile(new File(['png'], 'mock.png', { type: 'image/png' }), 'Attach files to the issue')
const upload = captured.functions.filter((f) => f.name === 'drive' && f.body instanceof FormData).at(-1)?.body as FormData | undefined
check('a file is sent to the drive function with its issue', upload?.get('issue_id') === 'i-web-2' && !upload.get('comment_id'))
await settle(100)
check('…and listed once Drive has it', dialog()?.textContent?.includes('mock.png'))

failNext('functions.drive', { message: 'Files can be at most 25 MB.' })
await pickFile(new File(['x'], 'big.mov', { type: 'video/quicktime' }), 'Attach files to the issue')
check('the function’s refusal is shown', dialog()?.textContent?.includes('Files can be at most 25 MB.'))

// Docs: link an existing one
await click(button('Link existing', dialog()!))
await type('Link', 'https://docs.google.com/document/d/abc123/edit')
await type('Title', 'Hero spec')
await click(button('Link', dialog()!))
const doc = lastInsert('documents')
check('a Google Doc is linked to the issue', doc?.issue_id === 'i-web-2' && doc.project_id === 'pr-web' && doc.doc_type === 'document' &&
  doc.title === 'Hero spec', JSON.stringify(doc))

await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 1)
await click(button('Link existing', dialog()!))
await type('Link', 'https://evil.example/doc')
await type('Title', 'Nope')
await click(button('Link', dialog()!))
check('…but only Google links', dialog()?.textContent?.includes('Paste a link to a Google Doc'))

// ---------------- what a viewer can't do ----------------
reset()
signInAs(PEOPLE.viewer)
await mountApp('/projects/WEB/issues?issue=WEB-2')
await settleLazy()
check('a viewer sees the issue read-only', !!dialog() && labelled<HTMLInputElement>('Status', dialog()!) === null &&
  !!dialog()!.querySelector('.MuiInputBase-root.Mui-disabled'))
check('…can comment', !!button('Add a comment…', dialog()!))
check('…but not attach or add docs', !button('Attach', dialog()!) && !button('Link existing', dialog()!))
await click(button('Add a comment…', dialog()!))
check('…not even to a comment', !button('Attach files', dialog()!) && !!button('Insert table', dialog()!))
check('…nor delete it', !button('More actions', dialog()!))

// ---------------- deleting ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/issues?issue=WEB-6')
await settleLazy()
await click(button('More actions', dialog()!))
await click(menuItem('Delete issue'))
await click(button('Delete', dialog()!))
check('a project admin deletes an issue', captured.deletes.some((d) => d.table === 'issues' && JSON.stringify(d.filters) === '[["id","eq","i-web-6"]]'))
check('…and the dialog closes', await waitFor(() => !location.search.includes('issue=')), location.search)

// ---------------- a key nobody can see ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/browse/WEB-99')
await settleLazy()
check('an unknown key says so', text().includes("WEB-99 doesn't exist, or you don't have access"))

done()
