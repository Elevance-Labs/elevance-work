// Flagging an issue, the parts that aren't drawn on their own: saving a flag,
// the Flag group of a card's menu (board, backlog) with the dialog it opens,
// and the tint a flagged issue carries wherever it is listed. issues_guard
// stamps who flagged it and when.
import { useState } from 'react'
import { alpha, type Theme } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/constants'
import type { Issue } from '../../lib/types'
import { emitIssueChange } from '../../workspace/issueEvents'
import type { MoveGroup } from '../IssueCard'
import { FlagDialog } from './Flag'

/** Flag an issue with a reason, or remove its flag (null). The error in words, or null. */
export async function setIssueFlag(issueId: string, reason: string | null) {
  const { error } = await supabase.from('issues').update({ flag_reason: reason }).eq('id', issueId)
  if (error) return errorMessage(error, "The flag wasn't saved.")
  emitIssueChange(issueId)
  return null
}

/**
 * The tint a flagged issue carries wherever it is listed (an amber wash, in
 * either mode), and a stronger one on hover; false for one that isn't. Goes
 * last in an `sx` array, after the row's own background and hover.
 */
export function flaggedSx(issue: Pick<Issue, 'flag_reason'>) {
  if (!issue.flag_reason) return false
  return (t: Theme) => ({
    bgcolor: alpha(t.palette.warning.main, t.palette.mode === 'dark' ? 0.16 : 0.12),
    '&:hover': { bgcolor: alpha(t.palette.warning.main, t.palette.mode === 'dark' ? 0.24 : 0.2) },
  })
}

/**
 * Flagging from a card's menu (board, backlog): the menu's Flag group and the
 * dialog it opens. The page reloads on the change (emitIssueChange).
 */
export function useFlagMenu(onError: (message: string) => void) {
  const [flagging, setFlagging] = useState<Issue | null>(null)
  const group = (i: Issue): MoveGroup => ({
    title: 'Flag',
    options: i.flag_reason
      ? [
          { label: 'Change reason…', onSelect: () => setFlagging(i) },
          {
            label: 'Remove flag',
            onSelect: async () => {
              const failed = await setIssueFlag(i.id, null)
              if (failed) onError(failed)
            },
          },
        ]
      : [{ label: 'Add flag…', onSelect: () => setFlagging(i) }],
  })
  const dialog = (
    <FlagDialog issue={flagging} onClose={() => setFlagging(null)} onSubmit={(reason) => setIssueFlag(flagging!.id, reason)} />
  )
  return { group, dialog }
}
