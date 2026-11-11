// One release: its issues and progress, releasing it, and its notes, which
// can be copied or saved as a Google Doc in the project's Drive folder.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { supabase } from '../../lib/supabase'
import { can } from '../../lib/permissions'
import { RELEASE_STATUS_COLORS, RELEASE_STATUS_LABELS, errorMessage, formatDate, formatDayTime } from '../../lib/constants'
import { ISSUE_COLUMNS, byRank } from '../../lib/issues'
import { createDoc } from '../../lib/drive'
import { notesHtml, notesText, releaseNotes, releaseProgress } from '../../lib/releases'
import type { Issue, ReleaseStatus } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { invalidateProjectMeta, useProjectMeta } from '../../workspace/useProjectMeta'
import { emitIssueChange, useIssueChanges } from '../../workspace/issueEvents'
import { ConfirmDialog, EmptyState, FormDialog, Loading } from '../../components/common'
import { StatTile } from '../../components/charts'
import { BacklogRow } from '../../components/IssueCard'
import { IssuePicker } from '../../components/pickers'
import ReleaseForm from '../../components/ReleaseForm'
import { useProject } from './projectContext'

export default function ReleaseDetail() {
  const { releaseId } = useParams()
  const navigate = useNavigate()
  const { project, role } = useProject()
  const { statusesOf, issueTypes } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const release = meta?.releases.find((r) => r.id === releaseId)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [tab, setTab] = useState<'issues' | 'notes'>('issues')
  const [editing, setEditing] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [moveTo, setMoveTo] = useState('keep')
  const [deleting, setDeleting] = useState(false)
  const [adding, setAdding] = useState<Issue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const editable = can.manageReleases(role)

  const load = useCallback(async () => {
    const { data } = await supabase.from('issues').select(ISSUE_COLUMNS).eq('release_id', releaseId ?? '')
    setIssues((data ?? []) as unknown as Issue[])
  }, [releaseId])

  useEffect(() => {
    load()
  }, [load])
  useIssueChanges(() => load())

  if (!meta || !issues) return <Loading />
  if (!release) {
    return <EmptyState title="That release doesn't exist">
      <Link to={`/projects/${project.key}/releases`}>All releases</Link>
    </EmptyState>
  }

  const progress = releaseProgress(issues, statuses)
  const { sections, unfinished } = releaseNotes(issues, issueTypes, statuses)
  const others = meta.releases.filter((r) => r.id !== release.id && r.status === 'unreleased')

  async function setStatus(status: ReleaseStatus) {
    setBusy(true)
    setError(null)
    if (status === 'released' && moveTo !== 'keep' && unfinished.length) {
      const { error: e } = await supabase.from('issues').update({ release_id: moveTo === 'none' ? null : moveTo })
        .in('id', unfinished.map((i) => i.id))
      if (e) {
        setBusy(false)
        return setError(errorMessage(e))
      }
    }
    const { error: e } = await supabase.from('releases').update({ status }).eq('id', release!.id)
    setBusy(false)
    if (e) return setError(errorMessage(e))
    setReleasing(false)
    await invalidateProjectMeta(project.id)
    await load()
    emitIssueChange()
  }

  async function remove() {
    setBusy(true)
    const { error: e } = await supabase.from('releases').delete().eq('id', release!.id)
    setBusy(false)
    if (e) return setError(errorMessage(e))
    await invalidateProjectMeta(project.id)
    navigate(`/projects/${project.key}/releases`)
  }

  async function addIssue() {
    if (!adding) return
    const { error: e } = await supabase.from('issues').update({ release_id: release!.id }).eq('id', adding.id)
    if (e) return setError(errorMessage(e))
    setAdding(null)
    await load()
    emitIssueChange(adding.id)
  }

  async function copyNotes() {
    try {
      await navigator.clipboard.writeText(notesText(project.name, release!, sections))
      setNotice('Release notes copied.')
    } catch {
      setError("Your browser didn't allow copying. Select the notes and copy them instead.")
    }
  }

  async function saveAsDoc() {
    setBusy(true)
    setError(null)
    const { data, error: e } = await createDoc(project.id, `${project.name} ${release!.name} release notes`, 'document', null,
      notesHtml(project.name, release!, sections))
    setBusy(false)
    if (e || !data) return setError(e ?? 'Google Drive is not reachable right now.')
    setNotice('Saved as a Google Doc in the project folder (see Docs).')
    window.open(data.url, '_blank', 'noopener')
  }

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <Button component={Link} to={`/projects/${project.key}/releases`} size="small">← Releases</Button>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {release.name}{' '}
          <Chip size="small" label={RELEASE_STATUS_LABELS[release.status]} color={RELEASE_STATUS_COLORS[release.status]} sx={{ verticalAlign: 'middle' }} />
        </Typography>
        {editable && (
          <>
            <Button onClick={() => setEditing(true)}>Edit</Button>
            {release.status === 'unreleased' && <Button variant="contained" onClick={() => { setMoveTo(others[0]?.id ?? 'keep'); setReleasing(true) }}>Release</Button>}
            {release.status === 'released' && (
              <>
                <Button onClick={() => setStatus('unreleased')} loading={busy}>Unrelease</Button>
                <Button onClick={() => setStatus('archived')} loading={busy}>Archive</Button>
              </>
            )}
            {release.status === 'archived' && <Button onClick={() => setStatus('released')} loading={busy}>Unarchive</Button>}
          </>
        )}
        {can.deleteReleases(role) && <Button color="error" onClick={() => setDeleting(true)}>Delete</Button>}
      </Stack>
      {release.description && <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2, whiteSpace: 'pre-wrap' }}>{release.description}</Typography>}
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>{notice}</Alert>}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}><StatTile value={progress.total} label="issues" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile value={progress.done} label="done" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatTile value={progress.inProgress + progress.todo} label="still open" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile value={release.status === 'released' && release.released_at ? formatDate(release.released_at.slice(0, 10)) : formatDate(release.release_date)}
            label={release.status === 'released' ? 'released' : 'release date'}
            hint={release.released_at ? formatDayTime(release.released_at) : release.start_date ? `from ${formatDate(release.start_date)}` : undefined} />
        </Grid>
      </Grid>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="issues" label="Issues" />
        <Tab value="notes" label="Release notes" />
      </Tabs>

      {tab === 'issues' ? (
        <>
          {editable && release.status !== 'archived' && (
            <Stack direction="row" spacing={1} sx={{ mb: 2, maxWidth: 560 }}>
              <Box sx={{ flexGrow: 1 }}>
                <IssuePicker label="Add an issue to this release" value={adding} onChange={setAdding} projectId={project.id}
                  exclude={issues.map((i) => i.id)} />
              </Box>
              <Button variant="outlined" disabled={!adding} onClick={addIssue}>Add</Button>
            </Stack>
          )}
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            {[...issues].sort(byRank).map((i) => <BacklogRow key={i.id} issue={i} moves={[]} draggable={false} />)}
            {!issues.length && <EmptyState title="No issues in this release">Set an issue's Release field, or add one above.</EmptyState>}
          </Paper>
        </>
      ) : (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button startIcon={<ContentCopyIcon />} onClick={copyNotes} disabled={!sections.length}>Copy as text</Button>
            {can.addDocs(role) && <Button variant="outlined" onClick={saveAsDoc} loading={busy} disabled={!sections.length}>Save as Google Doc</Button>}
          </Stack>
          <Typography variant="h6">{project.name} {release.name}</Typography>
          {!sections.length && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>Nothing done in this release yet.</Typography>}
          {sections.map((s) => (
            <Box key={s.title} sx={{ mt: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{s.title}</Typography>
              <Box component="ul" sx={{ pl: 3, my: 0.5 }}>
                {s.issues.map((i) => (
                  <li key={i.id}><Typography variant="body2"><Link to={{ search: `?issue=${i.key}` }}>{i.key}</Link> {i.title}</Typography></li>
                ))}
              </Box>
            </Box>
          ))}
          {unfinished.length > 0 && (
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 2 }}>
              {unfinished.length} unfinished issue{unfinished.length === 1 ? ' isn’t' : 's aren’t'} in the notes.
            </Typography>
          )}
        </Paper>
      )}

      {editing && <ReleaseForm open release={release} projectId={project.id} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      <FormDialog open={releasing} title={`Release ${release.name}`} submitLabel="Release" busy={busy} error={error} maxWidth="xs"
        onSubmit={() => setStatus('released')} onClose={() => setReleasing(false)}>
        <Typography variant="body2">
          {progress.done} of {progress.total} issues are done.
          {release.release_date ? ` Planned for ${formatDate(release.release_date)}.` : ''}
        </Typography>
        {unfinished.length > 0 && (
          <TextField select label={`The ${unfinished.length} unfinished issue${unfinished.length === 1 ? '' : 's'}`} value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}>
            <MenuItem value="keep">Stay in this release</MenuItem>
            {others.map((r) => <MenuItem key={r.id} value={r.id}>Move to {r.name}</MenuItem>)}
            <MenuItem value="none">Remove from any release</MenuItem>
          </TextField>
        )}
      </FormDialog>
      <ConfirmDialog open={deleting} title={`Delete ${release.name}?`} destructive confirmLabel="Delete" busy={busy}
        message="Its issues stay, without a release." onConfirm={remove} onClose={() => setDeleting(false)} />
    </Box>
  )
}
