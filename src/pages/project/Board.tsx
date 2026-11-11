// The board: a column per status, in workflow order. Scrum boards show the
// active sprint; Kanban boards show everything, with done work dropping off
// after two weeks. Dragging changes status (and, in assignee lanes, the
// assignee) and order; so does each card's menu.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Alert, Avatar, AvatarGroup, Box, Button, ButtonBase, Chip, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { useMe } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { can } from '../../lib/permissions'
import { addDays, errorMessage, formatDateRange, todayIso } from '../../lib/constants'
import { ISSUE_COLUMNS, byRank, rankForIndex, sumPoints } from '../../lib/issues'
import type { Issue, ProjectStatus } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { useIssueChanges } from '../../workspace/issueEvents'
import { useLayout } from '../../components/layoutContext'
import { EmptyState, Loading, PersonAvatar } from '../../components/common'
import { BoardCard, type MoveGroup } from '../../components/IssueCard'
import { useProject } from './projectContext'

type GroupBy = 'none' | 'assignee' | 'epic'

// Kanban: done issues stay on the board this long after they're resolved.
const KANBAN_DONE_DAYS = 14

interface Lane {
  key: string
  title: string
  issues: Issue[]
}

const colId = (lane: string, status: string) => `col:${lane}:${status}`

function Column({
  lane,
  status,
  issues,
  movesFor,
  editable,
  onCreate,
}: {
  lane: string
  status: ProjectStatus
  issues: Issue[]
  movesFor: (i: Issue) => MoveGroup[]
  editable: boolean
  onCreate?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: colId(lane, status.id) })
  return (
    <Box
      ref={setNodeRef}
      data-column={status.name}
      sx={{ bgcolor: isOver ? 'action.selected' : 'grey.100', borderRadius: 2, p: 1, minHeight: 120, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        {issues.map((i) => <BoardCard key={i.id} issue={i} moves={movesFor(i)} draggable={editable} />)}
      </SortableContext>
      {onCreate && (
        <ButtonBase onClick={onCreate} sx={{ justifyContent: 'flex-start', gap: 1, px: 1, py: 0.75, borderRadius: 1, color: 'text.secondary',
          typography: 'body2', '&:hover': { bgcolor: 'action.hover' } }}>
          <AddIcon fontSize="small" /> Create issue
        </ButtonBase>
      )}
    </Box>
  )
}

export default function Board() {
  const me = useMe()
  const { project, role } = useProject()
  const { statusesOf, typeById, profileById, profiles } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const { openCreate } = useLayout()
  const statuses = statusesOf(project.id)
  const editable = can.editIssues(role)
  const sprint = project.kind === 'scrum' ? meta?.sprints.find((s) => s.state === 'active') ?? null : null
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [epics, setEpics] = useState<Issue[]>([])
  const [error, setError] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [text, setText] = useState('')
  const [people, setPeople] = useState<string[]>([])
  const [onlyMine, setOnlyMine] = useState(false)
  const [dragging, setDragging] = useState<Issue | null>(null)

  const load = useCallback(async () => {
    if (project.kind === 'scrum' && !meta) return
    let q = supabase.from('issues').select(ISSUE_COLUMNS).eq('project_id', project.id)
    if (project.kind === 'scrum') {
      if (!sprint) {
        setIssues([])
        return
      }
      q = q.eq('sprint_id', sprint.id)
    } else {
      // Unresolved, or resolved in the last two weeks.
      q = q.or(`resolved_at.is.null,resolved_at.gte.${addDays(todayIso(), -KANBAN_DONE_DAYS)}`)
    }
    const { data, error: e } = await q.order('rank')
    if (e) return setError(errorMessage(e))
    const rows = (data ?? []) as unknown as Issue[]
    setIssues(rows.filter((i) => typeById(i.type_id)?.level !== 'epic'))
    const epicIds = [...new Set(rows.map((i) => i.parent_id).filter((x): x is string => !!x))]
    if (epicIds.length) {
      const { data: parents } = await supabase.from('issues').select(ISSUE_COLUMNS).in('id', epicIds)
      setEpics((parents ?? []) as unknown as Issue[])
    } else setEpics([])
  }, [project.id, project.kind, sprint, meta, typeById])

  useEffect(() => {
    load()
  }, [load])
  useIssueChanges(() => load())

  // Other people's moves arrive live (RLS still decides what's sent).
  const reloadSoon = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    const channel = supabase
      .channel(`board:${project.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'issues', filter: `project_id=eq.${project.id}` }, () => {
        clearTimeout(reloadSoon.current)
        reloadSoon.current = setTimeout(() => load(), 400)
      })
      .subscribe()
    return () => {
      clearTimeout(reloadSoon.current)
      supabase.removeChannel(channel)
    }
  }, [project.id, load])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const visible = useMemo(() => {
    const t = text.trim().toLowerCase()
    return (issues ?? []).filter((i) =>
      (!t || i.key.toLowerCase().includes(t) || i.title.toLowerCase().includes(t)) &&
      (!people.length || people.includes(i.assignee_id ?? 'none')) &&
      (!onlyMine || i.assignee_id === me.id)).sort(byRank)
  }, [issues, text, people, onlyMine, me.id])

  const epicOf = (i: Issue) => {
    if (!i.parent_id) return null
    const parent = epics.find((e) => e.id === i.parent_id) ?? (issues ?? []).find((x) => x.id === i.parent_id)
    if (!parent) return null
    if (typeById(parent.type_id)?.level === 'epic') return parent
    // A sub-task's epic is its parent's.
    return epics.find((e) => e.id === parent.parent_id) ?? null
  }

  const lanes: Lane[] = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', title: '', issues: visible }]
    const keyOf = (i: Issue) => (groupBy === 'assignee' ? i.assignee_id ?? 'none' : epicOf(i)?.id ?? 'none')
    const keys = [...new Set(visible.map(keyOf))]
    const title = (k: string) =>
      groupBy === 'assignee'
        ? profileById(k === 'none' ? null : k)?.full_name ?? 'Unassigned'
        : epics.find((e) => e.id === k)?.title ?? 'No epic'
    return keys
      .sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : title(a).localeCompare(title(b))))
      .map((k) => ({ key: k, title: title(k), issues: visible.filter((i) => keyOf(i) === k) }))
    // epicOf reads epics and issues, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, visible, epics, issues, profileById])

  async function move(issue: Issue, statusId: string, index: number | 'end', lane?: string) {
    const column = (issues ?? []).filter((i) => i.status_id === statusId && i.id !== issue.id).sort(byRank)
    const at = index === 'end' ? column.length : index
    let rank = rankForIndex(column, at, issue.id)
    if (rank === null) {
      await supabase.rpc('project_rerank', { p_project: project.id })
      const { data } = await supabase.from('issues').select('id, rank').eq('project_id', project.id)
      const ranks = new Map(((data ?? []) as { id: string; rank: number }[]).map((r) => [r.id, r.rank]))
      rank = rankForIndex(column.map((i) => ({ ...i, rank: ranks.get(i.id) ?? i.rank })), at, issue.id) ?? 0
    }
    const patch: Partial<Issue> = { status_id: statusId, rank }
    if (groupBy === 'assignee' && lane !== undefined) {
      const assignee = lane === 'none' ? null : lane
      if (assignee !== issue.assignee_id) patch.assignee_id = assignee
    }
    const before = issues
    setIssues((rows) => rows && rows.map((r) => (r.id === issue.id ? { ...r, ...patch } : r)))
    setError(null)
    const { error: e } = await supabase.from('issues').update(patch).eq('id', issue.id)
    if (e) {
      setIssues(before)
      setError(errorMessage(e))
    }
  }

  const movesFor = (i: Issue): MoveGroup[] =>
    editable
      ? [
          { title: 'Move to', options: statuses.map((s) => ({ label: s.name, disabled: s.id === i.status_id, onSelect: () => move(i, s.id, 'end') })) },
          {
            title: 'Order',
            options: [
              { label: 'Top of column', onSelect: () => move(i, i.status_id, 0) },
              { label: 'Bottom of column', onSelect: () => move(i, i.status_id, 'end') },
            ],
          },
        ]
      : []

  function onDragStart(e: DragStartEvent) {
    setDragging((issues ?? []).find((i) => i.id === e.active.id) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const issue = (issues ?? []).find((i) => i.id === e.active.id)
    if (!issue || !e.over) return
    const overId = String(e.over.id)
    let statusId: string
    let lane: string | undefined
    let index: number | 'end'
    if (overId.startsWith('col:')) {
      const [, l, s] = overId.split(':')
      lane = l
      statusId = s
      index = 'end'
    } else {
      const target = (issues ?? []).find((i) => i.id === overId)
      if (!target) return
      statusId = target.status_id
      lane = groupBy === 'assignee' ? target.assignee_id ?? 'none' : undefined
      const column = (issues ?? []).filter((i) => i.status_id === statusId).sort(byRank)
      const from = column.findIndex((i) => i.id === issue.id)
      const to = column.findIndex((i) => i.id === target.id)
      // Taking the target's place puts it before the target, or after it when
      // dragged down its own column: either way, index `to` among the others.
      if (from === to) return
      index = to
    }
    move(issue, statusId, index, lane)
  }

  if (project.kind === 'scrum' && meta && !sprint) {
    return (
      <Paper variant="outlined">
        <EmptyState title="No active sprint">
          Plan one on the <Link to={`/projects/${project.key}/backlog`}>backlog</Link> and start it to see it here.
        </EmptyState>
      </Paper>
    )
  }
  if (!issues || (project.kind === 'scrum' && !meta)) return <Loading />

  const assignees = [...new Set((issues ?? []).map((i) => i.assignee_id ?? 'none'))]
  const columnsTemplate = { xs: `repeat(${statuses.length}, 272px)`, lg: `repeat(${statuses.length}, minmax(220px, 1fr))` }

  return (
    <Box>
      {sprint && (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline', mb: 2, flexWrap: 'wrap' }}>
          <Typography variant="h6">{sprint.name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>{formatDateRange(sprint.start_date, sprint.end_date)}</Typography>
          {sprint.goal && <Typography variant="body2" sx={{ color: 'text.secondary' }}>· {sprint.goal}</Typography>}
          <Box sx={{ flexGrow: 1 }} />
          <Button component={Link} to={`/projects/${project.key}/backlog`} size="small">Complete sprint on the backlog</Button>
        </Stack>
      )}
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <TextField placeholder="Filter this board" value={text} onChange={(e) => setText(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Filter this board' } }} sx={{ width: { xs: '100%', sm: 200 }, bgcolor: 'background.paper' }} />
        <AvatarGroup max={8} sx={{ '& .MuiAvatar-root': { width: 30, height: 30, border: 2, borderColor: 'background.default' } }}>
          {assignees.map((id) => {
            const p = id === 'none' ? null : profileById(id)
            const on = people.includes(id)
            return (
              <Tooltip key={id} title={p?.full_name ?? 'Unassigned'}>
                <Avatar component="button" aria-pressed={on} aria-label={`Only ${p?.full_name ?? 'unassigned'}`}
                  onClick={() => setPeople((ps) => (on ? ps.filter((x) => x !== id) : [...ps, id]))}
                  sx={{ p: 0, cursor: 'pointer', outline: on ? 2 : 0, outlineColor: 'primary.main', bgcolor: 'transparent' }}>
                  <PersonAvatar person={p} size={30} />
                </Avatar>
              </Tooltip>
            )
          })}
        </AvatarGroup>
        <Chip label="Only my issues" clickable color={onlyMine ? 'primary' : 'default'} variant={onlyMine ? 'filled' : 'outlined'}
          onClick={() => setOnlyMine((v) => !v)} />
        <Box sx={{ flexGrow: 1 }} />
        <TextField select label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} sx={{ minWidth: 140 }}>
          <MenuItem value="none">None</MenuItem>
          <MenuItem value="assignee">Assignee</MenuItem>
          <MenuItem value="epic">Epic</MenuItem>
        </TextField>
      </Stack>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
      <Box sx={{ overflowX: 'auto', pb: 1 }}>
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}>
          <Box sx={{ display: 'grid', gridTemplateColumns: columnsTemplate, gap: 1.5, position: 'sticky', top: 0, zIndex: 1, mb: 1 }}>
            {statuses.map((s) => {
              const n = visible.filter((i) => i.status_id === s.id)
              const over = s.wip_limit !== null && n.length > s.wip_limit
              return (
                <Stack key={s.id} direction="row" spacing={1} sx={{ px: 1, py: 0.75, alignItems: 'center', bgcolor: over ? '#ffeceb' : 'grey.100', borderRadius: 2 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: 'text.secondary', flexGrow: 1 }} noWrap>
                    {s.name}
                  </Typography>
                  <Tooltip title={s.wip_limit ? `Work-in-progress limit: ${s.wip_limit}` : `${sumPoints(n)} points`}>
                    <Typography variant="caption" sx={{ color: over ? 'error.main' : 'text.secondary', fontWeight: 600 }}>
                      {n.length}{s.wip_limit ? ` / ${s.wip_limit}` : ''}
                    </Typography>
                  </Tooltip>
                </Stack>
              )
            })}
          </Box>
          {lanes.map((lane) => (
            <Box key={lane.key} sx={{ mb: 2 }}>
              {groupBy !== 'none' && (
                <Typography variant="subtitle2" sx={{ mb: 1, position: 'sticky', left: 0 }}>
                  {lane.title} <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>({lane.issues.length})</Typography>
                </Typography>
              )}
              <Box sx={{ display: 'grid', gridTemplateColumns: columnsTemplate, gap: 1.5 }}>
                {statuses.map((s, i) => (
                  <Column key={s.id} lane={lane.key} status={s} issues={lane.issues.filter((x) => x.status_id === s.id)}
                    movesFor={movesFor} editable={editable}
                    onCreate={editable && i === 0 && groupBy === 'none'
                      ? () => openCreate({ projectId: project.id, sprintId: sprint?.id ?? null, statusId: s.id })
                      : undefined} />
                ))}
              </Box>
            </Box>
          ))}
          <DragOverlay>{dragging && <BoardCard issue={dragging} moves={[]} overlay />}</DragOverlay>
        </DndContext>
      </Box>
      {!issues.length && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
          {project.kind === 'scrum' ? 'This sprint has no issues yet.' : 'Nothing on the board yet.'}{' '}
          {profiles.length > 0 && editable && 'Create one to get started.'}
        </Typography>
      )}
    </Box>
  )
}
