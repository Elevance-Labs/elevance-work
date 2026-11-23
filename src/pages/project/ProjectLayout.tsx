// The frame around every project page: its header, its tabs, and the
// project in context for the page below. A project you can't see doesn't
// exist here, as it doesn't in the database.
import { Suspense, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { Alert, Box, Button, Chip, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import AddToDriveIcon from '@mui/icons-material/AddToDrive'
import { PROJECT_KIND_LABELS, PROJECT_ROLE_LABELS } from '../../lib/constants'
import { can } from '../../lib/permissions'
import { projectFolderUrl } from '../../lib/drive'
import { featureOn, projectTabHref, tabFeature } from '../../lib/projectFeatures'
import type { ProjectFeature } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { EmptyState, Loading } from '../../components/common'
import { ProjectAvatar } from '../../components/IssueBits'
import { ProjectContext } from './projectContext'

export default function ProjectLayout() {
  const { key = '' } = useParams()
  const { pathname } = useLocation()
  const { projectByKey, roleOf } = useWorkspace()
  const project = projectByKey(key)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  if (!project) {
    return (
      <EmptyState title={`There's no project ${key.toUpperCase()} you can see`}>
        It may be private, or the key may be wrong. <Link to="/work">Your projects</Link>
      </EmptyState>
    )
  }
  const role = roleOf(project.id)
  const base = `/projects/${project.key}`
  const on = (f: ProjectFeature) => featureOn(project, f)
  const tabs = [
    { to: base, label: 'Summary' },
    ...(project.kind === 'scrum' ? [{ to: `${base}/backlog`, label: 'Backlog' }] : []),
    ...(on('board') ? [{ to: `${base}/board`, label: 'Board' }] : []),
    ...(on('timeline') ? [{ to: `${base}/timeline`, label: 'Timeline' }] : []),
    ...(on('calendar') ? [{ to: `${base}/calendar`, label: 'Calendar' }] : []),
    ...(on('issues') ? [{ to: `${base}/issues`, label: 'Issues' }] : []),
    ...(on('releases') ? [{ to: `${base}/releases`, label: 'Releases' }] : []),
    ...(on('docs') ? [{ to: `${base}/docs`, label: 'Docs' }] : []),
    ...(can.manageProject(role) ? [{ to: `${base}/settings`, label: 'Settings' }] : []),
  ]
  const current = [...tabs].sort((a, b) => b.to.length - a.to.length).find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))

  // A tab its admins turned off isn't there: its address lands on the Summary.
  const off = tabFeature(pathname.slice(base.length))
  if (off && !on(off)) return <Navigate to={base} replace />
  if (pathname === `${base}/settings` && !can.manageProject(role)) return <Navigate to={base} replace />
  if (pathname === `${base}/backlog` && project.kind !== 'scrum') return <Navigate to={projectTabHref(project, 'board')} replace />

  async function openFolder() {
    setOpening(true)
    setFolderError(null)
    // Opened before the await so the browser doesn't treat it as a pop-up.
    const tab = window.open('', '_blank')
    const { data, error } = await projectFolderUrl(project!.id)
    setOpening(false)
    if (error || !data) {
      tab?.close()
      return setFolderError(error ?? 'Google Drive is not reachable right now.')
    }
    if (tab) tab.location.href = data.url
    else window.location.href = data.url
  }

  return (
    <ProjectContext.Provider value={{ project, role }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <ProjectAvatar project={project} size={36} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="h5" component="h1" noWrap>{project.name}</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{project.key}</Typography>
            <Chip size="small" label={PROJECT_KIND_LABELS[project.kind]} variant="outlined" />
            {role && <Chip size="small" label={PROJECT_ROLE_LABELS[role]} />}
          </Stack>
        </Box>
        <Tooltip title="Open the project's folder in the shared Google Drive">
          <Button variant="outlined" startIcon={<AddToDriveIcon />} onClick={openFolder} loading={opening}>
            Drive folder
          </Button>
        </Tooltip>
      </Stack>
      {project.archived_at && <Alert severity="info" sx={{ mb: 1 }}>This project is archived: it can be read, not changed.</Alert>}
      {folderError && <Alert severity="error" onClose={() => setFolderError(null)} sx={{ mb: 1 }}>{folderError}</Alert>}
      <Tabs value={current?.to ?? false} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        {tabs.map((t) => <Tab key={t.to} value={t.to} label={t.label} component={Link} to={t.to} />)}
      </Tabs>
      {/* A tab's first showing loads its chunk; the header and tabs stay put. */}
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </ProjectContext.Provider>
  )
}
