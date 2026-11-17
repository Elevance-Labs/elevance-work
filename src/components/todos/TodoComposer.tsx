// The todo add bar: one line to type in, and a row of icons below it (due
// day, issue, project, people, list) that turn into chips once set. Enter
// adds; while a todo is being saved the bar shows a spinner and ignores
// Enter, so one todo is added however often it is pressed.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AvatarGroup, Box, Button, CircularProgress, InputBase, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Popover, Stack } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import LinkIcon from '@mui/icons-material/Link'
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined'
import { useMe } from '../../auth/AuthProvider'
import { todayIso } from '../../lib/constants'
import { dueLabel } from '../../lib/todos'
import type { Issue, TodoList } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { PersonAvatar } from '../common'
import { ProjectAvatar } from '../IssueBits'
import { IssuePicker, PeoplePicker } from '../pickers'
import { AttrButton, DueMenu, ListDot, ListMenu } from './TodoBits'

export interface NewTodo {
  title: string
  due_on: string | null
  issue_id: string | null
  project_id: string | null
  shared_with: string[]
}

type Open = 'due' | 'issue' | 'project' | 'people' | 'list'

/**
 * issue: new todos are tied to it (no issue or project to pick).
 * defaults: the due day and list a new todo starts with (the view's).
 * onAdd: resolves true once saved, when the bar clears.
 */
export default function TodoComposer({ issue, lists, defaultDue = '', defaultList = null, dense, autoFocus, onAdd }: {
  issue?: { id: string; key: string }
  lists: TodoList[]
  defaultDue?: string
  defaultList?: string | null
  dense?: boolean
  autoFocus?: boolean
  onAdd: (todo: NewTodo, listId: string | null) => Promise<boolean>
}) {
  const me = useMe()
  const { profiles, profileById, projects, projectById } = useWorkspace()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState(defaultDue)
  const [linked, setLinked] = useState<Issue | null>(null)
  const [projectId, setProjectId] = useState('')
  const [people, setPeople] = useState<string[]>([])
  const [listId, setListId] = useState<string | null>(defaultList)
  const [open, setOpen] = useState<{ what: Open; el: HTMLElement } | null>(null)
  const [busy, setBusy] = useState(false)
  // A ref, not the state: a second Enter can arrive before the re-render.
  const saving = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const today = todayIso()
  // Also when asked for later (the issue view unfolds its todos already loaded).
  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])
  const close = () => setOpen(null)
  const opener = (what: Open) => (el: HTMLElement) => setOpen({ what, el })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving.current || !title.trim()) return
    saving.current = true
    setBusy(true)
    const ok = await onAdd({
      title: title.trim(),
      due_on: due || null,
      issue_id: issue?.id ?? linked?.id ?? null,
      project_id: issue || linked ? null : projectId || null,
      shared_with: people,
    }, listId)
    saving.current = false
    setBusy(false)
    if (!ok) return
    setTitle('')
    setDue(defaultDue)
    setLinked(null)
    setProjectId('')
    setPeople([])
    setListId(defaultList)
    input.current?.focus()
  }

  const project = projectById(projectId)
  const list = lists.find((l) => l.id === listId)
  const chosen = people.map((id) => profileById(id)).filter((p) => !!p)

  return (
    <Paper component="form" variant="outlined" onSubmit={submit} aria-busy={busy}
      sx={{ px: 1.25, py: dense ? 0.5 : 0.75, mb: 2, borderRadius: 2, transition: 'border-color .15s, box-shadow .15s',
        '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ width: 24, display: 'flex', justifyContent: 'center', color: 'text.secondary', flexShrink: 0 }}>
          {busy ? <CircularProgress size={16} aria-label="Adding" /> : <AddIcon fontSize="small" />}
        </Box>
        <InputBase fullWidth inputRef={input} value={title} onChange={(e) => setTitle(e.target.value)} readOnly={busy}
          placeholder={issue ? `Add a todo for ${issue.key}` : 'Add a todo'}
          inputProps={{ 'aria-label': 'New todo', maxLength: 300 }} sx={{ py: 0.5, fontSize: 15 }} />
      </Stack>
      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5, pl: 3.5, pb: 0.25 }}>
        <AttrButton label="Due date" icon={<CalendarTodayOutlinedIcon fontSize="small" />} value={due && dueLabel(due, today)}
          onOpen={opener('due')} onClear={() => setDue('')} />
        {!issue && (
          <AttrButton label="Link an issue" icon={<LinkIcon fontSize="small" />} value={linked?.key}
            onOpen={opener('issue')} onClear={() => setLinked(null)} />
        )}
        {!issue && !linked && (
          <AttrButton label="Project" icon={<FolderOutlinedIcon fontSize="small" />} value={project?.key}
            avatar={project && <ProjectAvatar project={project} size={18} />} onOpen={opener('project')} onClear={() => setProjectId('')} />
        )}
        {chosen.length ? (
          <Box component="button" type="button" aria-label="Add people" onClick={(e) => setOpen({ what: 'people', el: e.currentTarget })}
            sx={{ border: 0, p: 0.25, bgcolor: 'transparent', cursor: 'pointer', display: 'inline-flex' }}>
            <AvatarGroup max={4} sx={{ '& .MuiAvatar-root': { width: 22, height: 22, fontSize: 10 } }}>
              {chosen.map((p) => <PersonAvatar key={p.id} person={p} size={22} />)}
            </AvatarGroup>
          </Box>
        ) : (
          <AttrButton label="Add people" icon={<PersonAddAltOutlinedIcon fontSize="small" />} onOpen={opener('people')} />
        )}
        <AttrButton label="List" icon={<InboxOutlinedIcon fontSize="small" />} value={list?.name}
          chipIcon={list && <ListDot color={list.color} />}
          onOpen={opener('list')} onClear={() => setListId(null)} />
        <Box sx={{ flexGrow: 1 }} />
        <Button type="submit" size="small" variant="contained" disabled={!title.trim() || busy} disableElevation sx={{ minWidth: 0, px: 1.5 }}>
          Add
        </Button>
      </Stack>

      <DueMenu anchor={open?.what === 'due' ? open.el : null} value={due} onPick={setDue} onClose={close} />
      <ListMenu anchor={open?.what === 'list' ? open.el : null} lists={lists} value={listId} onPick={setListId} onClose={close} />
      <Menu anchorEl={open?.what === 'project' ? open.el : null} open={open?.what === 'project'} onClose={close}
        slotProps={{ list: { dense: true, 'aria-label': 'Project' } }}>
        {projectId && <MenuItem onClick={() => { setProjectId(''); close() }}><ListItemText>No project</ListItemText></MenuItem>}
        {projects.filter((p) => !p.archived_at).map((p) => (
          <MenuItem key={p.id} selected={p.id === projectId} onClick={() => { setProjectId(p.id); close() }}>
            <ListItemIcon><ProjectAvatar project={p} size={20} /></ListItemIcon>
            <ListItemText>{p.name}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      <Popover open={open?.what === 'issue' || open?.what === 'people'} anchorEl={open?.el} onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ p: 1.5, width: 360, maxWidth: '90vw' }}>
          {open?.what === 'issue' ? (
            <IssuePicker label="Issue" autoFocus value={linked} onChange={(i) => { setLinked(i); if (i) close() }} />
          ) : (
            <PeoplePicker label="People" value={people} options={profiles.filter((p) => p.active && p.id !== me.id)} onChange={setPeople} />
          )}
        </Box>
      </Popover>
    </Paper>
  )
}
