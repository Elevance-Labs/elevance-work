// What an issue is connected to: its children (an epic's issues, a story's
// sub-tasks) and its links to other issues.
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, IconButton, LinearProgress, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import { supabase } from '../../lib/supabase'
import { can } from '../../lib/permissions'
import { LINK_LABELS, errorMessage } from '../../lib/constants'
import { ISSUE_COLUMNS, byRank, isDone } from '../../lib/issues'
import type { Issue, IssueLink, LinkKind, ProjectRole } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { emitIssueChange } from '../../workspace/issueEvents'
import { useLayout } from '../layoutContext'
import { PersonAvatar, Section } from '../common'
import { IssueKey, StatusLozenge, TypeIcon } from '../IssueBits'
import { useIssueHref } from '../useIssueHref'
import { IssuePicker } from '../pickers'

function IssueRow({ issue, trailing }: { issue: Issue; trailing?: ReactNode }) {
  const { typeById, statusById, profileById } = useWorkspace()
  const href = useIssueHref()
  const status = statusById(issue.status_id)
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', py: 0.5, px: 1, borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}>
      <TypeIcon type={typeById(issue.type_id)} />
      <IssueKey issueKey={issue.key} done={status?.category === 'done'} />
      <Typography component={Link} to={href(issue.key)} variant="body2" noWrap
        sx={{ flexGrow: 1, minWidth: 0, color: 'text.primary', textDecoration: 'none' }}>
        {issue.title}
      </Typography>
      <StatusLozenge status={status} />
      <PersonAvatar person={profileById(issue.assignee_id)} size={22} tooltip />
      {trailing}
    </Stack>
  )
}

export function Children({
  parent,
  issues: children,
  role,
  onChange,
}: {
  parent: Issue
  issues: Issue[]
  role: ProjectRole | null
  onChange: (children: Issue[]) => void
}) {
  const { typeById, statusesOf, issueTypes } = useWorkspace()
  const { openCreate } = useLayout()
  const level = typeById(parent.type_id)?.level
  const statuses = statusesOf(parent.project_id)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (level === 'subtask') return null

  const sorted = [...children].sort(byRank)
  const done = children.filter((c) => isDone(c, statuses)).length
  const subtaskType = issueTypes.find((t) => t.level === 'subtask' && !t.archived)

  async function addSubtask() {
    if (!title.trim() || !subtaskType) return
    setBusy(true)
    setError(null)
    const { data, error: e } = await supabase.from('issues')
      .insert({ project_id: parent.project_id, type_id: subtaskType.id, title: title.trim(), parent_id: parent.id })
      .select(ISSUE_COLUMNS).single()
    setBusy(false)
    if (e || !data) return setError(errorMessage(e))
    onChange([...children, data as unknown as Issue])
    emitIssueChange(parent.id)
    setTitle('')
  }

  const epic = level === 'epic'
  return (
    <Section
      title={`${epic ? 'Issues in this epic' : 'Sub-tasks'}${children.length ? ` (${done}/${children.length} done)` : ''}`}
      action={can.editIssues(role) && (
        <Button size="small" startIcon={<AddIcon />}
          onClick={() => (epic ? openCreate({ projectId: parent.project_id, parent, onCreated: (i) => onChange([...children, i]) }) : setAdding(true))}>
          Add
        </Button>
      )}
    >
      {!!children.length && <LinearProgress variant="determinate" value={(done / children.length) * 100} color="success" sx={{ mb: 1, borderRadius: 1 }} />}
      {sorted.map((c) => <IssueRow key={c.id} issue={c} />)}
      {!children.length && !adding && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{epic ? 'No issues yet.' : 'No sub-tasks.'}</Typography>
      )}
      {adding && (
        <Box component="form" sx={{ mt: 1 }} onSubmit={(e) => { e.preventDefault(); addSubtask() }}>
          <Stack direction="row" spacing={1}>
            <TextField autoFocus fullWidth placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)}
              slotProps={{ htmlInput: { 'aria-label': 'New sub-task', maxLength: 255 } }} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
            <Button type="submit" variant="contained" loading={busy}>Create</Button>
            <Button onClick={() => setAdding(false)}>Done</Button>
          </Stack>
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        </Box>
      )}
    </Section>
  )
}

// One choice per reading of a link, from this issue's side.
const LINK_CHOICES: { value: string; kind: LinkKind; inward: boolean; label: string }[] = [
  { value: 'blocks', kind: 'blocks', inward: false, label: 'blocks' },
  { value: 'blocked', kind: 'blocks', inward: true, label: 'is blocked by' },
  { value: 'relates', kind: 'relates', inward: false, label: 'relates to' },
  { value: 'duplicates', kind: 'duplicates', inward: false, label: 'duplicates' },
  { value: 'duplicated', kind: 'duplicates', inward: true, label: 'is duplicated by' },
  { value: 'clones', kind: 'clones', inward: false, label: 'clones' },
  { value: 'cloned', kind: 'clones', inward: true, label: 'is cloned by' },
]

export interface LinkedIssue {
  link: IssueLink
  other: Issue
}

export function Links({
  issue,
  links,
  role,
  onChange,
}: {
  issue: Issue
  links: LinkedIssue[]
  role: ProjectRole | null
  onChange: (links: LinkedIssue[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [choice, setChoice] = useState('blocks')
  const [other, setOther] = useState<Issue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editable = can.editIssues(role)

  async function add() {
    const c = LINK_CHOICES.find((x) => x.value === choice)!
    if (!other) return
    setBusy(true)
    setError(null)
    const row = c.inward
      ? { source_id: other.id, target_id: issue.id, kind: c.kind }
      : { source_id: issue.id, target_id: other.id, kind: c.kind }
    const { data, error: e } = await supabase.from('issue_links').insert(row).select().single()
    setBusy(false)
    if (e || !data) return setError(e?.code === '23505' ? 'Those issues are already linked that way.' : errorMessage(e))
    onChange([...links, { link: data as IssueLink, other }])
    setOther(null)
    setAdding(false)
  }

  async function remove(l: LinkedIssue) {
    const { error: e } = await supabase.from('issue_links').delete().eq('id', l.link.id)
    if (e) return setError(errorMessage(e))
    onChange(links.filter((x) => x.link.id !== l.link.id))
  }

  const reading = (l: LinkedIssue) => LINK_LABELS[l.link.kind][l.link.source_id === issue.id ? 'outward' : 'inward']
  const groups = [...new Set(links.map(reading))]

  return (
    <Section title="Linked issues" action={editable && <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)}>Link</Button>}>
      {groups.map((g) => (
        <Box key={g} sx={{ mb: 1 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase' }}>{g}</Typography>
          {links.filter((l) => reading(l) === g).map((l) => (
            <IssueRow key={l.link.id} issue={l.other} trailing={editable && (
              <Tooltip title="Remove link">
                <IconButton size="small" aria-label={`Unlink ${l.other.key}`} onClick={() => remove(l)}><LinkOffIcon fontSize="small" /></IconButton>
              </Tooltip>
            )} />
          ))}
        </Box>
      ))}
      {!links.length && !adding && <Typography variant="body2" sx={{ color: 'text.secondary' }}>No links.</Typography>}
      {adding && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField select label="This issue" value={choice} onChange={(e) => setChoice(e.target.value)} sx={{ minWidth: 170 }}>
              {LINK_CHOICES.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
            </TextField>
            <Box sx={{ flexGrow: 1 }}>
              <IssuePicker label="Issue" value={other} onChange={setOther} exclude={[issue.id]} autoFocus />
            </Box>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" size="small" disabled={!other} loading={busy} onClick={add}>Link</Button>
            <Button size="small" onClick={() => setAdding(false)}>Cancel</Button>
          </Stack>
        </Stack>
      )}
      {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
    </Section>
  )
}
