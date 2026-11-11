import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Box, Button, Card, CardActionArea, Chip, FormControlLabel, Grid, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { PROJECT_KIND_HELP, PROJECT_KIND_LABELS, PROJECT_ROLE_LABELS, errorMessage } from '../lib/constants'
import type { Project, ProjectKind, ProjectVisibility } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { PROJECT_KEY, suggestKey } from '../lib/projects'
import { EmptyState, FormDialog, PageHeader, PersonName } from '../components/common'
import { ProjectAvatar } from '../components/IssueBits'

function CreateProject({ onClose }: { onClose: () => void }) {
  const { reload } = useWorkspace()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [kind, setKind] = useState<ProjectKind>('scrum')
  const [visibility, setVisibility] = useState<ProjectVisibility>('private')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return setError('Give the project a name.')
    if (!PROJECT_KEY.test(key)) return setError('The key is 2–10 capital letters or digits, starting with a letter.')
    setBusy(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('project_create', {
      p_key: key, p_name: name.trim(), p_kind: kind, p_visibility: visibility, p_description: description,
    })
    setBusy(false)
    if (e || !data) return setError(e?.code === '23505' ? `There is already a project with key ${key}.` : errorMessage(e))
    await reload()
    onClose()
    navigate(`/projects/${(data as Project).key}`)
  }

  return (
    <FormDialog open title="Create project" submitLabel="Create" busy={busy} error={error} onSubmit={create} onClose={onClose}>
      <TextField label="Name" required autoFocus value={name} onChange={(e) => {
        setName(e.target.value)
        if (!keyTouched) setKey(suggestKey(e.target.value))
      }} />
      <TextField label="Key" required value={key} onChange={(e) => { setKeyTouched(true); setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)) }}
        helperText={`Issues will be ${key || 'KEY'}-1, ${key || 'KEY'}-2… The key can't change later.`} />
      <TextField select label="Type" value={kind} onChange={(e) => setKind(e.target.value as ProjectKind)} helperText={PROJECT_KIND_HELP[kind]}>
        {(['scrum', 'kanban'] as ProjectKind[]).map((k) => <MenuItem key={k} value={k}>{PROJECT_KIND_LABELS[k]}</MenuItem>)}
      </TextField>
      <TextField select label="Access" value={visibility} onChange={(e) => setVisibility(e.target.value as ProjectVisibility)}>
        <MenuItem value="private">Private: only its members</MenuItem>
        <MenuItem value="open">Open: everyone can read and comment</MenuItem>
      </TextField>
      <TextField label="Description" multiline minRows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
    </FormDialog>
  )
}

export default function Projects() {
  const { isAdmin } = useAuth()
  const { projects, roleOf, profileById } = useWorkspace()
  const [creating, setCreating] = useState(false)
  const [archived, setArchived] = useState(false)
  const shown = projects.filter((p) => archived || !p.archived_at)

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={isAdmin ? 'Every project in the workspace.' : 'The projects you belong to, and the ones open to everyone.'}
        actions={
          <>
            {projects.some((p) => p.archived_at) && (
              <FormControlLabel control={<Switch checked={archived} onChange={(e) => setArchived(e.target.checked)} />} label="Show archived" />
            )}
            {isAdmin && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Create project</Button>}
          </>
        }
      />
      {!shown.length && (
        <EmptyState icon={<FolderOutlinedIcon />} title="No projects yet">
          {isAdmin ? 'Create the first one.' : 'Ask a workspace admin to add you to one.'}
        </EmptyState>
      )}
      <Grid container spacing={2}>
        {shown.map((p) => {
          const role = roleOf(p.id)
          return (
            <Grid key={p.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Card variant="outlined" sx={{ height: '100%', opacity: p.archived_at ? 0.7 : 1 }}>
                <CardActionArea component={Link} to={`/projects/${p.key}`} sx={{ p: 2, height: '100%', alignItems: 'flex-start', display: 'flex', flexDirection: 'column' }}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1, width: '100%' }}>
                    <ProjectAvatar project={p} size={36} />
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Typography variant="subtitle1" noWrap>{p.name}</Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{p.key} · {PROJECT_KIND_LABELS[p.kind]}</Typography>
                    </Box>
                  </Stack>
                  {p.description && (
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {p.description}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 'auto', width: '100%' }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>{p.lead_id && <PersonName person={profileById(p.lead_id)} size={22} />}</Box>
                    {p.visibility === 'open' && <Chip size="small" label="Open" variant="outlined" />}
                    {p.archived_at && <Chip size="small" label="Archived" />}
                    {role && <Chip size="small" label={PROJECT_ROLE_LABELS[role]} />}
                  </Stack>
                </CardActionArea>
              </Card>
            </Grid>
          )
        })}
      </Grid>
      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </>
  )
}
