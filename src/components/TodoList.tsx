// Todos: your own, and the ones people put you on. Everyone on a todo sees,
// edits and ticks it off, and adds people; only whoever made it deletes it
// (RLS). A todo may be due on a day and tied to an issue or just to a
// project (an issue's todo is in its project), and sits in your Inbox or one
// of your lists (each person files a shared todo in their own). The Todos
// page shows one view (the Inbox, a list, Today, Tomorrow, This week); the
// dashboard, what's due; an issue, the ones tied to it.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  AvatarGroup,
  Box,
  Button,
  Checkbox,
  Collapse,
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
} from '@mui/material'
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined'
import { useMe } from '../auth/AuthProvider'
import { todayIso } from '../lib/constants'
import {
  defaultDue, dueLabel, groupOpen, inView, isSmartView, listOf, sortDone,
  type TodoRow, type TodoView,
} from '../lib/todos'
import type { Profile, Todo, TodoList as TodoListRow } from '../lib/types'
import { projectTabHref } from '../lib/projectFeatures'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { PersonAvatar } from './common'
import { ProjectAvatar } from './IssueBits'
import { PeoplePicker } from './pickers'
import { DueMenu, ListDot, ListMenu } from './todos/TodoBits'
import TodoComposer from './todos/TodoComposer'
import { useTodoLists } from './todos/useTodoLists'
import { useTodos, type TodoStore } from './todos/useTodos'

/** Who is on a todo and who may be added: its creator and people, for the creator or anyone on it. */
function TodoPeople({ todo, onChange, onLeave }: { todo: TodoRow; onChange: (sharedWith: string[]) => void; onLeave: () => void }) {
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
          <IconButton size="small" aria-label={label} className="todo-reveal" onClick={(e) => setAnchor(e.currentTarget)}>
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

/** Which of your lists a new todo goes in (the Inbox, or one of yours). */
export function TodoListSelect({ value, lists, onChange }: { value: string; lists: TodoListRow[]; onChange: (id: string) => void }) {
  return (
    <TextField select fullWidth label="List" value={value} onChange={(e) => onChange(e.target.value)}>
      <MenuItem value="">Inbox</MenuItem>
      {lists.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
    </TextField>
  )
}

// Coloured by how soon: overdue red, today green, within a week purple.
function dueColor(due: string, today: string, done: boolean) {
  if (done) return 'text.secondary'
  if (due < today) return 'error.main'
  if (due === today) return 'success.main'
  return 'text.secondary'
}

function TodoItem({ todo, showContext, lists, showList, onChange, onDelete, onLeave, onMove }: {
  todo: TodoRow
  showContext: boolean
  lists: TodoListRow[]
  showList: boolean
  onChange: (t: Partial<Todo>) => void
  onDelete: () => void
  onLeave: () => void
  onMove: (listId: string | null) => void
}) {
  const me = useMe()
  const { projectById } = useWorkspace()
  const [title, setTitle] = useState(todo.title)
  const [menu, setMenu] = useState<{ what: 'more' | 'move' | 'due'; el: HTMLElement } | null>(null)
  const today = todayIso()
  const project = !todo.issue ? projectById(todo.project_id) : undefined
  const list = lists.find((l) => l.id === listOf(todo))
  const mine = todo.owner_id === me.id
  const done = !!todo.done_at
  const meta = [
    todo.due_on && (
      <Box key="due" component="button" type="button" aria-label={`Due ${dueLabel(todo.due_on, today)}`}
        onClick={(e) => setMenu({ what: 'due', el: e.currentTarget })}
        sx={{ border: 0, p: 0, bgcolor: 'transparent', cursor: 'pointer', font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 0.5,
          color: dueColor(todo.due_on, today, done) }}>
        <CalendarTodayOutlinedIcon sx={{ fontSize: 13 }} />{dueLabel(todo.due_on, today)}
      </Box>
    ),
    showContext && todo.issue && (
      <Tooltip key="issue" title={todo.issue.title}>
        <Box component={Link} to={{ search: `?issue=${todo.issue.key}` }} sx={{ color: 'text.secondary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
          {todo.issue.key}
        </Box>
      </Tooltip>
    ),
    showContext && project && (
      <Tooltip key="project" title={project.name}>
        <Box component={Link} to={projectTabHref(project, 'calendar')}
          sx={{ color: 'text.secondary', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, '&:hover': { textDecoration: 'underline' } }}>
          <ProjectAvatar project={project} size={14} />{project.key}
        </Box>
      </Tooltip>
    ),
    showList && (
      <Box key="list" component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
        {list ? <><ListDot color={list.color} size={8} />{list.name}</> : <><InboxOutlinedIcon sx={{ fontSize: 13 }} />Inbox</>}
      </Box>
    ),
  ].filter(Boolean)

  return (
    <Stack direction="row" spacing={0.5} data-todo={todo.id}
      sx={{ alignItems: 'flex-start', py: 0.25, borderBottom: 1, borderColor: 'divider',
        '@media (hover: hover)': { '& .todo-reveal': { opacity: 0 }, '&:hover .todo-reveal, &:focus-within .todo-reveal': { opacity: 1 } } }}>
      <Checkbox checked={done} size="small" slotProps={{ input: { 'aria-label': `Done: ${todo.title}` } }} sx={{ mt: 0.25 }}
        onChange={(e) => onChange({ done_at: e.target.checked ? new Date().toISOString() : null })} />
      <Box sx={{ flex: 1, minWidth: 0, py: 0.5 }}>
        <TextField variant="standard" fullWidth value={title} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== todo.title && onChange({ title: title.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          slotProps={{ input: { disableUnderline: true, sx: { py: 0, textDecoration: done ? 'line-through' : 'none', color: done ? 'text.secondary' : undefined } },
            htmlInput: { 'aria-label': 'Todo', sx: { py: 0.25 } } }} />
        {meta.length > 0 && (
          <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25, fontSize: 12, alignItems: 'center' }}>{meta}</Stack>
        )}
      </Box>
      <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexShrink: 0, pt: 0.5 }}>
        {!todo.due_on && (
          <Tooltip title="Due date">
            <IconButton size="small" className="todo-reveal" aria-label={`Due date for ${todo.title}`} onClick={(e) => setMenu({ what: 'due', el: e.currentTarget })}>
              <CalendarTodayOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
        <TodoPeople todo={todo} onChange={(shared_with) => onChange({ shared_with })} onLeave={onLeave} />
        <IconButton size="small" className="todo-reveal" aria-label={`More for ${todo.title}`} onClick={(e) => setMenu({ what: 'more', el: e.currentTarget })}>
          <MoreHorizIcon fontSize="small" />
        </IconButton>
      </Stack>

      <DueMenu anchor={menu?.what === 'due' ? menu.el : null} value={todo.due_on ?? ''}
        onPick={(d) => onChange({ due_on: d || null })} onClose={() => setMenu(null)} />
      <ListMenu anchor={menu?.what === 'move' ? menu.el : null} title="Move to" lists={lists} value={listOf(todo)}
        onPick={onMove} onClose={() => setMenu(null)} />
      <Menu anchorEl={menu?.what === 'more' ? menu.el : null} open={menu?.what === 'more'} onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ list: { dense: true } }}>
        <MenuItem onClick={() => setMenu((m) => m && { what: 'move', el: m.el })}>
          <ListItemIcon><DriveFileMoveOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Move to…</ListItemText>
        </MenuItem>
        <Divider />
        {mine ? (
          <MenuItem aria-label={`Delete ${todo.title}`} onClick={() => { setMenu(null); onDelete() }} sx={{ color: 'error.main' }}>
            <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        ) : (
          <MenuItem onClick={() => { setMenu(null); onLeave() }} sx={{ color: 'error.main' }}>
            <ListItemIcon><LogoutIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>Leave this todo</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Stack>
  )
}

const EMPTY: Record<string, string> = {
  inbox: 'Your Inbox is clear.',
  today: 'Nothing due today.',
  tomorrow: 'Nothing due tomorrow.',
  week: 'Nothing due this week.',
}

/**
 * One view of the todos in a store.
 * view: the Inbox, a smart view or a list (the Todos page); none for an issue's or the dashboard's.
 * compact: the dashboard's: what's overdue or due today, and a link to the rest.
 * issue: the store holds that issue's todos, and new ones are tied to it.
 */
export function TodoListView({ store, lists, view, compact, issue, autoFocus }: {
  store: TodoStore
  lists: TodoListRow[]
  view?: TodoView
  compact?: boolean
  issue?: { id: string; key: string }
  autoFocus?: boolean
}) {
  const [showDone, setShowDone] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const today = todayIso()
  const { todos, error, setError } = store
  if (!todos) return null

  const inThis = view ? todos.filter((t) => inView(t, view, today)) : todos
  const open = inThis.filter((t) => !t.done_at)
  let groups = groupOpen(open, view ?? 'inbox', today)
  // Within a list or the Inbox, the days are the groups; in Today or Tomorrow there's one.
  if (view === 'today' || view === 'tomorrow') groups = groups.map((g) => (g.key === 'upcoming' ? { ...g, label: 'Tomorrow' } : g))
  const later = compact ? groups.filter((g) => g.key === 'upcoming' || g.key === 'none') : []
  if (compact) groups = groups.filter((g) => g.key === 'overdue' || g.key === 'today')
  const done = sortDone(inThis.filter((t) => t.done_at))
  // Smart views and the dashboard span lists, so a row says which it is in.
  const showList = !!view && isSmartView(view) || !!compact
  const defaultList = view && view !== 'inbox' && !isSmartView(view) ? view : null

  const row = (t: TodoRow) => (
    <TodoItem key={t.id} todo={t} showContext={!issue} lists={lists} showList={showList && lists.length > 0}
      onChange={(p) => store.update(t, p)} onDelete={() => store.remove(t)} onLeave={() => store.leave(t)}
      onMove={(id) => store.move(t, id)} />
  )
  const section = (key: string, label: string, rows: TodoRow[], tone?: 'error') => (
    <Box key={key} sx={{ mb: 1.5 }}>
      {(groups.length > 1 || key === 'overdue' || key === 'done' || compact || !view) && (
        <Typography variant="caption" component="h3" sx={{ fontWeight: 700, textTransform: 'uppercase', color: tone === 'error' ? 'error.main' : 'text.secondary' }}>
          {label} ({rows.length})
        </Typography>
      )}
      {rows.map(row)}
    </Box>
  )

  return (
    <Box>
      <TodoComposer key={view ?? 'all'} issue={issue} lists={lists} dense={!!issue || compact} autoFocus={autoFocus}
        defaultDue={view ? defaultDue(view, today) : ''} defaultList={defaultList}
        onAdd={store.add} />
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {groups.map((g) => section(g.key, g.label, g.rows, g.tone))}
      {compact ? (
        <>
          {!groups.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing due today.</Typography>}
          {later.length > 0 && (
            <Button size="small" component={Link} to="/todos" sx={{ mt: 0.5 }}>
              {later.reduce((n, g) => n + g.rows.length, 0)} more on your list
            </Button>
          )}
        </>
      ) : (
        <>
          {!open.length && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {issue ? (done.length ? 'All done here.' : 'No todos on this issue yet.')
                : (view && EMPTY[view]) ?? (done.length ? 'All done in this list.' : 'Nothing here yet. Add a todo above.')}
            </Typography>
          )}
          {done.length > 0 && (
            <>
              <Button size="small" onClick={() => setShowDone((v) => !v)}>{showDone ? 'Hide' : 'Show'} {done.length} done</Button>
              <Collapse in={showDone}>{section('done', 'Done', done.slice(0, showMore ? undefined : 30))}</Collapse>
              {showDone && done.length > 30 && !showMore && <Button size="small" onClick={() => setShowMore(true)}>Show all</Button>}
            </>
          )}
        </>
      )}
    </Box>
  )
}

/**
 * Your todos, or one issue's, loading their own. The dashboard (compact) and the issue view use this; the Todos page a store of its own.
 * onChange: after any write here, so a view showing the same todos (the dashboard's agenda) reads them again.
 */
export default function TodoList({ compact, onChange, issue, onCount, autoFocus }: {
  compact?: boolean
  onChange?: () => void
  issue?: { id: string; key: string }
  // How many todos there are once loaded (the issue view hides an empty section).
  onCount?: (n: number) => void
  autoFocus?: boolean
}) {
  const store = useTodos(issue?.id, onChange)
  const { lists } = useTodoLists()
  const count = store.todos?.length
  useEffect(() => {
    if (count !== undefined) onCount?.(count)
  }, [count, onCount])
  return <TodoListView store={store} lists={lists} compact={compact} issue={issue} autoFocus={autoFocus} />
}
