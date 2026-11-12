import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Box, Button, Chip, Paper, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import NewReleasesOutlinedIcon from '@mui/icons-material/NewReleasesOutlined'
import { supabase } from '../../lib/supabase'
import { can } from '../../lib/permissions'
import { RELEASE_STATUS_COLORS, RELEASE_STATUS_LABELS, errorMessage, formatDate, todayIso } from '../../lib/constants'
import { ISSUE_COLUMNS } from '../../lib/issues'
import { releaseProgress } from '../../lib/releases'
import type { Issue, ReleaseStatus } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { EmptyState, Loading } from '../../components/common'
import ReleaseForm from '../../components/ReleaseForm'
import { useProject } from './projectContext'

export default function Releases() {
  const { project, role } = useProject()
  const { statusesOf } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const [tab, setTab] = useState<ReleaseStatus>('unreleased')
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('issues').select(ISSUE_COLUMNS).eq('project_id', project.id).not('release_id', 'is', null)
    if (e) setError(errorMessage(e))
    setIssues((data ?? []) as unknown as Issue[])
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  if (!meta || !issues) return <Loading />
  const releases = meta.releases.filter((r) => r.status === tab)
  const today = todayIso()

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ flexGrow: 1 }}>
          {(['unreleased', 'released', 'archived'] as ReleaseStatus[]).map((s) => (
            <Tab key={s} value={s} label={`${RELEASE_STATUS_LABELS[s]} (${meta.releases.filter((r) => r.status === s).length})`} />
          ))}
        </Tabs>
        {can.manageReleases(role) && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>New release</Button>}
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!releases.length && (
        <Paper variant="outlined">
          <EmptyState icon={<NewReleasesOutlinedIcon />} title={tab === 'unreleased' ? 'No releases planned' : `No ${RELEASE_STATUS_LABELS[tab].toLowerCase()} releases`}>
            {tab === 'unreleased' && 'Releases group the issues that ship together, and come with notes you can share.'}
          </EmptyState>
        </Paper>
      )}
      <Stack spacing={1.5}>
        {releases.map((r) => {
          const p = releaseProgress(issues.filter((i) => i.release_id === r.id), statuses)
          const late = r.status === 'unreleased' && r.release_date && r.release_date < today
          return (
            <Paper key={r.id} variant="outlined" component={Link} to={`/projects/${project.key}/releases/${r.id}`}
              sx={{ p: 2, display: 'block', textDecoration: 'none', color: 'inherit', '&:hover': { borderColor: 'primary.light' } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} sx={{ alignItems: { sm: 'center' } }}>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="subtitle1">{r.name}</Typography>
                    <Chip size="small" label={RELEASE_STATUS_LABELS[r.status]} color={RELEASE_STATUS_COLORS[r.status]} variant="outlined" />
                    {late && <Chip size="small" color="error" label="Overdue" />}
                  </Stack>
                  {r.description && <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>{r.description}</Typography>}
                </Box>
                <Box sx={{ width: { sm: 240 } }}>
                  <Tooltip title={`${p.done} done, ${p.inProgress} in progress, ${p.todo} to do`}>
                    <Box sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', bgcolor: 'background.muted' }}>
                      <Box sx={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%`, bgcolor: 'success.main' }} />
                      <Box sx={{ width: `${p.total ? (p.inProgress / p.total) * 100 : 0}%`, bgcolor: 'info.main' }} />
                    </Box>
                  </Tooltip>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.done} of {p.total} issues done</Typography>
                </Box>
                <Typography variant="body2" sx={{ color: late ? 'error.main' : 'text.secondary', whiteSpace: 'nowrap', minWidth: 110 }}>
                  {r.status === 'released' && r.released_at ? `Released ${formatDate(r.released_at.slice(0, 10))}` : r.release_date ? formatDate(r.release_date) : 'No date'}
                </Typography>
              </Stack>
            </Paper>
          )
        })}
      </Stack>
      {creating && <ReleaseForm open release={null} projectId={project.id} onClose={() => setCreating(false)} onSaved={() => setCreating(false)} />}
    </Box>
  )
}
