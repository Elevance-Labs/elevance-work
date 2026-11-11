// The calendar: your meetings (from your own Google Calendar, which only you
// see), with what the app itself dates laid alongside: epics, the issues
// assigned to you, releases and your todos. Nothing is created here; meetings
// are made in Google Calendar. Clicking anything opens it in a dialog.
import { useCallback, useState } from 'react'
import { MenuItem, TextField } from '@mui/material'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { ISSUE_COLUMNS } from '../lib/issues'
import { datedWithin, type ItemKind } from '../lib/calendar'
import type { Issue, Release, Todo } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { PageHeader } from '../components/common'
import CalendarView, { type Layer } from '../components/calendar/CalendarView'
import { TODO_COLUMNS } from '../components/TodoList'

const LAYERS: Layer[] = [
  { key: 'meeting', label: 'My meetings', on: true },
  { key: 'epic', label: 'Epics', on: true },
  { key: 'issue', label: 'My issues', on: true },
  { key: 'release', label: 'Releases', on: true },
  { key: 'todo', label: 'My todos', on: true },
]

export default function Calendar() {
  const me = useMe()
  const { projects, issueTypes } = useWorkspace()
  const [projectId, setProjectId] = useState('')
  const epicTypeIds = issueTypes.filter((t) => t.level === 'epic').map((t) => t.id).join(',')

  const load = useCallback(async (from: string, to: string, shown: ItemKind[]) => {
    const none = Promise.resolve({ data: [] })
    const [epics, mine, releases, todos] = await Promise.all([
      shown.includes('epic') && epicTypeIds
        ? supabase.from('issues').select(ISSUE_COLUMNS).in('type_id', epicTypeIds.split(',')).or(datedWithin(from, to))
        : none,
      shown.includes('issue')
        ? supabase.from('issues').select(ISSUE_COLUMNS).eq('assignee_id', me.id).is('resolved_at', null).or(datedWithin(from, to))
        : none,
      shown.includes('release') ? supabase.from('releases').select('*').gte('release_date', from).lte('release_date', to) : none,
      shown.includes('todo') ? supabase.from('todos').select(TODO_COLUMNS).gte('due_on', from).lte('due_on', to) : none,
    ])
    // An epic assigned to you comes back twice.
    const issues = new Map<string, Issue>()
    for (const i of [...(epics.data ?? []), ...(mine.data ?? [])] as unknown as Issue[]) issues.set(i.id, i)
    return {
      issues: [...issues.values()],
      releases: (releases.data ?? []) as Release[],
      todos: (todos.data ?? []) as unknown as Todo[],
    }
  }, [me.id, epicTypeIds])

  return (
    <>
      <PageHeader title="Calendar" subtitle="Your meetings, with the epics, issues, releases and todos that have dates." />
      <CalendarView
        layers={LAYERS}
        load={load}
        storageKey="el-work:calendar-layers"
        // A project shows its epics, issues, releases and todos; meetings belong to no project.
        filter={projectId
          ? (i) => (i.issue?.project_id ?? i.release?.project_id ?? i.todo?.project_id) === projectId
          : undefined}
        toolbar={(
          <TextField select value={projectId} onChange={(e) => setProjectId(e.target.value)} sx={{ minWidth: 160 }}
            slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Project' } }}>
            <MenuItem value="">All projects</MenuItem>
            {projects.filter((p) => !p.archived_at).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
        )}
      />
    </>
  )
}
