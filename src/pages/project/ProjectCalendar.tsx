// The project's calendar: its releases and epics, and your todos on it; its
// other issues with dates on request, and your own meetings if you like.
// Clicking anything opens it in a dialog.
import { useCallback } from 'react'
import { Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { ISSUE_COLUMNS } from '../../lib/issues'
import { datedWithin, type ItemKind } from '../../lib/calendar'
import type { Issue, Release, Todo } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import CalendarView, { type Layer } from '../../components/calendar/CalendarView'
import { TODO_COLUMNS } from '../../components/TodoList'
import { useProject } from './projectContext'

const LAYERS: Layer[] = [
  { key: 'release', label: 'Releases', on: true },
  { key: 'epic', label: 'Epics', on: true },
  { key: 'issue', label: 'Issues', on: false },
  { key: 'todo', label: 'My todos', on: true },
  { key: 'meeting', label: 'My meetings', on: false },
]

export default function ProjectCalendar() {
  const { project } = useProject()
  const { issueTypes } = useWorkspace()
  const epicTypeIds = issueTypes.filter((t) => t.level === 'epic').map((t) => t.id).join(',')

  const load = useCallback(async (from: string, to: string, shown: ItemKind[]) => {
    const none = Promise.resolve({ data: [] })
    const wantIssues = shown.includes('issue')
    const wantEpics = shown.includes('epic') && !!epicTypeIds
    let issues = supabase.from('issues').select(ISSUE_COLUMNS).eq('project_id', project.id).or(datedWithin(from, to))
    // Only the epics, unless the rest are wanted too.
    if (!wantIssues) issues = issues.in('type_id', epicTypeIds.split(','))
    const [i, r, t] = await Promise.all([
      wantIssues || wantEpics ? issues : none,
      shown.includes('release')
        ? supabase.from('releases').select('*').eq('project_id', project.id).gte('release_date', from).lte('release_date', to)
        : none,
      shown.includes('todo')
        ? supabase.from('todos').select(TODO_COLUMNS).eq('project_id', project.id).gte('due_on', from).lte('due_on', to)
        : none,
    ])
    return {
      issues: (i.data ?? []) as unknown as Issue[],
      releases: (r.data ?? []) as Release[],
      todos: (t.data ?? []) as unknown as Todo[],
    }
  }, [project.id, epicTypeIds])

  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {project.name}'s releases and epics, and your todos on it. Turn on Issues to see every issue with a start or due date.
      </Typography>
      <CalendarView layers={LAYERS} load={load} storageKey={`el-work:project-calendar-layers:${project.key}`} />
    </>
  )
}
