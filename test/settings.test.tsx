// Settings: a project's details, people, workflow, fields and Chat space;
// the workspace admin's people, issue types and workspace settings; and
// creating a project.
import { setupDom, reporter, text, button, click, dialog, type, choose, chooseLabelled, checkbox, labelled, freezeToday, waitFor } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

const lastInsert = (t: string) => captured.inserts.filter((i) => i.table === t).at(-1)?.rows[0]
const lastUpdate = (t: string) => captured.updates.filter((u) => u.table === t).at(-1)

// ---------------- details ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/settings')
check('settings open on the details', !!labelled('Name') || text().includes('Keys never change'))
await type('Name', 'Website 2.0')
await choose('Access', 'Open to the workspace')
await click(button('Colour #e2483d'))
await click(button('Save'))
const upd = lastUpdate('projects')
check('details save to the project', upd?.values.name === 'Website 2.0' && upd.values.visibility === 'open' && upd.values.color === '#e2483d' &&
  JSON.stringify(upd.filters) === '[["id","eq","pr-web"]]', JSON.stringify(upd))
check('…never the key', !('key' in (upd?.values ?? {})))

// ---------------- people ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/settings?tab=people')
check('the project’s people are listed with their roles', text().includes('Omar Farooq') && text().includes('Sara Iqbal'))
const addInput = document.querySelector<HTMLInputElement>('input[placeholder="Choose someone"]')!
addInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
addInput.focus()
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(addInput, 'Hina')
addInput.dispatchEvent(new Event('input', { bubbles: true }))
await waitFor(() => document.querySelectorAll('[role="option"]').length > 0)
await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Hina Raza')))
await choose('Role', 'Viewer')
await click(button('Add'))
const member = lastInsert('project_members')
check('a person is added with a role', member?.project_id === 'pr-web' && member.profile_id === 'p-hina' && member.role === 'viewer', JSON.stringify(member))

await chooseLabelled('Role of Omar Farooq', 'Member')
const roleUpd = lastUpdate('project_members')
check('a role is changed in place', roleUpd?.values.role === 'member' &&
  JSON.stringify(roleUpd.filters) === '[["project_id","eq","pr-web"],["profile_id","eq","p-omar"]]', JSON.stringify(roleUpd))
await click(button('Remove Omar Farooq'))
check('…and someone removed', captured.deletes.some((d) => d.table === 'project_members' &&
  JSON.stringify(d.filters) === '[["project_id","eq","pr-web"],["profile_id","eq","p-omar"]]'))

// ---------------- workflow ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/settings?tab=workflow')
check('the workflow lists the statuses in board order', text().indexOf('To Do') < text().indexOf('In Progress') && text().includes('Done'))
await click(button('Add status'))
await type('Name', 'QA')
await click(button('Save', dialog()!))
const st = lastInsert('project_statuses')
check('a status is added with its category', st?.name === 'QA' && st.category === 'in_progress' && st.project_id === 'pr-web', JSON.stringify(st))

await click(button('Move In Review left'))
const reorder = captured.rpcs.find((r) => r.name === 'project_statuses_reorder')
const ids = (reorder?.args?.p_ids ?? []) as string[]
check('reordering sends every status, in the new order', reorder?.args?.p_project === 'pr-web' && ids.length === 5 &&
  JSON.stringify(ids.slice(0, 4)) === '["st-web-todo","st-web-review","st-web-doing","st-web-done"]', JSON.stringify(reorder))

failNext('project_statuses.delete', { code: '23503', message: 'update or delete on table "project_statuses" violates foreign key constraint' })
await click(button('Delete In Progress'))
await click(button('Delete', dialog()!))
check('a status still in use can’t go, and it says so', dialog()?.textContent?.includes('It is still in use'))

// ---------------- fields ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/settings?tab=fields')
await click(button('Add field'))
await type('Name', 'Browser')
await choose('Kind', 'Choice (one)')
const optInput = dialog()!.querySelector<HTMLInputElement>('input[placeholder="Type an option and press Enter"]')!
for (const o of ['Chrome', 'Safari']) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(optInput, o)
  optInput.dispatchEvent(new Event('input', { bubbles: true }))
  optInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await waitFor(() => dialog()?.textContent?.includes(o))
}
await click(checkbox('Required when creating an issue'))
await click(button('Save', dialog()!))
const f = lastInsert('fields')
check('a choice field is added with its options', f?.name === 'Browser' && f.kind === 'select' &&
  JSON.stringify(f.options) === '["Chrome","Safari"]' && f.required === true && f.issue_type_ids === null, JSON.stringify(f))
check('…and listed', await waitFor(() => text().includes('Choice (one): Chrome, Safari')))

// ---------------- Google Chat ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/settings?tab=chat')
await type('Webhook URL', 'https://evil.example/hook')
await click(button('Save'))
check('only a Google Chat address is accepted', text().includes('That isn’t a Google Chat webhook address'))
check('…and nothing is sent', !captured.inserts.some((i) => i.table === 'project_integrations'))
await type('Webhook URL', 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t')
await click(checkbox('Someone comments'))
await click(button('Save'))
const chat = lastInsert('project_integrations')
check('the webhook and chosen events are saved for the project', chat?.project_id === 'pr-web' &&
  String(chat.chat_webhook_url).startsWith('https://chat.googleapis.com/') && !(chat.chat_events as string[]).includes('comment_added') &&
  (chat.chat_events as string[]).includes('issue_created'), JSON.stringify(chat))

// ---------------- archive and delete ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/settings?tab=danger')
await click(button('Delete project'))
const keyInput = labelled<HTMLInputElement>('Project key', dialog()!)!
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(keyInput, 'ops')
keyInput.dispatchEvent(new Event('input', { bubbles: true }))
await click(button('Delete for good', dialog()!))
check('deleting needs the key typed', dialog()?.textContent?.includes('Type WEB to confirm.') && !captured.deletes.some((d) => d.table === 'projects'))
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(keyInput, 'web')
keyInput.dispatchEvent(new Event('input', { bubbles: true }))
await click(button('Delete for good', dialog()!))
check('…then it goes', captured.deletes.some((d) => d.table === 'projects' && JSON.stringify(d.filters) === '[["id","eq","pr-web"]]'))
check('…and you land on the projects', await waitFor(() => location.pathname === '/projects'), location.pathname)

// ---------------- creating a project ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects')
await click(button('Create project'))
await type('Name', 'Mobile App')
check('a key is suggested from the name', (labelled('Key', dialog()!) as HTMLInputElement | null)?.value === 'MA' ||
  !!dialog()?.querySelector('input[value="MA"]'))
await choose('Type', 'Kanban')
await click(button('Create', dialog()!))
const create = captured.rpcs.find((r) => r.name === 'project_create')
check('it is created through project_create', create?.args?.p_key === 'MA' && create.args.p_name === 'Mobile App' && create.args.p_kind === 'kanban' &&
  create.args.p_visibility === 'private', JSON.stringify(create))
check('…and opens', await waitFor(() => location.pathname === '/projects/MA'), location.pathname)

// ---------------- the admin's people ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/admin/people')
check('people are listed, the deactivated hidden', text().includes('Hina Raza') && !text().includes('Zara Ali'))
await click(button('Add person'))
await type('Company email', 'new@gmail.com')
await type('Full name', 'New Person')
await click(button('Save', dialog()!))
check('only company addresses', dialog()?.textContent?.includes('Use their @elevancelabs.com address.'))
await type('Company email', 'New.Person@ElevanceLabs.com')
await click(button('Save', dialog()!))
const prof = lastInsert('profiles')
check('a person is added, email lower-cased', prof?.email === 'new.person@elevancelabs.com' && prof.full_name === 'New Person' && prof.app_role === 'member',
  JSON.stringify(prof))

await click(button('Edit Hina Raza'))
await click(dialog()!.querySelector('input[type="checkbox"]'))
await click(button('Save', dialog()!))
check('someone is deactivated rather than deleted', lastUpdate('profiles')?.values.active === false && !captured.deletes.some((d) => d.table === 'profiles'),
  JSON.stringify(lastUpdate('profiles')))

// ---------------- issue types ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/admin/issue-types')
await click(button('Add type'))
await type('Name', 'Spike')
await click(button('Icon spike'))
await click(button('Save', dialog()!))
const t = lastInsert('issue_types')
check('an issue type is added', t?.name === 'Spike' && t.icon === 'spike' && t.level === 'standard', JSON.stringify(t))
failNext('issue_types.delete', { code: '23503', message: 'violates foreign key constraint' })
await click(button('Delete Bug'))
await click(button('Delete', dialog()!))
check('a type in use can’t be deleted: archive it instead', dialog()?.textContent?.includes('Issues of this type exist. Archive it instead.'))

// ---------------- the workspace ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/admin/workspace')
await type('Webhook URL', 'https://chat.googleapis.com/v1/spaces/ALL/messages?key=k')
await click(button('Save'))
check('the company space is saved', lastUpdate('workspace_settings')?.values.chat_webhook_url === 'https://chat.googleapis.com/v1/spaces/ALL/messages?key=k')
check('…on the one settings row', JSON.stringify(lastUpdate('workspace_settings')?.filters) === '[["id","eq",true]]')
check('table touched', table('workspace_settings').length === 1)

done()
