// Create (the header's Create button, or Cmd/Ctrl+K): pick an issue, a
// todo or a note, by click, arrow keys or its number (1–3). Meetings are made
// in Google Calendar, not here.
// An issue opens the create dialog; the rest open their own dialogs here,
// and announce what they made (itemEvents) so the page underneath shows it.
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Box, Dialog, DialogTitle, ListItemIcon, ListItemText, MenuItem, MenuList, TextField, Typography } from '@mui/material'
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/constants'
import type { Issue, NoteLabel } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { emitItemChange } from '../workspace/itemEvents'
import { FormDialog } from './common'
import NoteDialog from './notes/NoteDialog'
import { IssuePicker, PeoplePicker } from './pickers'
import { TodoProjectSelect } from './TodoList'

export type CreateKind = 'issue' | 'todo' | 'note'

// In this order; each is picked by its number, 1 to 3.
const CHOICES: { kind: CreateKind; label: string; hint: string; icon: ReactElement }[] = [
  { kind: 'issue', label: 'Issue', hint: 'A task, story or bug in a project', icon: <AssignmentOutlinedIcon /> },
  { kind: 'todo', label: 'Todo', hint: 'For you, and anyone you add', icon: <ChecklistOutlinedIcon /> },
  { kind: 'note', label: 'Note', hint: 'Private to you', icon: <StickyNote2OutlinedIcon /> },
]

/** A new todo from anywhere: what, when, which issue or project, and who else is on it. */
function TodoDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const me = useMe()
  const { profiles } = useWorkspace()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [issue, setIssue] = useState<Issue | null>(null)
  const [projectId, setProjectId] = useState('')
  const [people, setPeople] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!title.trim()) return setError('Give the todo a title.')
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.from('todos')
      .insert({ title: title.trim(), due_on: due || null, issue_id: issue?.id ?? null,
        project_id: issue ? null : projectId || null, shared_with: people })
    setBusy(false)
    if (e) return setError(errorMessage(e))
    emitItemChange('todo')
    onSaved()
  }

  return (
    <FormDialog open title="New todo" submitLabel="Add" busy={busy} error={error} onSubmit={save} onClose={onClose}>
      <TextField label="Todo" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required
        slotProps={{ htmlInput: { maxLength: 300 } }} />
      <TextField label="Due on" type="date" value={due} onChange={(e) => setDue(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      <IssuePicker label="Link to an issue (optional)" value={issue} onChange={setIssue} />
      {!issue && <TodoProjectSelect value={projectId} onChange={setProjectId} />}
      <PeoplePicker label="Add people (optional)" value={people} options={profiles.filter((p) => p.active && p.id !== me.id)} onChange={setPeople} />
    </FormDialog>
  )
}

/** A new note: its dialog needs your labels. */
function NewNote({ onClose }: { onClose: () => void }) {
  const me = useMe()
  const [labels, setLabels] = useState<NoteLabel[] | null>(null)
  useEffect(() => {
    supabase.from('note_labels').select('*').eq('owner_id', me.id).order('name').then(({ data }) => setLabels((data ?? []) as NoteLabel[]))
  }, [me.id])
  if (!labels) return null
  return (
    <NoteDialog note={null} labels={labels} onLabelCreated={(l) => setLabels((ls) => [...(ls ?? []), l])} onClose={onClose}
      onSaved={() => emitItemChange('note')}
      onDeleted={onClose} />
  )
}

export default function CreateMenu({ onIssue, onClose }: { onIssue: () => void; onClose: () => void }) {
  const [kind, setKind] = useState<Exclude<CreateKind, 'issue'> | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const pick = (k: CreateKind) => {
    if (k === 'issue') {
      onClose()
      onIssue()
    } else setKind(k)
  }
  const pickRef = useRef(pick)
  useEffect(() => {
    pickRef.current = pick
  })

  // 1–3 open a form while the choice is showing, wherever focus is (the
  // dialog, not a choice, has it when it opens).
  const choosing = kind === null
  useEffect(() => {
    if (!choosing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const choice = /^[1-9]$/.test(e.key) ? CHOICES[Number(e.key) - 1] : undefined
      if (!choice) return
      e.preventDefault()
      pickRef.current(choice.kind)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choosing])

  if (kind === 'todo') return <TodoDialog onClose={onClose} onSaved={onClose} />
  if (kind === 'note') return <NewNote onClose={onClose} />

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
      slotProps={{
        paper: { sx: { mt: { xs: 2, sm: '10vh' } } },
        // Once it's shown, the first choice takes focus, so the arrow keys move through them.
        transition: {
          onEntered: () => {
            if (!listRef.current?.contains(document.activeElement)) listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
          },
        },
      }}>
      <DialogTitle sx={{ pb: 1 }}>Create</DialogTitle>
      <MenuList ref={listRef} autoFocusItem aria-label="Create" sx={{ pb: 1.5 }}>
        {CHOICES.map((c, i) => (
          <MenuItem key={c.kind} onClick={() => pick(c.kind)} aria-label={`New ${c.label.toLowerCase()}`} data-create={c.kind} sx={{ py: 1, mx: 1, borderRadius: 1 }}>
            <ListItemIcon>{c.icon}</ListItemIcon>
            <ListItemText primary={c.label} secondary={c.hint} />
            <Box component="kbd" sx={{ ml: 2, px: 0.75, border: 1, borderColor: 'divider', borderRadius: 0.5, fontFamily: 'inherit' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{i + 1}</Typography>
            </Box>
          </MenuItem>
        ))}
      </MenuList>
    </Dialog>
  )
}
