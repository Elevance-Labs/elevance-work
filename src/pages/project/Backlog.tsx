// The backlog (Scrum): the active and planned sprints, then everything not
// yet planned, in rank order. Drag issues between them, or use each row's
// menu. Sprints are created here, started and completed through the
// database's sprint_start / sprint_complete. Quick filters narrow every
// list; the Epics panel (as Jira's) filters by epic, and a row joins an
// epic by its chip, its menu, or being dropped on the epic in the panel.
// Rows can be selected (click, Cmd/Ctrl, Shift) and moved together: by the
// selection's bar, a selected row's menu, or dragging one of them.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined'
import CloseIcon from '@mui/icons-material/Close'
import BoltIcon from '@mui/icons-material/Bolt'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import { useMe } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { can } from '../../lib/permissions'
import { addDays, errorMessage, formatDateRange, formatPoints, todayIso } from '../../lib/constants'
import { ISSUE_COLUMNS, byRank, categoryOf, isDone, sumPoints } from '../../lib/issues'
import { isPlainKey } from '../../lib/search'
import {
  EMPTY_BACKLOG_FILTER,
  NO_EPIC,
  backlogFiltered,
  blockRanks,
  epicDropId,
  epicTargetOf,
  matchesBacklog,
  nextSelection,
  type BacklogFilter,
  type PickMode,
} from '../../lib/backlog'
import type { Issue, Sprint, StatusCategory } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { invalidateProjectMeta, useProjectMeta } from '../../workspace/useProjectMeta'
import { emitIssueChange, useIssueChanges } from '../../workspace/issueEvents'
import { ConfirmDialog, FormDialog, Loading } from '../../components/common'
import { BacklogRow, type MoveGroup } from '../../components/IssueCard'
import { useFlagMenu } from '../../components/issue/flagging'
import AssigneeFilter from '../../components/AssigneeFilter'
import { EpicLozenge, EpicMenu, EpicsPanel } from '../../components/backlog/Epics'
import { TypeIcon } from '../../components/IssueBits'
import { useProject } from './projectContext'

const BACKLOG = 'backlog'
const listId = (sprintId: string | null) => `list:${sprintId ?? BACKLOG}`
const EPIC_DROP = epicDropId('')

// Whether the Epics panel is open, remembered in this browser.
const PANEL_KEY = 'elevance.work.backlog-epics'
function readPanel() {
  try {
    return window.localStorage.getItem(PANEL_KEY) === '1'
  } catch {
    return false
  }
}
function writePanel(open: boolean) {
  try {
    window.localStorage.setItem(PANEL_KEY, open ? '1' : '0')
  } catch {
    // Storage can be refused (private windows); the choice then lasts the visit.
  }
}

// A row dropped on an epic in the panel goes there when the pointer is over
// it; anywhere else the lists sort as before, the epics left out.
const collide: CollisionDetection = (args) => {
  const onEpic = pointerWithin(args).find((c) => String(c.id).startsWith(EPIC_DROP))
  if (onEpic) return [onEpic]
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => !String(c.id).startsWith(EPIC_DROP)) })
}

function QuickChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <Chip label={label} clickable aria-pressed={on} color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} onClick={onClick} />
}

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
  const me = useMe()
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('md'))
  const { typeById, statusesOf, issueTypes } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const editable = can.planSprints(role)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<BacklogFilter>(EMPTY_BACKLOG_FILTER)
  // "Recently updated" counts back from when the issues were loaded.
  const [now, setNow] = useState(() => Date.now())
  const [panelOpen, setPanelOpen] = useState(readPanel)
  const [epicMenu, setEpicMenu] = useState<{ issues: Issue[]; anchor: HTMLElement } | null>(null)
  // Selected rows (ids), and the last one picked (where a Shift range starts).
  const [selected, setSelected] = useState<string[]>([])
  const [pickedLast, setPickedLast] = useState<string | null>(null)
  const [bulkMenu, setBulkMenu] = useState<HTMLElement | null>(null)
  const listsRef = useRef<HTMLDivElement>(null)
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
    setNow(Date.now())
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
  const epics = all.filter((i) => typeById(i.type_id)?.level === 'epic').sort(byRank)
  const openEpics = epics.filter((e) => !isDone(e, statuses))
  const epicById = (id: string | null) => (id ? epics.find((e) => e.id === id) : undefined)
  const categoryFor = (i: Issue) => categoryOf(i, statuses)
  // Only standard issues are planned: sub-tasks follow their parent, epics span sprints.
  const plannable = all.filter((i) => typeById(i.type_id)?.level === 'standard')
  const shown = (i: Issue) => matchesBacklog(i, filter, me.id, now)
  const patchFilter = (p: Partial<BacklogFilter>) => setFilter((f) => ({ ...f, ...p }))
  const canEdit = can.editIssues(role)
  const epicType = issueTypes.find((x) => x.level === 'epic' && !x.archived)
  const listIn = (rows: Issue[], sprintId: string | null) =>
    rows
      .filter((i) => typeById(i.type_id)?.level === 'standard' && i.sprint_id === sprintId && (sprintId !== null || categoryFor(i) !== 'done'))
      .sort(byRank)
  const inList = (sprintId: string | null) => listIn(all, sprintId)
  const listOf = (i: Issue) => i.sprint_id ?? BACKLOG

  // Saving several rows at once: shown at once, each saved; on a refusal the
  // page reloads (some may have saved) and says why.
  async function saveEach(patches: Map<string, Partial<Issue>>, shownRows: Issue[], changed: boolean) {
    if (!patches.size) return
    setIssues(shownRows.map((r) => (patches.has(r.id) ? { ...r, ...patches.get(r.id) } : r)))
    setError(null)
    const results = await Promise.all([...patches].map(([id, patch]) => supabase.from('issues').update(patch).eq('id', id)))
    const failed = results.find((r) => r.error)?.error
    if (failed) {
      setError(errorMessage(failed))
      await load()
    } else if (changed) emitIssueChange(patches.size === 1 ? [...patches.keys()][0] : undefined)
  }

  // Move issues (in this order) together into a sprint, or the backlog
  // (null), at `index` among what is there already.
  async function move(group: Issue[], sprintId: string | null, index: number | 'end') {
    if (!group.length) return
    const ids = group.map((i) => i.id)
    const place = (rows: Issue[]) => {
      const list = listIn(rows, sprintId)
      const others = list.length - list.filter((i) => ids.includes(i.id)).length
      return blockRanks(list, index === 'end' ? others : Math.min(index, others), ids)
    }
    let rows = all
    let ranks = place(rows)
    if (!ranks) {
      // Too close to split: renumber the project, then place them.
      await supabase.rpc('project_rerank', { p_project: project.id })
      const { data } = await supabase.from('issues').select('id, rank').eq('project_id', project.id)
      const fresh = new Map(((data ?? []) as { id: string; rank: number }[]).map((r) => [r.id, r.rank]))
      rows = all.map((i) => ({ ...i, rank: fresh.get(i.id) ?? i.rank }))
      ranks = place(rows)
      if (!ranks) return load()
    }
    const patches = new Map(group.map((i, k) => [i.id, { sprint_id: sprintId, rank: ranks[k] }]))
    await saveEach(patches, rows, group.some((i) => i.sprint_id !== sprintId))
  }

  // Put issues under an epic, or out of theirs (null).
  async function setEpic(group: Issue[], epicId: string | null) {
    const moving = group.filter((i) => i.parent_id !== epicId)
    await saveEach(new Map(moving.map((i) => [i.id, { parent_id: epicId }])), all, true)
  }

  async function createEpic(title: string) {
    if (!epicType) return false
    setError(null)
    const { data, error: e } = await supabase.from('issues')
      .insert({ project_id: project.id, type_id: epicType.id, title }).select(ISSUE_COLUMNS).single()
    if (e || !data) {
      setError(errorMessage(e))
      return false
    }
    setIssues((rows) => [...(rows ?? []), data as unknown as Issue])
    return true
  }

  const openEpicMenu = (group: Issue[], anchor?: HTMLElement | null) => {
    const at = anchor ?? listsRef.current?.querySelector<HTMLElement>(`[data-issue="${group[0].key}"]`)
    if (at) setEpicMenu({ issues: group, anchor: at })
  }

  // The selection: the selected rows the filters show, in list order.
  const listed = [...sprints.flatMap((s) => inList(s.id)), ...inList(null)]
  const picked = listed.filter((i) => selected.includes(i.id) && shown(i))
  // A selected row acts for the whole selection; any other row for itself.
  const groupOf = (i: Issue) => (picked.length > 1 && picked.some((p) => p.id === i.id) ? picked : [i])
  const pick = (i: Issue, mode: PickMode, order: string[]) => {
    setSelected((cur) => nextSelection(cur, i.id, mode, order, pickedLast))
    setPickedLast(i.id)
  }

  const togglePanel = (open = !panelOpen) => setPanelOpen(open)
  useEffect(() => writePanel(panelOpen), [panelOpen])

  // E opens and closes the Epics panel, as in Jira.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPlainKey(e, 'escape')) return setSelected([])
      if (!isPlainKey(e, 'e')) return
      e.preventDefault()
      setPanelOpen((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const flags = useFlagMenu(setError)
  const movesFor = (i: Issue): MoveGroup[] => {
    if (!editable) return []
    const group = groupOf(i)
    const allIn = (sprintId: string | null) => group.every((g) => g.sprint_id === sprintId)
    const hasEpic = group.some((g) => !!g.parent_id)
    return [
      {
        title: group.length > 1 ? `Move ${group.length} issues to` : 'Move to',
        options: [
          ...sprints.map((s) => ({ label: s.name, disabled: allIn(s.id), onSelect: () => move(group, s.id, 'end') })),
          { label: 'Backlog', disabled: allIn(null), onSelect: () => move(group, null, 0) },
        ],
      },
      {
        title: 'Order',
        options: [
          { label: 'Top', onSelect: () => move(group, i.sprint_id, 0) },
          { label: 'Bottom', onSelect: () => move(group, i.sprint_id, 'end') },
        ],
      },
      {
        title: 'Epic',
        options: [
          { label: hasEpic ? 'Change epic…' : 'Add to epic…', onSelect: () => openEpicMenu(group) },
          ...(hasEpic ? [{ label: 'Remove from epic', onSelect: () => setEpic(group, null) }] : []),
        ],
      },
      flags.group(i),
    ]
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const issue = all.find((i) => i.id === e.active.id)
    if (!issue || !e.over) return
    // Dragging a selected row takes the whole selection with it.
    const group = groupOf(issue)
    const overId = String(e.over.id)
    if (overId.startsWith(EPIC_DROP)) {
      const epic = overId.slice(EPIC_DROP.length)
      setEpic(group, epic === NO_EPIC ? null : epic)
      return
    }
    if (overId.startsWith('list:')) {
      const target = overId.slice(5)
      move(group, target === BACKLOG ? null : target, target === BACKLOG ? 0 : 'end')
      return
    }
    const over = all.find((i) => i.id === overId)
    if (!over || group.some((g) => g.id === over.id)) return
    const list = inList(over.sprint_id)
    const others = list.filter((i) => !group.some((g) => g.id === i.id))
    // Down the same list it lands after the row it's over; else before it.
    const down = listOf(issue) === listOf(over) && list.indexOf(issue) < list.indexOf(over)
    move(group, over.sprint_id, others.indexOf(over) + (down ? 1 : 0))
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

  const epicChip = (i: Issue) => {
    const epic = epicById(i.parent_id)
    return epic ? <EpicLozenge epic={epic} onClick={editable ? (anchor) => openEpicMenu([i], anchor) : undefined} /> : null
  }

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
              <DropList id={listId(sprint?.id ?? null)}
                empty={rows.length ? (visible.length ? '' : 'No issues here match the filters.') : sprint ? 'Plan this sprint: drag issues here, or use an issue’s menu.' : 'The backlog is empty.'}>
                {visible.map((i) => (
                  <BacklogRow key={i.id} issue={i} moves={movesFor(i)} draggable={editable} extra={epicChip(i)}
                    selected={selected.includes(i.id)} onPick={editable ? (mode) => pick(i, mode, visible.map((v) => v.id)) : undefined} />
                ))}
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

  const assignees = [...new Set(listed.map((i) => i.assignee_id ?? 'none'))]
  const filtered = backlogFiltered(filter)
  const panel = (
    <EpicsPanel epics={epics} issues={plannable} statuses={statuses} selected={filter.epic}
      withoutEpic={listed.filter((i) => !i.parent_id).length}
      onSelect={(epic) => { patchFilter({ epic }); if (narrow) togglePanel(false) }}
      onClose={() => togglePanel(false)} onCreate={canEdit && epicType ? createEpic : undefined}
      onOpenEpic={() => narrow && togglePanel(false)} />
  )

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
        <TextField placeholder="Search the backlog" value={filter.text} onChange={(e) => patchFilter({ text: e.target.value })}
          slotProps={{ htmlInput: { 'aria-label': 'Search the backlog' } }} sx={{ width: { xs: '100%', sm: 240 }, bgcolor: 'background.paper' }} />
        <AssigneeFilter assignees={assignees} value={filter.people} onChange={(people) => patchFilter({ people })} />
        <QuickChip label="Only my issues" on={filter.mine} onClick={() => patchFilter({ mine: !filter.mine })} />
        <QuickChip label="Recently updated" on={filter.recent} onClick={() => { setNow(Date.now()); patchFilter({ recent: !filter.recent }) }} />
        {(filter.flagged || listed.some((i) => i.flag_reason)) && (
          <QuickChip label="Flagged" on={filter.flagged} onClick={() => patchFilter({ flagged: !filter.flagged })} />
        )}
        {filter.epic && (
          <Chip label={filter.epic === NO_EPIC ? 'Without epic' : `Epic: ${epicById(filter.epic)?.title ?? '…'}`} color="primary"
            onDelete={() => patchFilter({ epic: '' })} sx={{ maxWidth: 240 }} />
        )}
        {filtered && <Button size="small" onClick={() => setFilter(EMPTY_BACKLOG_FILTER)}>Clear filters</Button>}
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
          {inList(null).length} issues not yet planned
        </Typography>
        <Tooltip title={`${panelOpen ? 'Hide' : 'Show'} the epics panel (E)`}>
          <Button size="small" variant={panelOpen ? 'contained' : 'outlined'} startIcon={<ViewSidebarOutlinedIcon sx={{ transform: 'scaleX(-1)' }} />}
            aria-pressed={panelOpen} aria-keyshortcuts="E" onClick={() => togglePanel()}>
            Epics
          </Button>
        </Tooltip>
      </Stack>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
      <DndContext sensors={sensors} collisionDetection={collide}
        onDragStart={(e) => setDragging(all.find((i) => i.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          {panelOpen && !narrow && (
            <Box sx={{ width: 264, flexShrink: 0, position: 'sticky', top: 80, maxHeight: 'calc(100vh - 96px)', overflowY: 'auto' }}>
              {panel}
            </Box>
          )}
          <Box ref={listsRef} data-selecting={picked.length > 0} sx={{ flexGrow: 1, minWidth: 0 }}>
            {editable && picked.length > 0 && (
              <Paper elevation={3} role="toolbar" aria-label="Selected issues"
                sx={{ position: 'sticky', top: { xs: 64, sm: 72 }, zIndex: 3, mb: 1.5, px: 1.5, py: 0.5, display: 'flex', alignItems: 'center',
                  gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {picked.length} issue{picked.length === 1 ? '' : 's'} selected
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>· {formatPoints(sumPoints(picked))} points</Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Button size="small" startIcon={<DriveFileMoveOutlinedIcon />} onClick={(e) => setBulkMenu(e.currentTarget)}>Move to</Button>
                <Button size="small" startIcon={<BoltIcon />} onClick={(e) => openEpicMenu(picked, e.currentTarget)}>Epic</Button>
                <Tooltip title="Clear the selection (Esc)">
                  <IconButton size="small" aria-label="Clear the selection" onClick={() => setSelected([])}><CloseIcon fontSize="small" /></IconButton>
                </Tooltip>
              </Paper>
            )}
            {sprints.map((s) => section(s))}
            {section(null)}
          </Box>
        </Box>
        <DragOverlay>
          {dragging && (
            <Box sx={{ position: 'relative' }}>
              <BacklogRow issue={dragging} moves={[]} overlay extra={epicChip(dragging)} />
              {groupOf(dragging).length > 1 && (
                <Chip size="small" color="primary" label={`${groupOf(dragging).length} issues`}
                  sx={{ position: 'absolute', top: -10, right: -6, fontWeight: 700 }} />
              )}
            </Box>
          )}
        </DragOverlay>
      </DndContext>
      {narrow && (
        <Drawer anchor="left" open={panelOpen} onClose={() => togglePanel(false)}
          slotProps={{ paper: { sx: { width: 'min(320px, 88vw)', p: 1, pt: 'calc(8px + env(safe-area-inset-top))', bgcolor: 'background.default' } } }}>
          {panel}
        </Drawer>
      )}
      <EpicMenu anchor={epicMenu?.anchor ?? null} target={epicMenu ? epicTargetOf(epicMenu.issues) : null} epics={openEpics}
        onPick={(epicId) => epicMenu && setEpic(epicMenu.issues, epicId)} onClose={() => setEpicMenu(null)} />
      <Menu anchorEl={bulkMenu} open={!!bulkMenu} onClose={() => setBulkMenu(null)}
        slotProps={{ list: { 'aria-label': `Move ${picked.length} issues to`, dense: true } }}>
        {[...sprints.map((s) => ({ id: s.id as string | null, name: s.name })), { id: null, name: 'Backlog' }].map((t) => (
          <MenuItem key={t.id ?? BACKLOG} disabled={picked.every((i) => i.sprint_id === t.id)}
            onClick={() => { setBulkMenu(null); move(picked, t.id, t.id ? 'end' : 0) }}>
            {t.name}
          </MenuItem>
        ))}
      </Menu>

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
      {flags.dialog}
    </Box>
  )
}
