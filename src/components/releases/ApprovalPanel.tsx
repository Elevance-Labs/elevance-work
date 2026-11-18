// A release's approvers and where approval stands. Managers add and remove
// approvers (someone who has decided stays until approval is asked for
// again); each approver approves or rejects once, a rejection saying why.
// Every approver approved locks the release; adding or removing an issue
// asks them all again (the database does both: release_approvers_guard,
// issues_release_changed).
import { useState } from 'react'
import { Box, Button, Chip, IconButton, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import { supabase } from '../../lib/supabase'
import { errorMessage, timeAgo } from '../../lib/constants'
import { APPROVAL_COLORS, LOCKED_HINT, approvalLabel, type ReleaseApproval } from '../../lib/releases'
import type { Profile, Release, ReleaseApprover, ReleaseDecision } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { ConfirmDialog, FormDialog, PersonAvatar, Section } from '../common'
import { PersonPicker } from '../pickers'

const DECISION = {
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Rejected', color: 'error' },
  pending: { label: 'Pending', color: 'default' },
} as const

export default function ApprovalPanel({ release, approvers, approval, me, canManage, candidates, onChanged, onError }: {
  release: Release
  approvers: ReleaseApprover[]
  approval: ReleaseApproval
  me: Profile
  canManage: boolean
  /** Who may approve: anyone active who can see the project. */
  candidates: Profile[]
  onChanged: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const { profileById } = useWorkspace()
  const [deciding, setDeciding] = useState<ReleaseDecision | null>(null)
  const [comment, setComment] = useState('')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const open = release.status === 'unreleased'
  const mine = approvers.find((a) => a.profile_id === me.id)
  const decided = approvers.some((a) => a.decision)
  const others = candidates.filter((p) => !approvers.some((a) => a.profile_id === p.id))
  const ordered = [...approvers].sort((a, b) => (profileById(a.profile_id)?.full_name ?? '').localeCompare(profileById(b.profile_id)?.full_name ?? ''))

  async function add(profileId: string | null) {
    if (!profileId) return
    onError(null)
    const { error } = await supabase.from('release_approvers').insert({ release_id: release.id, profile_id: profileId })
    if (error) return onError(errorMessage(error))
    await onChanged()
  }

  async function remove(profileId: string) {
    onError(null)
    const { error } = await supabase.from('release_approvers').delete().eq('release_id', release.id).eq('profile_id', profileId)
    if (error) return onError(errorMessage(error))
    await onChanged()
  }

  async function decide() {
    if (!deciding) return
    if (deciding === 'rejected' && !comment.trim()) return setDialogError('Say why, so it can be put right.')
    setBusy(true)
    setDialogError(null)
    const { error } = await supabase.rpc('release_decide', { p_release: release.id, p_decision: deciding, p_comment: comment.trim() })
    setBusy(false)
    if (error) return setDialogError(errorMessage(error))
    setDeciding(null)
    await onChanged()
  }

  async function askAgain() {
    setBusy(true)
    setDialogError(null)
    const { error } = await supabase.rpc('release_request_approval', { p_release: release.id })
    setBusy(false)
    if (error) return setDialogError(errorMessage(error))
    setAsking(false)
    await onChanged()
  }

  const say = approval.locked ? 'Every approver approved, so the release is locked. Adding or removing an issue asks them again.'
    : approval.state === 'rejected' ? 'Rejected: put it right, then ask for approval again.'
      : approval.state === 'pending' ? 'It is released once every approver approves. Adding or removing an issue asks them again.'
        : open ? (canManage ? 'Add approvers to have the release signed off before it goes out.' : 'No sign-off needed.') : null

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-approval={approval.state}>
      <Section title="Approval" action={
        <Chip size="small" variant="outlined" color={APPROVAL_COLORS[approval.state]} label={approvalLabel(approval)}
          icon={approval.locked ? <LockOutlinedIcon /> : undefined} />
      }>
        {say && <Typography variant="body2" sx={{ color: 'text.secondary', mb: approvers.length ? 1.5 : 0 }}>{say}</Typography>}

        <Stack spacing={1.25}>
          {ordered.map((a) => {
            const who = profileById(a.profile_id)
            const d = DECISION[a.decision ?? 'pending']
            return (
              <Stack key={a.profile_id} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }} data-approver={who?.full_name}>
                <PersonAvatar person={who} size={28} />
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                      {who?.full_name ?? 'Someone'}{a.profile_id === me.id ? ' (you)' : ''}
                    </Typography>
                    <Chip size="small" label={d.label} color={d.color} variant={a.decision ? 'filled' : 'outlined'} />
                  </Stack>
                  {a.decided_at && (
                    <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{timeAgo(a.decided_at)}</Typography>
                  )}
                  {a.comment && (
                    <Typography variant="body2" sx={{ mt: 0.5, pl: 1, borderLeft: 2, borderColor: 'divider', color: 'text.secondary', whiteSpace: 'pre-wrap' }}>
                      {a.comment}
                    </Typography>
                  )}
                </Box>
                {canManage && open && !a.decision && (
                  <Tooltip title="Remove approver">
                    <IconButton size="small" aria-label={`Remove ${who?.full_name ?? 'approver'}`} onClick={() => remove(a.profile_id)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            )
          })}
        </Stack>

        {open && mine && !mine.decision && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button variant="contained" color="success" fullWidth onClick={() => { setComment(''); setDialogError(null); setDeciding('approved') }}>
              Approve
            </Button>
            <Button variant="outlined" color="error" fullWidth onClick={() => { setComment(''); setDialogError(null); setDeciding('rejected') }}>
              Reject
            </Button>
          </Stack>
        )}

        {canManage && open && (
          <Stack spacing={1} sx={{ mt: 2 }}>
            {approval.locked ? (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{LOCKED_HINT}</Typography>
            ) : (
              <PersonPicker key={approvers.length} label="Add an approver" value={null} options={others} onChange={add} noneLabel="Anyone in the project" />
            )}
            {decided && (
              <Button size="small" onClick={() => { setDialogError(null); setAsking(true) }} sx={{ alignSelf: 'flex-start' }}>
                Ask for approval again
              </Button>
            )}
          </Stack>
        )}
      </Section>

      <FormDialog open={!!deciding} title={deciding === 'rejected' ? `Reject ${release.name}` : `Approve ${release.name}`}
        submitLabel={deciding === 'rejected' ? 'Reject' : 'Approve'} busy={busy} error={dialogError} maxWidth="xs"
        onSubmit={decide} onClose={() => setDeciding(null)}>
        <Typography variant="body2">
          {deciding === 'rejected' ? 'The release can’t go out until approval is asked for again.'
            : 'Your approval covers the release as it is now. Adding or removing an issue asks you again.'}
          {' '}Your decision stands until then.
        </Typography>
        <TextField label={deciding === 'rejected' ? 'Why' : 'Comment (optional)'} multiline minRows={2} value={comment} autoFocus
          required={deciding === 'rejected'} onChange={(e) => setComment(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
      </FormDialog>
      <ConfirmDialog open={asking} title="Ask for approval again?" confirmLabel="Ask again" busy={busy} error={dialogError}
        message="Every approver's decision goes back to pending, and the release unlocks." onConfirm={askAgain} onClose={() => setAsking(false)} />
    </Paper>
  )
}
