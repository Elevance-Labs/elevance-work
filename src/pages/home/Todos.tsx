// The Todos page: your Inbox, the smart views you chose to show (Today,
// Tomorrow, This week) and your own lists beside the todos in one of them
// (?list=inbox|today|tomorrow|week|<list id>). Lists are made, renamed,
// recoloured and deleted here (a deleted list's todos go back to the Inbox).
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Box,
  Checkbox,
  Chip,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import DateRangeOutlinedIcon from '@mui/icons-material/DateRangeOutlined'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import TuneIcon from '@mui/icons-material/Tune'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { TodoListView } from '../../components/TodoList'
import { useTodos } from '../../components/todos/useTodos'
import { ListDot } from '../../components/todos/TodoBits'
import { useTodoLists } from '../../components/todos/useTodoLists'
import { errorMessage, todayIso } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import {
  DEFAULT_LIST_COLOR, LIST_COLORS, SMART_VIEWS, SMART_VIEWS_KEY, isSmartView, openCount, parseSmartViews,
  type SmartView, type TodoView,
} from '../../lib/todos'
import type { TodoList } from '../../lib/types'

const VIEW_ICONS = {
  inbox: <InboxOutlinedIcon fontSize="small" />,
  today: <TodayOutlinedIcon fontSize="small" />,
  tomorrow: <WbSunnyOutlinedIcon fontSize="small" />,
  week: <DateRangeOutlinedIcon fontSize="small" />,
}

/** Which smart views show beside the lists, remembered in this browser. */
function useSmartViews(): [SmartView[], (v: SmartView[]) => void] {
  const [views, setViews] = useState(() => {
    try {
      return parseSmartViews(localStorage.getItem(SMART_VIEWS_KEY))
    } catch {
      return parseSmartViews(null)
    }
  })
  const save = (next: SmartView[]) => {
    setViews(next)
    try {
      localStorage.setItem(SMART_VIEWS_KEY, next.join(','))
    } catch {
      // Kept for this visit only.
    }
  }
  return [views, save]
}

function ListSettings({ list, onClose, onSaved }: { list: TodoList; onClose: () => void; onSaved: (l: TodoList) => void }) {
  const [name, setName] = useState(list.name)
  const [color, setColor] = useState(list.color)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    if (!name.trim()) return setError('Give the list a name.')
    setBusy(true)
    const { data, error: e } = await supabase.from('todo_lists').update({ name: name.trim(), color }).eq('id', list.id).select('*').single()
    setBusy(false)
    if (e || !data) return setError(e?.code === '23505' ? 'You already have a list with that name.' : errorMessage(e))
    onSaved(data as TodoList)
  }
  return (
    <FormDialog open title="Edit list" maxWidth="xs" busy={busy} error={error} onSubmit={save} onClose={onClose}>
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required slotProps={{ htmlInput: { maxLength: 60 } }} />
      <Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Colour</Typography>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {LIST_COLORS.map((c) => (
            <Box key={c} component="button" type="button" aria-label={`Colour ${c}`} aria-pressed={c === color} onClick={() => setColor(c)}
              sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: c, border: 2, borderColor: c === color ? 'text.primary' : 'transparent',
                cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#fff', p: 0 }}>
              {c === color && <CheckIcon sx={{ fontSize: 16 }} />}
            </Box>
          ))}
        </Stack>
      </Box>
    </FormDialog>
  )
}

/** A new list's name, typed in place; Enter makes it (once), Escape or leaving it empty gives up. */
function NewList({ onCreated, onCancel }: { onCreated: (l: TodoList) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function create() {
    if (busy) return
    if (!name.trim()) return onCancel()
    setBusy(true)
    const { data, error: e } = await supabase.from('todo_lists').insert({ name: name.trim(), color: DEFAULT_LIST_COLOR }).select('*').single()
    setBusy(false)
    if (e || !data) return setError(e?.code === '23505' ? 'You already have a list with that name.' : errorMessage(e))
    onCreated(data as TodoList)
  }
  return (
    <Box component="form" onSubmit={(e) => { e.preventDefault(); create() }} sx={{ px: 2, py: 0.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <ListDot color={DEFAULT_LIST_COLOR} />
        <InputBase autoFocus fullWidth placeholder="List name" value={name} readOnly={busy} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()} onBlur={() => !name.trim() && onCancel()}
          inputProps={{ 'aria-label': 'New list name', maxLength: 60 }} sx={{ fontSize: 14 }} />
      </Stack>
      {error && <Typography variant="caption" sx={{ color: 'error.main' }}>{error}</Typography>}
    </Box>
  )
}

interface Entry {
  id: TodoView
  label: string
  icon: ReactNode
  count: number
}

export default function Todos() {
  const [params, setParams] = useSearchParams()
  const store = useTodos()
  const { lists, loaded, setLists } = useTodoLists()
  const [shown, setShown] = useSmartViews()
  const [adding, setAdding] = useState(false)
  const [viewsMenu, setViewsMenu] = useState<HTMLElement | null>(null)
  const [listMenu, setListMenu] = useState<HTMLElement | null>(null)
  const [editing, setEditing] = useState<TodoList | null>(null)
  const [deleting, setDeleting] = useState<TodoList | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const today = todayIso()
  const todos = store.todos ?? []

  const asked = params.get('list') ?? 'inbox'
  // A list that's gone (or not loaded yet) shows the Inbox.
  const view: TodoView = asked === 'inbox' || isSmartView(asked) || (loaded && lists.some((l) => l.id === asked)) ? asked : 'inbox'
  const list = lists.find((l) => l.id === view)
  const go = (id: TodoView) => setParams(id === 'inbox' ? {} : { list: id })

  const top: Entry[] = [
    { id: 'inbox', label: 'Inbox', icon: VIEW_ICONS.inbox, count: openCount(todos, 'inbox', today) },
    ...SMART_VIEWS.filter((s) => shown.includes(s.id) || view === s.id)
      .map((s) => ({ id: s.id, label: s.label, icon: VIEW_ICONS[s.id], count: openCount(todos, s.id, today) })),
  ]
  const mine: Entry[] = lists.map((l) => ({ id: l.id, label: l.name, icon: <ListDot color={l.color} />, count: openCount(todos, l.id, today) }))
  const current = [...top, ...mine].find((e) => e.id === view) ?? top[0]

  async function removeList() {
    if (!deleting) return
    setDeleteBusy(true)
    const { error } = await supabase.from('todo_lists').delete().eq('id', deleting.id)
    setDeleteBusy(false)
    if (error) return setDeleteError(errorMessage(error))
    setLists((ls) => ls && ls.filter((l) => l.id !== deleting.id))
    setDeleting(null)
    go('inbox')
    store.load()
  }

  const item = (e: Entry) => (
    <ListItemButton key={e.id} selected={e.id === view} onClick={() => go(e.id)} sx={{ borderRadius: 1.5, py: 0.5 }} data-view={e.id}>
      <ListItemIcon sx={{ minWidth: 32, color: 'text.secondary' }}>{e.icon}</ListItemIcon>
      <ListItemText primary={e.label} slotProps={{ primary: { noWrap: true, variant: 'body2' } }} />
      {e.count > 0 && <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>{e.count}</Typography>}
    </ListItemButton>
  )

  return (
    <>
      <PageHeader title="Todos" subtitle="Yours, and the ones people add you to. File them in your own lists; only you see your lists." />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '240px minmax(0, 1fr)' }, gap: 2, alignItems: 'start', maxWidth: 1100 }}>
        {/* Phones: the views as a row of chips. */}
        <Stack direction="row" spacing={1} sx={{ display: { xs: 'flex', md: 'none' }, overflowX: 'auto', pb: 0.5 }} aria-label="Todo lists">
          {[...top, ...mine].map((e) => (
            <Chip key={e.id} icon={<Box sx={{ display: 'flex', pl: 0.5 }}>{e.icon}</Box>} label={e.count ? `${e.label} ${e.count}` : e.label}
              variant={e.id === view ? 'filled' : 'outlined'} color={e.id === view ? 'primary' : 'default'} onClick={() => go(e.id)} />
          ))}
        </Stack>

        <Paper variant="outlined" component="nav" aria-label="Todo lists" sx={{ p: { xs: 0.5, md: 1 } }}>
          <List dense disablePadding sx={{ display: { xs: 'none', md: 'block' } }}>{top.map(item)}</List>
          <List dense disablePadding
            subheader={
              <ListSubheader disableSticky sx={{ display: 'flex', alignItems: 'center', px: 1, lineHeight: '36px', bgcolor: 'transparent' }}>
                <Box sx={{ flex: 1 }}>My lists</Box>
                <Tooltip title="Smart views"><IconButton size="small" aria-label="Smart views" onClick={(e) => setViewsMenu(e.currentTarget)}><TuneIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="New list"><IconButton size="small" aria-label="New list" onClick={() => setAdding(true)}><AddIcon fontSize="small" /></IconButton></Tooltip>
              </ListSubheader>
            }>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>{mine.map(item)}</Box>
            {adding && <NewList onCancel={() => setAdding(false)}
              onCreated={(l) => { setLists((ls) => [...(ls ?? []), l]); setAdding(false); go(l.id) }} />}
            {!mine.length && !adding && (
              <Typography variant="caption" component="p" sx={{ px: 1, color: 'text.secondary', display: { xs: 'none', md: 'block' } }}>
                Group todos by area or goal. Lists are yours alone.
              </Typography>
            )}
          </List>
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
            <Box sx={{ display: 'flex', color: 'text.secondary' }}>{current.icon}</Box>
            <Typography variant="h6" component="h2" sx={{ flex: 1, fontWeight: 700 }} noWrap>{current.label}</Typography>
            {list && (
              <IconButton size="small" aria-label={`List options for ${list.name}`} onClick={(e) => setListMenu(e.currentTarget)}>
                <MoreHorizIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
          <TodoListView key={view} store={store} lists={lists} view={view} />
        </Paper>
      </Box>

      <Menu anchorEl={viewsMenu} open={!!viewsMenu} onClose={() => setViewsMenu(null)} slotProps={{ list: { dense: true, 'aria-label': 'Smart views' } }}>
        <Typography variant="caption" sx={{ px: 2, py: 0.5, display: 'block', color: 'text.secondary' }}>Show beside your lists</Typography>
        {SMART_VIEWS.map((s) => {
          const on = shown.includes(s.id)
          return (
            <MenuItem key={s.id} onClick={() => setShown(on ? shown.filter((x) => x !== s.id) : SMART_VIEWS.map((x) => x.id).filter((x) => x === s.id || shown.includes(x)))}>
              <Checkbox size="small" checked={on} sx={{ p: 0, mr: 1 }} slotProps={{ input: { 'aria-label': `Show ${s.label}` } }} />
              {s.label}
            </MenuItem>
          )
        })}
      </Menu>
      <Menu anchorEl={listMenu} open={!!listMenu} onClose={() => setListMenu(null)} slotProps={{ list: { dense: true } }}>
        <MenuItem onClick={() => { setListMenu(null); setEditing(list ?? null) }}>Rename or recolour</MenuItem>
        <MenuItem onClick={() => { setListMenu(null); setDeleteError(null); setDeleting(list ?? null) }} sx={{ color: 'error.main' }}>Delete list</MenuItem>
      </Menu>
      {editing && (
        <ListSettings list={editing} onClose={() => setEditing(null)}
          onSaved={(l) => { setLists((ls) => ls && ls.map((x) => (x.id === l.id ? l : x))); setEditing(null) }} />
      )}
      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.name ?? 'list'}?`} destructive confirmLabel="Delete list"
        busy={deleteBusy} error={deleteError} onConfirm={removeList} onClose={() => setDeleting(null)}
        message="Its todos aren't deleted: they go back to your Inbox." />
    </>
  )
}
