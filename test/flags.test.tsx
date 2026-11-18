// Flagged issues: flagging one with a reason (the flag beside the issue's
// title, a card's menu), changing and removing the flag (each posted as a
// comment), and the flag showing wherever the issue is listed: board,
// backlog, the Issues list (and its filter), Work, history.
import {
  setupDom, reporter, button, click, dialog, type, menuItem, settleLazy, freezeToday, waitFor, choose, settle,
} from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, PEOPLE, TODAY } = await import('./mockSupabase')

const { check, done } = reporter()
freezeToday(TODAY)

const lastUpdate = (t: string) => captured.updates.filter((u) => u.table === t).at(-1)
const card = (key: string) => document.querySelector<HTMLElement>(`[data-issue="${key}"]`)
const flagged = (el: Element | null) => !!el?.querySelector('[data-flagged]')
// The issue view's flag beside the title, and what it opens once lit.
const flagButton = () => document.querySelector<HTMLElement>('[data-flag-button]')
const lit = () => flagButton()?.getAttribute('aria-pressed') === 'true'
const popover = () => document.querySelector<HTMLElement>('[data-flag-popover]')
const comments = () => [...document.querySelectorAll<HTMLElement>('[data-comment]')].map((c) => c.textContent ?? '')

// Flags an issue in the fixtures, as if someone had already.
function flag(id: string, reason: string) {
  Object.assign(table('issues').find((i) => i.id === id)!, {
    flag_reason: reason, flagged_by: 'p-amna', flagged_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  })
}

// ---------------- flagging from the issue view ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/issues?issue=WEB-6')
await settleLazy()
check('the flag sits beside the title, not lit', !!flagButton() && !lit() &&
  flagButton()?.getAttribute('aria-label') === 'Flag this issue' &&
  !!flagButton()?.closest('.MuiStack-root')?.querySelector('h1'))
check('…and no longer in the ⋯ menu', !button('More actions', dialog()!))
await click(flagButton())
check('the flag asks why', await waitFor(() => dialog()?.textContent?.includes('Flag WEB-6')) &&
  !!dialog()?.textContent?.includes('Why is it flagged?'))
await click(button('Add flag', dialog()!))
check('a flag needs a reason', !!dialog()?.textContent?.includes('Say why this issue is flagged.') &&
  !captured.updates.some((u) => u.table === 'issues'))

failNext('issues.update', { code: '42501', message: 'permission denied for table issues' })
await type('Why is it flagged?', 'Waiting on the client’s copy')
await click(button('Add flag', dialog()!))
check('a refused flag says why, and the dialog stays', !!dialog()?.textContent?.includes("You don't have permission to do that.") &&
  !!dialog()?.textContent?.includes('Flag WEB-6'))
await type('Why is it flagged?', '  Waiting on the client’s copy  ')
await click(button('Add flag', dialog()!))
const flagging = lastUpdate('issues')
check('the reason is saved, trimmed, on the issue', flagging?.values.flag_reason === 'Waiting on the client’s copy' &&
  JSON.stringify(flagging.filters) === '[["id","eq","i-web-6"]]', JSON.stringify(flagging))
check('…the dialog closes and the flag lights up', await waitFor(() => !dialog()?.textContent?.includes('Why is it flagged?') && lit()) &&
  flagButton()?.getAttribute('aria-label') === 'Flagged')
check('…the History is reloaded', captured.selects.filter((s) => s.table === 'issue_events').length >= 2)
check('…and the comment it posts shows, as you', await waitFor(() =>
  comments().some((c) => c.includes('Sara Iqbal') && c.includes('Flag added') && c.includes('Waiting on the client’s copy'))),
  comments().join(' | '))

await click(flagButton())
check('the lit flag opens why, and who flagged it', await waitFor(() => popover()?.textContent?.includes('Waiting on the client’s copy')) &&
  !!popover()?.textContent?.includes('Sara Iqbal'))
await click(button('Edit reason', popover()!))
check('Edit reason opens the reason to change', await waitFor(() => dialog()?.textContent?.includes('Change the flag on WEB-6')) &&
  dialog()?.querySelector<HTMLTextAreaElement>('textarea')?.value === 'Waiting on the client’s copy')
await type('Why is it flagged?', 'Copy promised for Friday')
await click(button('Save', dialog()!))
check('…and saves the new one', lastUpdate('issues')?.values.flag_reason === 'Copy promised for Friday' &&
  await waitFor(() => comments().some((c) => c.includes('Flag reason changed') && c.includes('Copy promised for Friday'))))

await click(flagButton())
await waitFor(() => popover())
await click(button('Remove flag', popover()!))
check('Remove flag unflags it', lastUpdate('issues')?.values.flag_reason === null && await waitFor(() => !lit()),
  JSON.stringify(lastUpdate('issues')))
check('…and says so in the comments', await waitFor(() => comments().some((c) => c.includes('Flag removed'))))

// An issue already flagged.
reset()
flag('i-web-6', 'Blocked on legal')
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/issues?issue=WEB-6')
await settleLazy()
check('a flagged issue opens with its flag lit', lit())
await click(flagButton())
check('…which says why, who and when', await waitFor(() => popover()?.textContent?.includes('Blocked on legal')) &&
  !!popover()?.textContent?.includes('Amna Khan') && !!popover()?.textContent?.includes('3 hours ago'), popover()?.textContent)

// ---------------- a viewer ----------------
reset()
signInAs(PEOPLE.viewer)
await mountApp('/projects/WEB/issues?issue=WEB-6')
await settleLazy()
check('a viewer isn’t offered a flag on an issue that has none', !!dialog() && !flagButton())
reset()
flag('i-web-2', 'Waiting on the brand team')
signInAs(PEOPLE.viewer)
await mountApp('/projects/WEB/issues?issue=WEB-2')
await settleLazy()
check('a viewer sees the lit flag', lit())
await click(flagButton())
check('…and its reason', await waitFor(() => popover()?.textContent?.includes('Waiting on the brand team')))
check('…but can’t change or remove it', !button('Edit reason', popover()!) && !button('Remove flag', popover()!))

// ---------------- the history ----------------
reset()
table('issue_events').push(
  { id: 'ev-f1', issue_id: 'i-web-6', project_id: 'pr-web', actor_id: 'p-amna', field: 'flag', from_value: null,
    to_value: 'Blocked on legal', from_id: null, to_id: null, created_at: new Date(Date.now() - 7200_000).toISOString() },
  { id: 'ev-f2', issue_id: 'i-web-6', project_id: 'pr-web', actor_id: 'p-sara', field: 'flag', from_value: 'Blocked on legal',
    to_value: null, from_id: null, to_id: null, created_at: new Date(Date.now() - 3600_000).toISOString() },
)
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/issues?issue=WEB-6')
await settleLazy()
await click([...dialog()!.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === 'History'))
check('the history says who flagged it, and why', !!dialog()?.textContent?.includes('Amna Khan flagged the issue') &&
  !!dialog()?.textContent?.includes('Blocked on legal'))
check('…and who removed the flag', !!dialog()?.textContent?.includes('Sara Iqbal removed the flag'))

// ---------------- the board ----------------
reset()
flag('i-web-2', 'Waiting on the brand team')
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/board')
await waitFor(() => card('WEB-2'))
check('a flagged card carries the flag', flagged(card('WEB-2')) && !flagged(card('WEB-3')))
check('…its reason on hover', card('WEB-2')?.querySelector('[data-flagged]')?.getAttribute('aria-label') === 'Flagged: Waiting on the brand team')
await click(button('Flagged'))
check('the Flagged quick filter keeps flagged cards', !!card('WEB-2') && !card('WEB-3') && !card('WEB-4'))
await click(button('Flagged'))
check('…and lets the rest back', !!card('WEB-3'))

await click(button('Move WEB-4'))
await click(menuItem('Add flag…'))
check('a card’s menu flags it too', await waitFor(() => dialog()?.textContent?.includes('Flag WEB-4')))
await type('Why is it flagged?', 'Needs the final headline')
await click(button('Add flag', dialog()!))
check('…saving the reason', lastUpdate('issues')?.values.flag_reason === 'Needs the final headline' &&
  JSON.stringify(lastUpdate('issues')?.filters) === '[["id","eq","i-web-4"]]')
check('…and the board shows it at once', await waitFor(() => flagged(card('WEB-4'))))
await click(button('Move WEB-2'))
await click(menuItem('Remove flag'))
check('a card’s menu removes a flag', lastUpdate('issues')?.values.flag_reason === null && await waitFor(() => !flagged(card('WEB-2'))))

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/board')
await waitFor(() => card('WEB-2'))
check('with nothing flagged there is no Flagged filter', !button('Flagged'))

reset()
flag('i-web-2', 'Waiting on the brand team')
signInAs(PEOPLE.viewer)
await mountApp('/projects/WEB/board')
await waitFor(() => card('WEB-2'))
check('a viewer sees the flag on the board too, with no menu to change it', flagged(card('WEB-2')) && !button('Move WEB-2'))

// ---------------- the backlog ----------------
reset()
flag('i-web-5', 'Pricing not agreed')
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/backlog')
await waitFor(() => card('WEB-5'))
check('the backlog marks a flagged issue', flagged(card('WEB-5')) && !flagged(card('WEB-6')))
await click(button('Move WEB-5'))
check('…and its menu changes or removes the flag', !!menuItem('Change reason…') && !!menuItem('Remove flag'))
await click(menuItem('Change reason…'))
check('…Change reason starts from the current one', await waitFor(() =>
  dialog()?.querySelector<HTMLTextAreaElement>('textarea')?.value === 'Pricing not agreed'))
await click(button('Cancel', dialog()!))

// ---------------- the Issues list ----------------
reset()
flag('i-web-5', 'Pricing not agreed')
signInAs(PEOPLE.member)
await mountApp('/issues')
await waitFor(() => card('WEB-5'))
check('the Issues list marks a flagged issue', flagged(card('WEB-5')) && !flagged(card('WEB-6')))
await click(button('More'))
await choose('Flagged', 'Flagged')
check('the Flagged filter is in the address', await waitFor(() => location.search.includes('flagged=yes')), location.search)
check('…and asks for flagged issues only', await waitFor(() => captured.selects.some((s) => s.table === 'issues' &&
  JSON.stringify(s.filters).includes('["flag_reason","not",["is",null]]'))),
  JSON.stringify(captured.selects.filter((s) => s.table === 'issues').at(-1)?.filters))
check('…so only they are listed', await waitFor(() => !!card('WEB-5') && !card('WEB-6')))

// ---------------- Work ----------------
reset()
flag('i-web-5', 'Pricing not agreed')
signInAs(PEOPLE.member)
await mountApp('/work')
await waitFor(() => card('WEB-5'))
await settle()
check('My issues marks a flagged issue', flagged(card('WEB-5')) && !flagged(card('WEB-2')))

done()
