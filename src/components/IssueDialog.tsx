import { startTransition, useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ClickAwayListener, Dialog, DialogContent, Drawer, useMediaQuery, useTheme } from '@mui/material'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/constants'
import type { IssueViewMode } from '../lib/types'
import IssueView from './issue/IssueView'

// An issue over whatever page is open: any page can show one with ?issue=KEY,
// which also makes it a link to share. Closing drops the parameter.
// On a wide screen it opens as each person chose from the issue (saved on
// their profile): a dialog, or a side panel that leaves the page usable, so
// another issue opens in its place. A phone is always full screen.
export default function IssueDialog({ issueKey }: { issueKey: string }) {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const { profile, refreshProfile } = useAuth()
  // The choice shows at once; the profile catches up.
  const [chosen, setChosen] = useState<IssueViewMode | null>(null)
  const mode: IssueViewMode = chosen ?? profile?.issue_view ?? 'modal'
  const panel = !phone && mode === 'drawer'

  function close() {
    const params = new URLSearchParams(search)
    params.delete('issue')
    const rest = params.toString()
    navigate({ pathname, search: rest ? `?${rest}` : '' })
  }

  // The side panel leaves the page usable, so a click outside it closes it,
  // unless that same click opened another issue in its place. Navigations are
  // transitions: asking in one too lands in the same commit as the click's
  // own navigation, so by then this knows which issue is showing.
  const [closeAsked, setCloseAsked] = useState<string | null>(null)
  useEffect(() => {
    if (closeAsked === null) return
    setCloseAsked(null)
    if (closeAsked === issueKey) close()
    // close reads the address of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeAsked, issueKey])

  // Esc closes the side panel wherever the focus is, unless something in
  // front took it first (a menu, a dialog, the activity sheet, a picker).
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // close reads the address of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, pathname, search])

  async function chooseView(next: IssueViewMode) {
    if (!profile) return null
    const was = mode
    setChosen(next)
    const { error } = await supabase.from('profiles').update({ issue_view: next }).eq('id', profile.id)
    if (error) {
      setChosen(was)
      return errorMessage(error, "That choice wasn't saved.")
    }
    await refreshProfile()
    return null
  }

  const view = <IssueView key={issueKey} issueKey={issueKey} onClose={close} panel={panel} viewMode={mode} onViewMode={chooseView} />

  if (panel) {
    return (
      // Not modal: the page beside it stays usable. A click outside or Esc
      // closes it. (Menus and dialogs opened from inside count as inside.)
      <ClickAwayListener onClickAway={() => startTransition(() => setCloseAsked(issueKey))}>
        <Drawer variant="persistent" anchor="right" open
          slotProps={{
            paper: {
              role: 'dialog',
              'aria-label': issueKey,
              'aria-modal': false,
              // Wide enough on a desktop for the issue and its fields side by
              // side; a tablet's is one column.
              sx: { width: { md: 720, lg: 'min(1120px, 78vw)' }, maxWidth: '100vw', zIndex: theme.zIndex.modal - 1, boxShadow: 16,
                backgroundImage: 'none', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
            } as object,
          }}>
          {view}
        </Drawer>
      </ClickAwayListener>
    )
  }

  // On a phone the dialog is the whole screen: no elevation tint (so the
  // issue's pinned bars match what scrolls under them), and the issue lays
  // out its own scrolling between them.
  return (
    <Dialog open onClose={close} fullWidth maxWidth="lg" fullScreen={phone} aria-label={issueKey}
      slotProps={{ paper: { sx: { minHeight: { md: '80vh' }, ...(phone && { backgroundImage: 'none' }) } } }}>
      <DialogContent sx={phone ? { p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { pt: 1.5 }}>
        {view}
      </DialogContent>
    </Dialog>
  )
}
