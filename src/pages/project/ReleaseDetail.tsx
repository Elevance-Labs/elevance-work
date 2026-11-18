// One release. Its internal description and its notes lead (the notes
// public one day), then its issues; down the right: its status and dates, its approval,
// and its outlook (the Summary's release judgement). On a phone the status
// and approval come first. Managers plan, write, approve-gate and release;
// once every approver approved, it is locked.
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import { supabase } from '../../lib/supabase'
import { can, canApprove } from '../../lib/permissions'
import { RELEASE_STATUS_COLORS, RELEASE_STATUS_LABELS, errorMessage, formatDate, formatDayTime } from '../../lib/constants'
import { ISSUE_COLUMNS, byRank } from '../../lib/issues'
import {
  APPROVAL_COLORS,
  LOCKED_HINT,
  approvalLabel,
  releaseApproval,
  releaseCountdown,
  releaseNotes,
  releaseProgress,
} from '../../lib/releases'
import type { Issue, ReleaseApprover, ReleaseStatus } from '../../lib/types'
import { useMe } from '../../auth/AuthProvider'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { invalidateProjectMeta, useProjectMeta } from '../../workspace/useProjectMeta'
import { emitIssueChange, useIssueChanges } from '../../workspace/issueEvents'
import { ConfirmDialog, EmptyState, FormDialog, Loading, Section } from '../../components/common'
import { BacklogRow } from '../../components/IssueCard'
import { IssuePicker } from '../../components/pickers'
import ReleaseForm from '../../components/ReleaseForm'
import ReleaseNotesCard from '../../components/releases/ReleaseNotesCard'
import ApprovalPanel from '../../components/releases/ApprovalPanel'
import ReleaseOutlook from '../../components/insights/ReleaseOutlook'
import { invalidateWidgets } from '../../components/insights/useWidgetQuery'
import { useProject } from './projectContext'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ py: 0.5 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', width: 96, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" component="div" sx={{ minWidth: 0 }}>{children}</Typography>
    </Stack>
  )
}

export default function ReleaseDetail() {
  const { releaseId } = useParams()
  const navigate = useNavigate()
  const me = useMe()
  const { project, role } = useProject()
  const { statusesOf, issueTypes, profiles } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const release = meta?.releases.find((r) => r.id === releaseId)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [approvers, setApprovers] = useState<ReleaseApprover[]>([])
  const [editing, setEditing] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const [moveTo, setMoveTo] = useState('keep')
  const [deleting, setDeleting] = useState(false)
  const [adding, setAdding] = useState<Issue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const manages = can.manageReleases(role)

  const load = useCallback(async () => {
    const [i, a] = await Promise.all([
      supabase.from('issues').select(ISSUE_COLUMNS).eq('release_id', releaseId ?? ''),
      supabase.from('release_approvers').select('*').eq('release_id', releaseId ?? ''),
    ])
    if (i.error || a.error) setError(errorMessage(i.error ?? a.error))
    setIssues((i.data ?? []) as unknown as Issue[])
    setApprovers((a.data ?? []) as ReleaseApprover[])
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
  const approval = releaseApproval(release, approvers)
  const countdown = releaseCountdown(release)
  const others = meta.releases.filter((r) => r.id !== release.id && r.status === 'unreleased')
  const open = release.status === 'unreleased'

  // Issues moved in or out: the database asked the approvers again, and the outlook is stale.
  async function changed(issueId?: string) {
    invalidateWidgets(project.id)
    await load()
    emitIssueChange(issueId)
  }

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
    await changed()
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
    setError(null)
    const { error: e } = await supabase.from('issues').update({ release_id: release!.id }).eq('id', adding.id)
    if (e) return setError(errorMessage(e))
    setAdding(null)
    await changed(adding.id)
  }

  async function takeOut(issue: Issue) {
    setError(null)
    const { error: e } = await supabase.from('issues').update({ release_id: null }).eq('id', issue.id)
    if (e) return setError(errorMessage(e))
    await changed(issue.id)
  }

  const asksAgain = approvers.length > 0 && open
  const lockedTip = (node: ReactElement) => approval.locked
    ? <Tooltip title={LOCKED_HINT}><span>{node}</span></Tooltip> : node

  const header = (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
      <Button component={Link} to={`/projects/${project.key}/releases`} size="small">← Releases</Button>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0, flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="h6" component="h1" noWrap>{release.name}</Typography>
        <Chip size="small" label={RELEASE_STATUS_LABELS[release.status]} color={RELEASE_STATUS_COLORS[release.status]} />
        {approval.state !== 'none' && (
          <Chip size="small" variant="outlined" color={APPROVAL_COLORS[approval.state]} label={approvalLabel(approval)}
            icon={approval.locked ? <LockOutlinedIcon /> : undefined} />
        )}
      </Stack>
      {manages && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {release.status !== 'archived' && lockedTip(<Button disabled={approval.locked} onClick={() => setEditing(true)}>Edit</Button>)}
          {open && (
            <Tooltip title={approval.cleared ? '' : approval.state === 'rejected' ? 'Rejected: ask for approval again once it is put right.'
              : 'Every approver must approve first.'}>
              <span>
                <Button variant="contained" disabled={!approval.cleared}
                  onClick={() => { setMoveTo(asksAgain ? 'keep' : others[0]?.id ?? 'keep'); setError(null); setReleasing(true) }}>
                  Release
                </Button>
              </span>
            </Tooltip>
          )}
          {release.status === 'released' && <Button onClick={() => setStatus('unreleased')} loading={busy}>Unrelease</Button>}
          {release.status !== 'archived' && <Button onClick={() => setStatus('archived')} loading={busy}>Archive</Button>}
          {/* Back to where it was: released if it ever went out. */}
          {release.status === 'archived' && (
            <Button onClick={() => setStatus(release.released_at ? 'released' : 'unreleased')} loading={busy}>Unarchive</Button>
          )}
          {can.deleteReleases(role) && <Button color="error" onClick={() => setDeleting(true)}>Delete</Button>}
        </Stack>
      )}
    </Stack>
  )

  const details = (
    <Paper variant="outlined" sx={{ p: 2, order: { xs: 1, md: 0 } }} data-release-details>
      <Section title="Details">
        <Fact label="Status">{RELEASE_STATUS_LABELS[release.status]}</Fact>
        <Fact label="Release date">
          {formatDate(release.release_date)}
          {countdown && release.status === 'unreleased' && (
            <Typography variant="caption" component="div"
              sx={{ color: countdown.tone === 'overdue' ? 'error.main' : countdown.tone === 'soon' ? 'warning.main' : 'text.secondary' }}>
              {countdown.text}
            </Typography>
          )}
        </Fact>
        <Fact label="Start date">{release.start_date ? formatDate(release.start_date) : '—'}</Fact>
        {release.released_at && <Fact label="Released">{formatDayTime(release.released_at)}</Fact>}
      </Section>
    </Paper>
  )

  const issuesCard = (
    <Paper variant="outlined" sx={{ p: 2, order: { xs: 4, md: 0 } }} data-release-issues>
      <Section title={`Issues (${issues.length})`}>
        {manages && release.status !== 'archived' && (
          <Box sx={{ mb: 2 }}>
            <Stack direction="row" spacing={1} sx={{ maxWidth: 560 }}>
              <Box sx={{ flexGrow: 1 }}>
                <IssuePicker label="Add an issue to this release" value={adding} onChange={setAdding} projectId={project.id}
                  exclude={issues.map((i) => i.id)} />
              </Box>
              <Button variant="outlined" disabled={!adding} onClick={addIssue}>Add</Button>
            </Stack>
            {asksAgain && (
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
                Adding or removing an issue asks the approvers again.
              </Typography>
            )}
          </Box>
        )}
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', '& > :last-child': { borderBottom: 0 } }}>
          {[...issues].sort(byRank).map((i) => (
            <BacklogRow key={i.id} issue={i} moves={[]} draggable={false} extra={manages && release.status !== 'archived' && (
              <Tooltip title="Remove from this release">
                <IconButton size="small" aria-label={`Remove ${i.key} from the release`} onClick={() => takeOut(i)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )} />
          ))}
          {!issues.length && <EmptyState title="No issues in this release">Set an issue's Release field{manages ? ', or add one above' : ''}.</EmptyState>}
        </Box>
      </Section>
    </Paper>
  )

  return (
    <Box>
      {header}
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>{notice}</Alert>}

      {/* Two columns from md; below, one column with status and approval first. */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: { md: 'flex-start' } }}>
        <Box sx={{ display: { xs: 'contents', md: 'flex' }, flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <Box sx={{ order: { xs: 3, md: 0 } }}>
            {release.description && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2, whiteSpace: 'pre-wrap' }} data-release-description>
                {release.description}
              </Typography>
            )}
            <ReleaseNotesCard project={project} release={release} sections={sections} canEdit={manages} canSaveDoc={can.addDocs(role)}
              locked={approval.locked} onError={setError} onNotice={setNotice} />
          </Box>
          {issuesCard}
        </Box>
        <Box sx={{ display: { xs: 'contents', md: 'flex' }, flexDirection: 'column', gap: 2, width: { md: 340, lg: 380 }, flexShrink: 0 }}>
          {details}
          <Box sx={{ order: { xs: 2, md: 0 } }}>
            <ApprovalPanel release={release} approvers={approvers} approval={approval} me={me} canManage={manages}
              candidates={canApprove(project, profiles, meta.members)} onChanged={load} onError={setError} />
          </Box>
          {open && (
            <Paper variant="outlined" sx={{ p: 2, order: { xs: 5, md: 0 } }}>
              <Section title="Outlook"><ReleaseOutlook project={project} release={release} /></Section>
            </Paper>
          )}
        </Box>
      </Box>

      {editing && <ReleaseForm open release={release} projectId={project.id} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      <FormDialog open={releasing} title={`Release ${release.name}`} submitLabel="Release" busy={busy} error={error} maxWidth="xs"
        onSubmit={() => setStatus('released')} onClose={() => setReleasing(false)}>
        <Typography variant="body2">
          {progress.done} of {progress.total} issues are done. Planned for {formatDate(release.release_date)}.
          {approval.state === 'approved' ? ` Approved by ${approval.total === 1 ? 'its approver' : `all ${approval.total} approvers`}.` : ''}
        </Typography>
        {unfinished.length > 0 && (asksAgain ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            The {unfinished.length} unfinished issue{unfinished.length === 1 ? ' stays' : 's stay'} in this release: moving
            {unfinished.length === 1 ? ' it' : ' them'} out now would ask the approvers again.
          </Typography>
        ) : (
          <TextField select label={`The ${unfinished.length} unfinished issue${unfinished.length === 1 ? '' : 's'}`} value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}>
            <MenuItem value="keep">Stay in this release</MenuItem>
            {others.map((r) => <MenuItem key={r.id} value={r.id}>Move to {r.name}</MenuItem>)}
            <MenuItem value="none">Remove from any release</MenuItem>
          </TextField>
        ))}
      </FormDialog>
      <ConfirmDialog open={deleting} title={`Delete ${release.name}?`} destructive confirmLabel="Delete" busy={busy}
        message="Its issues stay, without a release." onConfirm={remove} onClose={() => setDeleting(false)} />
    </Box>
  )
}
