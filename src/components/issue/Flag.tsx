// Flagging an issue, the parts you see: the reason dialog (from the issue
// view and from board and backlog cards' menus) and the issue view's flag
// button beside the title.
// The rest (saving, the cards' menu, the tint) is in ./flagging.
import { useEffect, useState } from 'react'
import { Box, Button, IconButton, Popover, Stack, TextField, Tooltip, Typography, alpha } from '@mui/material'
import FlagIcon from '@mui/icons-material/Flag'
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined'
import { formatDayTime, timeAgo } from '../../lib/constants'
import type { Issue } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { FormDialog } from '../common'

// The column's own limit (issues.flag_reason).
const REASON_MAX = 2000

/** Asks why: flagging an issue, or changing a flag's reason. */
export function FlagDialog({ issue, onSubmit, onClose }: {
  // The issue being flagged; null while closed.
  issue: Pick<Issue, 'key' | 'flag_reason'> | null
  // Saves the reason: the error in words, or null.
  onSubmit: (reason: string) => Promise<string | null>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The issue stays named while the dialog fades out.
  const [shown, setShown] = useState(issue)
  const open = !!issue
  useEffect(() => {
    if (!issue) return
    setShown(issue)
    setReason(issue.flag_reason ?? '')
    setError(null)
    // Filled in once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function submit() {
    const r = reason.trim()
    if (!r) return setError('Say why this issue is flagged.')
    if (r === shown?.flag_reason) return onClose()
    setBusy(true)
    const failed = await onSubmit(r)
    setBusy(false)
    if (failed) setError(failed)
    else onClose()
  }

  const editing = !!shown?.flag_reason
  return (
    <FormDialog open={open} title={editing ? `Change the flag on ${shown?.key}` : `Flag ${shown?.key ?? ''}`}
      submitLabel={editing ? 'Save' : 'Add flag'} busy={busy} error={error} maxWidth="xs" onSubmit={submit} onClose={onClose}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        A flag marks the issue as held up. It stands out wherever the issue is listed, with your reason.
      </Typography>
      <TextField label="Why is it flagged?" autoFocus multiline minRows={3} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Waiting on the client's API keys"
        slotProps={{ htmlInput: { maxLength: REASON_MAX } }}
        onKeyDown={(e) => {
          // Enter writes a new line; Cmd/Ctrl+Enter saves, as elsewhere.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }} />
    </FormDialog>
  )
}

/**
 * The issue view's flag, beside the title: an outline to flag the issue
 * (for whoever can edit it), lit red once it is flagged. Lit, it opens why,
 * who flagged it and when; and, for whoever can edit, Edit reason and Remove flag.
 */
export function FlagButton({ issue, editable, onFlag, onRemove }: {
  issue: Pick<Issue, 'key' | 'flag_reason' | 'flagged_by' | 'flagged_at'>
  editable: boolean
  // Opens the reason dialog: flagging, or changing the reason.
  onFlag: () => void
  onRemove: () => void
}) {
  const { profileById } = useWorkspace()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const flagged = !!issue.flag_reason
  if (!flagged && !editable) return null
  const who = profileById(issue.flagged_by)?.full_name
  return (
    <>
      <Tooltip title={flagged ? 'Flagged: see why' : 'Flag this issue'}>
        <IconButton aria-label={flagged ? 'Flagged' : 'Flag this issue'} aria-pressed={flagged} data-flag-button
          aria-haspopup={flagged ? 'dialog' : undefined}
          onClick={(e) => (flagged ? setAnchor(e.currentTarget) : onFlag())}
          sx={[
            { flexShrink: 0, color: 'text.secondary' },
            flagged && ((t) => ({
              color: 'error.main',
              bgcolor: alpha(t.palette.error.main, t.palette.mode === 'dark' ? 0.2 : 0.1),
              '&:hover': { bgcolor: alpha(t.palette.error.main, t.palette.mode === 'dark' ? 0.3 : 0.18) },
            })),
          ]}>
          {flagged ? <FlagIcon /> : <FlagOutlinedIcon />}
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor && flagged} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { 'data-flag-popover': true, role: 'dialog', 'aria-label': `Why ${issue.key} is flagged`,
          sx: { p: 2, width: 320, maxWidth: 'calc(100vw - 32px)' } } as object }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <FlagIcon sx={{ color: 'error.main', fontSize: 20 }} />
          <Typography variant="subtitle2">Flagged</Typography>
        </Stack>
        <Box sx={{ typography: 'body2', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{issue.flag_reason}</Box>
        {issue.flagged_at && (
          <Typography variant="caption" component="div" sx={{ mt: 1, color: 'text.secondary' }} title={formatDayTime(issue.flagged_at)}>
            {who ? `${who}, ` : ''}{timeAgo(issue.flagged_at)}
          </Typography>
        )}
        {editable && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, justifyContent: 'flex-end' }}>
            <Button size="small" color="inherit" onClick={() => { setAnchor(null); onFlag() }}>Edit reason</Button>
            <Button size="small" variant="outlined" color="error" onClick={() => { setAnchor(null); onRemove() }}>Remove flag</Button>
          </Stack>
        )}
      </Popover>
    </>
  )
}
