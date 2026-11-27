// Test cases: the sheet's columns, what a cell says and what typing or
// pasting into one means, tab-separated text (what Google Sheets copies and
// takes), the filter, and the counts. Pure: the sheet and its pages use it;
// the database (test_cases_guard, test_results_guard) has the last word.
import type { ChipProps } from '@mui/material'
import { parseIssueKey } from './issues'
import type { TestCase, TestRun, TestStatus } from './types'

export const TEST_CASE_COLUMNS =
  'id, project_id, number, key, issue_id, title, description, expected, type, level, areas, rank, last_status, last_reason, ' +
  'last_environment, last_recorded_by, last_recorded_at, created_by, created_at, updated_at, updated_by, script_repo, script_path, ' +
  'script_title, automated_at'

// The columns a client may write (the grant lists in the schema).
export type TestCaseWrite = Partial<Pick<TestCase, 'issue_id' | 'title' | 'description' | 'expected' | 'type' | 'level' | 'areas' | 'rank'>>

export const TEST_STATUSES: TestStatus[] = ['pass', 'fail', 'blocked', 'skipped']
export const TEST_STATUS_LABELS: Record<TestStatus, string> = { pass: 'Pass', fail: 'Fail', blocked: 'Blocked', skipped: 'Skipped' }
export const NOT_RUN = 'Not run'
export const TEST_STATUS_COLORS: Record<TestStatus, ChipProps['color']> = {
  pass: 'success',
  fail: 'error',
  blocked: 'warning',
  skipped: 'default',
}
// Data colours: the summary bar.
export const TEST_STATUS_HEX: Record<TestStatus | 'none', string> = {
  pass: '#22a06b',
  fail: '#e2483d',
  blocked: '#e2b203',
  skipped: '#8590a2',
  none: '#c1c7d0',
}
/** The letter that records a status from the sheet's Status column. */
export const TEST_STATUS_SHORTCUTS: Record<string, TestStatus> = { p: 'pass', f: 'fail', b: 'blocked', s: 'skipped' }
export const STATUS_SHORTCUT: Record<TestStatus, string> = { pass: 'P', fail: 'F', blocked: 'B', skipped: 'S' }

/** A failure or a block says why (test_results_guard). */
export const needsReason = (status: TestStatus) => status === 'fail' || status === 'blocked'

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export type SheetColumn = 'key' | 'title' | 'description' | 'expected' | 'type' | 'level' | 'areas' | 'issue' | 'status' | 'result' | 'script'

export interface ColumnSpec {
  label: string
  width: number
  /** Typed into (status is recorded instead; key and result are the database's). */
  editable: boolean
  /** Text that may run over several lines. */
  multiline?: boolean
  /** What a sheet's header row may call it, lower-case. */
  aliases: string[]
}

export const SHEET_COLUMNS: Record<SheetColumn, ColumnSpec> = {
  key: { label: 'ID', width: 96, editable: false, aliases: ['id', 'key', 'test id', 'case id', 'tc id', 'test case id'] },
  title: { label: 'Summary', width: 320, editable: true, aliases: ['summary', 'title', 'test case', 'test cases', 'name', 'scenario', 'test scenario'] },
  description: { label: 'Description', width: 280, editable: true, multiline: true,
    aliases: ['description', 'steps', 'test steps', 'details', 'steps to reproduce', 'preconditions'] },
  expected: { label: 'Expected result', width: 240, editable: true, multiline: true,
    aliases: ['expected', 'expected result', 'expected results', 'expected outcome', 'expected behaviour', 'expected behavior'] },
  type: { label: 'Type', width: 130, editable: true, aliases: ['type', 'test type', 'case type'] },
  level: { label: 'Level', width: 120, editable: true, aliases: ['level', 'test level', 'suite'] },
  areas: { label: 'Impacted areas', width: 200, editable: true,
    aliases: ['impacted areas', 'impacted area', 'areas', 'area', 'module', 'modules', 'component', 'components', 'impact'] },
  issue: { label: 'Issue', width: 104, editable: true, aliases: ['issue', 'ticket', 'jira', 'story', 'issue key'] },
  status: { label: 'Status', width: 120, editable: false, aliases: ['status', 'pass/fail', 'outcome', 'actual status'] },
  result: { label: 'Reason', width: 260, editable: false,
    aliases: ['reason', 'result', 'comment', 'comments', 'remarks', 'notes', 'actual result', 'actual results', 'failure reason'] },
  // Linked through qa-api (set_automation); never typed.
  script: { label: 'Automated', width: 200, editable: false, aliases: ['automated', 'automation', 'script', 'spec', 'playwright'] },
}

/** The project's Tests tab; an issue's own sheet leaves out its issue. */
export const PROJECT_SHEET: SheetColumn[] = ['key', 'title', 'description', 'expected', 'type', 'level', 'areas', 'issue', 'status', 'result', 'script']
export const ISSUE_SHEET: SheetColumn[] = ['key', 'title', 'description', 'expected', 'type', 'level', 'areas', 'status', 'result', 'script']

/** What a cell shows and copies, as text. */
export function cellText(c: TestCase, col: SheetColumn, issueKey?: (id: string) => string | undefined): string {
  switch (col) {
    case 'key':
      return c.key
    case 'title':
      return c.title
    case 'description':
      return c.description
    case 'expected':
      return c.expected
    case 'type':
      return c.type ?? ''
    case 'level':
      return c.level ?? ''
    case 'areas':
      return c.areas.join(', ')
    case 'issue':
      return (c.issue_id && issueKey?.(c.issue_id)) ?? ''
    case 'status':
      return c.last_status ? TEST_STATUS_LABELS[c.last_status] : ''
    case 'result':
      return c.last_reason ?? ''
    case 'script':
      return c.script_path ? [c.script_repo, c.script_path].filter(Boolean).join(':') : ''
  }
}

/** The value as the list spells it, ignoring case and spaces. */
export function matchOption(value: string, list: string[]) {
  const want = value.trim().replace(/\s+/g, ' ').toLowerCase()
  return list.find((o) => o.toLowerCase() === want) ?? null
}

/**
 * Impacted areas from text ("Checkout, Payments"), spelt as the project
 * already spells them, each once.
 */
export function parseAreas(text: string, known: string[] = []) {
  const out: string[] = []
  for (const raw of text.split(/[,;\n]/)) {
    const a = raw.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (!a) continue
    const spelt = matchOption(a, known) ?? a
    if (!out.some((x) => x.toLowerCase() === spelt.toLowerCase())) out.push(spelt)
  }
  return out
}

/** Every area the project's cases use, by name. */
export function knownAreas(cases: Pick<TestCase, 'areas'>[]) {
  const seen = new Map<string, string>()
  for (const c of cases) for (const a of c.areas) if (!seen.has(a.toLowerCase())) seen.set(a.toLowerCase(), a)
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** A status as people write it in a sheet: Pass, passed, ✓, F… */
export function parseStatus(text: string): TestStatus | null | undefined {
  const t = text.trim().toLowerCase()
  if (!t) return null
  if (['pass', 'passed', 'p', 'ok', 'yes', '✓', '✔', 'done'].includes(t)) return 'pass'
  if (['fail', 'failed', 'f', 'no', '✗', '✘', 'x'].includes(t)) return 'fail'
  if (['blocked', 'block', 'b'].includes(t)) return 'blocked'
  if (['skipped', 'skip', 's', 'n/a', 'na', 'not applicable'].includes(t)) return 'skipped'
  return undefined
}

/** "WEB-12", "web-12" or plain "12" (in this project): the issue key, or null for nothing, undefined for nonsense. */
export function parseIssueRef(text: string, projectKey: string): string | null | undefined {
  const t = text.trim()
  if (!t) return null
  if (/^\d+$/.test(t)) return `${projectKey}-${Number(t)}`
  const parsed = parseIssueKey(t)
  return parsed ? `${parsed.projectKey}-${parsed.number}` : undefined
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export interface ParseContext {
  types: string[]
  levels: string[]
  areas: string[]
}

/**
 * What typing or pasting `text` into a column writes. The issue column hands
 * back a key, which the sheet looks up.
 */
export function parseCell(col: SheetColumn, text: string, ctx: ParseContext): Parsed<TestCaseWrite> {
  switch (col) {
    case 'title': {
      const title = text.trim().replace(/\s+/g, ' ')
      if (!title) return { ok: false, error: 'A test case needs a summary.' }
      return { ok: true, value: { title: title.slice(0, 500) } }
    }
    case 'description':
    case 'expected':
      return { ok: true, value: { [col]: text.replace(/^\s+|\s+$/g, '').slice(0, 10000) } }
    case 'type':
    case 'level': {
      const list = col === 'type' ? ctx.types : ctx.levels
      if (!text.trim()) return { ok: true, value: { [col]: null } }
      const v = matchOption(text, list)
      return v
        ? { ok: true, value: { [col]: v } }
        : { ok: false, error: `"${text.trim()}" isn't one of this project's test ${col === 'type' ? 'types' : 'levels'}.` }
    }
    case 'areas':
      return { ok: true, value: { areas: parseAreas(text, ctx.areas).slice(0, 20) } }
    default:
      return { ok: false, error: `${SHEET_COLUMNS[col].label} isn't typed in.` }
  }
}

// ---------------------------------------------------------------------------
// Tab-separated text: what spreadsheets copy and paste
// ---------------------------------------------------------------------------

/**
 * Rows of cells from copied spreadsheet text. A cell with a tab, a line
 * break or a quote comes quoted ("…", quotes doubled), as Google Sheets and
 * Excel write it.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  const s = text.replace(/\r\n?/g, '\n')
  let atCellStart = true
  while (i < s.length) {
    const ch = s[i]
    if (atCellStart && ch === '"') {
      // A quoted cell, up to the quote that isn't doubled.
      let j = i + 1
      let quoted = ''
      let closed = false
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            quoted += '"'
            j += 2
            continue
          }
          closed = true
          break
        }
        quoted += s[j++]
      }
      // Only a real quoted cell if the quote closes at the cell's end.
      if (closed && (j + 1 >= s.length || s[j + 1] === '\t' || s[j + 1] === '\n')) {
        cell = quoted
        i = j + 1
        atCellStart = false
        continue
      }
    }
    atCellStart = false
    if (ch === '\t') {
      row.push(cell)
      cell = ''
      atCellStart = true
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      atCellStart = true
    } else {
      cell += ch
    }
    i++
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export function toTsv(rows: string[][]) {
  return rows.map((r) => r.map((c) => (/[\t\n\r"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t')).join('\n')
}

/**
 * If this row is a sheet's header (Summary, Expected result, Type…), the
 * column each of its cells is; otherwise null.
 */
export function headerColumns(row: string[]): (SheetColumn | null)[] | null {
  const cols = row.map((cell) => {
    const name = cell.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[:*]$/, '')
    return (Object.keys(SHEET_COLUMNS) as SheetColumn[]).find((c) => SHEET_COLUMNS[c].aliases.includes(name)) ?? null
  })
  const named = row.filter((c) => c.trim()).length
  const matched = cols.filter(Boolean).length
  return matched >= 2 && matched * 2 >= named && cols.includes('title') ? cols : null
}

// ---------------------------------------------------------------------------
// Filter and counts
// ---------------------------------------------------------------------------

export interface TestFilter {
  q: string
  type: string
  level: string
  /** A status, or 'none' for not run yet. */
  status: TestStatus | 'none' | ''
  area: string
  /** An issue key. */
  issue: string
}

export const EMPTY_TEST_FILTER: TestFilter = { q: '', type: '', level: '', status: '', area: '', issue: '' }

/** The URL form. `for` is the issue (`?issue=` opens the issue dialog). */
export function testFilterFromParams(params: URLSearchParams): TestFilter {
  const status = params.get('status') ?? ''
  return {
    q: params.get('q') ?? '',
    type: params.get('type') ?? '',
    level: params.get('level') ?? '',
    status: ([...TEST_STATUSES, 'none'] as string[]).includes(status) ? (status as TestFilter['status']) : '',
    area: params.get('area') ?? '',
    issue: (params.get('for') ?? '').toUpperCase(),
  }
}

export function testFilterToParams(f: TestFilter) {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.type) p.set('type', f.type)
  if (f.level) p.set('level', f.level)
  if (f.status) p.set('status', f.status)
  if (f.area) p.set('area', f.area)
  if (f.issue) p.set('for', f.issue)
  return p
}

export const isFiltered = (f: TestFilter) => Object.values(f).some(Boolean)

export function matchesTestCase(c: TestCase, f: TestFilter, issueKey?: (id: string) => string | undefined) {
  if (f.type && c.type !== f.type) return false
  if (f.level && c.level !== f.level) return false
  if (f.status && (c.last_status ?? 'none') !== f.status) return false
  if (f.area && !c.areas.some((a) => a.toLowerCase() === f.area.toLowerCase())) return false
  const key = c.issue_id ? issueKey?.(c.issue_id) : undefined
  if (f.issue && key !== f.issue) return false
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length) {
    const hay = [c.key, c.title, c.description, c.expected, c.type, c.level, c.areas.join(' '), key, c.last_reason]
      .filter(Boolean).join(' ').toLowerCase()
    if (!words.every((w) => hay.includes(w))) return false
  }
  return true
}

export interface TestCounts {
  total: number
  pass: number
  fail: number
  blocked: number
  skipped: number
  none: number
}

/** How many cases stand at each latest result. */
export function testCounts(cases: Pick<TestCase, 'last_status'>[]): TestCounts {
  const counts: TestCounts = { total: cases.length, pass: 0, fail: 0, blocked: 0, skipped: 0, none: 0 }
  for (const c of cases) counts[c.last_status ?? 'none']++
  return counts
}

/** Where a project keeps the environment you last recorded on, in this browser. */
export const environmentKey = (projectId: string) => `elevance.work.test-env.${projectId}`

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export type TestGroupBy = 'type' | 'level' | 'area' | 'issue'
export const TEST_GROUP_BYS: TestGroupBy[] = ['type', 'level', 'area', 'issue']
export const TEST_GROUP_LABELS: Record<TestGroupBy, string> = { type: 'Type', level: 'Level', area: 'Impacted area', issue: 'Issue' }

export interface TestGroup {
  /** Unique among the groups: `type:UI`, `none`… */
  key: string
  label: string
  /** The issue's key, grouping by issue. */
  issueKey?: string
  /** In the order they came (by rank). */
  cases: TestCase[]
}

/** `?group=` in the address. */
export function groupFromParams(params: URLSearchParams): TestGroupBy | null {
  const g = params.get('group')
  return TEST_GROUP_BYS.includes(g as TestGroupBy) ? (g as TestGroupBy) : null
}

/**
 * Cases in groups: types and levels in the project's list order (values
 * since taken off the list after, by name), areas by name, issues by number.
 * A case with several areas is in each of their groups. Cases with none
 * come last.
 */
export function groupTestCases(
  cases: TestCase[],
  by: TestGroupBy,
  ctx: { types: string[]; levels: string[]; issue: (id: string) => { key: string; title: string } | undefined },
): TestGroup[] {
  const groups = new Map<string, TestGroup>()
  const add = (key: string, label: string, c: TestCase, issueKey?: string) => {
    const g = groups.get(key) ?? { key, label, cases: [], ...(issueKey ? { issueKey } : {}) }
    g.cases.push(c)
    groups.set(key, g)
  }
  const none = { type: 'No type', level: 'No level', area: 'No area', issue: 'No issue' }[by]
  for (const c of cases) {
    if (by === 'type' || by === 'level') {
      const v = c[by]
      if (v) add(`${by}:${v}`, v, c)
      else add('none', none, c)
    } else if (by === 'area') {
      if (!c.areas.length) add('none', none, c)
      for (const a of c.areas) add(`area:${a.toLowerCase()}`, a, c)
    } else if (c.issue_id) {
      const issue = ctx.issue(c.issue_id)
      add(`issue:${c.issue_id}`, issue ? `${issue.key} ${issue.title}` : '…', c, issue?.key)
    } else {
      add('none', none, c)
    }
  }
  const list = by === 'type' ? ctx.types : by === 'level' ? ctx.levels : []
  const order = (g: TestGroup) => {
    if (g.key === 'none') return [2, 0, '']
    if (by === 'issue') return [0, Number(g.issueKey?.split('-').at(-1) ?? Infinity), g.label]
    const at = list.indexOf(g.label)
    return at >= 0 ? [0, at, ''] : [1, 0, g.label.toLowerCase()]
  }
  return [...groups.values()].sort((a, b) => {
    const [x, y] = [order(a), order(b)]
    return (x[0] as number) - (y[0] as number) || (x[1] as number) - (y[1] as number) || String(x[2]).localeCompare(String(y[2]))
  })
}

// ---------------------------------------------------------------------------
// Runs and scripts
// ---------------------------------------------------------------------------

/** A run's counts as the counts bar draws them (what wasn't recorded, if anything, as not run). */
export function runCounts(r: Pick<TestRun, 'total' | 'passed' | 'failed' | 'blocked' | 'skipped'>): TestCounts {
  return { total: r.total, pass: r.passed, fail: r.failed, blocked: r.blocked, skipped: r.skipped,
    none: Math.max(0, r.total - r.passed - r.failed - r.blocked - r.skipped) }
}

/** How long a finished run took: "42 s", "3 min", "1 h 5 min". */
export function runDuration(r: Pick<TestRun, 'started_at' | 'finished_at'>) {
  if (!r.finished_at) return ''
  const s = Math.max(0, Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** Who ran it: "Sara Iqbal (local)", or "Cloud". */
export const runnerLabel = (r: Pick<TestRun, 'mode'>, name: string | undefined) =>
  r.mode === 'cloud' ? 'Cloud' : `${name ?? 'Someone'} (local)`

/** The script that automates a case, as the sheet shows it: its file (in its repo). */
export function scriptLabel(c: Pick<TestCase, 'script_repo' | 'script_path'>) {
  if (!c.script_path) return ''
  const file = c.script_path.split('/').at(-1)
  return c.script_repo ? `${file} (${c.script_repo})` : file ?? ''
}

/** Edited since its script was linked: the script may need to follow. */
export const scriptStale = (c: Pick<TestCase, 'automated_at' | 'updated_at'>) =>
  !!c.automated_at && c.updated_at > c.automated_at
