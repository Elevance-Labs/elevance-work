// Todos: the views of the Todos page and what they hold. A person's todos sit
// in their Inbox (every todo not filed in a list) or in one of their own
// lists; where a todo sits is per person (todo_places), since a todo is
// shared. Today, Tomorrow and This week are smart views across every list,
// each shown or hidden by the person (in this browser).
import { addDays, formatDate } from './constants'
import type { Todo } from './types'

export type SmartView = 'today' | 'tomorrow' | 'week'
/** 'inbox', a smart view, or a list's id. */
export type TodoView = 'inbox' | SmartView | string

export const SMART_VIEWS: { id: SmartView; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'week', label: 'This week' },
]
export const isSmartView = (v: string): v is SmartView => SMART_VIEWS.some((s) => s.id === v)

/** A list's colours, the first the default (as in the schema). */
export const LIST_COLORS = ['#5c6bc0', '#26a69a', '#66bb6a', '#ffa726', '#ef5350', '#ab47bc', '#29b6f6', '#8d6e63', '#78909c']
export const DEFAULT_LIST_COLOR = LIST_COLORS[0]

/** A todo as the pages load it: its issue, and where you filed it (RLS returns only your own place). */
export type TodoRow = Todo & { issue: { key: string; title: string } | null; place?: { list_id: string }[] | null }
export const TODO_COLUMNS = '*, issue:issues(key, title), place:todo_places(list_id)'

/** The list you filed a todo in, or null for your Inbox. */
export const listOf = (t: Pick<TodoRow, 'place'>) => t.place?.[0]?.list_id ?? null

/** The last day (Sunday) of the week `today` is in; weeks start on Monday, as in the calendar. */
export function weekEnd(today: string) {
  const day = new Date(`${today}T00:00:00`).getDay()
  return addDays(today, (7 - day) % 7)
}

/** Whether an open or done todo belongs in a view. Smart views show only dated todos, overdue ones in Today and This week. */
export function inView(t: TodoRow, view: TodoView, today: string) {
  switch (view) {
    case 'inbox':
      return listOf(t) === null
    case 'today':
      return !!t.due_on && (t.due_on === today || (!t.done_at && t.due_on < today))
    case 'tomorrow':
      return t.due_on === addDays(today, 1)
    case 'week':
      return !!t.due_on && t.due_on <= weekEnd(today) && (t.due_on >= today || !t.done_at)
    default:
      return listOf(t) === view
  }
}

/** Open todos in a view, for its count. */
export const openCount = (todos: TodoRow[], view: TodoView, today: string) =>
  todos.filter((t) => !t.done_at && inView(t, view, today)).length

/** The day a new todo gets in a view: today in Today and This week, tomorrow in Tomorrow. */
export function defaultDue(view: TodoView, today: string) {
  if (view === 'today' || view === 'week') return today
  if (view === 'tomorrow') return addDays(today, 1)
  return ''
}

export interface TodoGroup {
  key: string
  label: string
  rows: TodoRow[]
  tone?: 'error'
}

const byDue = (a: TodoRow, b: TodoRow) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.position - b.position

/**
 * The open todos in groups: Overdue, then by day through the week in This
 * week, else Today, Upcoming and No date. Empty groups are dropped.
 */
export function groupOpen(open: TodoRow[], view: TodoView, today: string): TodoGroup[] {
  const overdue = open.filter((t) => t.due_on && t.due_on < today).sort(byDue)
  const rest = open.filter((t) => !t.due_on || t.due_on >= today)
  let groups: TodoGroup[]
  if (view === 'week') {
    const days: string[] = []
    for (let d = today; d <= weekEnd(today); d = addDays(d, 1)) days.push(d)
    groups = days.map((d) => ({ key: d, label: dueLabel(d, today, true), rows: rest.filter((t) => t.due_on === d).sort(byDue) }))
  } else {
    groups = [
      { key: 'today', label: 'Today', rows: rest.filter((t) => t.due_on === today).sort(byDue) },
      { key: 'upcoming', label: 'Upcoming', rows: rest.filter((t) => t.due_on && t.due_on > today).sort(byDue) },
      { key: 'none', label: 'No date', rows: rest.filter((t) => !t.due_on).sort(byDue) },
    ]
  }
  return [{ key: 'overdue', label: 'Overdue', rows: overdue, tone: 'error' as const }, ...groups].filter((g) => g.rows.length)
}

export const sortDone = (done: TodoRow[]) => [...done].sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''))

/** "Today", "Tomorrow", "Yesterday", a weekday within the next six days, else "Nov 24" (with the weekday when `long`). */
export function dueLabel(due: string, today: string, long = false) {
  if (due === today) return 'Today'
  if (due === addDays(today, 1)) return 'Tomorrow'
  if (due === addDays(today, -1)) return 'Yesterday'
  const date = new Date(`${due}T00:00:00`)
  if (due > today && due <= addDays(today, 6))
    return date.toLocaleDateString(undefined, long ? { weekday: 'long', month: 'short', day: 'numeric' } : { weekday: 'long' })
  return long ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : formatDate(due, due.slice(0, 4) !== today.slice(0, 4))
}

/** The quick picks for a due day: today, tomorrow, the coming Saturday and next Monday. */
export function duePresets(today: string) {
  const dow = new Date(`${today}T00:00:00`).getDay()
  const saturday = addDays(today, (6 - dow + 7) % 7)
  const monday = addDays(today, (8 - dow) % 7 || 7)
  return [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'This weekend', date: saturday },
    { label: 'Next week', date: monday },
  ].filter((p, i, all) => all.findIndex((q) => q.date === p.date) === i)
}

/** The smart views shown beside the lists: a per-browser choice. */
export const SMART_VIEWS_KEY = 'elevance.work.todo-views'
export const DEFAULT_SMART_VIEWS: SmartView[] = ['today', 'tomorrow', 'week']

export function parseSmartViews(saved: string | null): SmartView[] {
  if (saved === null) return DEFAULT_SMART_VIEWS
  return saved.split(',').filter(isSmartView)
}
