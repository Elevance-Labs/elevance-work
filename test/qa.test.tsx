// AI-assisted QA: the qa-api function (its MCP protocol, an issue as
// Markdown, its operations run on the in-memory database as the service
// role), and the app's side: API tokens, CI tokens, the Runs view, scripts
// on the sheet and a case's history.
import { setupDom, reporter, text, button, click, dialog, settle, settleLazy, waitFor, type } from './setup'
setupDom()

const { mountApp } = await import('./app')
const { reset, signInAs, asService, captured, table, PEOPLE, supabase } = await import('./mockSupabase')
const { htmlToMarkdown } = await import('../supabase/functions/qa-api/markdown')
const { handleMcp, TOOLS, ApiError } = await import('../supabase/functions/qa-api/mcp')
const { Ops } = await import('../supabase/functions/qa-api/ops')
const { mcpConfig, qaApiUrl, tokenExport } = await import('../src/lib/qaApi')
type Db = import('../supabase/functions/qa-api/ops').Db

const { check, done } = reporter()

// ---------------- an issue as Markdown ----------------
const md = htmlToMarkdown('<h2>Goal</h2><p>Pay with a <strong>saved</strong> card &amp; get a <a href="https://x.test/r">receipt</a>.</p>' +
  '<ol><li><p>Open the cart</p></li><li><p>Pay</p></li></ol><ul><li><p>Fast</p></li></ul>' +
  '<table><tbody><tr><th><p>Card</p></th><th><p>Result</p></th></tr><tr><td><p>Visa</p></td><td><p>OK</p></td></tr></tbody></table>' +
  '<p>Ask <span data-type="mention" data-id="p-amna" data-label="Amna Khan">@Amna Khan</span></p><pre><code>npm test\nnpm run e2e</code></pre>')
check('an issue reads as Markdown: headings, emphasis, links, numbered and bulleted lists, tables, mentions, code', md ===
  '## Goal\n\nPay with a **saved** card & get a [receipt](https://x.test/r).\n\n1. Open the cart\n\n2. Pay\n\n- Fast\n\n' +
  '| Card | Result |\n| --- | --- |\n| Visa | OK |\n\nAsk @Amna Khan\n\n```\nnpm test\nnpm run e2e\n```', JSON.stringify(md))
check('…and nothing reads as nothing', htmlToMarkdown('') === '' && htmlToMarkdown('<p></p>') === '')

// ---------------- MCP ----------------
const calls: [string, unknown][] = []
const fake = async (tool: string, args: Record<string, unknown>) => {
  calls.push([tool, args])
  if (tool === 'get_run') throw new ApiError(404, "There's no run WEB-R9 this token can use.")
  return { ok: true }
}
const init = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {} } }, fake) as Record<string, any>
check('MCP: initialize agrees a protocol version the client knows, offering tools', init.result.protocolVersion === '2025-03-26' &&
  !!init.result.capabilities.tools && init.result.serverInfo.name === 'el-work' && /never record a status/.test(init.result.instructions))
check('…an unknown version gets the newest', ((await handleMcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, fake)) as Record<string, any>)
  .result.protocolVersion === '2025-06-18')
check('…a notification gets no reply', (await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, fake)) === null)
const listed = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, fake) as Record<string, any>
check('…the tools, each with its input schema', JSON.stringify(listed.result.tools.map((t: { name: string }) => t.name)) ===
  '["get_issue","list_test_cases","save_test_cases","set_automation","start_run","record_results","finish_run","get_run","list_runs"]' &&
  listed.result.tools.every((t: { inputSchema?: { type: string }; writes?: boolean }) => t.inputSchema?.type === 'object' && t.writes === undefined))
const called = await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_runs', arguments: { project: 'WEB' } } }, fake) as Record<string, any>
check('…a tool call returns its result as text and as structure', called.result.isError === false &&
  JSON.parse(called.result.content[0].text).ok === true && called.result.structuredContent.ok === true &&
  JSON.stringify(calls.at(-1)) === '["list_runs",{"project":"WEB"}]')
const refused = await handleMcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_run', arguments: { run: 'WEB-R9' } } }, fake) as Record<string, any>
check('…a refusal is the tool’s answer (isError), for the model to read', refused.result.isError === true &&
  refused.result.content[0].text.includes('no run WEB-R9'))
const unknown = await handleMcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'drop_tables' } }, fake) as Record<string, any>
check('…an unknown tool or method is a JSON-RPC error', unknown.error.code === -32602 &&
  ((await handleMcp({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, fake)) as Record<string, any>).error.code === -32601)
const batch = await handleMcp([{ jsonrpc: '2.0', id: 8, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/cancelled' }], fake) as unknown[]
check('…a batch gets a reply per request', Array.isArray(batch) && batch.length === 1)
check('the tools that write are marked so (a read-only token can still read)',
  TOOLS.filter((t) => t.writes).map((t) => t.name).join() === 'save_test_cases,set_automation,start_run,record_results,finish_run')

// ---------------- the function's operations, on the database ----------------
const SARA = { tokenId: 'tok-sara', profileId: 'p-sara', projectId: null, scopes: ['tests:read', 'tests:write'] }
const CI = { tokenId: 'tok-ci', profileId: null, projectId: 'pr-web', scopes: ['tests:read', 'tests:write'] }
const ops = (caller: typeof SARA | typeof CI) => new Ops(supabase as unknown as Db, caller)
const refusal = async (p: Promise<unknown>) => {
  try {
    await p
    return null
  } catch (e) {
    return e instanceof ApiError ? `${e.status} ${e.message}` : `crash: ${(e as Error).message}`
  }
}

reset()
asService()
table('issues').find((i) => i.key === 'WEB-2')!.description = '<p>The hero shows the <strong>new</strong> photo.</p>'
const issue = await ops(SARA).get_issue({ key: 'web-2' }) as Record<string, any>
check('get_issue: the ticket to test, its description as Markdown', issue.key === 'WEB-2' && issue.title === 'Hero banner' &&
  issue.type === 'Story' && issue.status === 'In Progress' && issue.epic?.key === 'WEB-1' && issue.description === 'The hero shows the **new** photo.',
  JSON.stringify(issue).slice(0, 300))
check('…its comments by name', issue.comments[0]?.author === 'Amna Khan' && issue.comments[0]?.text === 'Use the new photo')
check('…its cases, with their latest result and script', JSON.stringify(issue.test_cases.map((c: { key: string }) => c.key)) === '["WEB-T1","WEB-T2"]' &&
  issue.test_cases[0].latest.status === 'pass' && issue.test_cases[0].script.path === 'e2e/home/hero.spec.ts' &&
  issue.test_cases[1].changed_since_automated === true && issue.test_cases[0].changed_since_automated === false)
check('…and what the project allows', issue.project_lists.levels.join() === 'Smoke,Sanity,Regression' &&
  issue.project_lists.areas.join() === 'Footer,Home,Mobile')

const HINA = { ...SARA, tokenId: 'tok-hina', profileId: 'p-hina' }
table('api_tokens').push({ id: 'tok-hina', profile_id: 'p-hina', project_id: null, scopes: ['tests:read', 'tests:write'] })
check('a token whose person can’t see the project finds no such issue (not even its project’s name)',
  await refusal(ops(HINA).get_issue({ key: 'WEB-2' })) === "404 There's no issue WEB-2 this token can use.")
const OMAR = { ...SARA, tokenId: 'tok-omar', profileId: 'p-omar' }
table('api_tokens').push({ id: 'tok-omar', profile_id: 'p-omar', project_id: null, scopes: ['tests:read', 'tests:write'] })
check('…a viewer’s token reads', (await ops(OMAR).list_test_cases({ project: 'WEB' }) as { count: number }).count === 3)
check('…but doesn’t write', await refusal(ops(OMAR).save_test_cases({ project: 'WEB', cases: [{ title: 'x' }] })) === '403 This token can only read WEB.')
check('a read-only token doesn’t write either',
  await refusal(ops({ ...SARA, scopes: ['tests:read'] }).save_test_cases({ project: 'WEB', cases: [{ title: 'x' }] })) === "403 This token can't write tests.")

const listed2 = await ops(SARA).list_test_cases({ project: 'WEB', level: 'regression', status: 'none' }) as { test_cases: { key: string }[] }
check('list_test_cases filters by level and latest status', JSON.stringify(listed2.test_cases.map((c) => c.key)) === '["WEB-T3"]')

const saved = await ops(SARA).save_test_cases({
  issue: 'WEB-2',
  cases: [
    { title: 'Hero has alt text', expected: 'Screen readers read it', level: 'Regression', areas: 'Home, Accessibility' },
    { key: 'WEB-T1', expected: 'The new photo fills the hero, edge to edge' },
    { key: 'WEB-T2', title: 'Hero is readable on a small phone' },
    { title: '' },
  ],
}) as { saved: { key: string; action: string }[]; errors: { index: number; error: string }[] }
const madeCase = table('test_cases').find((c) => c.title === 'Hero has alt text')
check('save_test_cases creates cases for the issue, by whoever owns the token',
  saved.saved.some((s) => s.key === 'WEB-T4' && s.action === 'created') && madeCase?.issue_id === 'i-web-2' && madeCase?.created_by === 'p-sara' &&
  JSON.stringify(madeCase?.areas) === '["Home","Accessibility"]', JSON.stringify(saved))
check('…changes only the fields given', saved.saved.some((s) => s.key === 'WEB-T2' && s.action === 'updated') &&
  table('test_cases').find((c) => c.key === 'WEB-T2')?.type === 'UI' && captured.updates.some((u) => u.table === 'test_cases' &&
    u.values.title === 'Hero is readable on a small phone' && u.values.updated_by === 'p-sara' && !('type' in u.values)))
check('…won’t change an expected result without a reason, nor make a case without a title', JSON.stringify(saved.errors) ===
  '[{"index":1,"key":"WEB-T1","error":"Changing WEB-T1\'s expected result needs a reason."},{"index":3,"error":"title is required."}]' ||
  JSON.stringify(saved.errors) === '[{"index":1,"key":"WEB-T1","error":"Changing WEB-T1\'s expected result needs a reason."},{"index":3,"error":"A new case needs a title."}]',
  JSON.stringify(saved.errors))
await ops(SARA).save_test_cases({ project: 'WEB', cases: [{ key: 'WEB-T1', expected: 'The new photo fills the hero, edge to edge', reason: 'Design review' }] })
check('…with one, it does, and keeps the reason', captured.updates.some((u) => u.table === 'test_cases' && u.values.change_reason === 'Design review' &&
  u.values.expected === 'The new photo fills the hero, edge to edge'))
check('…and a case of another project is refused', (await ops(SARA).save_test_cases({ project: 'WEB', cases: [{ key: 'OPS-T1', title: 'x' }] }) as
  { errors: { error: string }[] }).errors[0]?.error === "There's no case OPS-T1 in WEB.")

const linkedScripts = await ops(SARA).set_automation({ links: [{ case: 'WEB-T3', repo: 'elevance/site', path: 'e2e/footer.spec.ts', title: 'links open @WEB-T3' }] })
const t3 = table('test_cases').find((c) => c.key === 'WEB-T3')
check('set_automation links a case to its test', JSON.stringify(linkedScripts) === '{"linked":["WEB-T3"],"errors":[]}' &&
  t3?.script_path === 'e2e/footer.spec.ts' && t3?.script_repo === 'elevance/site' && !!t3?.automated_at)

const run = await ops(SARA).start_run({ project: 'WEB', environment: 'staging', branch: 'feature/hero', commit: 'ABC1234', repo: 'elevance/site' }) as Record<string, any>
const runRow = table('test_runs').find((r) => r.key === run.run)
check('start_run: a person’s run is local and theirs, on the environment as the project spells it', run.run === 'WEB-R3' &&
  run.environment === 'Staging' && run.mode === 'local' && runRow?.run_by === 'p-sara' && runRow?.commit_sha === 'abc1234', JSON.stringify(run))
const recorded = await ops(SARA).record_results({ run: 'WEB-R3', results: [
  { case: 'WEB-T1', status: 'pass', duration_ms: 3100 },
  { case: 'web-t2', status: 'fail', error: 'expect(locator).toBeVisible()\nLocator: hero title', attempts: 2 },
  { case: 'WEB-T3', status: 'pass', flaky: true, attempts: 2, artifact_url: 'https://ci.test/trace.zip' },
  { case: 'WEB-T99', status: 'pass' },
] }) as Record<string, any>
const failRow = table('test_results').find((r) => r.run_id === runRow?.id && r.case_id === 'tc-2')
check('record_results: one result per case, automated, by the token’s person, on the run’s environment', recorded.recorded === 3 &&
  failRow?.source === 'automated' && failRow?.recorded_by === 'p-sara' && failRow?.environment === 'Staging' && failRow?.attempts === 2)
check('…a failure without a reason takes its error’s first line', failRow?.reason === 'expect(locator).toBeVisible()')
check('…cases that aren’t the project’s are named, not recorded', JSON.stringify(recorded.unknown_cases) === '["WEB-T99"]')
check('…and the run counts them', JSON.stringify(recorded.counts) === '{"total":3,"pass":2,"fail":1,"blocked":0,"skipped":0,"flaky":1}')
check('…the cases show it as their latest', table('test_cases').find((c) => c.key === 'WEB-T2')?.last_status === 'fail')
check('a status not Playwright’s is refused', await refusal(ops(SARA).record_results({ run: 'WEB-R3', results: [{ case: 'WEB-T1', status: 'great' }] })) ===
  '400 WEB-T1: "great" is not one of pass, fail, blocked, skipped.')
const finished = await ops(SARA).finish_run({ run: 'WEB-R3' }) as Record<string, any>
check('finish_run closes it', !!finished.finished_at && !!table('test_runs').find((r) => r.key === 'WEB-R3')?.finished_at)
check('…and it takes no more', await refusal(ops(SARA).record_results({ run: 'WEB-R3', results: [{ case: 'WEB-T1', status: 'pass' }] })) ===
  '400 Run WEB-R3 is finished.')
const got = await ops(SARA).get_run({ run: 'WEB-R3' }) as Record<string, any>
check('get_run lists its results by case', JSON.stringify(got.results.map((r: { case: string; status: string }) => `${r.case}:${r.status}`)) ===
  '["WEB-T1:pass","WEB-T2:fail","WEB-T3:pass"]')

const ciRun = await ops(CI).start_run({ project: 'WEB', environment: 'Dev' }) as Record<string, any>
check('a CI token’s run is the cloud’s, nobody’s', ciRun.mode === 'cloud' && table('test_runs').find((r) => r.key === ciRun.run)?.run_by === null)
check('…and it can’t touch another project', await refusal(ops(CI).list_test_cases({ project: 'OPS' })) === "404 There's no project OPS this token can use.")
// Made in the same millisecond here; a minute apart in life.
table('test_runs').find((r) => r.key === 'WEB-R4')!.started_at = new Date(Date.now() + 60_000).toISOString()
check('list_runs: newest first', ((await ops(SARA).list_runs({ project: 'WEB' })) as { runs: { run: string }[] }).runs[0].run === 'WEB-R4')
asService(false)

// ---------------- the setup a new token shows ----------------
check('the setup the app shows: the address, .mcp.json with the token from the environment', qaApiUrl('https://x.supabase.co/') ===
  'https://x.supabase.co/functions/v1/qa-api' && mcpConfig('https://x/fn').includes('"url": "https://x/fn/mcp"') &&
  mcpConfig('https://x/fn').includes('Bearer ${EL_WORK_TOKEN}') && tokenExport('elw_1') === 'export EL_WORK_TOKEN=elw_1')

// ---------------- the app: your API tokens ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/dashboard')
await click(button('Account menu'))
await click([...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent?.includes('API tokens'))!)
await settleLazy()
check('the account menu has your API tokens', !!dialog()?.textContent?.includes('API tokens') && !!dialog()?.querySelector('[data-token="Sara laptop"]'))
check('…only your own', !dialog()?.querySelector('[data-token="GitHub Actions"]'))
await type('Name', 'Work laptop', dialog()!)
await click(button('Make token', dialog()!))
const made = captured.rpcs.find((r) => r.name === 'api_token_create')
check('making one asks the database', made?.args?.p_name === 'Work laptop' && made.args.p_ci === false && made.args.p_days === 90 &&
  JSON.stringify(made.args.p_scopes) === '["tests:read","tests:write"]', JSON.stringify(made?.args))
const shown = dialog()?.querySelector('[data-copyable="Token"]')?.textContent ?? ''
check('…and shows it once, with what to paste', /^elw_\d{64}$/.test(shown) &&
  !!dialog()?.querySelector('[data-copyable="Claude Code: .mcp.json in the repo"]')?.textContent?.includes('/functions/v1/qa-api/mcp') &&
  dialog()?.querySelector('[data-copyable="In your shell profile"]')?.textContent === `export EL_WORK_TOKEN=${shown}`)
check('…and lists it by its prefix only', await waitFor(() => !!dialog()?.querySelector('[data-token="Work laptop"]')) &&
  !dialog()!.querySelector('[data-token="Work laptop"]')!.textContent!.includes(shown))
await click(button('Revoke', dialog()!.querySelector('[data-token="Sara laptop"]')!))
await click(button('Revoke', dialog()!))
check('revoking asks first, then revokes', captured.rpcs.some((r) => r.name === 'api_token_revoke' && r.args?.p_id === 'tok-sara') &&
  await waitFor(() => !!dialog()?.querySelector('[data-token="Sara laptop"]')?.textContent?.includes('Revoked')))

// ---------------- CI tokens ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/settings?tab=tests')
check('a project admin sees its CI tokens in Settings → Tests', text().includes('CI tokens') && !!document.querySelector('[data-token="GitHub Actions"]'))
await type('Name', 'Nightly regression')
await click(button('Make token'))
const ciMade = captured.rpcs.find((r) => r.name === 'api_token_create')
check('…and makes one for the project', ciMade?.args?.p_ci === true && ciMade.args.p_project === 'pr-web' && text().includes('won\'t be shown again'))

// ---------------- runs, scripts and history in the Tests tab ----------------
reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/tests?view=runs')
const runKeys = () => [...document.querySelectorAll('[data-run]')].map((r) => r.getAttribute('data-run'))
check('the Tests tab lists its runs, newest first', await waitFor(() => JSON.stringify(runKeys()) === '["WEB-R2","WEB-R1"]'), JSON.stringify(runKeys()))
const r1 = document.querySelector('[data-run="WEB-R1"]')!
check('…each with its environment, who ran it (or the cloud) and where from', r1.textContent!.includes('Dev') && r1.textContent!.includes('Sara Iqbal (local)') &&
  r1.textContent!.includes('feature/hero') && r1.textContent!.includes('abc1234') &&
  !!document.querySelector('[data-run="WEB-R2"]')?.textContent?.includes('Cloud') && !!document.querySelector('[data-run="WEB-R2"]')?.textContent?.includes('Running'))
await click(r1)
check('opening one lists its results', !!dialog()?.textContent?.includes('Run WEB-R1') && !!dialog()?.querySelector('[data-result="WEB-T1"]')?.textContent?.includes('Flaky'))
check('…a member can’t delete it', !button('Delete run', dialog()!))

reset()
signInAs(PEOPLE.admin)
await mountApp('/projects/WEB/tests?view=runs')
await waitFor(() => runKeys().length === 2)
await click(document.querySelector('[data-run="WEB-R1"]'))
await click(button('Delete run', dialog()!))
await click(button('Delete', dialog()!))
check('a project admin deletes a run', captured.deletes.some((d) => d.table === 'test_runs' && JSON.stringify(d.filters) === '[["id","eq","run-1"]]') &&
  await waitFor(() => JSON.stringify(runKeys()) === '["WEB-R2"]'))

reset()
signInAs(PEOPLE.member)
await mountApp('/projects/WEB/tests')
const scriptCell = (row: string) => document.querySelector(`tr[data-row="${row}"] td[data-col="script"]`)
check('the sheet shows the script that automates a case', await waitFor(() => scriptCell('WEB-T1')?.textContent === 'hero.spec.ts (elevance/site)') &&
  scriptCell('WEB-T3')?.textContent === '')
check('…flagged once the case changed after it was linked', !!scriptCell('WEB-T2')?.querySelector('[data-stale]') && !scriptCell('WEB-T1')?.querySelector('[data-stale]'))
check('…and switches to the runs', !!button('Runs'))

const statusCell = document.querySelector<HTMLElement>('tr[data-row="WEB-T1"] td[data-col="result"]')!
statusCell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }))
await settle()
document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
await settle(60)
check('a case’s results say which run, who or the cloud, and if flaky', !!dialog()?.textContent?.includes('Sara Iqbal (local) · WEB-R1') &&
  !!dialog()?.textContent?.includes('Flaky'), dialog()?.textContent)
await click([...dialog()!.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Changes'))
check('…and its changes: through the API, by whom, and why', await waitFor(() => !!dialog()?.querySelector('[data-change="expected"]')) &&
  !!dialog()!.querySelector('[data-change="expected"]')!.textContent!.includes('API') &&
  dialog()!.querySelector('[data-change="expected"]')!.textContent!.includes('Amna Khan') &&
  dialog()!.querySelector('[data-change="expected"]')!.textContent!.includes('Why: The story asks for the full width'))

done()
