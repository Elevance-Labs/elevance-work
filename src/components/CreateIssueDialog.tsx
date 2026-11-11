import { useMemo, useState } from 'react'
import { Alert, Checkbox, FormControlLabel, Grid, MenuItem, TextField } from '@mui/material'
import { supabase } from '../lib/supabase'
import { can, assignable } from '../lib/permissions'
import { errorMessage } from '../lib/constants'
import { ISSUE_COLUMNS, parentLevelFor } from '../lib/issues'
import { sanitizeHtml, isBlankHtml } from '../lib/richText'
import type { CustomValues, Issue, IssuePriority } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { openSprints, useProjectMeta } from '../workspace/useProjectMeta'
import { emitIssueChange } from '../workspace/issueEvents'
import { FormDialog } from './common'
import { CustomFieldInput } from './CustomFields'
import { fieldsFor, missingRequired } from '../lib/fields'
import { IssuePicker, LabelsInput, PersonPicker, PrioritySelect, TypeSelect } from './pickers'
import { RichTextEditor } from './RichText'

export interface CreateDefaults {
  projectId?: string
  typeId?: string
  parent?: Issue
  sprintId?: string | null
  statusId?: string
  // Called with the new issue (e.g. the backlog adds it in place).
  onCreated?: (issue: Issue) => void
}

const LAST_PROJECT = 'work.lastProject'

function rememberedProject() {
  try {
    return localStorage.getItem(LAST_PROJECT)
  } catch {
    return null
  }
}

export default function CreateIssueDialog({ defaults, onClose }: { defaults: CreateDefaults; onClose: () => void }) {
  const { projects, issueTypes, profiles, roleOf, projectById, typeById } = useWorkspace()
  const writable = projects.filter((p) => can.editIssues(roleOf(p.id)))
  const initialProject =
    defaults.projectId ?? writable.find((p) => p.id === rememberedProject())?.id ?? writable[0]?.id ?? ''

  const [projectId, setProjectId] = useState(initialProject)
  const project = projectById(projectId)
  const meta = useProjectMeta(projectId || null)
  // Under a parent, only the level that may sit there: stories under an epic, sub-tasks under a story.
  const parentType = defaults.parent ? typeById(defaults.parent.type_id) : undefined
  const types = issueTypes.filter((t) => !t.archived && (!parentType || parentLevelFor(t.level) === parentType.level))
  const [typeId, setTypeId] = useState(defaults.typeId ?? (defaults.parent ? types[0]?.id : types.find((t) => t.name === 'Task')?.id) ?? types[0]?.id ?? '')
  const level = typeById(typeId)?.level ?? 'standard'
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState<string | null>(null)
  const [priority, setPriority] = useState<IssuePriority>('medium')
  const [labels, setLabels] = useState<string[]>([])
  const [points, setPoints] = useState('')
  const [due, setDue] = useState('')
  const [sprintId, setSprintId] = useState<string>(defaults.sprintId ?? '')
  const [releaseId, setReleaseId] = useState('')
  const [parent, setParent] = useState<Issue | null>(defaults.parent ?? null)
  const [custom, setCustom] = useState<CustomValues>({})
  const [another, setAnother] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const people = useMemo(() => (project && meta ? assignable(project, profiles, meta.members) : []), [project, meta, profiles])
  const fields = meta ? fieldsFor(meta.fields, typeId) : []
  const parentLevel = parentLevelFor(level)
  const parentTypeIds = issueTypes.filter((t) => t.level === parentLevel).map((t) => t.id)
  const sprints = openSprints(meta)

  function switchProject(id: string) {
    setProjectId(id)
    setParent(null)
    setSprintId('')
    setReleaseId('')
    setAssignee(null)
    setCustom({})
  }

  async function submit() {
    setError(null)
    if (!project) return setError('Choose a project.')
    if (!title.trim()) return setError('Give the issue a summary.')
    if (level === 'subtask' && !parent) return setError('A sub-task needs a parent issue.')
    const missing = meta ? missingRequired(meta.fields, typeId, custom) : []
    if (missing.length) return setError(`${missing.map((f) => f.name).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required.`)

    setBusy(true)
    const { data, error: e } = await supabase
      .from('issues')
      .insert({
        project_id: project.id,
        type_id: typeId,
        title: title.trim(),
        description: isBlankHtml(description) ? '' : sanitizeHtml(description),
        assignee_id: assignee,
        priority,
        labels,
        story_points: points === '' ? null : Number(points),
        due_date: due || null,
        sprint_id: level === 'standard' && sprintId ? sprintId : null,
        release_id: releaseId || null,
        parent_id: parent?.id ?? null,
        custom,
        ...(defaults.statusId ? { status_id: defaults.statusId } : {}),
      })
      .select(ISSUE_COLUMNS)
      .single()
    setBusy(false)
    if (e || !data) return setError(errorMessage(e))
    try {
      localStorage.setItem(LAST_PROJECT, project.id)
    } catch {
      // Remembering the project is a convenience.
    }
    const issue = data as unknown as Issue
    defaults.onCreated?.(issue)
    emitIssueChange(issue.id)
    if (another) {
      setTitle('')
      setDescription('')
      setEditorKey((k) => k + 1)
    } else {
      onClose()
    }
  }

  return (
    <FormDialog
      open
      title={defaults.parent ? `New issue under ${defaults.parent.key}` : 'Create issue'}
      submitLabel="Create"
      busy={busy}
      error={error}
      maxWidth="md"
      onSubmit={submit}
      onClose={onClose}
      extraActions={
        <FormControlLabel control={<Checkbox checked={another} onChange={(e) => setAnother(e.target.checked)} />} label="Create another" />
      }
    >
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField select label="Project" value={projectId} required fullWidth disabled={!!defaults.projectId}
            onChange={(e) => switchProject(e.target.value)}>
            {writable.map((p) => <MenuItem key={p.id} value={p.id}>{p.name} ({p.key})</MenuItem>)}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TypeSelect value={typeId} types={types} onChange={(id) => {
            setTypeId(id)
            if (parentLevelFor(typeById(id)?.level ?? 'standard') !== parentLevel && !defaults.parent) setParent(null)
          }} />
        </Grid>
      </Grid>
      {!writable.length && <Alert severity="info">You aren't a member of any project you can add issues to.</Alert>}
      <TextField label="Summary" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} slotProps={{ htmlInput: { maxLength: 255 } }} />
      <RichTextEditor key={editorKey} label="Description" value={description} onChange={setDescription} mentionables={profiles}
        placeholder="What needs doing, and why?" minHeight={120} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <PersonPicker label="Assignee" value={assignee} options={people} onChange={setAssignee} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <PrioritySelect value={priority} onChange={setPriority} />
        </Grid>
        {parentLevel && (
          <Grid size={{ xs: 12, sm: 6 }}>
            {defaults.parent ? (
              <TextField label="Parent" value={`${defaults.parent.key} ${defaults.parent.title}`} disabled fullWidth />
            ) : (
              <IssuePicker label={level === 'subtask' ? 'Parent issue' : 'Epic'} value={parent} onChange={setParent}
                projectId={projectId} typeIds={parentTypeIds} />
            )}
          </Grid>
        )}
        {project?.kind === 'scrum' && level === 'standard' && (
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select label="Sprint" value={sprintId} fullWidth onChange={(e) => setSprintId(e.target.value)}>
              <MenuItem value="">Backlog</MenuItem>
              {sprints.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}{s.state === 'active' ? ' (active)' : ''}</MenuItem>)}
            </TextField>
          </Grid>
        )}
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField label="Story points" type="number" value={points} fullWidth onChange={(e) => setPoints(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: 0.5 } }} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField label="Due date" type="date" value={due} fullWidth onChange={(e) => setDue(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField select label="Release" value={releaseId} fullWidth onChange={(e) => setReleaseId(e.target.value)}>
            <MenuItem value="">None</MenuItem>
            {(meta?.releases ?? []).filter((r) => r.status === 'unreleased').map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid size={12}>
          <LabelsInput value={labels} onChange={setLabels} />
        </Grid>
        {fields.map((f) => (
          <Grid key={f.id} size={{ xs: 12, sm: f.kind === 'text' ? 12 : 6 }}>
            <CustomFieldInput field={f} value={custom[f.id]} people={profiles.filter((p) => p.active)}
              onChange={(v) => setCustom((c) => {
                const next = { ...c }
                if (v === undefined) delete next[f.id]
                else next[f.id] = v
                return next
              })} />
          </Grid>
        ))}
      </Grid>
    </FormDialog>
  )
}
