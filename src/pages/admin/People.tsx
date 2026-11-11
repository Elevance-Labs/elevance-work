// Who may sign in, and as what. A person is added by their company email;
// their Google sign-in binds to it. People are deactivated, never deleted,
// so what they wrote keeps their name.
import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined'
import { useMe } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { APP_ROLE_LABELS, COMPANY_DOMAIN, errorMessage, formatDay } from '../../lib/constants'
import type { AppRole, Profile } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { FormDialog, PageHeader, PersonName } from '../../components/common'

interface Form {
  id?: string
  email: string
  full_name: string
  title: string
  app_role: AppRole
  active: boolean
}

export default function People() {
  const me = useMe()
  const { profiles, reload } = useWorkspace()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const shown = profiles.filter((p) => (showInactive || p.active) && (!q || p.full_name.toLowerCase().includes(q) || p.email.includes(q)))

  async function save() {
    if (!form) return
    const email = form.email.trim().toLowerCase()
    if (!email.endsWith(`@${COMPANY_DOMAIN}`)) return setError(`Use their @${COMPANY_DOMAIN} address.`)
    if (!form.full_name.trim()) return setError('Add their name.')
    setBusy(true)
    setError(null)
    const values = { email, full_name: form.full_name.trim(), title: form.title.trim() || null, app_role: form.app_role, active: form.active }
    const { error: e } = form.id
      ? await supabase.from('profiles').update(values).eq('id', form.id)
      : await supabase.from('profiles').insert(values)
    setBusy(false)
    if (e) return setError(e.code === '23505' ? 'Someone already has that email.' : errorMessage(e))
    setForm(null)
    await reload()
  }

  const edit = (p: Profile) => {
    setError(null)
    setForm({ id: p.id, email: p.email, full_name: p.full_name, title: p.title ?? '', app_role: p.app_role, active: p.active })
  }

  return (
    <>
      <PageHeader
        title="People"
        subtitle={`Everyone who can sign in with their @${COMPANY_DOMAIN} Google account.`}
        actions={
          <Button variant="contained" startIcon={<PersonAddAlt1OutlinedIcon />}
            onClick={() => { setError(null); setForm({ email: '', full_name: '', title: '', app_role: 'member', active: true }) }}>
            Add person
          </Button>
        }
      />
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center' }}>
        <TextField placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Search people' } }} />
        <FormControlLabel control={<Switch checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />} label="Show deactivated" />
      </Stack>
      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Person</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Added</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((p) => (
              <TableRow key={p.id} sx={{ opacity: p.active ? 1 : 0.6 }}>
                <TableCell><PersonName person={p} /></TableCell>
                <TableCell>{p.email}</TableCell>
                <TableCell>{p.title ?? '—'}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <Chip size="small" label={APP_ROLE_LABELS[p.app_role]} color={p.app_role === 'admin' ? 'primary' : 'default'} variant="outlined" />
                    {!p.active && <Chip size="small" label="Deactivated" />}
                  </Stack>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDay(p.created_at)}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Edit">
                    <IconButton aria-label={`Edit ${p.full_name}`} onClick={() => edit(p)}><EditOutlinedIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <FormDialog open={!!form} title={form?.id ? `Edit ${form.full_name}` : 'Add a person'} busy={busy} error={error} onSubmit={save} onClose={() => setForm(null)}>
        {form && (
          <>
            <TextField label="Company email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder={`name@${COMPANY_DOMAIN}`} helperText={form.id ? 'Changing it means they sign in with the new address.' : 'They sign in with this Google account.'} />
            <TextField label="Full name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Frontend Engineer" />
            <TextField select label="Workspace role" value={form.app_role} onChange={(e) => setForm({ ...form, app_role: e.target.value as AppRole })}
              helperText={form.app_role === 'admin' ? 'Admins manage people, projects, issue types and settings, and are admins of every project.' : 'Members work in the projects they are added to, and open ones.'}>
              <MenuItem value="member">{APP_ROLE_LABELS.member}</MenuItem>
              <MenuItem value="admin">{APP_ROLE_LABELS.admin}</MenuItem>
            </TextField>
            {form.id && (
              <Box>
                <FormControlLabel control={<Switch checked={form.active} disabled={form.id === me.id}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })} />} label="Can sign in" />
                {!form.active && <Alert severity="warning" sx={{ mt: 1 }}>They're signed out of the app and drop off pickers. Their history stays.</Alert>}
                {form.id === me.id && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>You can't deactivate yourself.</Typography>}
              </Box>
            )}
          </>
        )}
      </FormDialog>
    </>
  )
}
