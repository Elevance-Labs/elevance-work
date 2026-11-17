// The Create project dialog (workspace admins, from the Work page): name,
// key (suggested from the name; fixed once made), Scrum or Kanban, access.
// Made through project_create; opens the new project.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MenuItem, TextField } from '@mui/material'
import { supabase } from '../lib/supabase'
import { PROJECT_KIND_HELP, PROJECT_KIND_LABELS, errorMessage } from '../lib/constants'
import type { Project, ProjectKind, ProjectVisibility } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { PROJECT_KEY, suggestKey } from '../lib/projects'
import { FormDialog } from './common'

export default function CreateProject({ onClose }: { onClose: () => void }) {
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
