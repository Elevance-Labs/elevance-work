// Your own note labels: add, rename, remove. Removing one takes it off your
// notes (the database does), and the notes stay.
import { useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/constants'
import type { NoteLabel } from '../../lib/types'
import { ConfirmDialog } from '../common'

const byName = (a: NoteLabel, b: NoteLabel) => a.name.localeCompare(b.name)

function LabelRow({ label, onRename, onDelete }: { label: NoteLabel; onRename: (name: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(label.name)
  const commit = () => {
    const next = name.trim()
    if (!next) return setName(label.name)
    if (next !== label.name) onRename(next)
  }
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <TextField fullWidth value={name} onChange={(e) => setName(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        slotProps={{ htmlInput: { 'aria-label': `Label ${label.name}`, maxLength: 40 } }} />
      <Tooltip title="Delete">
        <IconButton aria-label={`Delete label ${label.name}`} onClick={onDelete}><DeleteOutlineIcon fontSize="small" /></IconButton>
      </Tooltip>
    </Stack>
  )
}

export default function NoteLabelsDialog({
  labels,
  usage,
  onChange,
  onDeleted,
  onClose,
}: {
  labels: NoteLabel[]
  // How many of your notes carry each label.
  usage: (id: string) => number
  onChange: (labels: NoteLabel[]) => void
  onDeleted: (id: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<NoteLabel | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    const n = name.trim()
    if (!n) return
    setError(null)
    const { data, error: e } = await supabase.from('note_labels').insert({ name: n }).select('*').single()
    if (e || !data) return setError(errorMessage(e))
    onChange([...labels, data as NoteLabel].sort(byName))
    setName('')
  }

  async function rename(label: NoteLabel, next: string) {
    setError(null)
    const { error: e } = await supabase.from('note_labels').update({ name: next }).eq('id', label.id)
    if (e) return setError(errorMessage(e))
    onChange(labels.map((l) => (l.id === label.id ? { ...l, name: next } : l)).sort(byName))
  }

  async function remove() {
    const label = deleting!
    setBusy(true)
    const { error: e } = await supabase.from('note_labels').delete().eq('id', label.id)
    setBusy(false)
    setDeleting(null)
    if (e) return setError(errorMessage(e))
    onChange(labels.filter((l) => l.id !== label.id))
    onDeleted(label.id)
  }

  const used = deleting ? usage(deleting.id) : 0
  return (
    <>
      <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>Your labels</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Only you see them, on your own notes.</Typography>
            {labels.map((l) => (
              <LabelRow key={l.id} label={l} onRename={(n) => rename(l, n)} onDelete={() => setDeleting(l)} />
            ))}
            <Stack component="form" direction="row" spacing={1} onSubmit={(e) => { e.preventDefault(); add() }}>
              <TextField fullWidth placeholder="New label" value={name} onChange={(e) => setName(e.target.value)}
                slotProps={{ htmlInput: { 'aria-label': 'New label', maxLength: 40 } }} />
              <Button type="submit" variant="outlined" disabled={!name.trim()}>Add</Button>
            </Stack>
            {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button variant="contained" onClick={onClose}>Done</Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog open={!!deleting} title={`Delete “${deleting?.name ?? ''}”?`} destructive confirmLabel="Delete" busy={busy}
        message={used ? `It comes off ${used} note${used === 1 ? '' : 's'}; the notes stay.` : 'No note uses it.'}
        onConfirm={remove} onClose={() => setDeleting(null)} />
    </>
  )
}
