// Write or change one of your notes: its text, colour, labels (your own; a
// new one is made as you type it), the project it is about, and whether it is
// pinned to your dashboard. A note taken on a meeting says which; it can be
// unlinked here, but is linked only from the meeting.
import { useMemo, useState } from 'react'
import { Autocomplete, Box, Button, Chip, FormControlLabel, Grid, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import { supabase } from '../../lib/supabase'
import { errorMessage, formatDay, timeAgo } from '../../lib/constants'
import {
  DEFAULT_NOTE_COLOR,
  NOTE_COLORS,
  NOTE_COLOR_KEYS,
  NOTE_COLUMNS,
  meetingLabel,
  type NoteRow,
} from '../../lib/notes'
import type { Note, NoteColor, NoteLabel } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { ConfirmDialog, FormDialog } from '../common'

export type NoteDefaults = Partial<Pick<Note, 'project_id' | 'pinned'>>

export function ColorPicker({ value, onChange }: { value: NoteColor; onChange: (c: NoteColor) => void }) {
  return (
    <Stack direction="row" role="radiogroup" aria-label="Colour" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
      {NOTE_COLOR_KEYS.map((c) => (
        <Tooltip key={c} title={NOTE_COLORS[c].label}>
          <Box component="button" type="button" role="radio" aria-checked={value === c} aria-label={NOTE_COLORS[c].label}
            onClick={() => onChange(c)}
            sx={{ width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', p: 0, display: 'grid', placeItems: 'center',
              bgcolor: NOTE_COLORS[c].bg, border: 2, borderColor: value === c ? 'primary.main' : 'rgba(0,0,0,0.15)' }}>
            {value === c && <CheckIcon sx={{ fontSize: 16, color: 'primary.main' }} />}
          </Box>
        </Tooltip>
      ))}
    </Stack>
  )
}

export default function NoteDialog({
  note,
  defaults = {},
  labels,
  onLabelCreated,
  onClose,
  onSaved,
  onDeleted,
}: {
  note: NoteRow | null
  defaults?: NoteDefaults
  labels: NoteLabel[]
  onLabelCreated: (label: NoteLabel) => void
  onClose: () => void
  onSaved: (note: NoteRow) => void
  onDeleted: (id: string) => void
}) {
  const { projects, projectById } = useWorkspace()
  const [form, setForm] = useState({
    title: note?.title ?? '',
    body: note?.body ?? '',
    color: note?.color ?? DEFAULT_NOTE_COLOR,
    labelIds: note?.label_ids ?? [],
    projectId: note ? note.project_id ?? '' : defaults.project_id ?? '',
    pinned: note ? note.pinned : defaults.pinned ?? false,
    // Only ever unlinked here.
    meetingLinked: !!note?.meeting_id,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  const labelById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const chosenLabels = form.labelIds.map((id) => labelById.get(id)).filter((l): l is NoteLabel => !!l)
  const projectOptions = projects.filter((p) => !p.archived_at || p.id === form.projectId)

  async function changeLabels(values: (NoteLabel | string)[]) {
    const ids: string[] = []
    for (const v of values) {
      if (typeof v !== 'string') {
        ids.push(v.id)
        continue
      }
      const name = v.trim()
      if (!name) continue
      const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        ids.push(existing.id)
        continue
      }
      const { data, error: e } = await supabase.from('note_labels').insert({ name }).select('*').single()
      if (e || !data) {
        setError(errorMessage(e))
        continue
      }
      onLabelCreated(data as NoteLabel)
      ids.push((data as NoteLabel).id)
    }
    set({ labelIds: [...new Set(ids)] })
  }

  async function save() {
    if (!form.title.trim() && !form.body.trim()) return setError('Write something first.')
    const values = {
      title: form.title.trim(),
      body: form.body,
      color: form.color,
      label_ids: form.labelIds,
      project_id: form.projectId || null,
      pinned: form.pinned,
      ...(note?.meeting_id && !form.meetingLinked ? { meeting_id: null } : {}),
    }
    setBusy(true)
    setError(null)
    const { data, error: e } = note
      ? await supabase.from('notes').update(values).eq('id', note.id).select(NOTE_COLUMNS).single()
      : await supabase.from('notes').insert(values).select(NOTE_COLUMNS).single()
    setBusy(false)
    if (e || !data) return setError(errorMessage(e))
    onSaved(data as unknown as NoteRow)
  }

  async function remove() {
    setBusy(true)
    const { error: e } = await supabase.from('notes').delete().eq('id', note!.id)
    setBusy(false)
    if (e) {
      setDeleting(false)
      return setError(errorMessage(e))
    }
    onDeleted(note!.id)
  }

  return (
    <>
      <FormDialog open title={note ? 'Edit note' : 'New note'} busy={busy} error={error} onSubmit={save} onClose={onClose}
        paperColor={NOTE_COLORS[form.color].bg}
        extraActions={note && <Button color="error" onClick={() => setDeleting(true)}>Delete</Button>}>
        <TextField variant="standard" placeholder="Title" autoFocus={!note} value={form.title} onChange={(e) => set({ title: e.target.value })}
          slotProps={{ htmlInput: { 'aria-label': 'Title', maxLength: 200 }, input: { sx: { fontSize: 20, fontWeight: 600 } } }} />
        <TextField variant="standard" placeholder="Take a note…" multiline minRows={6} value={form.body}
          onChange={(e) => set({ body: e.target.value })}
          slotProps={{ htmlInput: { 'aria-label': 'Note', maxLength: 20000 }, input: { disableUnderline: true } }} />
        <ColorPicker value={form.color} onChange={(color) => set({ color })} />
        <Autocomplete<NoteLabel | string, true, false, true>
          multiple
          freeSolo
          value={chosenLabels}
          options={labels.filter((l) => !form.labelIds.includes(l.id))}
          getOptionLabel={(l) => (typeof l === 'string' ? l : l.name)}
          isOptionEqualToValue={(a, b) => typeof a !== 'string' && typeof b !== 'string' && a.id === b.id}
          onChange={(_, values) => changeLabels(values)}
          renderValue={(values, getItemProps) =>
            values.map((l, index) => {
              const { key, ...itemProps } = getItemProps({ index })
              return <Chip key={key} {...itemProps} size="small" label={typeof l === 'string' ? l : l.name} />
            })
          }
          renderInput={(params) => (
            <TextField {...params} label="Labels" placeholder={form.labelIds.length ? '' : 'Pick or type a new one'}
              sx={{ '& .MuiInputBase-root': { bgcolor: 'rgba(255,255,255,0.6)' } }} />
          )}
        />
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select fullWidth label="Project" value={form.projectId} onChange={(e) => set({ projectId: e.target.value })}
              sx={{ '& .MuiInputBase-root': { bgcolor: 'rgba(255,255,255,0.6)' } }}>
              <MenuItem value="">None</MenuItem>
              {projectOptions.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
              {form.projectId && !projectById(form.projectId) && <MenuItem value={form.projectId}>A project you can no longer see</MenuItem>}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }} sx={{ display: 'flex', alignItems: 'center' }}>
            <FormControlLabel control={<Switch checked={form.pinned} onChange={(e) => set({ pinned: e.target.checked })} />}
              label="Pin to my dashboard" />
          </Grid>
          {note?.meeting_id && form.meetingLinked && (
            <Grid size={12}>
              <Chip icon={<EventOutlinedIcon />} label={meetingLabel(note)} onDelete={() => set({ meetingLinked: false })}
                variant="outlined" sx={{ bgcolor: 'rgba(255,255,255,0.6)', maxWidth: '100%' }} />
            </Grid>
          )}
        </Grid>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Only you can see your notes.
          {note && ` Created ${formatDay(note.created_at)}; edited ${timeAgo(note.updated_at)}.`}
        </Typography>
      </FormDialog>
      <ConfirmDialog open={deleting} title="Delete this note?" destructive confirmLabel="Delete" busy={busy}
        message="It can't be brought back." onConfirm={remove} onClose={() => setDeleting(false)} />
    </>
  )
}
