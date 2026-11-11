// The calendar: the month grid, the week and day timelines (one-hour slots),
// and what goes on them. Meetings come from your own Google Calendar (the app
// keeps none of its own); alongside them, the app's own dates: epics and
// issues (start to due), releases and your todos.
import { addDays, formatDateRange, formatDayTime, formatTime, isoDate } from './constants'
import type { GoogleCalendarEvent, Issue, Project, Release, Todo } from './types'

// Weeks start on Monday.
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The 6×7 days shown for a month (YYYY-MM): from the Monday on or before the 1st. */
export function monthGrid(month: string) {
  const first = new Date(`${month}-01T00:00:00`)
  const offset = (first.getDay() + 6) % 7
  const start = addDays(isoDate(first), -offset)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** The first and last day the month's grid shows. */
export function gridRange(month: string) {
  const days = monthGrid(month)
  return { from: days[0], to: days[days.length - 1] }
}

/** The Monday on or before a day. */
export function weekStart(day: string) {
  return addDays(day, -((new Date(`${day}T00:00:00`).getDay() + 6) % 7))
}

/** The seven days (Monday to Sunday) of the week a day is in. */
export function weekDays(day: string) {
  const start = weekStart(day)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** "Oct 19 – 25, 2026", "Oct 26 – Nov 1, 2026", "Dec 28, 2026 – Jan 3, 2027". */
export function weekLabel(day: string) {
  const [first, last] = [weekStart(day), addDays(weekStart(day), 6)]
  const at = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, o)
  if (first.slice(0, 4) !== last.slice(0, 4))
    return `${at(first, { month: 'short', day: 'numeric', year: 'numeric' })} – ${at(last, { month: 'short', day: 'numeric', year: 'numeric' })}`
  if (first.slice(0, 7) !== last.slice(0, 7))
    return `${at(first, { month: 'short', day: 'numeric' })} – ${at(last, { month: 'short', day: 'numeric' })}, ${last.slice(0, 4)}`
  return `${at(first, { month: 'short', day: 'numeric' })} – ${Number(last.slice(8))}, ${last.slice(0, 4)}`
}

export function shiftMonth(month: string, by: number) {
  const d = new Date(`${month}-01T00:00:00`)
  d.setMonth(d.getMonth() + by)
  return isoDate(d).slice(0, 7)
}

export function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * A PostgREST `or` filter for issues dated within [from, to]: a start and a
 * due date that overlap it, or just one of them inside it.
 */
export function datedWithin(from: string, to: string) {
  return [
    `and(start_date.lte.${to},due_date.gte.${from})`,
    `and(start_date.is.null,due_date.gte.${from},due_date.lte.${to})`,
    `and(due_date.is.null,start_date.gte.${from},start_date.lte.${to})`,
  ].join(',')
}

export type ItemKind = 'meeting' | 'epic' | 'issue' | 'release' | 'todo'

export const ITEM_LABELS: Record<ItemKind, string> = {
  meeting: 'Meeting',
  epic: 'Epic',
  issue: 'Issue',
  release: 'Release',
  todo: 'Todo',
}

// Meetings in Google Calendar's own blue; releases green; todos grey. Epics
// and issues take their type's colour.
export const MEETING_COLOR = '#039be5'
export const RELEASE_COLOR = '#22a06b'
export const TODO_COLOR = '#6b778c'

export interface CalendarItem {
  id: string
  kind: ItemKind
  title: string
  startDay: string
  endDay: string
  // Timed items (meetings) only.
  startsAt: Date | null
  endsAt: Date | null
  color: string
  // Resolved, released or ticked off: drawn faded.
  done: boolean
  // Clicking opens a dialog for what it is.
  meeting?: GoogleCalendarEvent
  issue?: Issue
  release?: Release
  todo?: Todo
}

export interface CalendarSources {
  // Your own Google Calendar, when connected.
  meetings?: GoogleCalendarEvent[]
  // Epics and issues with a start or due date; which are epics is `isEpic`.
  issues?: Issue[]
  isEpic: (issue: Issue) => boolean
  typeColor: (issue: Issue) => string | undefined
  releases?: Release[]
  todos?: Todo[]
  projects: Project[]
}

/** An issue's days: start to due, or just the one it has. */
function issueSpan(i: Pick<Issue, 'start_date' | 'due_date'>) {
  const start = i.start_date ?? i.due_date
  const end = i.due_date ?? i.start_date
  if (!start || !end) return null
  return start <= end ? { start, end } : { start: end, end: start }
}

/** Everything on the calendar in [from, to], earliest first; all-day items before timed ones. */
export function calendarItems(src: CalendarSources, from: string, to: string): CalendarItem[] {
  const project = new Map(src.projects.map((p) => [p.id, p]))
  const items: CalendarItem[] = []
  const base = { startsAt: null, endsAt: null, done: false }

  for (const i of src.issues ?? []) {
    const span = issueSpan(i)
    if (!span || span.end < from || span.start > to) continue
    const epic = src.isEpic(i)
    items.push({
      ...base,
      id: `issue:${i.id}`,
      kind: epic ? 'epic' : 'issue',
      title: `${i.key} ${i.title}`,
      startDay: span.start,
      endDay: span.end,
      color: src.typeColor(i) ?? (epic ? '#904ee2' : '#4bade8'),
      done: !!i.resolved_at,
      issue: i,
    })
  }
  for (const r of src.releases ?? []) {
    const p = project.get(r.project_id)
    if (!p || !r.release_date || r.status === 'archived' || r.release_date < from || r.release_date > to) continue
    items.push({
      ...base,
      id: `release:${r.id}`,
      kind: 'release',
      title: `${p.key} ${r.name}`,
      startDay: r.release_date,
      endDay: r.release_date,
      color: RELEASE_COLOR,
      done: r.status === 'released',
      release: r,
    })
  }
  for (const t of src.todos ?? []) {
    if (!t.due_on || t.due_on < from || t.due_on > to) continue
    items.push({
      ...base,
      id: `todo:${t.id}`,
      kind: 'todo',
      title: t.title,
      startDay: t.due_on,
      endDay: t.due_on,
      color: TODO_COLOR,
      done: !!t.done_at,
      todo: t,
    })
  }
  for (const g of src.meetings ?? []) {
    const startsAt = g.starts_at ? new Date(g.starts_at) : null
    const startDay = g.all_day ? g.start_date! : isoDate(startsAt!)
    // A timed meeting ending at midnight doesn't cover the next day.
    const endDay = g.all_day ? g.end_date! : isoDate(new Date(new Date(g.ends_at!).getTime() - 1))
    if (endDay < from || startDay > to) continue
    items.push({
      ...base,
      id: `meeting:${g.id}`,
      kind: 'meeting',
      title: g.title,
      startDay,
      endDay: endDay < startDay ? startDay : endDay,
      startsAt,
      endsAt: g.ends_at ? new Date(g.ends_at) : null,
      color: MEETING_COLOR,
      meeting: g,
    })
  }
  const order: Record<ItemKind, number> = { meeting: 0, release: 1, epic: 2, issue: 3, todo: 4 }
  return items.sort((a, b) =>
    a.startDay.localeCompare(b.startDay) ||
    Number(!!a.startsAt) - Number(!!b.startsAt) ||
    (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0) ||
    order[a.kind] - order[b.kind] ||
    a.title.localeCompare(b.title))
}

/** The items that cover one day. */
export const itemsOn = (items: CalendarItem[], day: string) => items.filter((i) => i.startDay <= day && i.endDay >= day)

/** A timed item placed on one day's timeline: minutes from local midnight, and its column among overlapping ones. */
export interface TimedBlock {
  item: CalendarItem
  start: number
  end: number
  col: number
  cols: number
}

// Short items still get a block tall enough to read.
const MIN_BLOCK_MINUTES = 20

/**
 * The timed items on one day, clipped to it, for the week and day views.
 * Items that overlap share the width side by side, as Google Calendar does.
 */
export function timedBlocks(items: CalendarItem[], day: string): TimedBlock[] {
  const dayStart = new Date(`${day}T00:00:00`).getTime()
  const dayEnd = new Date(`${addDays(day, 1)}T00:00:00`).getTime()
  const minutes = (t: number) => (t - dayStart) / 60_000
  const dayMinutes = minutes(dayEnd)
  const placed = items
    .filter((i) => i.startsAt)
    .map((item) => {
      const s = item.startsAt!.getTime()
      const e = item.endsAt?.getTime() ?? s
      return { item, s, from: Math.max(s, dayStart), to: Math.min(e, dayEnd) }
    })
    // On this day: starts in it, or runs through some of it.
    .filter((b) => (b.s >= dayStart && b.s < dayEnd) || b.to > b.from)
    .map((b) => {
      const start = minutes(b.from)
      return { item: b.item, start, end: Math.min(Math.max(minutes(b.to), start + MIN_BLOCK_MINUTES), dayMinutes), col: 0, cols: 1 }
    })
    .sort((a, b) => a.start - b.start || b.end - a.end || a.item.title.localeCompare(b.item.title))

  // Clusters of items that overlap one another; within one, each takes the first free column.
  let cluster: TimedBlock[] = []
  let columnEnds: number[] = []
  let clusterEnd = -1
  const close = () => cluster.forEach((b) => (b.cols = columnEnds.length))
  for (const b of placed) {
    if (b.start >= clusterEnd) {
      close()
      cluster = []
      columnEnds = []
    }
    let col = columnEnds.findIndex((end) => end <= b.start)
    if (col < 0) col = columnEnds.push(b.end) - 1
    else columnEnds[col] = b.end
    b.col = col
    cluster.push(b)
    clusterEnd = Math.max(clusterEnd, b.end)
  }
  close()
  return placed
}

/** "Wed, Nov 11 · 10:00 – 10:30 AM", or the days of an all-day entry. */
export function meetingWhen(m: GoogleCalendarEvent) {
  if (m.all_day) return formatDateRange(m.start_date, m.end_date)
  return `${formatDayTime(m.starts_at!)} – ${formatTime(m.ends_at!)}`
}

/** A meeting's local day (for its note). */
export function meetingDay(m: Pick<GoogleCalendarEvent, 'all_day' | 'start_date' | 'starts_at'>) {
  return m.all_day ? m.start_date! : isoDate(new Date(m.starts_at!))
}

/**
 * The meeting happening now, else the next one today: what the dashboard puts
 * up front. All-day entries (holidays, out of office) are not meetings here.
 */
export function currentMeeting(meetings: GoogleCalendarEvent[], now = new Date()) {
  const today = isoDate(now)
  const timed = meetings
    .filter((m) => !m.all_day && m.starts_at && m.ends_at)
    .sort((a, b) => a.starts_at!.localeCompare(b.starts_at!))
  const live = timed.find((m) => new Date(m.starts_at!) <= now && now < new Date(m.ends_at!))
  if (live) return { meeting: live, live: true }
  const next = timed.find((m) => new Date(m.starts_at!) > now && isoDate(new Date(m.starts_at!)) === today)
  return next ? { meeting: next, live: false } : null
}
