// The workspace's issue types. The level decides where a type sits:
// epics hold standard issues, which hold sub-tasks. A type in use can be
// archived (no new issues of it) but not deleted.
import { useState } from 'react'
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { supabase } from '../../lib/supabase'
import { PROJECT_COLORS, errorMessage } from '../../lib/constants'
import type { IssueIcon, IssueLevel, IssueType } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { ConfirmDialog, FormDialog, PageHeader } from '../../components/common'
import { TypeIcon } from '../../components/IssueBits'

const LEVEL_LABELS: Record<IssueLevel, string> = { epic: 'Epic (holds issues)', standard: 'Standard', subtask: 'Sub-task (under an issue)' }
const ICONS: IssueIcon[] = ['epic', 'story', 'task', 'bug', 'subtask', 'spike', 'improvement', 'feature']
const COLORS = ['#904ee2', '#63ba3c', '#4bade8', '#e5493a', '#f79232', '#2684ff', ...PROJECT_COLORS.slice(5)]

export default function IssueTypes() {
  const { issueTypes, reload } = useWorkspace()
  const [form, setForm] = useState<Partial<IssueType> | null>(null)
  const [deleting, setDeleting] = useState<IssueType | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!form?.name?.trim()) return setError('Give the type a name.')
    setBusy(true)
    setError(null)
    const values = { name: form.name.trim(), level: form.level ?? 'standard', icon: form.icon ?? 'task', color: form.color ?? COLORS[2], archived: !!form.archived }
    const { error: e } = form.id
      ? await supabase.from('issue_types').update(values).eq('id', form.id)
      : await supabase.from('issue_types').insert(values)
    setBusy(false)
    if (e) return setError(e.code === '23505' ? 'There is already a type with that name.' : errorMessage(e))
    setForm(null)
    await reload()
  }

  async function remove() {
    if (!deleting) return
    setBusy(true)
    const { error: e } = await supabase.from('issue_types').delete().eq('id', deleting.id)
    setBusy(false)
    if (e) return setError(e.code === '23503' ? 'Issues of this type exist. Archive it instead.' : errorMessage(e))
    setDeleting(null)
    await reload()
  }

  return (
    <>
      <PageHeader title="Issue types" subtitle="Shared by every project."
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => { setError(null); setForm({ level: 'standard', icon: 'task', color: COLORS[2] }) }}>Add type</Button>} />
      <Paper variant="outlined" sx={{ overflowX: 'auto', maxWidth: 820 }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Type</TableCell><TableCell>Level</TableCell><TableCell /></TableRow></TableHead>
          <TableBody>
            {issueTypes.map((t) => (
              <TableRow key={t.id} sx={{ opacity: t.archived ? 0.6 : 1 }}>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TypeIcon type={t} />
                    <Typography variant="body2">{t.name}</Typography>
                    {t.archived && <Chip size="small" label="Archived" />}
                  </Stack>
                </TableCell>
                <TableCell>{LEVEL_LABELS[t.level]}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" aria-label={`Edit ${t.name}`} onClick={() => { setError(null); setForm(t) }}><EditOutlinedIcon fontSize="small" /></IconButton>
                  <IconButton size="small" aria-label={`Delete ${t.name}`} onClick={() => { setError(null); setDeleting(t) }}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <FormDialog open={!!form} title={form?.id ? `Edit ${form.name}` : 'New issue type'} busy={busy} error={error} maxWidth="xs" onSubmit={save} onClose={() => setForm(null)}>
        {form && (
          <>
            <TextField label="Name" autoFocus value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField select label="Level" value={form.level ?? 'standard'} onChange={(e) => setForm({ ...form, level: e.target.value as IssueLevel })}
              helperText={form.id ? "Can't change once issues use it." : undefined}>
              {(Object.keys(LEVEL_LABELS) as IssueLevel[]).map((l) => <MenuItem key={l} value={l}>{LEVEL_LABELS[l]}</MenuItem>)}
            </TextField>
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>Icon</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                {ICONS.map((icon) => (
                  <ButtonBase key={icon} aria-label={`Icon ${icon}`} aria-pressed={form.icon === icon} onClick={() => setForm({ ...form, icon })}
                    sx={{ p: 0.5, borderRadius: 1, outline: form.icon === icon ? 2 : 0, outlineColor: 'primary.main' }}>
                    <TypeIcon type={{ ...(form as IssueType), icon, name: icon }} size={24} />
                  </ButtonBase>
                ))}
              </Stack>
            </Box>
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>Colour</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                {COLORS.map((c) => (
                  <ButtonBase key={c} aria-label={`Colour ${c}`} aria-pressed={form.color === c} onClick={() => setForm({ ...form, color: c })}
                    sx={{ width: 26, height: 26, borderRadius: 1, bgcolor: c, outline: form.color === c ? 3 : 0, outlineColor: 'primary.main', outlineOffset: 2 }} />
                ))}
              </Stack>
            </Box>
            {form.id && (
              <TextField select label="Status" value={form.archived ? 'archived' : 'active'} onChange={(e) => setForm({ ...form, archived: e.target.value === 'archived' })}>
                <MenuItem value="active">In use: new issues can have it</MenuItem>
                <MenuItem value="archived">Archived: existing issues keep it</MenuItem>
              </TextField>
            )}
          </>
        )}
      </FormDialog>
      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.name}?`} destructive confirmLabel="Delete" busy={busy} error={error}
        message="Only a type no issue uses can be deleted." onConfirm={remove} onClose={() => setDeleting(null)} />
    </>
  )
}
