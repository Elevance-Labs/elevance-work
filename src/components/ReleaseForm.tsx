import { useState } from 'react'
import { Stack, TextField, Typography } from '@mui/material'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/constants'
import type { Release } from '../lib/types'
import { invalidateProjectMeta } from '../workspace/useProjectMeta'
import { FormDialog } from './common'

// Create or edit a release (its name, dates and description).
export default function ReleaseForm({
  open,
  release,
  projectId,
  onClose,
  onSaved,
}: {
  open: boolean
  release: Release | null
  projectId: string
  onClose: () => void
  onSaved: (r: Release) => void
}) {
  const [name, setName] = useState(release?.name ?? '')
  const [description, setDescription] = useState(release?.description ?? '')
  const [start, setStart] = useState(release?.start_date ?? '')
  const [date, setDate] = useState(release?.release_date ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) return setError('Give the release a name, e.g. v1.4.')
    setBusy(true)
    setError(null)
    const values = { name: name.trim(), description, start_date: start || null, release_date: date || null }
    const { data, error: e } = release
      ? await supabase.from('releases').update(values).eq('id', release.id).select().single()
      : await supabase.from('releases').insert({ ...values, project_id: projectId }).select().single()
    setBusy(false)
    if (e || !data) return setError(e?.code === '23505' ? 'There is already a release with that name.' : errorMessage(e))
    await invalidateProjectMeta(projectId)
    onSaved(data as Release)
  }

  return (
    <FormDialog open={open} title={release ? `Edit ${release.name}` : 'New release'} busy={busy} error={error} maxWidth="xs"
      onSubmit={save} onClose={onClose}>
      <TextField label="Name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="v1.4" />
      <Stack direction="row" spacing={2}>
        <TextField label="Start date" type="date" value={start} fullWidth slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => setStart(e.target.value)} />
        <TextField label="Release date" type="date" value={date} fullWidth slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => setDate(e.target.value)} />
      </Stack>
      <TextField label="Description" multiline minRows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        A release with a date shows on the shared calendar (and Google Calendar, once connected).
      </Typography>
    </FormDialog>
  )
}
