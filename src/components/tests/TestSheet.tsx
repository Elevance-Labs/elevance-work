// Test cases as a spreadsheet: the way QA already work in Google Sheets.
// Click or arrow to a cell, type to replace it (Enter or F2 to edit it),
// Enter saves and goes down, Tab goes right. Copy and paste work with
// Google Sheets in both directions: a pasted block fills the cells from the
// one selected, adding cases past the last row, and a pasted header row
// (Summary, Expected result, Type…) maps the columns by name. The Status
// column records a result: P, F, B or S on any number of selected cases.
// Rows are dragged by their number (or Alt+Shift+arrows); Cmd/Ctrl+Z undoes.
// Grouped (by type, level, area or issue), each group has a header row that
// folds it away or selects its cases; a case with several areas is under
// each, and a case moves only within its group.
//
// Focus lives in one hidden textarea while you move about, so the keyboard,
// copy, cut and paste reach the sheet in every browser; an editor opens over
// the cell being changed. Every change saves itself (useTestCases).
import {
  Fragment, memo, useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import HistoryIcon from '@mui/icons-material/History'
import KeyboardIcon from '@mui/icons-material/KeyboardOutlined'
import UndoIcon from '@mui/icons-material/Undo'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { timeAgo, formatDayTime } from '../../lib/constants'
import { isMac } from '../../lib/search'
import {
  SHEET_COLUMNS,
  STATUS_SHORTCUT,
  TEST_STATUSES,
  TEST_STATUS_LABELS,
  TEST_STATUS_SHORTCUTS,
  cellText,
  headerColumns,
  knownAreas,
  needsReason,
  parseCell,
  parseIssueRef,
  parseStatus,
  parseTsv,
  scriptLabel,
  scriptStale,
  testCounts,
  toTsv,
  type ParseContext,
  type TestGroup,
  type SheetColumn,
  type TestCaseWrite,
} from '../../lib/testCases'
import type { Project, TestCase, TestStatus } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { ConfirmDialog } from '../common'
import { useIssueHref } from '../useIssueHref'
import { AreasEditor, ChoiceEditor, TextEditor, type Move } from './editors'
import { CountsBar, ResultHistory, StatusPill } from './TestBits'
import { isTmp, type TestCasesState } from './useTestCases'

const ROW_HEADER = 52
const ROW_HEIGHT = 36
const WIDTHS_KEY = 'elevance.work.test-sheet.widths'
const NEW = 'new'

interface Pos {
  r: number
  c: number
}
interface Selection {
  active: Pos
  anchor: Pos
}
interface Edit {
  /** The row's uid (a case is in several groups by area), or NEW. */
  id: string
  c: number
  initial: string
  typed: boolean
}
interface CellEdit {
  r: number
  col: SheetColumn
  text: string
}
interface Undo {
  label: string
  run: () => Promise<unknown>
}

function loadWidths(): Partial<Record<SheetColumn, number>> {
  try {
    return JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey

export interface TestSheetProps {
  project: Project
  /** Members and admins write and record; viewers read and copy. */
  editable: boolean
  data: TestCasesState
  /** The cases shown, in order (a filter may hide some). */
  rows: TestCase[]
  /** The same cases in groups, shown under a header each (instead of `rows`). */
  groups?: TestGroup[]
  columns: SheetColumn[]
  /** What results are recorded on. */
  environment: string | null
  /** Long text shown in full rather than one line. */
  wrap?: boolean
  label: string
  maxHeight?: number | string
  /** What a new case starts with (the issue it's for). */
  defaults?: TestCaseWrite
  /** Open on the new case's summary, ready to type. */
  autoStart?: boolean
}

export default function TestSheet({
  project, editable, data, rows: given, groups, columns, environment, wrap = false, label, maxHeight = '70vh', defaults, autoStart = false,
}: TestSheetProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // The rows as drawn: each with a uid (its group and id) and its group.
  const entries = useMemo(() => groups
    ? groups.flatMap((g) => (collapsed.has(g.key) ? [] : g.cases.map((row) => ({ row, uid: `${g.key}\u0000${row.id}`, group: g.key }))))
    : given.map((row) => ({ row, uid: row.id, group: null as string | null })), [groups, given, collapsed])
  const rows = useMemo(() => entries.map((e) => e.row), [entries])
  const uids = useMemo(() => entries.map((e) => e.uid), [entries])
  const theme = useTheme()
  const sink = useRef<HTMLTextAreaElement>(null)
  const table = useRef<HTMLTableElement>(null)
  // The selection, with the id of its active row when it was made: when
  // rows come or go above it, the selection moves with its row.
  const [sel, setSelState] = useState<Selection & { id: string | null }>({ active: { r: 0, c: 1 }, anchor: { r: 0, c: 1 }, id: null })
  const shown = useRef({ uids, editable })
  useEffect(() => {
    shown.current = { uids, editable }
  })
  const setSel = useCallback((next: Selection | ((s: Selection) => Selection)) => {
    setSelState((s) => {
      const n = typeof next === 'function' ? next(s) : next
      if (n === s) return s
      const { uids: list, editable: canAdd } = shown.current
      return { ...n, id: n.active.r === list.length && canAdd ? NEW : list[n.active.r] ?? null }
    })
  }, [])
  const [edit, setEdit] = useState<Edit | null>(null)
  const [focused, setFocused] = useState(false)
  const [statusMenu, setStatusMenu] = useState<HTMLElement | null>(null)
  const [context, setContext] = useState<{ x: number; y: number } | null>(null)
  const [reasonFor, setReasonFor] = useState<{ anchor: HTMLElement; cases: { id: string; key: string }[]; status: TestStatus } | null>(null)
  const [historyOf, setHistoryOf] = useState<{ anchor: HTMLElement; row: TestCase } | null>(null)
  const [deleting, setDeleting] = useState<TestCase[] | null>(null)
  const [help, setHelp] = useState<HTMLElement | null>(null)
  const [widths, setWidths] = useState(loadWidths)
  const undoStack = useRef<Undo[]>([])
  const [undoLabel, setUndoLabel] = useState<string | null>(null)
  const dragSelecting = useRef(false)
  const touch = useRef(false)

  const nRows = rows.length + (editable ? 1 : 0)
  const nCols = columns.length
  const titleC = columns.indexOf('title')
  const ctx: ParseContext = useMemo(
    () => ({ types: project.test_types, levels: project.test_levels, areas: knownAreas(data.cases ?? []) }),
    [project.test_types, project.test_levels, data.cases],
  )

  const indexOf = useCallback((uid: string) => (uid === NEW ? uids.length : uids.indexOf(uid)), [uids])

  // The selection follows its row when rows above it come or go. The
  // new-case row doesn't pull it along: a case just added takes its place.
  useEffect(() => {
    setSelState((s) => {
      const r = s.id && s.id !== NEW ? indexOf(s.id) : -1
      if (r >= 0 && r !== s.active.r) {
        const d = r - s.active.r
        return { ...s, active: { ...s.active, r }, anchor: { ...s.anchor, r: s.anchor.r + d } }
      }
      const max = Math.max(0, nRows - 1)
      return s.active.r > max || s.anchor.r > max
        ? { ...s, active: { ...s.active, r: Math.min(s.active.r, max) }, anchor: { ...s.anchor, r: Math.min(s.anchor.r, max) } }
        : s
    })
  }, [indexOf, nRows])

  const r1 = Math.min(sel.active.r, sel.anchor.r)
  const r2 = Math.max(sel.active.r, sel.anchor.r)
  const c1 = Math.min(sel.active.c, sel.anchor.c)
  const c2 = Math.max(sel.active.c, sel.anchor.c)
  // Each case once, though it may be in two groups.
  const selectedCases = [...new Map(rows.slice(r1, Math.min(r2, rows.length - 1) + 1).map((c) => [c.id, c])).values()]
  const activeCol = columns[sel.active.c]

  const cellEl = (r: number, c: number) => table.current?.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`) ?? null
  const refocus = () => sink.current?.focus({ preventScroll: true })

  useEffect(() => {
    cellEl(sel.active.r, sel.active.c)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [sel.active.r, sel.active.c])

  useEffect(() => {
    if (!autoStart || !editable || titleC < 0) return
    select({ r: rows.length, c: titleC })
    setEdit({ id: NEW, c: titleC, initial: '', typed: false })
    // Once, on mount.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Moving about
  // ---------------------------------------------------------------------------

  const clampPos = (p: Pos, grow = false): Pos => ({
    r: Math.max(0, Math.min(nRows - (grow ? 0 : 1), p.r)),
    c: Math.max(0, Math.min(nCols - 1, p.c)),
  })
  const select = (p: Pos, extend = false, grow = false) => {
    const active = clampPos(p, grow)
    setSel((s) => ({ active, anchor: extend ? s.anchor : active }))
  }
  const step = (from: Pos, move: Move, grow = false) => {
    const d = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1], none: [0, 0] }[move]
    select({ r: from.r + d[0], c: from.c + d[1] }, false, grow)
  }

  const pushUndo = (u: Undo) => {
    undoStack.current = [...undoStack.current.slice(-49), u]
    setUndoLabel(u.label)
  }
  async function undo() {
    const u = undoStack.current.pop()
    setUndoLabel(undoStack.current.at(-1)?.label ?? null)
    if (u) await u.run()
  }

  // ---------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------

  /**
   * Write cells: each row's changes in one update, rows past the end as new
   * cases (they need a summary), statuses as results (a failure with the
   * reason beside it). One undo for the lot.
   */
  async function applyEdits(edits: CellEdit[]) {
    if (!editable || !edits.length) return
    const errors: string[] = []
    const byRow = new Map<number, CellEdit[]>()
    for (const e of edits) byRow.set(e.r, [...(byRow.get(e.r) ?? []), e])
    const entries = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([r, list]) => {
      const row = rows[r] as TestCase | undefined
      const patch: TestCaseWrite = {}
      let issueRef: string | null | undefined
      let statusText: string | undefined
      let reasonText = ''
      for (const { col, text } of list) {
        // The database's: a key, a linked script.
        if (col === 'key' || col === 'script') continue
        if (col === 'status') statusText = text
        else if (col === 'result') reasonText = text
        else if (col === 'issue') {
          const ref = parseIssueRef(text, project.key)
          if (ref === undefined) errors.push(`"${text.trim()}" isn't an issue key.`)
          else issueRef = ref
        } else if (col === 'title' && row && !text.trim()) {
          // A summary is never cleared.
          continue
        } else {
          const p = parseCell(col, text, ctx)
          if (p.ok) Object.assign(patch, p.value)
          else errors.push(p.error)
        }
      }
      return { row, patch, issueRef, statusText, reasonText }
    })

    // Issue keys to ids, each looked up once.
    const keys = [...new Set(entries.map((e) => e.issueRef).filter((k): k is string => !!k))]
    const found = new Map<string, string>()
    await Promise.all(keys.map(async (k) => {
      const issue = await data.findIssue(k)
      if (issue) found.set(k, issue.id)
      else errors.push(`There's no issue ${k} in ${project.name}.`)
    }))
    for (const e of entries) {
      if (e.issueRef === null) e.patch.issue_id = null
      else if (e.issueRef && found.has(e.issueRef)) e.patch.issue_id = found.get(e.issueRef)!
    }

    // Results to record: by status and reason, so a block of passes is one write.
    const records = new Map<string, { status: TestStatus; reason: string; targets: (TestCase | number)[] }>()
    entries.forEach((e, i) => {
      if (e.statusText === undefined) return
      const status = parseStatus(e.statusText)
      if (status === undefined) return errors.push(`"${e.statusText.trim()}" isn't a status (Pass, Fail, Blocked or Skipped).`)
      if (status === null) return
      const reason = e.reasonText.trim()
      if (needsReason(status) && !reason) return errors.push(`Say why ${e.row?.key ?? 'each new case'} ${status === 'fail' ? 'failed' : 'is blocked'}.`)
      if (e.row && e.row.last_status === status && (e.row.last_reason ?? '') === reason) return
      const k = `${status}\u0000${reason}`
      const group = records.get(k) ?? { status, reason, targets: [] }
      group.targets.push(e.row ?? i)
      records.set(k, group)
    })

    const undos: (() => Promise<unknown>)[] = []
    const work: Promise<unknown>[] = []

    for (const e of entries) {
      if (!e.row) continue
      const changed = (Object.keys(e.patch) as (keyof TestCaseWrite)[]).filter((k) => !same(e.patch[k], e.row![k]))
      if (!changed.length) continue
      const patch = Object.fromEntries(changed.map((k) => [k, e.patch[k]])) as TestCaseWrite
      const before = Object.fromEntries(changed.map((k) => [k, e.row![k]])) as TestCaseWrite
      const id = e.row.id
      work.push(data.update(id, patch).then((ok) => ok && undos.push(() => data.update(id, before))))
    }

    const fresh = entries.map((e, i) => ({ e, i })).filter(({ e }) => !e.row)
    const creatable = fresh.filter(({ e }) => e.patch.title)
    if (creatable.length < fresh.length) {
      const n = fresh.length - creatable.length
      errors.push(`${n} new ${n === 1 ? 'row has' : 'rows have'} no summary, so ${n === 1 ? "it wasn't" : "they weren't"} added.`)
    }
    const createdIds = new Map<number, string>()
    if (creatable.length) {
      work.push(data.insert(creatable.map(({ e }) => ({ ...defaults, ...e.patch }))).then((ids) => {
        if (!ids) return
        creatable.forEach(({ i }, n) => createdIds.set(i, ids[n]))
        undos.push(() => data.remove(ids))
      }))
    }
    await Promise.all(work)

    for (const { status, reason, targets } of records.values()) {
      const ids = targets.map((t) => (typeof t === 'number' ? createdIds.get(t) : t.id)).filter((x): x is string => !!x)
      if (!ids.length) continue
      const resultIds = await data.record(ids, status, reason, environment)
      if (resultIds) undos.push(() => data.unrecord(resultIds, ids))
    }

    if (undos.length) {
      const n = edits.length
      pushUndo({ label: n === 1 ? 'the edit' : `the ${n} cell edits`, run: () => Promise.all(undos.map((u) => u())) })
    }
    if (errors.length) data.setError(errors[0] + (errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''))
  }

  async function recordStatus(cases: { id: string; key: string }[], status: TestStatus, reason = '') {
    if (!editable || !cases.length) return
    const ids = cases.map((c) => c.id)
    const resultIds = await data.record(ids, status, reason, environment)
    if (resultIds) {
      pushUndo({
        label: `marking ${cases.length === 1 ? cases[0].key : `${cases.length} cases`} ${TEST_STATUS_LABELS[status].toLowerCase()}`,
        run: () => data.unrecord(resultIds, ids),
      })
    }
  }

  /** Record from the toolbar, a menu or a key: a failure or a block asks why first. */
  function mark(status: TestStatus, cases = selectedCases) {
    if (!editable || !cases.length) return
    if (needsReason(status)) {
      const anchor = cellEl(sel.active.r, columns.includes('status') ? columns.indexOf('status') : sel.active.c) ?? table.current
      if (anchor) setReasonFor({ anchor, cases: cases.map((c) => ({ id: c.id, key: c.key })), status })
    } else {
      recordStatus(cases, status)
    }
  }

  async function moveRow(from: number, to: number) {
    const moving = rows[from]
    if (!editable || !moving || to < 0 || to >= rows.length || from === to) return
    // Within its group: the group is a value of the case, not a place.
    if (entries[from].group !== entries[to].group) return
    const others = rows.filter((_, i) => i !== from)
    const oldRank = moving.rank
    if (await data.move(moving.id, others[to - 1]?.id ?? null, others[to]?.id ?? null)) {
      pushUndo({ label: `moving ${moving.key}`, run: () => data.update(moving.id, { rank: oldRank }) })
    }
  }

  // ---------------------------------------------------------------------------
  // Editing a cell
  // ---------------------------------------------------------------------------

  function startEdit(p: Pos, typed?: string) {
    if (!editable) return
    let { r, c } = p
    // A new case starts with its summary.
    if (r === rows.length && titleC >= 0) {
      c = titleC
      select({ r, c })
    }
    const col = columns[c]
    const row = rows[r]
    if (col === 'status') {
      if (row) setStatusMenu(cellEl(r, c))
      return
    }
    if (col === 'result' || col === 'key') {
      if (row && !typed) setHistoryOf({ anchor: cellEl(r, c)!, row })
      return
    }
    if (!SHEET_COLUMNS[col].editable) return
    setEdit({ id: uids[r] ?? NEW, c, initial: typed ?? (row ? cellText(row, col, data.issueKey) : ''), typed: typed !== undefined })
  }

  function commitEdit(text: string, move: Move) {
    const e = edit
    if (!e) return
    setEdit(null)
    const r = indexOf(e.id)
    const col = columns[e.c]
    const row = rows[r]
    const before = row ? cellText(row, col, data.issueKey) : ''
    const creating = !row && !!text.trim()
    step({ r, c: e.c }, move, creating)
    refocus()
    if (r < 0 || (row && text === before) || (!row && !text.trim())) return
    applyEdits([{ r, col, text }])
  }

  function cancelEdit() {
    setEdit(null)
    refocus()
  }

  // ---------------------------------------------------------------------------
  // Copy, cut, paste, clear
  // ---------------------------------------------------------------------------

  function selectionText() {
    const lines: string[][] = []
    for (let r = r1; r <= Math.min(r2, rows.length - 1); r++) {
      const line: string[] = []
      for (let c = c1; c <= c2; c++) line.push(cellText(rows[r], columns[c], data.issueKey))
      lines.push(line)
    }
    if (lines.length === 1 && lines[0].length === 1) return lines[0][0]
    return toTsv(lines)
  }

  function clearSelection() {
    const edits: CellEdit[] = []
    for (let r = r1; r <= Math.min(r2, rows.length - 1); r++) {
      for (let c = c1; c <= c2; c++) {
        const col = columns[c]
        if (SHEET_COLUMNS[col].editable && col !== 'title' && cellText(rows[r], col, data.issueKey)) edits.push({ r, col, text: '' })
      }
    }
    applyEdits(edits)
  }

  function onCopy(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (edit) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', selectionText())
  }

  function onCut(e: ClipboardEvent<HTMLTextAreaElement>) {
    onCopy(e)
    if (editable && !edit) clearSelection()
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (edit) return
    e.preventDefault()
    if (!editable) return
    paste(e.clipboardData.getData('text/plain'))
  }

  function paste(text: string) {
    let matrix = parseTsv(text).filter((line) => line.some((cell) => cell.trim()))
    if (!matrix.length) return
    const edits: CellEdit[] = []
    const header = headerColumns(matrix[0])
    const allowed = new Set<SheetColumn>([...columns, 'status', 'result'])
    if (header) {
      // A sheet with its header: columns by name; a row whose ID is one of
      // these cases updates it, any other row is a new case.
      matrix = matrix.slice(1)
      const keyAt = header.indexOf('key')
      let next = rows.length
      for (const line of matrix) {
        const key = keyAt >= 0 ? line[keyAt]?.trim().toUpperCase() : ''
        const existing = key ? rows.findIndex((x) => x.key === key) : -1
        const r = existing >= 0 ? existing : next++
        header.forEach((col, i) => {
          if (col && allowed.has(col) && line[i] !== undefined) edits.push({ r, col, text: line[i] })
        })
      }
      if (next > rows.length) select({ r: next, c: Math.max(0, titleC) }, false, true)
    } else if (matrix.length === 1 && matrix[0].length === 1 && (r1 !== r2 || c1 !== c2)) {
      // One value into a block fills it.
      for (let r = r1; r <= Math.min(r2, rows.length - 1); r++) for (let c = c1; c <= c2; c++) edits.push({ r, col: columns[c], text: matrix[0][0] })
    } else {
      matrix.forEach((line, i) => line.forEach((cell, j) => {
        const c = c1 + j
        if (c < nCols) edits.push({ r: r1 + i, col: columns[c], text: cell })
      }))
      setSel({ anchor: { r: r1, c: c1 }, active: clampPos({ r: r1 + matrix.length - 1, c: c1 + Math.max(...matrix.map((l) => l.length)) - 1 }, true) })
    }
    applyEdits(edits)
  }

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (edit) return
    const { active } = sel
    const key = e.key
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (mod(e) && !e.shiftKey && key.toLowerCase() === 'z') {
      handled()
      return void undo()
    }
    if (mod(e) && key.toLowerCase() === 'a') {
      handled()
      return setSel({ anchor: { r: 0, c: 0 }, active: { r: Math.max(0, rows.length - 1), c: nCols - 1 } })
    }
    if (mod(e) && (key === 'Backspace' || key === 'Delete')) {
      handled()
      if (editable && selectedCases.length) setDeleting(selectedCases)
      return
    }
    if (mod(e) && ['c', 'x'].includes(key.toLowerCase())) {
      // The browser copies whatever is selected in the sink: put the cells there.
      const el = e.currentTarget
      el.value = selectionText()
      el.select()
      setTimeout(() => (el.value = ''), 0)
      return
    }
    if (mod(e) && key.toLowerCase() === 'v') return
    if (e.altKey && e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      handled()
      const to = active.r + (key === 'ArrowUp' ? -1 : 1)
      if (active.r < rows.length && to >= 0 && to < rows.length && entries[to].group === entries[active.r].group) {
        moveRow(active.r, to)
        select({ r: to, c: active.c })
      }
      return
    }
    const arrows: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }
    if (arrows[key]) {
      handled()
      const [dr, dc] = arrows[key]
      const to = mod(e)
        ? { r: dr ? (dr > 0 ? nRows - 1 : 0) : active.r, c: dc ? (dc > 0 ? nCols - 1 : 0) : active.c }
        : { r: active.r + dr, c: active.c + dc }
      return select(to, e.shiftKey)
    }
    if (key === 'Tab') {
      handled()
      const c = active.c + (e.shiftKey ? -1 : 1)
      if (c >= nCols) return select({ r: active.r + 1, c: 0 })
      if (c < 0) return select({ r: active.r - 1, c: nCols - 1 })
      return select({ r: active.r, c })
    }
    if (key === 'Home' || key === 'End') {
      handled()
      return select({ r: mod(e) ? (key === 'Home' ? 0 : nRows - 1) : active.r, c: key === 'Home' ? 0 : nCols - 1 }, e.shiftKey)
    }
    if (key === 'Enter' || key === 'F2') {
      handled()
      if (key === 'Enter' && e.shiftKey) return select({ r: active.r - 1, c: active.c })
      return startEdit(active)
    }
    if (key === 'Escape') {
      // With one cell selected, Escape is the page's (it closes the issue dialog).
      if (r1 === r2 && c1 === c2) return
      handled()
      return setSel((s) => ({ ...s, anchor: s.active }))
    }
    if (key === 'Delete' || key === 'Backspace') {
      handled()
      return clearSelection()
    }
    if (key.length === 1 && !mod(e) && !e.altKey) {
      if (activeCol === 'status') {
        const status = TEST_STATUS_SHORTCUTS[key.toLowerCase()]
        if (status) {
          handled()
          mark(status)
        }
        return
      }
      if (key === ' ' && activeCol !== 'title' && activeCol !== 'description' && activeCol !== 'expected') return
      if (editable && (SHEET_COLUMNS[activeCol].editable || active.r === rows.length)) {
        handled()
        startEdit(active, key)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------------

  const posOf = (target: EventTarget) => {
    const td = (target as HTMLElement).closest?.('td[data-r]')
    return td ? { r: Number(td.getAttribute('data-r')), c: Number(td.getAttribute('data-c')) } : null
  }

  function onCellMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('a, button, [data-editor]')) return
    const p = posOf(target)
    if (!p || e.button === 2) return
    e.preventDefault()
    if (edit) commitPending()
    const again = !e.shiftKey && p.r === sel.active.r && p.c === sel.active.c && r1 === r2 && c1 === c2
    select(p, e.shiftKey)
    dragSelecting.current = true
    refocus()
    // On a touch screen a second tap on the cell edits it.
    if (again && touch.current) startEdit(p)
  }

  function onCellMouseOver(e: MouseEvent) {
    if (!dragSelecting.current || !(e.buttons & 1)) return
    const p = posOf(e.target)
    if (p) setSel((s) => (s.active.r === p.r && s.active.c === p.c ? s : { ...s, active: p }))
  }

  useEffect(() => {
    const up = () => (dragSelecting.current = false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  function onContextMenu(e: MouseEvent) {
    const p = posOf(e.target)
    if (!p || p.r >= rows.length) return
    e.preventDefault()
    if (p.r < r1 || p.r > r2 || p.c < c1 || p.c > c2) select(p)
    refocus()
    setContext({ x: e.clientX, y: e.clientY })
  }

  /** A click elsewhere while editing: the editor's blur commits it. */
  const commitPending = () => (document.activeElement as HTMLElement | null)?.blur?.()

  const selectRows = useCallback((r: number, extend: boolean) => {
    setSel((s) => ({ anchor: extend ? { r: s.anchor.r, c: 0 } : { r, c: 0 }, active: { r, c: nCols - 1 } }))
    sink.current?.focus({ preventScroll: true })
  }, [nCols, setSel])
  function selectColumn(c: number, extend: boolean) {
    setSel((s) => ({ anchor: { r: 0, c: extend ? s.anchor.c : c }, active: { r: Math.max(0, rows.length - 1), c } }))
    refocus()
  }

  // Column widths, dragged at a header's right edge and kept in this browser.
  function startResize(col: SheetColumn, e: ReactPointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widths[col] ?? SHEET_COLUMNS[col].width
    const moveTo = (ev: PointerEvent) => setWidths((w) => ({ ...w, [col]: Math.max(64, Math.min(800, startW + ev.clientX - startX)) }))
    const stop = () => {
      window.removeEventListener('pointermove', moveTo)
      window.removeEventListener('pointerup', stop)
      setWidths((w) => {
        try {
          localStorage.setItem(WIDTHS_KEY, JSON.stringify(w))
        } catch {
          // Kept for this visit only.
        }
        return w
      })
    }
    window.addEventListener('pointermove', moveTo)
    window.addEventListener('pointerup', stop)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = uids.indexOf(String(active.id))
    const to = uids.indexOf(String(over.id))
    if (from >= 0 && to >= 0 && entries[from].group === entries[to].group) {
      moveRow(from, to)
      select({ r: to, c: sel.active.c })
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  const width = (col: SheetColumn) => widths[col] ?? SHEET_COLUMNS[col].width
  const tableWidth = ROW_HEADER + columns.reduce((sum, col) => sum + width(col), 0)
  const editRow = edit ? indexOf(edit.id) : -1

  function editorFor(e: Edit): ReactNode {
    const col = columns[e.c]
    const props = { label: SHEET_COLUMNS[col].label, initial: e.initial, typed: e.typed, onCommit: commitEdit, onCancel: cancelEdit }
    if (col === 'type') return <ChoiceEditor {...props} options={project.test_types} />
    if (col === 'level') return <ChoiceEditor {...props} options={project.test_levels} />
    if (col === 'areas') return <AreasEditor {...props} known={ctx.areas} />
    return <TextEditor {...props} multiline={SHEET_COLUMNS[col].multiline} minWidth={SHEET_COLUMNS[col].multiline ? 360 : undefined} />
  }

  const selectedBg = alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08)
  const headerBg = theme.palette.background.subtle
  const wholeRowBg = alpha(theme.palette.primary.main, 0.18)
  const many = selectedCases.length > 1
  const modKey = isMac() ? '⌘' : 'Ctrl+'

  return (
    <Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', rowGap: 0.5, minHeight: 36 }}>
        {editable && (
          <>
            <Typography variant="body2" sx={{ color: 'text.secondary', mr: 0.5 }}>
              {selectedCases.length ? `Mark ${many ? `${selectedCases.length} cases` : selectedCases[0].key}:` : 'Mark:'}
            </Typography>
            {TEST_STATUSES.map((s) => (
              <Tooltip key={s} title={`${TEST_STATUS_LABELS[s]} (${STATUS_SHORTCUT[s]} in the Status column)`}>
                <span>
                  <Button size="small" variant="outlined" color={s === 'pass' ? 'success' : s === 'fail' ? 'error' : s === 'blocked' ? 'warning' : 'inherit'}
                    disabled={!selectedCases.length} onMouseDown={(e) => e.preventDefault()} onClick={() => mark(s)}
                    sx={{ minWidth: 0, px: 1, py: 0.25 }}>
                    {TEST_STATUS_LABELS[s]}
                  </Button>
                </span>
              </Tooltip>
            ))}
            <Tooltip title={`Delete ${many ? 'these cases' : 'this case'} (${modKey}Delete)`}>
              <span>
                <IconButton size="small" aria-label="Delete test cases" disabled={!selectedCases.length}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => setDeleting(selectedCases)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" role="status" sx={{ color: 'text.secondary', mr: 0.5 }}>
          {data.saving ? 'Saving…' : editable && data.cases?.length ? 'All changes saved' : ''}
        </Typography>
        {editable && (
          <Tooltip title={undoLabel ? `Undo ${undoLabel} (${modKey}Z)` : 'Nothing to undo'}>
            <span>
              <IconButton size="small" aria-label="Undo" disabled={!undoLabel} onMouseDown={(e) => e.preventDefault()} onClick={() => undo()}>
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title="Keyboard shortcuts">
          <IconButton size="small" aria-label="Keyboard shortcuts" onClick={(e) => setHelp(e.currentTarget)}>
            <KeyboardIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Box sx={{ position: 'relative' }}>
        {/* Where focus lives while moving about: keys, copy, cut and paste land here. */}
        <textarea ref={sink} aria-label={label} aria-roledescription="spreadsheet" inputMode="none" autoComplete="off" spellCheck={false}
          onKeyDown={onKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste}
          onInput={(e) => (e.currentTarget.value = '')}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0, padding: 0, border: 0, resize: 'none', pointerEvents: 'none' }} />
        <Box sx={{ overflow: 'auto', maxHeight, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper',
          overscrollBehavior: 'contain' }}
          onPointerDown={(e) => (touch.current = e.pointerType === 'touch')}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <Box component="table" ref={table} role="grid" aria-label={label} aria-rowcount={nRows + 1} aria-colcount={nCols}
              sx={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, width: tableWidth, typography: 'body2',
                '& td, & th': { borderRight: 1, borderBottom: 1, borderColor: 'divider', p: 0, height: ROW_HEIGHT, verticalAlign: 'top',
                  scrollMarginTop: `${ROW_HEIGHT + 4}px`, scrollMarginLeft: `${ROW_HEADER + 4}px` } }}>
              <colgroup>
                <col style={{ width: ROW_HEADER }} />
                {columns.map((col) => <col key={col} style={{ width: width(col) }} />)}
              </colgroup>
              <thead>
                <tr>
                  <Box component="th" aria-label="Row" sx={{ position: 'sticky', top: 0, left: 0, zIndex: 3, bgcolor: headerBg }} />
                  {columns.map((col, c) => (
                    <Box component="th" key={col} scope="col" data-col={col}
                      onMouseDown={(e: MouseEvent) => {
                        e.preventDefault()
                        selectColumn(c, e.shiftKey)
                      }}
                      sx={{ position: 'sticky', top: 0, zIndex: 2, px: 1, textAlign: 'left', fontWeight: 600, color: 'text.secondary',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: `${ROW_HEIGHT}px`, cursor: 'default',
                        userSelect: 'none', bgcolor: c >= c1 && c <= c2 && focused ? alpha(theme.palette.primary.main, 0.14) : headerBg }}>
                      {SHEET_COLUMNS[col].label}
                      <Box onPointerDown={(e: ReactPointerEvent) => startResize(col, e)} aria-hidden
                        sx={{ position: 'absolute', top: 0, right: -3, width: 7, height: '100%', cursor: 'col-resize', zIndex: 1,
                          '&:hover': { bgcolor: 'primary.main', opacity: 0.4 } }} />
                    </Box>
                  ))}
                </tr>
              </thead>
              <tbody onMouseDown={onCellMouseDown} onMouseOver={onCellMouseOver} onContextMenu={onContextMenu}
                onDoubleClick={(e: MouseEvent) => {
                  const p = posOf(e.target)
                  if (p && !(e.target as HTMLElement).closest('a, [data-editor]')) startEdit(p)
                }}>
                <SortableContext items={uids} strategy={verticalListSortingStrategy}>
                  {(groups ?? [null]).map((g) => {
                    const lines = entries.map((e, r) => ({ ...e, r })).filter((e) => !g || e.group === g.key)
                    return (
                      <Fragment key={g?.key ?? 'all'}>
                        {g && (
                          <GroupHeader group={g} span={nCols + 1} collapsed={collapsed.has(g.key)} headerBg={headerBg}
                            onToggle={() => setCollapsed((set) => {
                              const next = new Set(set)
                              if (!next.delete(g.key)) next.add(g.key)
                              return next
                            })}
                            onSelect={() => {
                              if (!lines.length) return
                              setSel({ anchor: { r: lines[0].r, c: 0 }, active: { r: lines.at(-1)!.r, c: nCols - 1 } })
                              refocus()
                            }} />
                        )}
                        {lines.map(({ row, uid, r }) => {
                          const inRows = r >= r1 && r <= r2
                          return (
                            <SheetRow key={uid} uid={uid} row={row} r={r} columns={columns} wrap={wrap} editable={editable}
                              selFrom={inRows ? c1 : -1} selTo={inRows ? c2 : -1} activeC={focused && sel.active.r === r ? sel.active.c : null}
                              selectedBg={selectedBg} headerBg={inRows && c1 === 0 && c2 === nCols - 1 ? wholeRowBg : headerBg}
                              editing={editRow === r && edit ? { c: edit.c, node: editorFor(edit) } : null}
                              issueKey={data.issueKey} onRowHeader={selectRows} />
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </SortableContext>
                {editable && (
                  <tr data-row={NEW}>
                    <Box component="th" scope="row" sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: headerBg, color: 'text.disabled',
                      fontWeight: 400, textAlign: 'center', lineHeight: `${ROW_HEIGHT}px` }}>
                      +
                    </Box>
                    {columns.map((col, c) => {
                      const active = focused && sel.active.r === rows.length && sel.active.c === c
                      const editing = editRow === rows.length && edit?.c === c
                      return (
                        <Box component="td" key={col} data-r={rows.length} data-c={c} data-col={col}
                          sx={{ position: 'relative', px: 1, lineHeight: `${ROW_HEIGHT - 1}px`, color: 'text.disabled', cursor: 'cell',
                            outline: active ? 2 : 0, outlineColor: 'primary.main', outlineOffset: -2 }}>
                          {editing ? <Box data-editor>{editorFor(edit!)}</Box> : col === 'title' ? 'Add a test case…' : ''}
                        </Box>
                      )
                    })}
                  </tr>
                )}
                {!editable && !rows.length && (
                  <tr>
                    <td colSpan={nCols + 1}>
                      <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>No test cases yet.</Typography>
                    </td>
                  </tr>
                )}
              </tbody>
            </Box>
          </DndContext>
        </Box>
      </Box>

      <Menu open={!!statusMenu} anchorEl={statusMenu} onClose={() => { setStatusMenu(null); refocus() }}>
        {TEST_STATUSES.map((s) => (
          <MenuItem key={s} onClick={() => { setStatusMenu(null); refocus(); mark(s) }}>
            <ListItemText>{TEST_STATUS_LABELS[s]}</ListItemText>
            <Typography variant="caption" sx={{ color: 'text.secondary', ml: 3 }}>{STATUS_SHORTCUT[s]}</Typography>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem disabled={selectedCases.length !== 1} onClick={() => {
          setStatusMenu(null)
          if (selectedCases[0] && statusMenu) setHistoryOf({ anchor: statusMenu, row: selectedCases[0] })
        }}>
          <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Results…</ListItemText>
        </MenuItem>
      </Menu>

      <Menu open={!!context} onClose={() => { setContext(null); refocus() }} anchorReference="anchorPosition"
        anchorPosition={context ? { top: context.y, left: context.x } : undefined}>
        <MenuItem onClick={async () => {
          setContext(null)
          refocus()
          try {
            await navigator.clipboard.writeText(selectionText())
          } catch {
            // Refused: Cmd/Ctrl+C still works.
          }
        }}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Copy</ListItemText>
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 3 }}>{modKey}C</Typography>
        </MenuItem>
        {editable && <Divider />}
        {editable && TEST_STATUSES.map((s) => (
          <MenuItem key={s} onClick={() => { setContext(null); refocus(); mark(s) }}>
            <ListItemText inset>Mark {many ? `${selectedCases.length} cases` : ''} {TEST_STATUS_LABELS[s].toLowerCase()}</ListItemText>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem disabled={selectedCases.length !== 1} onClick={() => {
          setContext(null)
          const anchor = cellEl(sel.active.r, sel.active.c)
          if (anchor && selectedCases[0]) setHistoryOf({ anchor, row: selectedCases[0] })
        }}>
          <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Results…</ListItemText>
        </MenuItem>
        {editable && (
          <MenuItem onClick={() => { setContext(null); setDeleting(selectedCases) }} sx={{ color: 'error.main' }}>
            <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>Delete {many ? `${selectedCases.length} test cases` : 'test case'}</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {reasonFor && (
        <ReasonPopover anchor={reasonFor.anchor} status={reasonFor.status} count={reasonFor.cases.length} environment={environment}
          onCancel={() => { setReasonFor(null); refocus() }}
          onSave={(reason) => {
            setReasonFor(null)
            refocus()
            recordStatus(reasonFor.cases, reasonFor.status, reason)
          }} />
      )}

      {historyOf && (
        <ResultHistory anchor={historyOf.anchor} caseId={historyOf.row.id} caseKey={historyOf.row.key} data={data}
          onClose={() => { setHistoryOf(null); refocus() }} />
      )}

      <ConfirmDialog open={!!deleting} destructive confirmLabel="Delete"
        title={deleting?.length === 1 ? `Delete ${deleting[0].key}?` : `Delete ${deleting?.length} test cases?`}
        message="Their results go with them. This can't be undone."
        onClose={() => { setDeleting(null); refocus() }}
        onConfirm={() => {
          const ids = (deleting ?? []).map((x) => x.id)
          setDeleting(null)
          refocus()
          setSel((s) => ({ ...s, anchor: s.active }))
          data.remove(ids)
        }} />

      <Popover open={!!help} anchorEl={help} onClose={() => setHelp(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ p: 2, width: 400, maxWidth: 'calc(100vw - 32px)' }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Working in the sheet</Typography>
          {([
            ['Arrows, Tab', 'Move; with Shift, select'],
            ['Type, Enter, F2, double-click', 'Edit the cell'],
            ['Enter / Tab', 'Save and go down / right'],
            ['Shift+Enter', 'A new line (description, expected result)'],
            ['Esc', 'Cancel the edit'],
            ['P  F  B  S', 'In Status: pass, fail, blocked, skipped'],
            [`${modKey}C  ${modKey}X  ${modKey}V`, 'Copy, cut, paste: to and from Google Sheets'],
            ['Delete', 'Clear the cells'],
            [`${modKey}Delete`, 'Delete the selected cases'],
            ['Alt+Shift+↑↓', 'Move a case (or drag its number)'],
            [`${modKey}Z`, 'Undo'],
          ] as const).map(([keys, what]) => (
            <Stack key={keys} direction="row" spacing={2} sx={{ py: 0.25 }}>
              <Typography variant="body2" sx={{ width: 150, flexShrink: 0, fontFamily: 'monospace', fontSize: 12.5 }}>{keys}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{what}</Typography>
            </Stack>
          ))}
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1.5 }}>
            Pasting rows that start with a header row (Summary, Description, Expected result, Type, Level, Impacted areas, Status, Reason) adds
            them as new cases, matching the columns by name; a row whose ID is already here updates that case.
          </Typography>
        </Box>
      </Popover>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// A row
// ---------------------------------------------------------------------------

interface SheetRowProps {
  /** The row's own id: the case's, and its group's when grouped. */
  uid: string
  row: TestCase
  r: number
  columns: SheetColumn[]
  wrap: boolean
  editable: boolean
  /** The selected columns, if the row is in the selection (else -1). */
  selFrom: number
  selTo: number
  /** The active cell's column, if it's in this row. */
  activeC: number | null
  selectedBg: string
  headerBg: string
  editing: { c: number; node: ReactNode } | null
  issueKey: (id: string) => string | undefined
  onRowHeader: (r: number, extend: boolean) => void
}

const SheetRow = memo(function SheetRow({
  uid, row, r, columns, wrap, editable, selFrom, selTo, activeC, selectedBg, headerBg, editing, issueKey, onRowHeader,
}: SheetRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: uid, disabled: !editable || isTmp(row.id),
  })
  return (
    <Box component="tr" ref={setNodeRef} data-row={row.key} data-id={row.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      sx={{ position: 'relative', zIndex: isDragging ? 5 : undefined, opacity: isDragging ? 0.85 : 1 }}>
      <Box component="th" scope="row" aria-label={`Row ${r + 1}`}
        onMouseDown={(e: MouseEvent) => {
          if ((e.target as HTMLElement).closest('[data-handle]')) return
          e.preventDefault()
          onRowHeader(r, e.shiftKey)
        }}
        sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: headerBg, color: 'text.secondary',
          fontWeight: 400, fontSize: 12, textAlign: 'center', lineHeight: `${ROW_HEIGHT}px`, userSelect: 'none', cursor: 'default',
          '& [data-handle]': { opacity: 0 }, '&:hover [data-handle]': { opacity: 1 },
          '@media (hover: none)': { '& [data-handle]': { opacity: 1 } } }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'center', height: ROW_HEIGHT }}>
          {editable && (
            <Box component="span" data-handle ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Move ${row.key}`}
              sx={{ display: 'inline-flex', cursor: 'grab', color: 'text.disabled', touchAction: 'none', ml: -0.5 }}>
              <DragIndicatorIcon sx={{ fontSize: 16 }} />
            </Box>
          )}
          {r + 1}
        </Stack>
      </Box>
      {columns.map((col, c) => {
        const selected = c >= selFrom && c <= selTo && selFrom >= 0
        const active = activeC === c
        const isEditing = editing?.c === c
        return (
          <Box component="td" key={col} data-r={r} data-c={c} data-col={col} aria-selected={selected || undefined}
            sx={{ position: 'relative', cursor: 'cell', bgcolor: selected && !active ? selectedBg : undefined,
              outline: active ? 2 : 0, outlineColor: 'primary.main', outlineOffset: -2 }}>
            {isEditing ? <Box data-editor>{editing!.node}</Box> : <Cell row={row} col={col} wrap={wrap} issueKey={issueKey} />}
          </Box>
        )
      })}
    </Box>
  )
})

const textStyle = (wrap: boolean) => ({
  px: 1,
  py: '8px',
  lineHeight: '20px',
  minHeight: ROW_HEIGHT - 1,
  ...(wrap
    ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
    : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
}) as const

function IssueCell({ issueKey, wrap }: { issueKey: string | undefined; wrap: boolean }) {
  const href = useIssueHref()
  return (
    <Box sx={textStyle(wrap)}>
      {issueKey && (
        <Box component={Link} to={href(issueKey)}
          sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}>
          {issueKey}
        </Box>
      )}
    </Box>
  )
}

function ResultCell({ row, wrap }: { row: TestCase; wrap: boolean }) {
  const { profileById } = useWorkspace()
  const text = textStyle(wrap)
  if (!row.last_recorded_at) return <Box sx={text} />
  const who = profileById(row.last_recorded_by)?.full_name.split(' ')[0]
  const meta = `${who ?? 'Someone'}, ${timeAgo(row.last_recorded_at)}`
  return (
    <Box sx={text} title={`${row.last_reason ? `${row.last_reason}\n` : ''}${meta} · ${formatDayTime(row.last_recorded_at)}`}>
      {row.last_reason}
      <Box component="span" sx={{ color: 'text.secondary', fontSize: 12, ml: row.last_reason ? 1 : 0 }}>{row.last_reason ? `— ${meta}` : meta}</Box>
    </Box>
  )
}

/** A group's header: folds it, selects its cases, and says how they stand. */
function GroupHeader({ group, span, collapsed, headerBg, onToggle, onSelect }: {
  group: TestGroup
  span: number
  collapsed: boolean
  headerBg: string
  onToggle: () => void
  onSelect: () => void
}) {
  const href = useIssueHref()
  const counts = testCounts(group.cases)
  return (
    <tr data-group={group.key}>
      <Box component="td" colSpan={span} sx={{ bgcolor: headerBg }}>
        <Stack direction="row" spacing={1} sx={{ position: 'sticky', left: 0, width: 'fit-content', maxWidth: '100vw', alignItems: 'center',
          px: 0.5, minHeight: ROW_HEIGHT }}>
          <IconButton size="small" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.label}`} aria-expanded={!collapsed}
            onMouseDown={(e) => e.preventDefault()} onClick={onToggle}>
            {collapsed ? <ChevronRightIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
          <Tooltip title="Select these cases">
            <Box component="button" type="button" data-group-name onMouseDown={(e: MouseEvent) => e.preventDefault()} onClick={onSelect}
              sx={{ border: 0, bgcolor: 'transparent', p: 0, font: 'inherit', fontWeight: 600, color: 'text.primary', cursor: 'pointer',
                whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}>
              {group.label}
            </Box>
          </Tooltip>
          {group.issueKey && (
            <Box component={Link} to={href(group.issueKey)} sx={{ fontSize: 12, color: 'primary.main', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Open
            </Box>
          )}
          <CountsBar counts={counts} width={80} />
        </Stack>
      </Box>
    </tr>
  )
}

/** The Playwright test that automates the case; flagged once the case changes after it was linked. */
function ScriptCell({ row, wrap }: { row: TestCase; wrap: boolean }) {
  if (!row.script_path) return <Box sx={textStyle(wrap)} />
  const stale = scriptStale(row)
  return (
    <Stack direction="row" spacing={0.5} sx={{ ...textStyle(wrap), alignItems: 'center' }}
      title={[row.script_repo, row.script_path, row.script_title].filter(Boolean).join('\n') +
        (stale ? '\nThe case changed after its script was linked: the script may need to follow.' : '')}>
      {stale && <WarningAmberIcon data-stale sx={{ fontSize: 16, color: 'warning.main', flexShrink: 0 }} />}
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{scriptLabel(row)}</Box>
    </Stack>
  )
}

function Cell({ row, col, wrap, issueKey }: { row: TestCase; col: SheetColumn; wrap: boolean; issueKey: (id: string) => string | undefined }) {
  const text = textStyle(wrap)
  switch (col) {
    case 'key':
      return <Box sx={{ ...text, fontWeight: 600, color: 'text.secondary' }}>{isTmp(row.id) ? '…' : row.key}</Box>
    case 'areas':
      return (
        <Box sx={{ px: 0.75, py: '7px', display: 'flex', gap: 0.5, flexWrap: wrap ? 'wrap' : 'nowrap', overflow: 'hidden' }}>
          {row.areas.map((a) => <Chip key={a} label={a} size="small" sx={{ height: 22 }} />)}
        </Box>
      )
    case 'issue':
      return <IssueCell issueKey={row.issue_id ? issueKey(row.issue_id) : undefined} wrap={wrap} />
    case 'status':
      return (
        <Stack direction="row" spacing={0.75} sx={{ px: 1, height: ROW_HEIGHT - 1, alignItems: 'center', overflow: 'hidden' }}>
          <StatusPill status={row.last_status} />
          {row.last_environment && <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{row.last_environment}</Typography>}
        </Stack>
      )
    case 'result':
      return <ResultCell row={row} wrap={wrap} />
    case 'script':
      return <ScriptCell row={row} wrap={wrap} />
    default:
      return <Box sx={text}>{cellText(row, col)}</Box>
  }
}

function ReasonPopover({ anchor, status, count, environment, onSave, onCancel }: {
  anchor: HTMLElement
  status: TestStatus
  count: number
  environment: string | null
  onSave: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const save = () => reason.trim() && onSave(reason.trim())
  return (
    <Popover open anchorEl={anchor} onClose={onCancel} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
      <Box component="form" role="dialog" aria-label={status === 'fail' ? 'Why it failed' : 'What is blocking it'}
        sx={{ p: 2, width: 360, maxWidth: 'calc(100vw - 32px)' }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          save()
        }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {status === 'fail' ? 'Why did it fail?' : 'What is blocking it?'}
        </Typography>
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mb: 1.5 }}>
          {count > 1 ? `${count} cases, ` : ''}{environment ? `on ${environment}` : 'no environment'}
        </Typography>
        <TextField autoFocus fullWidth multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Reason', maxLength: 5000 } }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              save()
            }
          }} />
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="contained" color={status === 'fail' ? 'error' : 'warning'} disabled={!reason.trim()}>
            Mark {TEST_STATUS_LABELS[status].toLowerCase()}
          </Button>
        </Stack>
      </Box>
    </Popover>
  )
}
