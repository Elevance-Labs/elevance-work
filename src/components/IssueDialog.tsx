import { useNavigate, useLocation } from 'react-router-dom'
import { Dialog, DialogContent, useMediaQuery, useTheme } from '@mui/material'
import IssueView from './issue/IssueView'

// An issue over whatever page is open: any page can show one with ?issue=KEY,
// which also makes it a link to share. Closing drops the parameter.
export default function IssueDialog({ issueKey }: { issueKey: string }) {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))

  function close() {
    const params = new URLSearchParams(search)
    params.delete('issue')
    const rest = params.toString()
    navigate({ pathname, search: rest ? `?${rest}` : '' })
  }

  return (
    <Dialog open onClose={close} fullWidth maxWidth="lg" fullScreen={phone} aria-label={issueKey}
      slotProps={{ paper: { sx: { minHeight: { md: '80vh' } } } }}>
      <DialogContent sx={{ pt: 1.5 }}>
        <IssueView key={issueKey} issueKey={issueKey} onClose={close} />
      </DialogContent>
    </Dialog>
  )
}
