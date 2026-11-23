// Workspace admin, one page reached from the header's Admin button (workspace
// admins only: the routes aren't registered for anyone else). Its tabs are
// People, Issue types and Workspace; each tab keeps its own header.
import { Suspense } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Tab, Tabs } from '@mui/material'
import { Loading } from '../../components/common'

const TABS = [
  { to: '/admin/people', label: 'People' },
  { to: '/admin/issue-types', label: 'Issue types' },
  { to: '/admin/workspace', label: 'Workspace' },
]

export default function AdminLayout() {
  const { pathname } = useLocation()
  const current = TABS.find((t) => pathname.startsWith(t.to))?.to ?? false
  return (
    <>
      <Tabs value={current} variant="scrollable" allowScrollButtonsMobile aria-label="Admin"
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map((t) => <Tab key={t.to} value={t.to} label={t.label} component={Link} to={t.to} />)}
      </Tabs>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </>
  )
}
