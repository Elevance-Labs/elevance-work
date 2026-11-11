import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { Paper } from '@mui/material'
import { Loading } from '../components/common'

// Carries the rich text editor.
const IssueView = lazy(() => import('../components/issue/IssueView'))

export default function BrowseIssue() {
  const { key = '' } = useParams()
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1280, mx: 'auto' }}>
      <Suspense fallback={<Loading />}>
        <IssueView key={key} issueKey={key.toUpperCase()} />
      </Suspense>
    </Paper>
  )
}
