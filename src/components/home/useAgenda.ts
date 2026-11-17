// Home's agenda, from today up to a day: your Google meetings, releases,
// issues assigned to you that fall due, and your todos that do, with
// anything overdue gathered apart. Also which meetings you've written notes
// on, and ticking a todo off. Reloads when issues, todos or notes change.
import { useCallback, useEffect, useState } from 'react'
import { useMe } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { PRIORITIES, addDays } from '../../lib/constants'
import { ISSUE_COLUMNS } from '../../lib/issues'
import { calendarItems, itemsOn, type CalendarItem } from '../../lib/calendar'
import type { Issue, Release, Todo } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useIssueChanges } from '../../workspace/issueEvents'
import { useItemChanges } from '../../workspace/itemEvents'
import { useGoogleCalendar } from '../../workspace/useGoogleCalendar'

export type TodoRow = Todo & { issue: { key: string; title: string } | null }

/** One line of the agenda (AgendaRow). */
export type Entry =
  | { kind: 'calendar'; id: string; item: CalendarItem }
  | { kind: 'issue'; id: string; issue: Issue }
  | { kind: 'todo'; id: string; todo: TodoRow }

/** "Today", "Tomorrow", "Friday 20 Nov". */
export function dayHeading(day: string, today: string) {
  if (day === today) return 'Today'
  if (day === addDays(today, 1)) return 'Tomorrow'
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

export function useAgenda(today: string, until: string) {
  const me = useMe()
  const { projects } = useWorkspace()
  const google = useGoogleCalendar(today, until)
  const [releases, setReleases] = useState<Release[]>([])
  const [due, setDue] = useState<Issue[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [noted, setNoted] = useState<Set<string>>(new Set())
  // Bumped when a todo is ticked here, so other todo lists on the page read theirs again.
  const [todoVersion, setTodoVersion] = useState(0)

  const loadTodos = useCallback(async () => {
    const { data } = await supabase.from('todos').select('*, issue:issues(key, title)')
      .is('done_at', null).not('due_on', 'is', null).lte('due_on', until).order('position')
    setTodos((data ?? []) as unknown as TodoRow[])
  }, [until])

  const load = useCallback(async () => {
    const [upcoming, dueIssues] = await Promise.all([
      supabase.from('releases').select('*').eq('status', 'unreleased').gte('release_date', today).lte('release_date', until),
      // Yours with a due date up to the last day, overdue ones included.
      supabase.from('issues').select(ISSUE_COLUMNS).eq('assignee_id', me.id).is('resolved_at', null)
        .not('due_date', 'is', null).lte('due_date', until).order('due_date'),
      loadTodos(),
    ])
    setDue((dueIssues.data ?? []) as unknown as Issue[])
    setReleases((upcoming.data ?? []) as Release[])
  }, [me.id, today, until, loadTodos])

  useEffect(() => {
    load()
  }, [load])
  useIssueChanges(() => load())
  // A todo made with Create, or changed in a todo list beside the agenda.
  useItemChanges(['todo'], () => load())

  // Which of these meetings you've written notes on.
  const meetingIds = google.events.map((m) => m.id).join(',')
  const loadNoted = useCallback(async () => {
    if (!meetingIds) return setNoted(new Set())
    const { data } = await supabase.from('notes').select('meeting_id').eq('owner_id', me.id).in('meeting_id', meetingIds.split(','))
    setNoted(new Set(((data ?? []) as { meeting_id: string }[]).map((n) => n.meeting_id)))
  }, [me.id, meetingIds])
  useEffect(() => {
    loadNoted()
  }, [loadNoted])
  useItemChanges(['note'], loadNoted)

  async function tick(t: TodoRow) {
    setTodos((ts) => ts.filter((x) => x.id !== t.id))
    await supabase.from('todos').update({ done_at: new Date().toISOString() }).eq('id', t.id)
    setTodoVersion((v) => v + 1)
    loadTodos()
  }

  const items = calendarItems({ meetings: google.events, releases, projects, isEpic: () => false, typeColor: () => undefined }, today, until)
  const priority = (i: Issue) => PRIORITIES.indexOf(i.priority)

  // Overdue issues and todos, oldest first.
  const overdue: (Entry & { day: string })[] = [
    ...due.filter((i) => i.due_date! < today).map((issue) => ({ kind: 'issue' as const, id: `issue:${issue.id}`, issue, day: issue.due_date! })),
    ...todos.filter((t) => t.due_on! < today).map((todo) => ({ kind: 'todo' as const, id: `todo:${todo.id}`, todo, day: todo.due_on! })),
  ].sort((a, b) => a.day.localeCompare(b.day))

  /** A day's meetings and releases (in time order), then issues due (by priority), then todos. */
  const entriesOn = (d: string): Entry[] => [
    ...itemsOn(items, d).map((item) => ({ kind: 'calendar' as const, id: `cal:${item.id}`, item })),
    ...due.filter((i) => i.due_date === d).sort((a, b) => priority(a) - priority(b))
      .map((issue) => ({ kind: 'issue' as const, id: `issue:${issue.id}`, issue })),
    ...todos.filter((t) => t.due_on === d).map((todo) => ({ kind: 'todo' as const, id: `todo:${todo.id}`, todo })),
  ]

  return { google, due, todos, noted, overdue, entriesOn, tick, loadTodos, todoVersion }
}
