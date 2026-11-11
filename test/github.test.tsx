// GitHub links: what a webhook delivery says about our issues (the parser the
// `github` Edge Function runs), and the Development section an issue shows.
import { setupDom, reporter, text, freezeToday, waitFor } from './setup'
setupDom()

const { issueKeys, parse } = await import('../supabase/functions/github/parse')
const { sortDevLinks } = await import('../src/lib/devLinks')
const { mountApp } = await import('./app')
const { reset, signInAs, table, PEOPLE, TODAY } = await import('./mockSupabase')
type DevLink = import('../src/lib/types').DevLink

const { check, done } = reporter()
freezeToday(TODAY)

// ---------------- finding issue keys ----------------
check('a key is found in a sentence', issueKeys('Fix WEB-12: the footer').join() === 'WEB-12')
check('in a lower-case branch name too, stored upper case', issueKeys('feature/web-12-footer-links').join() === 'WEB-12')
check('several keys, each once, in order', issueKeys('WEB-12 and OPS-3, again WEB-12').join() === 'WEB-12,OPS-3')
check('leading zeros are not a different issue', issueKeys('WEB-012').join() === 'WEB-12')
check('part of a longer word is not a key', issueKeys('preweb-12x and v2-0beta').length === 0, issueKeys('preweb-12x and v2-0beta').join())
check('nothing in, nothing out', issueKeys('').length === 0 && issueKeys(null).length === 0)
check('a flood of keys is capped', issueKeys(Array.from({ length: 60 }, (_, i) => `WEB-${i + 1}`).join(' ')).length === 20)

// ---------------- reading deliveries ----------------
const repository = { full_name: 'Elevance-Labs/site', html_url: 'https://github.com/Elevance-Labs/site' }
const push = parse('push', {
  ref: 'refs/heads/feature/web-2-hero',
  repository,
  sender: { login: 'sara' },
  head_commit: { timestamp: '2026-10-20T10:00:00Z' },
  commits: [
    { id: 'a1b2c3d4e5f6', message: 'WEB-2 hero banner\n\nlonger text', url: 'https://github.com/Elevance-Labs/site/commit/a1b2c3d4e5f6', timestamp: '2026-10-20T10:00:00Z', author: { username: 'sara' } },
    { id: 'ffff', message: 'tidy up', url: 'https://github.com/Elevance-Labs/site/commit/ffff', timestamp: '2026-10-20T10:01:00Z', author: { name: 'Sara' } },
    { id: 'eeee', message: 'WEB-2 WEB-5 shared styles', url: 'javascript:alert(1)', timestamp: '2026-10-20T10:02:00Z' },
  ],
})
const branch = push.links.find((l) => l.kind === 'branch')
check('a push to a branch named for an issue links the branch', branch?.key === 'WEB-2' && branch.ref === 'feature/web-2-hero', JSON.stringify(branch))
check('…with a link to it on GitHub', branch?.url === 'https://github.com/Elevance-Labs/site/tree/feature/web-2-hero')
const commits = push.links.filter((l) => l.kind === 'commit')
check('a commit is linked to the issue its message names', commits.length === 1 && commits[0].key === 'WEB-2' && commits[0].ref === 'a1b2c3d4e5f6', JSON.stringify(commits))
check('…by the first line of its message', commits[0]?.title === 'WEB-2 hero banner' && commits[0].author === 'sara')
check('a commit that names no issue links nothing', !push.links.some((l) => l.ref === 'ffff'))
check('an address that is not https is never kept', !push.links.some((l) => l.ref === 'eeee'))

check('a push to a tag is not a branch', parse('push', { ref: 'refs/tags/v1', repository, commits: [] }).links.length === 0)
const deleted = parse('push', { ref: 'refs/heads/feature/web-2-hero', deleted: true, repository })
check('a deleted branch takes its link away', deleted.removed.length === 1 && deleted.removed[0].ref === 'feature/web-2-hero' && deleted.links.length === 0)
check('so does the delete event', parse('delete', { ref_type: 'branch', ref: 'web-2', repository }).removed[0]?.ref === 'web-2')
check('a new branch is linked as soon as it exists', parse('create', { ref_type: 'branch', ref: 'web-5-pricing', repository }).links[0]?.key === 'WEB-5')

const pr = (extra: object) =>
  parse('pull_request', {
    repository,
    pull_request: { number: 7, title: 'Hero banner (WEB-2)', html_url: 'https://github.com/Elevance-Labs/site/pull/7', state: 'open', draft: false, merged: false,
      head: { ref: 'feature/web-2-hero' }, user: { login: 'sara' }, updated_at: '2026-10-20T11:00:00Z', ...extra },
  }).links
check('a pull request is linked by its title or its branch, once per issue', pr({}).length === 1 && pr({})[0].key === 'WEB-2' && pr({})[0].ref === '7')
check('named only by its branch, it is still linked', pr({ title: 'Hero banner' })[0]?.key === 'WEB-2')
check('one that names two issues is on both', pr({ title: 'WEB-2 and WEB-5' }).map((l) => l.key).join() === 'WEB-2,WEB-5')
check('its state is open, draft, merged or closed',
  [pr({})[0].state, pr({ draft: true })[0].state, pr({ state: 'closed', merged: true })[0].state, pr({ state: 'closed' })[0].state].join() === 'open,draft,merged,closed')
check('an event nobody asked for is nothing', parse('issues', { repository }).links.length === 0 && parse('push', {}).links.length === 0)

// ---------------- order ----------------
const link = (id: string, kind: DevLink['kind'], at: string, extra: Partial<DevLink> = {}): DevLink => ({
  id, issue_id: 'i-web-2', kind, repo: 'Elevance-Labs/site', ref: id, title: `title ${id}`, url: `https://github.com/x/${id}`,
  state: null, author: 'sara', happened_at: at, updated_at: at, ...extra,
})
check('pull requests first, then branches, then commits, newest first',
  sortDevLinks([link('c1', 'commit', '2026-10-01'), link('b', 'branch', '2026-10-02'), link('c2', 'commit', '2026-10-03'), link('p', 'pull_request', '2026-09-01')])
    .map((l) => l.id).join() === 'p,b,c2,c1')

// ---------------- on the issue ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/browse/WEB-2')
await waitFor(() => text().includes('Hero banner'))
check('an issue with no code shows no Development section', !text().includes('Development'), text().slice(0, 200))

reset()
const fixtures: DevLink[] = [
  link('7', 'pull_request', '2026-10-20T11:00:00Z', { title: 'Hero banner (WEB-2)', state: 'open', url: 'https://github.com/Elevance-Labs/site/pull/7' }),
  link('feature/web-2-hero', 'branch', '2026-10-19T09:00:00Z'),
  ...Array.from({ length: 7 }, (_, i) => link(`abcdef${i}999`, 'commit', `2026-10-1${i}T09:00:00Z`, { title: `commit ${i}` })),
  { ...link('99', 'pull_request', '2026-10-20T11:00:00Z', { title: 'Someone else’s' }), issue_id: 'i-web-5' },
]
table('issue_dev_links').push(...fixtures.map((f) => ({ ...f })))
signInAs(PEOPLE.member)
await mountApp('/browse/WEB-2')
check('with code, the issue shows its Development', await waitFor(() => text().includes('Development')))
const rows = [...document.querySelectorAll('[data-dev-link]')]
check('the pull request leads, with its state', rows[0]?.getAttribute('data-dev-link') === 'pull_request' && rows[0].textContent?.includes('#7') === true && rows[0].textContent.includes('Open'),
  rows[0]?.textContent ?? '')
check('then the branch', rows[1]?.getAttribute('data-dev-link') === 'branch' && rows[1].textContent?.includes('feature/web-2-hero') === true)
check('commits show their short sha', rows.some((r) => r.textContent?.includes('abcdef6') && r.textContent.includes('commit 6')))
check('a long run of commits is summed up, newest kept', rows.filter((r) => r.getAttribute('data-dev-link') === 'commit').length === 5 && text().includes('and 2 earlier commits'))
check('each opens GitHub in a new tab, safely',
  [...document.querySelectorAll<HTMLAnchorElement>('[data-dev-link] a')].every((a) => a.target === '_blank' && a.rel.includes('noopener') && a.href.startsWith('https://github.com/')))
check('another issue’s pull request is not shown here', !text().includes('Someone else’s'))

done()
