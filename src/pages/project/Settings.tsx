// A project's settings, for its admins: details, people, workflow, custom
// fields, its Google Chat space, and archiving or deleting it.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import {
  CATEGORY_LABELS,
  CHAT_EVENT_LABELS,
  PROJECT_COLORS,
  PROJECT_KIND_HELP,
  PROJECT_KIND_LABELS,
  PROJECT_ROLE_HELP,
  PROJECT_ROLE_LABELS,
  errorMessage,
} from '../../lib/constants'
import type {
  ChatEvent,
  Field,
  FieldKind,
  ProjectIntegrations,
  ProjectKind,
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
  StatusCategory,
} from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { invalidateProjectMeta, useProjectMeta } from '../../workspace/useProjectMeta'
import { ConfirmDialog, FormDialog, Loading, PersonName } from '../../components/common'
import { PersonPicker } from '../../components/pickers'
import { useProject } from './projectContext'

type TabKey = 'details' | 'people' | 'workflow' | 'fields' | 'chat' | 'danger'

const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Choice (one)',
  multi_select: 'Choice (several)',
  user: 'Person',
  url: 'Link',
  checkbox: 'Checkbox',
}

function useSaver() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const run = async (fn: () => PromiseLike<{ error: { code?: string; message: string } | null }>) => {
    setBusy(true)
    setError(null)
    setSaved(false)
    const { error: e } = await fn()
    setBusy(false)
    if (e) {
      setError(errorMessage(e))
      return false
    }
    setSaved(true)
    return true
  }
  return { busy, error, saved, setError, run }
}

function Details() {
  const { project } = useProject()
  const { reload, profiles } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const [form, setForm] = useState({
    name: project.name, description: project.description, kind: project.kind, visibility: project.visibility,
    lead_id: project.lead_id, color: project.color,
  })
  const s = useSaver()
  const members = profiles.filter((p) => meta?.members.some((m) => m.profile_id === p.id))

  async function save() {
    if (await s.run(() => supabase.from('projects').update({ ...form, name: form.name.trim() }).eq('id', project.id))) await reload()
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 560 }}>
      <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      <TextField label="Key" value={project.key} disabled helperText="Keys never change: they're in every issue key and shared link." />
      <TextField label="Description" multiline minRows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <TextField select label="Type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ProjectKind })}
        helperText={PROJECT_KIND_HELP[form.kind]}>
        {(['scrum', 'kanban'] as ProjectKind[]).map((k) => <MenuItem key={k} value={k}>{PROJECT_KIND_LABELS[k]}</MenuItem>)}
      </TextField>
      <TextField select label="Access" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as ProjectVisibility })}
        helperText={form.visibility === 'open' ? 'Everyone in the workspace can read it and comment; members edit.' : 'Only its members (and workspace admins) can see it.'}>
        <MenuItem value="private">Private</MenuItem>
        <MenuItem value="open">Open to the workspace</MenuItem>
      </TextField>
      <PersonPicker label="Project lead" value={form.lead_id} options={members} noneLabel="No lead" onChange={(id) => setForm({ ...form, lead_id: id })} />
      <Box>
        <Typography variant="body2" sx={{ mb: 1 }}>Colour</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {PROJECT_COLORS.map((c) => (
            <ButtonBase key={c} aria-label={`Colour ${c}`} aria-pressed={form.color === c} onClick={() => setForm({ ...form, color: c })}
              sx={{ width: 28, height: 28, borderRadius: 1, bgcolor: c, outline: form.color === c ? 3 : 0, outlineColor: 'primary.main', outlineOffset: 2 }} />
          ))}
        </Stack>
      </Box>
      {s.error && <Alert severity="error">{s.error}</Alert>}
      {s.saved && <Alert severity="success">Saved.</Alert>}
      <Box><Button variant="contained" onClick={save} loading={s.busy}>Save</Button></Box>
    </Stack>
  )
}

function People() {
  const { project } = useProject()
  const { profiles, profileById, reload } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const [adding, setAdding] = useState<string | null>(null)
  const [role, setRole] = useState<ProjectRole>('member')
  const s = useSaver()
  if (!meta) return <Loading />
  const members = [...meta.members].sort((a, b) => (profileById(a.profile_id)?.full_name ?? '').localeCompare(profileById(b.profile_id)?.full_name ?? ''))
  const candidates = profiles.filter((p) => p.active && !meta.members.some((m) => m.profile_id === p.id))

  const after = async () => {
    await invalidateProjectMeta(project.id)
    await reload()
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2, maxWidth: 720 }}>
        <Box sx={{ flexGrow: 1 }}>
          <PersonPicker label="Add a person" value={adding} options={candidates} noneLabel="Choose someone" onChange={setAdding} />
        </Box>
        <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} sx={{ minWidth: 140 }}>
          {(['admin', 'member', 'viewer'] as ProjectRole[]).map((r) => <MenuItem key={r} value={r}>{PROJECT_ROLE_LABELS[r]}</MenuItem>)}
        </TextField>
        <Button variant="contained" disabled={!adding} loading={s.busy} onClick={async () => {
          if (adding && await s.run(() => supabase.from('project_members').insert({ project_id: project.id, profile_id: adding, role }))) {
            setAdding(null)
            await after()
          }
        }}>Add</Button>
      </Stack>
      {s.error && <Alert severity="error" sx={{ mb: 2 }}>{s.error}</Alert>}
      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>Person</TableCell><TableCell>Role</TableCell><TableCell /></TableRow></TableHead>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.profile_id}>
                <TableCell><PersonName person={profileById(m.profile_id)} /></TableCell>
                <TableCell>
                  <TextField select value={m.role} slotProps={{ htmlInput: { 'aria-label': `Role of ${profileById(m.profile_id)?.full_name}` } }}
                    onChange={async (e) => {
                      if (await s.run(() => supabase.from('project_members').update({ role: e.target.value }).eq('project_id', project.id).eq('profile_id', m.profile_id))) await after()
                    }}>
                    {(['admin', 'member', 'viewer'] as ProjectRole[]).map((r) => <MenuItem key={r} value={r}>{PROJECT_ROLE_LABELS[r]}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Remove from the project">
                    <IconButton aria-label={`Remove ${profileById(m.profile_id)?.full_name}`} onClick={async () => {
                      if (await s.run(() => supabase.from('project_members').delete().eq('project_id', project.id).eq('profile_id', m.profile_id))) await after()
                    }}><DeleteOutlineIcon /></IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Stack spacing={0.5} sx={{ mt: 2 }}>
        {(['admin', 'member', 'viewer'] as ProjectRole[]).map((r) => (
          <Typography key={r} variant="caption" sx={{ color: 'text.secondary' }}><strong>{PROJECT_ROLE_LABELS[r]}</strong>: {PROJECT_ROLE_HELP[r]}</Typography>
        ))}
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Workspace admins are admins of every project.</Typography>
      </Stack>
    </Box>
  )
}

function Workflow() {
  const { project } = useProject()
  const { statusesOf, reload } = useWorkspace()
  const statuses = statusesOf(project.id)
  const [editing, setEditing] = useState<Partial<ProjectStatus> | null>(null)
  const [deleting, setDeleting] = useState<ProjectStatus | null>(null)
  const s = useSaver()

  async function save() {
    if (!editing?.name?.trim()) return s.setError('Give the status a name.')
    const values = { name: editing.name.trim(), category: editing.category ?? 'todo', wip_limit: editing.wip_limit || null }
    const ok = await s.run(() => editing.id
      ? supabase.from('project_statuses').update(values).eq('id', editing.id)
      : supabase.from('project_statuses').insert({ ...values, project_id: project.id }))
    if (ok) {
      setEditing(null)
      await reload()
    }
  }

  async function moveStatus(i: number, by: number) {
    const ids = statuses.map((x) => x.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    if (await s.run(() => supabase.rpc('project_statuses_reorder', { p_project: project.id, p_ids: ids }))) await reload()
  }

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        The board's columns, in order. Issues can move from any status to any other; the category decides what counts as done.
      </Typography>
      {s.error && !editing && <Alert severity="error" sx={{ mb: 2 }} onClose={() => s.setError(null)}>{s.error}</Alert>}
      <Paper variant="outlined">
        <Table size="small">
          <TableHead><TableRow><TableCell>Status</TableCell><TableCell>Category</TableCell><TableCell>WIP limit</TableCell><TableCell /></TableRow></TableHead>
          <TableBody>
            {statuses.map((st, i) => (
              <TableRow key={st.id}>
                <TableCell>{st.name}</TableCell>
                <TableCell>{CATEGORY_LABELS[st.category]}</TableCell>
                <TableCell>{st.wip_limit ?? '—'}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <IconButton size="small" aria-label={`Move ${st.name} left`} disabled={i === 0} onClick={() => moveStatus(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                  <IconButton size="small" aria-label={`Move ${st.name} right`} disabled={i === statuses.length - 1} onClick={() => moveStatus(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                  <IconButton size="small" aria-label={`Edit ${st.name}`} onClick={() => { s.setError(null); setEditing(st) }}><EditOutlinedIcon fontSize="small" /></IconButton>
                  <IconButton size="small" aria-label={`Delete ${st.name}`} onClick={() => setDeleting(st)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Button sx={{ mt: 2 }} variant="outlined" onClick={() => { s.setError(null); setEditing({ category: 'in_progress' }) }}>Add status</Button>
      <FormDialog open={!!editing} title={editing?.id ? 'Edit status' : 'New status'} busy={s.busy} error={s.error} maxWidth="xs"
        onSubmit={save} onClose={() => setEditing(null)}>
        <TextField label="Name" autoFocus value={editing?.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
        <TextField select label="Category" value={editing?.category ?? 'todo'} onChange={(e) => setEditing({ ...editing, category: e.target.value as StatusCategory })}>
          {(['todo', 'in_progress', 'done'] as StatusCategory[]).map((c) => <MenuItem key={c} value={c}>{CATEGORY_LABELS[c]}</MenuItem>)}
        </TextField>
        <TextField label="WIP limit" type="number" value={editing?.wip_limit ?? ''} helperText="The column turns red when it holds more. Leave empty for none."
          onChange={(e) => setEditing({ ...editing, wip_limit: e.target.value ? Number(e.target.value) : null })} slotProps={{ htmlInput: { min: 1 } }} />
      </FormDialog>
      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.name}?`} destructive confirmLabel="Delete" busy={s.busy} error={s.error}
        message="Only a status no issue is in can be deleted: move its issues first."
        onConfirm={async () => {
          if (deleting && await s.run(() => supabase.from('project_statuses').delete().eq('id', deleting.id))) {
            setDeleting(null)
            await reload()
          }
        }}
        onClose={() => { setDeleting(null); s.setError(null) }} />
    </Box>
  )
}

function Fields() {
  const { project } = useProject()
  const { issueTypes, typeById } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const [editing, setEditing] = useState<Partial<Field> | null>(null)
  const [deleting, setDeleting] = useState<Field | null>(null)
  const s = useSaver()
  if (!meta) return <Loading />
  const fields = meta.fields
  const choice = editing?.kind === 'select' || editing?.kind === 'multi_select'

  async function save() {
    if (!editing?.name?.trim()) return s.setError('Give the field a name.')
    const values = {
      name: editing.name.trim(),
      options: choice ? editing.options ?? [] : [],
      issue_type_ids: editing.issue_type_ids?.length ? editing.issue_type_ids : null,
      required: !!editing.required,
    }
    const ok = await s.run(() => editing.id
      ? supabase.from('fields').update(values).eq('id', editing.id)
      : supabase.from('fields').insert({ ...values, kind: editing.kind ?? 'text', project_id: project.id }))
    if (ok) {
      setEditing(null)
      await invalidateProjectMeta(project.id)
    }
  }

  async function moveField(i: number, by: number) {
    const ids = fields.map((f) => f.id)
    ;[ids[i], ids[i + by]] = [ids[i + by], ids[i]]
    if (await s.run(() => supabase.rpc('fields_reorder', { p_project: project.id, p_ids: ids }))) await invalidateProjectMeta(project.id)
  }

  return (
    <Box sx={{ maxWidth: 820 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Extra fields on this project's issues, shown in the create dialog and down the side of every issue.
      </Typography>
      {s.error && !editing && <Alert severity="error" sx={{ mb: 2 }} onClose={() => s.setError(null)}>{s.error}</Alert>}
      {fields.length > 0 && (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead><TableRow><TableCell>Field</TableCell><TableCell>Kind</TableCell><TableCell>Applies to</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {fields.map((f, i) => (
                <TableRow key={f.id}>
                  <TableCell>{f.name}{f.required && <Chip size="small" label="Required" sx={{ ml: 1 }} />}</TableCell>
                  <TableCell>{FIELD_KIND_LABELS[f.kind]}{f.options.length ? `: ${f.options.join(', ')}` : ''}</TableCell>
                  <TableCell>{f.issue_type_ids ? f.issue_type_ids.map((id) => typeById(id)?.name).join(', ') : 'Every type'}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <IconButton size="small" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => moveField(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                    <IconButton size="small" aria-label={`Move ${f.name} down`} disabled={i === fields.length - 1} onClick={() => moveField(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                    <IconButton size="small" aria-label={`Edit ${f.name}`} onClick={() => { s.setError(null); setEditing(f) }}><EditOutlinedIcon fontSize="small" /></IconButton>
                    <IconButton size="small" aria-label={`Delete ${f.name}`} onClick={() => setDeleting(f)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      <Button sx={{ mt: 2 }} variant="outlined" onClick={() => { s.setError(null); setEditing({ kind: 'text', options: [] }) }}>Add field</Button>
      <FormDialog open={!!editing} title={editing?.id ? 'Edit field' : 'New field'} busy={s.busy} error={s.error} onSubmit={save} onClose={() => setEditing(null)}>
        <TextField label="Name" autoFocus value={editing?.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
        <TextField select label="Kind" value={editing?.kind ?? 'text'} disabled={!!editing?.id}
          helperText={editing?.id ? "A field's kind can't change." : undefined}
          onChange={(e) => setEditing({ ...editing, kind: e.target.value as FieldKind })}>
          {(Object.keys(FIELD_KIND_LABELS) as FieldKind[]).map((k) => <MenuItem key={k} value={k}>{FIELD_KIND_LABELS[k]}</MenuItem>)}
        </TextField>
        {choice && (
          <Autocomplete multiple freeSolo options={[]} value={editing?.options ?? []}
            onChange={(_, v) => setEditing({ ...editing, options: v.map((o) => o.trim()).filter(Boolean) })}
            renderInput={(params) => <TextField {...params} label="Options" placeholder="Type an option and press Enter" />} />
        )}
        <Autocomplete multiple options={issueTypes.filter((t) => !t.archived)} getOptionLabel={(t) => t.name}
          value={issueTypes.filter((t) => editing?.issue_type_ids?.includes(t.id))}
          onChange={(_, v) => setEditing({ ...editing, issue_type_ids: v.map((t) => t.id) })}
          renderInput={(params) => <TextField {...params} label="Applies to" placeholder={editing?.issue_type_ids?.length ? '' : 'Every type'} />} />
        {editing?.kind !== 'checkbox' && (
          <FormControlLabel control={<Checkbox checked={!!editing?.required} onChange={(e) => setEditing({ ...editing, required: e.target.checked })} />}
            label="Required when creating an issue" />
        )}
      </FormDialog>
      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.name}?`} destructive confirmLabel="Delete" busy={s.busy}
        message="Its values on existing issues are dropped the next time each is saved."
        onConfirm={async () => {
          if (deleting && await s.run(() => supabase.from('fields').delete().eq('id', deleting.id))) {
            setDeleting(null)
            await invalidateProjectMeta(project.id)
          }
        }}
        onClose={() => setDeleting(null)} />
    </Box>
  )
}

const ALL_CHAT_EVENTS = Object.keys(CHAT_EVENT_LABELS) as ChatEvent[]

function Chat() {
  const { project } = useProject()
  const [row, setRow] = useState<ProjectIntegrations | null | undefined>(undefined)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<ChatEvent[]>([])
  const s = useSaver()

  const load = useCallback(async () => {
    const { data } = await supabase.from('project_integrations').select('*').eq('project_id', project.id).maybeSingle()
    const r = (data as ProjectIntegrations | null) ?? null
    setRow(r)
    setUrl(r?.chat_webhook_url ?? '')
    setEvents(r?.chat_events ?? ['issue_created', 'status_changed', 'comment_added', 'sprint_started', 'sprint_completed', 'release_released'])
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  if (row === undefined) return <Loading />

  async function save() {
    const values = { chat_webhook_url: url.trim() || null, chat_events: events }
    if (values.chat_webhook_url && !/^https:\/\/chat\.googleapis\.com\//.test(values.chat_webhook_url)) {
      return s.setError('That isn’t a Google Chat webhook address (it starts with https://chat.googleapis.com/).')
    }
    const ok = await s.run(() => row
      ? supabase.from('project_integrations').update(values).eq('project_id', project.id)
      : supabase.from('project_integrations').insert({ ...values, project_id: project.id }))
    if (ok) load()
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 640 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Post this project's news to a Google Chat space. In the space: <em>Apps &amp; integrations → Webhooks → Add webhook</em>, then paste its
        address here. Each issue gets its own thread in the space.
      </Typography>
      <TextField label="Webhook URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://chat.googleapis.com/v1/spaces/…"
        helperText="Anyone with this address can post into the space, so only project admins can see it." />
      <FormGroup>
        {ALL_CHAT_EVENTS.map((ev) => (
          <FormControlLabel key={ev} label={CHAT_EVENT_LABELS[ev]} control={
            <Checkbox checked={events.includes(ev)} onChange={(e) => setEvents((xs) => (e.target.checked ? [...xs, ev] : xs.filter((x) => x !== ev)))} />
          } />
        ))}
      </FormGroup>
      {s.error && <Alert severity="error">{s.error}</Alert>}
      {s.saved && <Alert severity="success">Saved.</Alert>}
      <Box><Button variant="contained" onClick={save} loading={s.busy}>Save</Button></Box>
    </Stack>
  )
}

function Danger() {
  const { project } = useProject()
  const { isAdmin } = useAuth()
  const { reload } = useWorkspace()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const s = useSaver()

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle1">{project.archived_at ? 'Unarchive' : 'Archive'} this project</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          An archived project stays readable but can't be changed, and leaves the navigation.
        </Typography>
        <Button variant="outlined" loading={s.busy} onClick={async () => {
          if (await s.run(() => supabase.from('projects').update({ archived_at: project.archived_at ? null : new Date().toISOString() }).eq('id', project.id))) await reload()
        }}>{project.archived_at ? 'Unarchive' : 'Archive'}</Button>
      </Paper>
      {isAdmin && (
        <Paper variant="outlined" sx={{ p: 2.5, borderColor: 'error.light' }}>
          <Typography variant="subtitle1" color="error">Delete this project</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            Deletes every issue, comment, sprint and release in it, for good. Its Drive folder and files stay in Google Drive.
          </Typography>
          <Button color="error" variant="outlined" onClick={() => setConfirming(true)}>Delete project</Button>
        </Paper>
      )}
      {s.error && <Alert severity="error">{s.error}</Alert>}
      <FormDialog open={confirming} title={`Delete ${project.name}?`} submitLabel="Delete for good" busy={s.busy} error={s.error} maxWidth="xs"
        onSubmit={async () => {
          if (typed !== project.key) return s.setError(`Type ${project.key} to confirm.`)
          if (await s.run(() => supabase.from('projects').delete().eq('id', project.id))) {
            await reload()
            navigate('/projects')
          }
        }}
        onClose={() => setConfirming(false)}>
        <Typography variant="body2">This can't be undone. Type <strong>{project.key}</strong> to confirm.</Typography>
        <TextField autoFocus value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} slotProps={{ htmlInput: { 'aria-label': 'Project key' } }} />
      </FormDialog>
    </Stack>
  )
}

export default function ProjectSettings() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as TabKey) || 'details'
  const tabs: [TabKey, string][] = [
    ['details', 'Details'], ['people', 'People'], ['workflow', 'Workflow'], ['fields', 'Fields'], ['chat', 'Google Chat'], ['danger', 'Archive & delete'],
  ]
  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setParams({ tab: v }, { replace: true })} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 3 }}>
        {tabs.map(([k, label]) => <Tab key={k} value={k} label={label} />)}
      </Tabs>
      {tab === 'details' && <Details />}
      {tab === 'people' && <People />}
      {tab === 'workflow' && <Workflow />}
      {tab === 'fields' && <Fields />}
      {tab === 'chat' && <Chat />}
      {tab === 'danger' && <Danger />}
    </Box>
  )
}
