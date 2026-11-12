// The backlog (Scrum): the active and planned sprints, then everything not
// yet planned, in rank order. Drag issues between them, or use each row's
// menu. Sprints are created here, started and completed through the
// database's sprint_start / sprint_complete.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import { supabase } from '../../lib/supabase'
import { can } from '../../lib/permissions'
import { addDays, errorMessage, formatDateRange, formatPoints, todayIso } from '../../lib/constants'
import { ISSUE_COLUMNS, byRank, categoryOf, rankForIndex, sumPoints } from '../../lib/issues'
import type { Issue, Sprint, StatusCategory } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { invalidateProjectMeta, useProjectMeta } from '../../workspace/useProjectMeta'
import { emitIssueChange, useIssueChanges } from '../../workspace/issueEvents'
import { ConfirmDialog, FormDialog, Loading } from '../../components/common'
import { BacklogRow, type MoveGroup } from '../../components/IssueCard'
import { TypeIcon } from '../../components/IssueBits'
import { useProject } from './projectContext'

const BACKLOG = 'backlog'
const listId = (sprintId: string | null) => `list:${sprintId ?? BACKLOG}`

function CategoryCounts({ issues, categoryFor }: { issues: Issue[]; categoryFor: (i: Issue) => StatusCategory }) {
  const n = (c: StatusCategory) => sumPoints(issues.filter((i) => categoryFor(i) === c))
  // Light tint, dark tint.
  const chips: [StatusCategory, string, string, string][] = [
    ['todo', 'grey.300', 'grey.700', 'To do'],
    ['in_progress', '#cce0ff', '#09326c', 'In progress'],
    ['done', '#baf3db', '#164b35', 'Done'],
  ]
  return (
    <Stack direction="row" spacing={0.5}>
      {chips.map(([c, bg, darkBg, label]) => (
        <Tooltip key={c} title={`${label}: ${formatPoints(n(c))} points`}>
          <Box sx={{ bgcolor: (t) => (t.palette.mode === 'dark' ? darkBg : bg), borderRadius: 5, px: 0.875, fontSize: 12, fontWeight: 600, minWidth: 22, textAlign: 'center', lineHeight: '20px' }}>
            {formatPoints(n(c))}
          </Box>
        </Tooltip>
      ))}
    </Stack>
  )
}

function DropList({ id, children, empty }: { id: string; children: ReactNode; empty: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <Box ref={setNodeRef} sx={{ minHeight: 44, bgcolor: isOver ? 'action.selected' : undefined }}>
      {children}
      {empty && (
        <Typography variant="body2" sx={{ color: 'text.secondary', px: 1.5, py: 1.25, border: 1, borderStyle: 'dashed', borderColor: 'divider', m: 1, borderRadius: 1 }}>
          {empty}
        </Typography>
      )}
    </Box>
  )
}

function QuickCreate({ onCreate }: { onCreate: (title: string, typeId: string) => Promise<boolean> }) {
  const { issueTypes } = useWorkspace()
  const types = issueTypes.filter((t) => t.level === 'standard' && !t.archived)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [typeId, setTypeId] = useState(types.find((t) => t.name === 'Story')?.id ?? types[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  if (!open) {
    return (
      <Button startIcon={<AddIcon />} size="small" onClick={() => setOpen(true)} sx={{ m: 0.5 }}>
        Create issue
      </Button>
    )
  }
  return (
    <Box
      component="form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!title.trim()) return
        setBusy(true)
        const ok = await onCreate(title.trim(), typeId)
        setBusy(false)
        if (ok) setTitle('')
      }}
      sx={{ display: 'flex', gap: 1, p: 1, alignItems: 'center' }}
    >
      <TextField select value={typeId} onChange={(e) => setTypeId(e.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Issue type' } }}
        sx={{ width: 64, '& .MuiSelect-select': { display: 'flex' } }}>
        {types.map((t) => <MenuItem key={t.id} value={t.id}><TypeIcon type={t} /></MenuItem>)}
      </TextField>
      <TextField autoFocus fullWidth placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)}
        slotProps={{ htmlInput: { 'aria-label': 'New issue summary', maxLength: 255 } }} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <Button type="submit" variant="contained" loading={busy}>Create</Button>
      <Button onClick={() => setOpen(false)}>Done</Button>
    </Box>
  )
}

export default function Backlog() {
  const { project, role } = useProject()
  const { typeById, statusesOf } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const editable = can.planSprints(role)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [epicFilter, setEpicFilter] = useState('')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [dragging, setDragging] = useState<Issue | null>(null)
  const [sprintMenu, setSprintMenu] = useState<{ anchor: HTMLElement; sprint: Sprint } | null>(null)
  const [starting, setStarting] = useState<Sprint | null>(null)
  const [editing, setEditing] = useState<Sprint | null>(null)
  const [completing, setCompleting] = useState<Sprint | null>(null)
  const [deleting, setDeleting] = useState<Sprint | null>(null)
  const [form, setForm] = useState({ name: '', goal: '', start: '', end: '', weeks: '2' })
  const [moveTo, setMoveTo] = useState(BACKLOG)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const sprints = useMemo(
    () => (meta?.sprints ?? []).filter((s) => s.state !== 'closed').sort((a, b) => Number(b.state === 'active') - Number(a.state === 'active')),
    [meta],
  )
  const activeSprint = sprints.find((s) => s.state === 'active')

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('issues').select(ISSUE_COLUMNS).eq('project_id', project.id).order('rank')
    if (e) return setError(errorMessage(e))
    setIssues((data ?? []) as unknown as Issue[])
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])
  useIssueChanges(() => load())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const all = issues ?? []
  const epics = all.filter((i) => typeById(i.type_id)?.level === 'epic')
  const categoryFor = (i: Issue) => categoryOf(i, statuses)
  // Only standard issues are planned: sub-tasks follow their parent, epics span sprints.
  const plannable = all.filter((i) => typeById(i.type_id)?.level === 'standard')
  const t = text.trim().toLowerCase()
  const shown = (i: Issue) =>
    (!t || i.key.toLowerCase().includes(t) || i.title.toLowerCase().includes(t)) && (!epicFilter || i.parent_id === epicFilter)
  const inList = (sprintId: string | null) =>
    plannable
      .filter((i) => i.sprint_id === sprintId && (sprintId !== null || categoryFor(i) !== 'done'))
      .sort(byRank)
  const listOf = (i: Issue) => i.sprint_id ?? BACKLOG

  async function move(issue: Issue, sprintId: string | null, index: number | 'end') {
    const target = inList(sprintId).filter((i) => i.id !== issue.id)
    const at = index === 'end' ? target.length : index
    let rank = rankForIndex(target, at, issue.id)
    if (rank === null) {
      await supabase.rpc('project_rerank', { p_project: project.id })
      await load()
      return
    }
    const patch = { sprint_id: sprintId, rank }
    const before = issues
    setIssues((rows) => rows && rows.map((r) => (r.id === issue.id ? { ...r, ...patch } : r)))
    setError(null)
    const { error: e } = await supabase.from('issues').update(patch).eq('id', issue.id)
    if (e) {
      setIssues(before)
      setError(errorMessage(e))
    } else if (issue.sprint_id !== sprintId) {
      emitIssueChange(issue.id)
    }
  }

  const movesFor = (i: Issue): MoveGroup[] =>
    editable
      ? [
          {
            title: 'Move to',
            options: [
              ...sprints.map((s) => ({ label: s.name, disabled: i.sprint_id === s.id, onSelect: () => move(i, s.id, 'end') })),
              { label: 'Backlog', disabled: i.sprint_id === null, onSelect: () => move(i, null, 0) },
            ],
          },
          {
            title: 'Order',
            options: [
              { label: 'Top', onSelect: () => move(i, i.sprint_id, 0) },
              { label: 'Bottom', onSelect: () => move(i, i.sprint_id, 'end') },
            ],
          },
        ]
      : []

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const issue = all.find((i) => i.id === e.active.id)
    if (!issue || !e.over) return
    const overId = String(e.over.id)
    if (overId.startsWith('list:')) {
      const target = overId.slice(5)
      move(issue, target === BACKLOG ? null : target, target === BACKLOG ? 0 : 'end')
      return
    }
    const over = all.find((i) => i.id === overId)
    if (!over) return
    const list = inList(over.sprint_id)
    const from = list.findIndex((i) => i.id === issue.id)
    const to = list.findIndex((i) => i.id === over.id)
    if (from === to && listOf(issue) === listOf(over)) return
    move(issue, over.sprint_id, to)
  }

  async function quickCreate(sprintId: string | null, title: string, typeId: string) {
    const last = inList(sprintId).at(-1)
    const { data, error: e } = await supabase.from('issues')
      .insert({ project_id: project.id, type_id: typeId, title, sprint_id: sprintId, ...(last ? { rank: last.rank + 1 } : {}) })
      .select(ISSUE_COLUMNS).single()
    if (e || !data) {
      setError(errorMessage(e))
      return false
    }
    setIssues((rows) => [...(rows ?? []), data as unknown as Issue])
    return true
  }

  async function createSprint() {
    setError(null)
    const n = (meta?.sprints.length ?? 0) + 1
    const { error: e } = await supabase.from('sprints').insert({ project_id: project.id, name: `${project.key} Sprint ${n}` })
    if (e) return setError(errorMessage(e))
    await invalidateProjectMeta(project.id)
  }

  function openStart(s: Sprint) {
    const start = s.start_date ?? todayIso()
    setForm({ name: s.name, goal: s.goal, start, end: s.end_date ?? addDays(start, 13), weeks: '2' })
    setDialogError(null)
    setStarting(s)
  }

  function openEdit(s: Sprint) {
    setForm({ name: s.name, goal: s.goal, start: s.start_date ?? '', end: s.end_date ?? '', weeks: '' })
    setDialogError(null)
    setEditing(s)
  }

  async function start() {
    if (!starting) return
    setBusy(true)
    const { error: e } = await supabase.rpc('sprint_start', {
      p_sprint: starting.id, p_start: form.start, p_end: form.end, p_name: form.name, p_goal: form.goal,
    })
    setBusy(false)
    if (e) return setDialogError(errorMessage(e))
    setStarting(null)
    await invalidateProjectMeta(project.id)
    emitIssueChange()
  }

  async function saveEdit() {
    if (!editing) return
    setBusy(true)
    const { error: e } = await supabase.from('sprints')
      .update({ name: form.name.trim(), goal: form.goal, start_date: form.start || null, end_date: form.end || null }).eq('id', editing.id)
    setBusy(false)
    if (e) return setDialogError(errorMessage(e))
    setEditing(null)
    invalidateProjectMeta(project.id)
  }

  async function complete() {
    if (!completing) return
    setBusy(true)
    setDialogError(null)
    let target: string | null = moveTo === BACKLOG ? null : moveTo
    if (moveTo === 'new') {
      const n = (meta?.sprints.length ?? 0) + 1
      const { data, error: e } = await supabase.from('sprints').insert({ project_id: project.id, name: `${project.key} Sprint ${n}` }).select().single()
      if (e || !data) {
        setBusy(false)
        return setDialogError(errorMessage(e))
      }
      target = (data as Sprint).id
    }
    const { error: e } = await supabase.rpc('sprint_complete', { p_sprint: completing.id, p_move_to: target })
    setBusy(false)
    if (e) return setDialogError(errorMessage(e))
    setCompleting(null)
    await invalidateProjectMeta(project.id)
    await load()
    emitIssueChange()
  }

  async function removeSprint() {
    if (!deleting) return
    setBusy(true)
    const { error: e } = await supabase.from('sprints').delete().eq('id', deleting.id)
    setBusy(false)
    if (e) return setError(errorMessage(e))
    setDeleting(null)
    await invalidateProjectMeta(project.id)
    await load()
  }

  if (!issues || !meta) return <Loading />

  const section = (sprint: Sprint | null) => {
    const id = sprint?.id ?? BACKLOG
    const rows = inList(sprint?.id ?? null)
    const visible = rows.filter(shown)
    const open = !collapsed.includes(id)
    const doneCount = rows.filter((i) => categoryFor(i) === 'done').length
    return (
      <Paper key={id} variant="outlined" sx={{ mb: 2, overflow: 'hidden' }} data-list={sprint?.name ?? 'Backlog'}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1, py: 1, bgcolor: 'background.subtle', flexWrap: 'wrap', rowGap: 0.5 }}>
          <IconButton size="small" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setCollapsed((c) => (open ? [...c, id] : c.filter((x) => x !== id)))}>
            {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
          <Typography variant="subtitle2">{sprint?.name ?? 'Backlog'}</Typography>
          {sprint && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {sprint.start_date ? formatDateRange(sprint.start_date, sprint.end_date) : 'No dates'}
            </Typography>
          )}
          {sprint?.state === 'active' && <Chip size="small" color="primary" label="Active" />}
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            ({rows.length} issue{rows.length === 1 ? '' : 's'}{sprint && doneCount ? `, ${doneCount} done` : ''})
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <CategoryCounts issues={rows} categoryFor={categoryFor} />
          {sprint && editable && sprint.state === 'future' && (
            <Tooltip title={activeSprint ? 'Complete the active sprint first' : ''}>
              <span>
                <Button size="small" variant="outlined" disabled={!!activeSprint || !rows.length} onClick={() => openStart(sprint)}>Start sprint</Button>
              </span>
            </Tooltip>
          )}
          {sprint?.state === 'active' && editable && (
            <Button size="small" variant="contained" onClick={() => { setMoveTo(BACKLOG); setDialogError(null); setCompleting(sprint) }}>
              Complete sprint
            </Button>
          )}
          {sprint && editable && (
            <IconButton size="small" aria-label={`${sprint.name} actions`} onClick={(e) => setSprintMenu({ anchor: e.currentTarget, sprint })}>
              <MoreHorizIcon />
            </IconButton>
          )}
          {!sprint && editable && <Button size="small" variant="outlined" onClick={createSprint}>Create sprint</Button>}
        </Stack>
        {sprint?.goal && open && (
          <Typography variant="body2" sx={{ px: 2, pb: 1, bgcolor: 'background.subtle', color: 'text.secondary' }}>{sprint.goal}</Typography>
        )}
        {open && (
          <>
            <SortableContext items={visible.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <DropList id={listId(sprint?.id ?? null)} empty={rows.length ? '' : sprint ? 'Plan this sprint: drag issues here, or use an issue’s menu.' : 'The backlog is empty.'}>
                {visible.map((i) => <BacklogRow key={i.id} issue={i} moves={movesFor(i)} draggable={editable} />)}
              </DropList>
            </SortableContext>
            {can.editIssues(role) && <QuickCreate onCreate={(title, typeId) => quickCreate(sprint?.id ?? null, title, typeId)} />}
          </>
        )}
      </Paper>
    )
  }

  const unfinished = completing ? inList(completing.id).filter((i) => categoryFor(i) !== 'done') : []
  const finished = completing ? inList(completing.id).filter((i) => categoryFor(i) === 'done') : []

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
        <TextField placeholder="Search the backlog" value={text} onChange={(e) => setText(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Search the backlog' } }} sx={{ width: { xs: '100%', sm: 240 }, bgcolor: 'background.paper' }} />
        {epics.length > 0 && (
          <TextField select label="Epic" value={epicFilter} onChange={(e) => setEpicFilter(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All epics</MenuItem>
            {epics.map((e) => <MenuItem key={e.id} value={e.id}>{e.key} {e.title}</MenuItem>)}
          </TextField>
        )}
        <Typography variant="body2" sx={{ color: 'text.secondary', ml: 'auto !important' }}>
          {inList(null).length} issues not yet planned
        </Typography>
      </Stack>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={(e) => setDragging(all.find((i) => i.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        {sprints.map((s) => section(s))}
        {section(null)}
        <DragOverlay>{dragging && <BacklogRow issue={dragging} moves={[]} overlay />}</DragOverlay>
      </DndContext>

      <Menu anchorEl={sprintMenu?.anchor} open={!!sprintMenu} onClose={() => setSprintMenu(null)}>
        <MenuItem onClick={() => { const s = sprintMenu!.sprint; setSprintMenu(null); openEdit(s) }}>Edit sprint</MenuItem>
        {sprintMenu?.sprint.state === 'future' && (
          <MenuItem sx={{ color: 'error.main' }} onClick={() => { const s = sprintMenu!.sprint; setSprintMenu(null); setDeleting(s) }}>
            Delete sprint
          </MenuItem>
        )}
      </Menu>

      <FormDialog open={!!starting} title={`Start ${starting?.name ?? 'sprint'}`} submitLabel="Start" busy={busy} error={dialogError}
        onSubmit={start} onClose={() => setStarting(null)}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {starting && `${inList(starting.id).length} issues, ${formatPoints(sumPoints(inList(starting.id)))} points will be committed.`}
        </Typography>
        <TextField label="Sprint name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <TextField select label="Duration" value={form.weeks} onChange={(e) => {
          const weeks = e.target.value
          setForm({ ...form, weeks, end: weeks === 'custom' ? form.end : addDays(form.start, Number(weeks) * 7 - 1) })
        }}>
          {['1', '2', '3', '4'].map((w) => <MenuItem key={w} value={w}>{w} week{w === '1' ? '' : 's'}</MenuItem>)}
          <MenuItem value="custom">Custom</MenuItem>
        </TextField>
        <Stack direction="row" spacing={2}>
          <TextField label="Start date" type="date" value={form.start} fullWidth slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => {
            const startDate = e.target.value
            setForm({ ...form, start: startDate, end: form.weeks === 'custom' ? form.end : addDays(startDate, Number(form.weeks) * 7 - 1) })
          }} />
          <TextField label="End date" type="date" value={form.end} fullWidth slotProps={{ inputLabel: { shrink: true } }}
            onChange={(e) => setForm({ ...form, end: e.target.value, weeks: 'custom' })} />
        </Stack>
        <TextField label="Sprint goal" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} multiline minRows={2} />
      </FormDialog>

      <FormDialog open={!!editing} title={`Edit ${editing?.name ?? 'sprint'}`} busy={busy} error={dialogError}
        onSubmit={saveEdit} onClose={() => setEditing(null)}>
        <TextField label="Sprint name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Stack direction="row" spacing={2}>
          <TextField label="Start date" type="date" value={form.start} fullWidth slotProps={{ inputLabel: { shrink: true } }}
            onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <TextField label="End date" type="date" value={form.end} fullWidth slotProps={{ inputLabel: { shrink: true } }}
            onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </Stack>
        <TextField label="Sprint goal" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} multiline minRows={2} />
      </FormDialog>

      <FormDialog open={!!completing} title={`Complete ${completing?.name ?? 'sprint'}`} submitLabel="Complete sprint" busy={busy}
        error={dialogError} onSubmit={complete} onClose={() => setCompleting(null)}>
        <Typography variant="body2">
          {finished.length} issue{finished.length === 1 ? '' : 's'} done ({formatPoints(sumPoints(finished))} points),{' '}
          {unfinished.length} still open.
        </Typography>
        {unfinished.length > 0 && (
          <TextField select label="Move the open issues to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <MenuItem value={BACKLOG}>Backlog</MenuItem>
            {sprints.filter((s) => s.state === 'future').map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
            <MenuItem value="new">A new sprint</MenuItem>
          </TextField>
        )}
      </FormDialog>

      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.name}?`} confirmLabel="Delete" destructive busy={busy}
        message="Its issues go back to the backlog." onConfirm={removeSprint} onClose={() => setDeleting(null)} />
    </Box>
  )
}
