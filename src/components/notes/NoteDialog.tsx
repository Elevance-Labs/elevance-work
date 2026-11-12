// Write or change one of your notes: its text, colour, labels (your own; a
// new one is made as you type it), the project it is about, and whether it is
// pinned to your dashboard. A note taken on a meeting says which; it can be
// unlinked here, but is linked only from the meeting. Changes save themselves
// a moment after you stop (and on closing); a new note exists from its first
// words. A note is archived from here; an archived one is restored or, only
// then, deleted.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Autocomplete, Box, Button, Chip, FormControlLabel, Grid, MenuItem, Stack, Switch, TextField, Tooltip, Typography, useTheme, type Theme } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import { supabase } from '../../lib/supabase'
import { errorMessage, formatDay, timeAgo } from '../../lib/constants'
import {
  DEFAULT_NOTE_COLOR,
  NOTE_COLORS,
  noteColor,
  NOTE_COLOR_KEYS,
  NOTE_COLUMNS,
  meetingLabel,
  type NoteRow,
} from '../../lib/notes'
import type { Note, NoteColor, NoteLabel } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { ConfirmDialog, FormDialog } from '../common'

export type NoteDefaults = Partial<Pick<Note, 'project_id' | 'pinned'>>

// How long editing pauses before it is saved.
const SAVE_AFTER_MS = 1500

interface NoteForm {
  title: string
  body: string
  color: NoteColor
  labelIds: string[]
  projectId: string
  pinned: boolean
  meetingLinked: boolean
}

/** Fields sit on the note's colour behind a light (or, dark, a deep) veil. */
const onNote = (t: Theme) => (t.palette.mode === 'dark' ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.6)')

export function ColorPicker({ value, onChange }: { value: NoteColor; onChange: (c: NoteColor) => void }) {
  return (
    <Stack direction="row" role="radiogroup" aria-label="Colour" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
      {NOTE_COLOR_KEYS.map((c) => (
        <Tooltip key={c} title={NOTE_COLORS[c].label}>
          <Box component="button" type="button" role="radio" aria-checked={value === c} aria-label={NOTE_COLORS[c].label}
            onClick={() => onChange(c)}
            sx={{ width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', p: 0, display: 'grid', placeItems: 'center',
              bgcolor: (t) => noteColor(c, t.palette.mode), border: 2, borderColor: value === c ? 'primary.main' : 'divider' }}>
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
  const { palette } = useTheme()
  const [form, setForm] = useState<NoteForm>(() => ({
    title: note?.title ?? '',
    body: note?.body ?? '',
    color: note?.color ?? DEFAULT_NOTE_COLOR,
    labelIds: note?.label_ids ?? [],
    projectId: note ? note.project_id ?? '' : defaults.project_id ?? '',
    pinned: note ? note.pinned : defaults.pinned ?? false,
    // Only ever unlinked here.
    meetingLinked: !!note?.meeting_id,
  }))
  // The note as last saved: a new one exists from its first save.
  const [current, setCurrent] = useState<NoteRow | null>(note)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  // Archiving, restoring or deleting.
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  // The latest form and note, for saves that run after a pause or on leaving.
  const latest = useRef({ form, note, dirty: false })
  // Saves run one after another, so a second can't create the note twice.
  const queue = useRef<Promise<boolean>>(Promise.resolve(true))
  const timer = useRef<number | undefined>(undefined)
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    onSavedRef.current = onSaved
  })

  /**
   * Saves what changed (now, not after the pause); archiving or restoring
   * saves the form with it. True when there is nothing left unsaved.
   */
  const save = useCallback((archive?: boolean) => {
    window.clearTimeout(timer.current)
    queue.current = queue.current.then(async () => {
      const { form: f, note: saved, dirty } = latest.current
      if (!dirty && archive === undefined) return true
      latest.current.dirty = false
      if (!f.title.trim() && !f.body.trim()) {
        if (archive !== undefined) {
          setError('Write something first.')
          return false
        }
        // Nothing written yet: nothing to keep. A note emptied keeps what it had.
        if (saved) setError('Write something, or this note keeps what it had.')
        return true
      }
      const archived = !!saved?.archived_at
      const values = {
        title: f.title.trim(),
        body: f.body,
        color: f.color,
        label_ids: f.labelIds,
        project_id: f.projectId || null,
        // notes_guard unpins an archived note too.
        pinned: f.pinned && !(archive ?? archived),
        ...(saved?.meeting_id && !f.meetingLinked ? { meeting_id: null } : {}),
        ...(archive === undefined ? {} : { archived_at: archive ? new Date().toISOString() : null }),
      }
      setStatus('saving')
      const { data, error: e } = saved
        ? await supabase.from('notes').update(values).eq('id', saved.id).select(NOTE_COLUMNS).single()
        : await supabase.from('notes').insert(values).select(NOTE_COLUMNS).single()
      if (e || !data) {
        latest.current.dirty = true
        setError(errorMessage(e))
        setStatus('idle')
        return false
      }
      const row = data as unknown as NoteRow
      latest.current.note = row
      setCurrent(row)
      setError(null)
      setStatus(latest.current.dirty ? 'saving' : 'saved')
      onSavedRef.current(row)
      return true
    })
    return queue.current
  }, [])

  // Leaving with unsaved changes saves them.
  useEffect(() => () => {
    window.clearTimeout(timer.current)
    if (latest.current.dirty) save()
  }, [save])

  const set = (patch: Partial<NoteForm>) => {
    const next = { ...latest.current.form, ...patch }
    latest.current.form = next
    latest.current.dirty = true
    setForm(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => save(), SAVE_AFTER_MS)
  }

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

  const archived = !!current?.archived_at

  // Closing saves first; a refused save keeps the dialog open to say why.
  async function close() {
    if (await save()) onClose()
  }

  async function archive(value: boolean) {
    setBusy(true)
    const ok = await save(value)
    setBusy(false)
    if (ok) onClose()
  }

  async function remove() {
    window.clearTimeout(timer.current)
    latest.current.dirty = false
    setBusy(true)
    const { error: e } = await supabase.from('notes').delete().eq('id', current!.id)
    setBusy(false)
    if (e) {
      setDeleting(false)
      return setError(errorMessage(e))
    }
    onDeleted(current!.id)
  }

  return (
    <>
      <FormDialog open title={!note ? 'New note' : archived ? 'Archived note' : 'Edit note'} busy={busy} error={error}
        onSubmit={() => save()} onClose={close}
        paperColor={noteColor(form.color, palette.mode)}
        autosave={status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        extraActions={current && (archived ? (
          <>
            <Button color="error" disabled={busy} onClick={() => setDeleting(true)}>Delete</Button>
            <Button disabled={busy} onClick={() => archive(false)}>Restore</Button>
          </>
        ) : (
          <Button disabled={busy} onClick={() => archive(true)}>Archive</Button>
        ))}>
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
              sx={{ '& .MuiInputBase-root': { bgcolor: onNote } }} />
          )}
        />
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select fullWidth label="Project" value={form.projectId} onChange={(e) => set({ projectId: e.target.value })}
              sx={{ '& .MuiInputBase-root': { bgcolor: onNote } }}>
              <MenuItem value="">None</MenuItem>
              {projectOptions.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
              {form.projectId && !projectById(form.projectId) && <MenuItem value={form.projectId}>A project you can no longer see</MenuItem>}
            </TextField>
          </Grid>
          {!archived && (
            <Grid size={{ xs: 12, sm: 6 }} sx={{ display: 'flex', alignItems: 'center' }}>
              <FormControlLabel control={<Switch checked={form.pinned} onChange={(e) => set({ pinned: e.target.checked })} />}
                label="Pin to my dashboard" />
            </Grid>
          )}
          {current?.meeting_id && form.meetingLinked && (
            <Grid size={12}>
              <Chip icon={<EventOutlinedIcon />} label={meetingLabel(current)} onDelete={() => set({ meetingLinked: false })}
                variant="outlined" sx={{ bgcolor: onNote, maxWidth: '100%' }} />
            </Grid>
          )}
        </Grid>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Only you can see your notes. Changes save as you go.
          {current && ` Created ${formatDay(current.created_at)}; edited ${timeAgo(current.updated_at)}.`}
          {current?.archived_at && ` Archived ${timeAgo(current.archived_at)}: restore it to use it again, or delete it for good.`}
        </Typography>
      </FormDialog>
      <ConfirmDialog open={deleting} title="Delete this note?" destructive confirmLabel="Delete" busy={busy}
        message="It can't be brought back." onConfirm={remove} onClose={() => setDeleting(false)} />
    </>
  )
}
