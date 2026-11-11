// Todos: your own, and the ones people put you on. Everyone on a todo sees,
// edits and ticks it off, and adds people; only whoever made it deletes it
// (RLS). A todo may be due on a day and tied to an issue or just to a
// project (an issue's todo is in its project). The Todos page
// shows them all; the dashboard, what's due; an issue, the ones tied to it.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  AvatarGroup,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  IconButton,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { addDays, errorMessage, formatDate, todayIso } from '../lib/constants'
import type { Issue, Profile, Todo } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { useItemChanges } from '../workspace/itemEvents'
import { PersonAvatar } from './common'
import { ProjectAvatar } from './IssueBits'
import { IssuePicker, PeoplePicker } from './pickers'

type Row = Todo & { issue: { key: string; title: string } | null }
export const TODO_COLUMNS = '*, issue:issues(key, title)'

function groupTodos(todos: Row[], today: string) {
  const open = todos.filter((t) => !t.done_at)
  const byDue = (a: Row, b: Row) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.position - b.position
  return {
    overdue: open.filter((t) => t.due_on && t.due_on < today).sort(byDue),
    today: open.filter((t) => t.due_on === today).sort(byDue),
    upcoming: open.filter((t) => t.due_on && t.due_on > today).sort(byDue),
    someday: open.filter((t) => !t.due_on).sort(byDue),
    done: todos.filter((t) => t.done_at).sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '')),
  }
}

/** Who is on a todo and who may be added: its creator and people, for the creator or anyone on it. */
function TodoPeople({ todo, onChange, onLeave }: { todo: Row; onChange: (sharedWith: string[]) => void; onLeave: () => void }) {
  const me = useMe()
  const { profiles, profileById } = useWorkspace()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const mine = todo.owner_id === me.id
  // Everyone on it but you: the creator (if not you) and the rest.
  const others = [todo.owner_id, ...todo.shared_with].filter((id) => id !== me.id)
    .map((id) => profileById(id)).filter((p): p is Profile => !!p)
  // You take yourself off with Leave, not here: the list you edit leaves you on it.
  const editable = todo.shared_with.filter((id) => id !== me.id)
  const options = profiles.filter((p) => p.active && p.id !== todo.owner_id && p.id !== me.id)
  const owner = profileById(todo.owner_id)
  const label = others.length ? `People on ${todo.title}` : `Add people to ${todo.title}`

  return (
    <>
      <Tooltip title={others.length ? others.map((p) => p.full_name).join(', ') : 'Add people'}>
        {others.length ? (
          <Box component="button" type="button" aria-label={label} onClick={(e) => setAnchor(e.currentTarget)}
            sx={{ border: 0, p: 0, bgcolor: 'transparent', cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}>
            <AvatarGroup max={3} sx={{ '& .MuiAvatar-root': { width: 22, height: 22, fontSize: 10 } }}>
              {others.map((p) => <PersonAvatar key={p.id} person={p} size={22} />)}
            </AvatarGroup>
          </Box>
        ) : (
          <IconButton size="small" aria-label={label} onClick={(e) => setAnchor(e.currentTarget)}>
            <PersonAddAltOutlinedIcon fontSize="small" />
          </IconButton>
        )}
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Stack spacing={1.5} sx={{ p: 2, width: 340, maxWidth: '90vw' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {mine ? 'People you add see this todo, edit it and tick it off. Only you can delete it.'
              : `${owner?.full_name ?? 'Someone'} made this todo. Everyone on it can see, edit and tick it off.`}
          </Typography>
          <PeoplePicker label="People" value={editable} options={options}
            onChange={(ids) => onChange(mine ? ids : [...ids, me.id])} />
          {!mine && (
            <Box>
              <Button size="small" color="error" onClick={() => { setAnchor(null); onLeave() }}>Leave this todo</Button>
            </Box>
          )}
        </Stack>
      </Popover>
    </>
  )
}

/** Which project a new todo is about (none, or one you can see that isn't archived). */
export function TodoProjectSelect({ value, onChange, size }: { value: string; onChange: (id: string) => void; size?: 'small' | 'medium' }) {
  const { projects } = useWorkspace()
  return (
    <TextField select fullWidth label="Project (optional)" value={value} onChange={(e) => onChange(e.target.value)} size={size}>
      <MenuItem value="">None</MenuItem>
      {projects.filter((p) => !p.archived_at).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
    </TextField>
  )
}

function TodoItem({ todo, showIssue, onChange, onDelete, onLeave }: {
  todo: Row
  showIssue: boolean
  onChange: (t: Partial<Todo>) => void
  onDelete: () => void
  onLeave: () => void
}) {
  const me = useMe()
  const { projectById } = useWorkspace()
  const [title, setTitle] = useState(todo.title)
  const today = todayIso()
  const project = !todo.issue ? projectById(todo.project_id) : undefined
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.25 }} data-todo={todo.id}>
      <Checkbox checked={!!todo.done_at} slotProps={{ input: { 'aria-label': `Done: ${todo.title}` } }}
        onChange={(e) => onChange({ done_at: e.target.checked ? new Date().toISOString() : null })} />
      <TextField variant="standard" fullWidth value={title} onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== todo.title && onChange({ title: title.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        slotProps={{ input: { disableUnderline: true, sx: { textDecoration: todo.done_at ? 'line-through' : 'none', color: todo.done_at ? 'text.secondary' : undefined } },
          htmlInput: { 'aria-label': 'Todo' } }} />
      <TodoPeople todo={todo} onChange={(shared_with) => onChange({ shared_with })} onLeave={onLeave} />
      {showIssue && todo.issue && (
        <Chip size="small" label={todo.issue.key} component={Link} to={{ search: `?issue=${todo.issue.key}` }} clickable variant="outlined" />
      )}
      {showIssue && project && (
        <Tooltip title={project.name}>
          <Chip size="small" variant="outlined" label={project.key} avatar={<ProjectAvatar project={project} size={18} />}
            component={Link} to={`/projects/${project.key}/calendar`} clickable />
        </Tooltip>
      )}
      <TextField type="date" variant="standard" value={todo.due_on ?? ''} onChange={(e) => onChange({ due_on: e.target.value || null })}
        slotProps={{ htmlInput: { 'aria-label': 'Due on' }, input: { disableUnderline: true } }}
        sx={{ width: 130, flexShrink: 0, '& input': { color: !todo.done_at && todo.due_on && todo.due_on < today ? 'error.main' : 'text.secondary', fontSize: 13 } }} />
      {todo.owner_id === me.id ? (
        <Tooltip title="Delete">
          <IconButton size="small" aria-label={`Delete ${todo.title}`} onClick={onDelete}><DeleteOutlineIcon fontSize="small" /></IconButton>
        </Tooltip>
      ) : (
        // Only its creator deletes a todo; keeps the row's columns lined up.
        <Box sx={{ width: 34, flexShrink: 0 }} />
      )}
    </Stack>
  )
}

/**
 * onChange: after any write here, so a view showing the same todos (the dashboard's agenda) reads them again.
 * issue: only the todos tied to that issue, and new ones are tied to it.
 */
export default function TodoList({ compact, onChange, issue }: {
  compact?: boolean
  onChange?: () => void
  issue?: { id: string; key: string }
}) {
  const me = useMe()
  const { profiles } = useWorkspace()
  const [todos, setTodos] = useState<Row[] | null>(null)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [linked, setLinked] = useState<Issue | null>(null)
  const [projectId, setProjectId] = useState('')
  const [people, setPeople] = useState<string[]>([])
  const [showMore, setShowMore] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = todayIso()
  const issueId = issue?.id

  const load = useCallback(async () => {
    let q = supabase.from('todos').select(TODO_COLUMNS)
    if (issueId) q = q.eq('issue_id', issueId)
    const { data } = await q.order('position')
    setTodos((data ?? []) as unknown as Row[])
  }, [issueId])

  useEffect(() => {
    load()
  }, [load])
  useItemChanges(['todo'], load)

  async function add() {
    if (!title.trim()) return
    setError(null)
    const { data, error: e } = await supabase.from('todos')
      .insert({ title: title.trim(), due_on: due || null, issue_id: issueId ?? linked?.id ?? null,
        project_id: issueId || linked ? null : projectId || null, shared_with: people })
      .select(TODO_COLUMNS).single()
    if (e || !data) return setError(errorMessage(e))
    setTodos((ts) => [...(ts ?? []), data as unknown as Row])
    onChange?.()
    setTitle('')
    setDue('')
    setLinked(null)
    setProjectId('')
    setPeople([])
  }

  async function update(t: Row, patch: Partial<Todo>) {
    setTodos((ts) => ts && ts.map((x) => (x.id === t.id ? { ...x, ...patch } : x)))
    const { error: e } = await supabase.from('todos').update(patch).eq('id', t.id)
    if (e) {
      setError(errorMessage(e))
      load()
    }
    onChange?.()
  }

  async function remove(t: Row) {
    setTodos((ts) => ts && ts.filter((x) => x.id !== t.id))
    const { error: e } = await supabase.from('todos').delete().eq('id', t.id)
    if (e) {
      setError(errorMessage(e))
      load()
    }
    onChange?.()
  }

  // Off someone else's todo: it leaves your list.
  async function leave(t: Row) {
    setTodos((ts) => ts && ts.filter((x) => x.id !== t.id))
    const { error: e } = await supabase.rpc('todo_leave', { p_todo: t.id })
    if (e) {
      setError(errorMessage(e))
      load()
    }
    onChange?.()
  }

  if (!todos) return null
  const g = groupTodos(todos, today)
  const group = (label: string, rows: Row[], color?: string) => rows.length > 0 && (
    <Box key={label} sx={{ mb: 1 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', color: color ?? 'text.secondary' }}>
        {label} ({rows.length})
      </Typography>
      {rows.map((t) => (
        <TodoItem key={t.id} todo={t} showIssue={!issueId} onChange={(p) => update(t, p)} onDelete={() => remove(t)} onLeave={() => leave(t)} />
      ))}
    </Box>
  )
  const nothingOpen = !g.overdue.length && !g.today.length && !g.upcoming.length && !g.someday.length

  return (
    <Box>
      <Box component="form" onSubmit={(e) => { e.preventDefault(); add() }} sx={{ mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField fullWidth placeholder={issue ? `Add a todo for ${issue.key}` : 'Add a todo'} value={title}
            onChange={(e) => setTitle(e.target.value)} size={issue ? 'small' : 'medium'}
            slotProps={{ htmlInput: { 'aria-label': 'New todo', maxLength: 300 } }} />
          <TextField type="date" value={due} onChange={(e) => setDue(e.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Due on' } }}
            size={issue ? 'small' : 'medium'} sx={{ minWidth: 150 }} />
          <Button type="submit" variant="contained" disabled={!title.trim()}>Add</Button>
        </Stack>
        {!compact && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
            {!issue && (
              <Box sx={{ flex: 1 }}>
                <IssuePicker label="Link to an issue (optional)" value={linked} onChange={setLinked} />
              </Box>
            )}
            {!issue && !linked && (
              <Box sx={{ flex: 1 }}>
                <TodoProjectSelect value={projectId} onChange={setProjectId} />
              </Box>
            )}
            <Box sx={{ flex: 1 }}>
              <PeoplePicker label="Add people (optional)" value={people}
                options={profiles.filter((p) => p.active && p.id !== me.id)} onChange={setPeople} />
            </Box>
          </Stack>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {[['Today', today], ['Tomorrow', addDays(today, 1)], ['Next week', addDays(today, 7)]].map(([label, d]) => (
            <Chip key={label} size="small" label={label} variant={due === d ? 'filled' : 'outlined'} onClick={() => setDue(due === d ? '' : d)} />
          ))}
        </Stack>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {group('Overdue', g.overdue, 'error.main')}
      {group('Today', g.today)}
      {compact ? (
        <>
          {!g.overdue.length && !g.today.length && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing due today.</Typography>
          )}
          {(g.upcoming.length > 0 || g.someday.length > 0) && (
            <Button size="small" component={Link} to="/todos" sx={{ mt: 0.5 }}>
              {g.upcoming.length + g.someday.length} more on your list
            </Button>
          )}
        </>
      ) : (
        <>
          {group('Upcoming', g.upcoming)}
          {group('No date', g.someday)}
          {nothingOpen && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {issue ? (g.done.length ? 'All done here.' : 'No todos on this issue yet.') : 'All done. Add something above.'}
            </Typography>
          )}
          {g.done.length > 0 && (
            <>
              <Button size="small" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Hide' : 'Show'} {g.done.length} done</Button>
              <Collapse in={showDone}>{group('Done', g.done.slice(0, showMore ? undefined : 30))}</Collapse>
              {showDone && g.done.length > 30 && !showMore && <Button size="small" onClick={() => setShowMore(true)}>Show all</Button>}
            </>
          )}
        </>
      )}
      {due && <Typography variant="caption" sx={{ color: 'text.secondary' }}>New todos due {formatDate(due)}</Typography>}
    </Box>
  )
}
