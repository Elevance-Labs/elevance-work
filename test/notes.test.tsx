// Notes: the notes page (search and filters), writing and changing notes,
// archiving then deleting, your own labels, a project's notes, pinning, and a
// meeting's note.
import {
  setupDom, reporter, text, button, buttons, checkbox, click, dialog, type, typeInto, field, labelled, chooseLabelled, choose, options, navLabels,
  freezeToday, waitFor, settle,
} from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

const cards = () => [...document.querySelectorAll<HTMLElement>('[data-note]')].map((c) => c.getAttribute('data-note'))
const card = (id: string) => document.querySelector<HTMLElement>(`[data-note="${id}"]`)

/** Type into an autocomplete and press Enter, as a person adds a new value. */
async function enterInto(label: string, value: string, root: ParentNode) {
  await type(label, value, root)
  const input = field(label, root)!.querySelector('input')!
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await settle(60)
}

/** Leave a field, so its onBlur runs. */
async function blur(el: Element | null) {
  el?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  await settle()
}

// ---------------- the notes page ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/notes')
check('Notes is in the nav', navLabels().includes('Notes'))
check('your notes are listed, last edited first', JSON.stringify(cards()) === '["nt-launch","nt-standup","nt-gifts"]', JSON.stringify(cards()))
check('…asking only for your own', captured.selects.some((s) => s.table === 'notes' && JSON.stringify(s.filters) === '[["owner_id","eq","p-sara"]]'))
check('…so someone else’s never shows', !text().includes('Omar private'))
check('…nor an archived one', !card('nt-old'))
check('a note without a title is headed by its first line', !!card('nt-standup')?.textContent?.includes('Ask about the domain') &&
  !!card('nt-standup')?.textContent?.includes('Also the invoices'))
check('a card shows its labels, project and meeting', !!card('nt-launch')?.textContent?.includes('Ideas') &&
  !!card('nt-launch')?.textContent?.includes('Website') && !!card('nt-standup')?.textContent?.match(/Standup · Oct 19/))
check('it has the note’s colour', card('nt-gifts')?.style.backgroundColor !== '' ||
  getComputedStyle(card('nt-gifts')!).backgroundColor.includes('211, 249, 216'))

await typeInto('Search notes', 'pricing')
check('search finds words in the text', JSON.stringify(cards()) === '["nt-launch"]', JSON.stringify(cards()))
check('…and keeps the search in the address', await waitFor(() => location.search === '?q=pricing'), location.search)
await typeInto('Search notes', 'personal')
check('…and in label names', JSON.stringify(cards()) === '["nt-gifts"]', JSON.stringify(cards()))
await typeInto('Search notes', 'standup domain')
check('…and in the meeting’s title, every word', JSON.stringify(cards()) === '["nt-standup"]', JSON.stringify(cards()))
await typeInto('Search notes', 'nothing like this')
check('…saying so when nothing matches', text().includes('No notes match'))
await click(button('Clear'))
check('clearing brings them all back', await waitFor(() => cards().length === 3 && location.search === ''), location.search)

await chooseLabelled('Label', 'Ideas')
check('filter by a label', JSON.stringify(cards()) === '["nt-launch"]', JSON.stringify(cards()))
await chooseLabelled('Label', 'No label')
check('…or notes with none', JSON.stringify(cards()) === '["nt-standup"]', JSON.stringify(cards()))
await chooseLabelled('Label', 'All labels')
await chooseLabelled('Colour', 'Green')
check('filter by colour', JSON.stringify(cards()) === '["nt-gifts"]' && await waitFor(() => location.search === '?color=green'), location.search)
await chooseLabelled('Colour', 'Any colour')
await chooseLabelled('Project', 'Website')
check('filter by project', JSON.stringify(cards()) === '["nt-launch"]', JSON.stringify(cards()))

await mountApp('/notes?label=nl-personal&q=books')
check('a link with filters opens filtered', JSON.stringify(cards()) === '["nt-gifts"]' &&
  labelled<HTMLInputElement>('Search notes')?.value === 'books', JSON.stringify(cards()))

// ---------------- writing a note ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/notes')
await click(button('New note'))
check('a new note opens sticky-note yellow', dialog()?.textContent?.includes('New note') &&
  labelled('Yellow', dialog()!)?.getAttribute('aria-checked') === 'true')
check('there is no Save or Cancel: a note saves itself', buttons('Save', dialog()!).length === 0 && buttons('Cancel', dialog()!).length === 0)
await click(button('Close', dialog()!))
check('an empty note isn’t kept', await waitFor(() => !dialog()) && !captured.inserts.some((i) => i.table === 'notes'))
await click(button('New note'))
await typeInto('Title', 'Retro', dialog()!)
await typeInto('Note', 'Went well: the launch', dialog()!)
check('not on every keystroke', !captured.inserts.some((i) => i.table === 'notes'))
check('…but a moment after you stop', await waitFor(() => captured.inserts.some((i) => i.table === 'notes'), 3000) &&
  !!dialog()?.textContent?.includes('Saved'))
const plain = captured.inserts.find((i) => i.table === 'notes')?.rows[0]
check('a note is saved, yellow, unlinked', plain?.title === 'Retro' && plain.body === 'Went well: the launch' && plain.color === 'yellow' &&
  JSON.stringify(plain.label_ids) === '[]' && plain.project_id === null && plain.pinned === false && !('meeting_id' in plain), JSON.stringify(plain))
check('…and goes to the top of the list, under the pinned one, while still open', await waitFor(() => !!dialog() && cards()[0] === 'nt-launch' &&
  !!cards()[1]?.startsWith('new-')), JSON.stringify(cards()))
await typeInto('Note', 'Went well: the launch, mostly', dialog()!)
await click(button('Close', dialog()!))
check('closing saves what’s left at once, into the same note', await waitFor(() => !dialog()) &&
  captured.inserts.filter((i) => i.table === 'notes').length === 1 &&
  captured.updates.some((u) => u.table === 'notes' && u.values.body === 'Went well: the launch, mostly' &&
    JSON.stringify(u.filters) === JSON.stringify([['id', 'eq', table('notes').find((n) => n.title === 'Retro')?.id]])))

await click(button('New note'))
await typeInto('Note', 'Call the printer', dialog()!)
await click(button('Pink', dialog()!))
check('picking a colour colours the note as you write', labelled('Pink', dialog()!)?.getAttribute('aria-checked') === 'true')
await type('Labels', 'Ide', dialog()!)
await click(options().find((o) => o.textContent?.trim() === 'Ideas'))
await enterInto('Labels', 'Errands', dialog()!)
const newLabel = captured.inserts.find((i) => i.table === 'note_labels')?.rows[0]
check('typing a new label makes it', newLabel?.name === 'Errands', JSON.stringify(newLabel))
await choose('Project', 'Website', dialog()!)
await click(button('Close', dialog()!))
await waitFor(() => !dialog())
const rich = table('notes').find((n) => n.body === 'Call the printer')
const errands = table('note_labels').find((l) => l.name === 'Errands')
check('…and the note keeps its colour, labels and project', rich?.color === 'pink' && rich.project_id === 'pr-web' &&
  JSON.stringify(rich.label_ids) === JSON.stringify(['nl-ideas', errands?.id]), JSON.stringify(rich))
check('…and the new label is there to filter by', await waitFor(() => !dialog()) &&
  (await chooseLabelled('Label', 'Errands'), cards().length === 1))
await chooseLabelled('Label', 'All labels')

await click(card('nt-launch'))
check('opening a note shows it to edit', dialog()?.textContent?.includes('Edit note') &&
  labelled<HTMLInputElement>('Title', dialog()!)?.value === 'Launch plan')
await typeInto('Title', 'Launch plan v2', dialog()!)
await click(button('Close', dialog()!))
const edit = captured.updates.find((u) => u.table === 'notes' && u.values.title === 'Launch plan v2')
check('changes are saved to that note', edit?.values.title === 'Launch plan v2' && JSON.stringify(edit.filters) === '[["id","eq","nt-launch"]]',
  JSON.stringify(edit))

await click(card('nt-gifts'))
check('a note isn’t deleted straight away: it is archived first', buttons('Delete', dialog()!).length === 0 && !!button('Archive', dialog()!))
await click(button('Archive', dialog()!))
const archiving = captured.updates.find((u) => u.table === 'notes' && u.values.archived_at)
check('archiving a note saves it as archived', JSON.stringify(archiving?.filters) === '[["id","eq","nt-gifts"]]' &&
  archiving?.values.title === 'Gift ideas', JSON.stringify(archiving))
check('…and it leaves the list', await waitFor(() => !dialog() && !card('nt-gifts')))
check('…for the archive', !captured.deletes.some((d) => d.table === 'notes'))

await click(button('Archived'))
check('the archive lists archived notes only', await waitFor(() => JSON.stringify(cards().sort()) === '["nt-gifts","nt-old"]') &&
  await waitFor(() => location.search === '?archived=1'), JSON.stringify(cards()))
check('…with nothing new to write there', buttons('New note').length === 0)
await typeInto('Search notes', 'retro')
check('…and the search works there too', JSON.stringify(cards()) === '["nt-old"]', JSON.stringify(cards()))
await click(button('Clear'))
check('clearing stays in the archive', await waitFor(() => cards().length === 2 && location.search === '?archived=1'), location.search)

await click(card('nt-old'))
check('an archived note says so, and isn’t pinned', dialog()?.textContent?.includes('Archived note') && !checkbox('Pin to my dashboard'))
await click(button('Restore', dialog()!))
check('it can be restored', captured.updates.some((u) => u.table === 'notes' && u.values.archived_at === null &&
  JSON.stringify(u.filters) === '[["id","eq","nt-old"]]'))
check('…leaving the archive', await waitFor(() => !dialog() && !card('nt-old')))

await click(card('nt-gifts'))
await click(button('Delete', dialog()!))
check('an archived note can be deleted, after asking', dialog()?.textContent?.includes('Delete this note?'))
await click(button('Delete', dialog()!))
check('…for good', captured.deletes.some((d) => d.table === 'notes' && JSON.stringify(d.filters) === '[["id","eq","nt-gifts"]]'))
check('…and leaves the archive', await waitFor(() => !card('nt-gifts')))

await click(button('Archived'))
check('back to the current notes, with the restored one', await waitFor(() => location.search === '' && !!card('nt-old') && !card('nt-gifts')))

failNext('notes.insert', { code: '42501', message: "You can't link a note to that project." })
await click(button('New note'))
await typeInto('Note', 'Refused', dialog()!)
await click(button('Close', dialog()!))
check('the database’s refusal is shown, and the note stays open', dialog()?.textContent?.includes("You can't link a note to that project."))
await click(button('Close', dialog()!))
check('…closing tries again', await waitFor(() => !dialog()) && table('notes').some((n) => n.body === 'Refused'))

// ---------------- your labels ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/notes')
await click(button('Labels'))
check('you manage only your own labels', dialog()?.textContent?.includes('Your labels') && !!labelled('Label Ideas', dialog()!) &&
  !labelled('Label Omar label', dialog()!))
await typeInto('Label Ideas', 'Thoughts', dialog()!)
await blur(labelled('Label Ideas', dialog()!))
const renamed = captured.updates.find((u) => u.table === 'note_labels')
check('a label can be renamed', renamed?.values.name === 'Thoughts' && JSON.stringify(renamed.filters) === '[["id","eq","nl-ideas"]]',
  JSON.stringify(renamed))
await typeInto('New label', 'Later', dialog()!)
await click(button('Add', dialog()!))
check('…or added', captured.inserts.some((i) => i.table === 'note_labels' && i.rows[0].name === 'Later') && !!labelled('Label Later', dialog()!))
failNext('note_labels.insert', { code: '23505', message: 'duplicate key value violates unique constraint' })
await typeInto('New label', 'later', dialog()!)
await click(button('Add', dialog()!))
check('…but not twice', dialog()?.textContent?.includes('That name is already taken.'))
await click(button('Delete label Personal', dialog()!))
check('removing one says what happens to its notes', dialog()?.textContent?.includes('It comes off 1 note; the notes stay.'))
await click(button('Delete', dialog()!))
check('…and removes it', captured.deletes.some((d) => d.table === 'note_labels' && JSON.stringify(d.filters) === '[["id","eq","nl-personal"]]'))
await click(button('Done'))
check('…from the note too, which stays', await waitFor(() => !dialog()) && !!card('nt-gifts') && !card('nt-gifts')?.textContent?.includes('Personal'))
check('a renamed label shows its new name', !!card('nt-launch')?.textContent?.includes('Thoughts'))

// ---------------- a project's notes ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/notes')
check('a project has a My notes tab', buttons('My notes').length > 0 || text().includes('My notes'))
check('it lists your notes on the project, and only yours (not archived ones)', JSON.stringify(cards()) === '["nt-launch"]' && !text().includes('Omar private'),
  JSON.stringify(cards()))
check('…asking for that project', captured.selects.some((s) => s.table === 'notes' &&
  JSON.stringify(s.filters) === '[["owner_id","eq","p-sara"],["project_id","eq","pr-web"]]'))
await click(button('New note'))
await typeInto('Note', 'Ask about fonts', dialog()!)
await click(button('Close', dialog()!))
check('a note added there is linked to the project', captured.inserts.find((i) => i.table === 'notes')?.rows[0].project_id === 'pr-web')
check('…and listed', await waitFor(() => cards().length === 2))

await click(card('nt-launch'))
await choose('Project', 'None', dialog()!)
await click(button('Close', dialog()!))
check('a note taken off the project leaves its list', await waitFor(() => !card('nt-launch')))

// ---------------- pinning ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/notes')
check('a pinned note says so', !!card('nt-launch')?.querySelector('[aria-label="Pinned"]') && !card('nt-gifts')?.querySelector('[aria-label="Pinned"]'))
await click(card('nt-gifts'))
await click(checkbox('Pin to my dashboard'))
await click(button('Close', dialog()!))
check('a note can be pinned to the dashboard', captured.updates.some((u) => u.table === 'notes' && u.values.pinned === true &&
  JSON.stringify(u.filters) === '[["id","eq","nt-gifts"]]'))
check('…and moves up among the pinned ones', await waitFor(() => JSON.stringify(cards().slice(0, 2).sort()) === '["nt-gifts","nt-launch"]' &&
  cards()[2] === 'nt-standup'), JSON.stringify(cards()))

// ---------------- a meeting's note ----------------
await click(card('nt-standup'))
check('a note taken on a meeting names it', !!dialog()?.textContent?.includes('Standup · Oct 19'))
check('…and there is no picking a meeting here (they come from Google)', !labelled('Meeting', dialog()!) && !text().includes('Which day'))
await click(dialog()!.querySelector('.MuiChip-deleteIcon'))
await click(button('Close', dialog()!))
check('…but it can be unlinked', captured.updates.some((u) => u.table === 'notes' && u.values.meeting_id === null &&
  JSON.stringify(u.filters) === '[["id","eq","nt-standup"]]'))
check('…after which it no longer names the meeting', await waitFor(() => !card('nt-standup')?.textContent?.includes('Standup ·')))

done()
