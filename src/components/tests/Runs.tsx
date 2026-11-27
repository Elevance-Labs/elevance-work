// A project's test runs (written by qa-api: a person's local run, or a cloud
// one): newest first, each with its environment, who or what ran it, where
// from and how it went; opening one lists its results. Managers delete one.
import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Chip, Dialog, DialogContent, DialogTitle, IconButton, Link as MuiLink, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined'
import ComputerOutlinedIcon from '@mui/icons-material/ComputerOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { supabase } from '../../lib/supabase'
import { errorMessage, formatDayTime, timeAgo } from '../../lib/constants'
import { can } from '../../lib/permissions'
import { runCounts, runDuration, runnerLabel } from '../../lib/testCases'
import type { Project, ProjectRole, TestCase, TestResult, TestRun } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { ConfirmDialog, EmptyState, Loading } from '../common'
import { CountsBar, StatusPill } from './TestBits'

export function RunMode({ run }: { run: TestRun }) {
  const { profileById } = useWorkspace()
  const Icon = run.mode === 'cloud' ? CloudOutlinedIcon : ComputerOutlinedIcon
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Icon sx={{ fontSize: 16, color: 'text.secondary' }} />
      <Typography variant="body2" noWrap>{runnerLabel(run, profileById(run.run_by)?.full_name)}</Typography>
    </Stack>
  )
}

export default function RunsPanel({ project, role }: { project: Project; role: ProjectRole | null }) {
  const [runs, setRuns] = useState<TestRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<TestRun | null>(null)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('test_runs').select('*').eq('project_id', project.id)
      .order('started_at', { ascending: false }).limit(100)
    if (e) return setError(errorMessage(e, 'The runs could not be loaded.'))
    setRuns((data ?? []) as TestRun[])
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <Alert severity="error">{error}</Alert>
  if (!runs) return <Loading />
  if (!runs.length) {
    return (
      <EmptyState title="No runs yet">
        Runs come from Playwright, through the el-work reporter or an AI tool with an API token (account menu → API tokens).
      </EmptyState>
    )
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label="Test runs">
        <TableHead>
          <TableRow>
            <TableCell>Run</TableCell>
            <TableCell>Started</TableCell>
            <TableCell>Environment</TableCell>
            <TableCell>By</TableCell>
            <TableCell>From</TableCell>
            <TableCell sx={{ minWidth: 280 }}>Results</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={r.id} hover data-run={r.key} onClick={() => setOpen(r)} sx={{ cursor: 'pointer' }}>
              <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                {r.key}
                {!r.finished_at && <Chip size="small" label="Running" sx={{ ml: 1, height: 20 }} />}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }} title={formatDayTime(r.started_at)}>
                {timeAgo(r.started_at)}{runDuration(r) ? ` · ${runDuration(r)}` : ''}
              </TableCell>
              <TableCell>{r.environment}</TableCell>
              <TableCell><RunMode run={r} /></TableCell>
              <TableCell sx={{ maxWidth: 260 }}>
                <Typography variant="body2" noWrap title={[r.repo, r.branch, r.commit_sha].filter(Boolean).join(' · ')}>
                  {[r.repo, r.branch].filter(Boolean).join(' · ') || '—'}
                  {r.commit_sha && <Box component="span" sx={{ color: 'text.secondary', fontFamily: 'monospace', ml: 1 }}>{r.commit_sha.slice(0, 7)}</Box>}
                </Typography>
              </TableCell>
              <TableCell><CountsBar counts={runCounts(r)} width={100} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {open && (
        <RunDialog run={open} role={role} onClose={() => setOpen(null)}
          onDeleted={() => {
            setOpen(null)
            load()
          }} />
      )}
    </Box>
  )
}

type ResultRow = TestResult & { case?: Pick<TestCase, 'key' | 'title'> }

function RunDialog({ run, role, onClose, onDeleted }: { run: TestRun; role: ProjectRole | null; onClose: () => void; onDeleted: () => void }) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const [results, setResults] = useState<ResultRow[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data } = await supabase.from('test_results').select('*').eq('run_id', run.id).order('created_at')
      const list = (data ?? []) as TestResult[]
      const ids = [...new Set(list.map((r) => r.case_id))]
      const cases = ids.length ? ((await supabase.from('test_cases').select('id, key, title').in('id', ids)).data ?? []) as TestCase[] : []
      if (live) setResults(list.map((r) => ({ ...r, case: cases.find((c) => c.id === r.case_id) })))
    })()
    return () => {
      live = false
    }
  }, [run.id])

  async function remove() {
    setBusy(true)
    const { error: e } = await supabase.from('test_runs').delete().eq('id', run.id)
    setBusy(false)
    if (e) return setError(errorMessage(e))
    onDeleted()
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth fullScreen={phone}>
      <DialogTitle sx={{ pr: 12 }}>
        Run {run.key}
        <Typography variant="body2" component="div" sx={{ color: 'text.secondary' }}>
          {run.environment} · {formatDayTime(run.started_at)}{runDuration(run) ? ` · ${runDuration(run)}` : ''}
        </Typography>
      </DialogTitle>
      <Stack direction="row" sx={{ position: 'absolute', top: 12, right: 12 }}>
        {can.deleteRuns(role) && (
          <Tooltip title="Delete this run and its results">
            <IconButton aria-label="Delete run" onClick={() => setDeleting(true)}><DeleteOutlineIcon /></IconButton>
          </Tooltip>
        )}
        <IconButton aria-label="Close" onClick={onClose}><CloseIcon /></IconButton>
      </Stack>
      <DialogContent>
        <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
          <RunMode run={run} />
          {run.repo && <Typography variant="body2">{run.repo}</Typography>}
          {run.branch && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{run.branch}</Typography>}
          {run.commit_sha && <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{run.commit_sha.slice(0, 7)}</Typography>}
          {run.ci_url && <MuiLink href={run.ci_url} target="_blank" rel="noopener noreferrer" variant="body2">CI job</MuiLink>}
          <Box sx={{ flexGrow: 1 }} />
          <CountsBar counts={runCounts(run)} width={120} />
        </Stack>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!results ? <Loading minHeight={120} /> : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label={`Results of ${run.key}`}>
              <TableHead>
                <TableRow>
                  <TableCell>Case</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell sx={{ minWidth: 240 }}>Reason</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.id} data-result={r.case?.key}>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.case?.key ?? '—'}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap component="div">{r.case?.title}</Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <StatusPill status={r.status} />
                      {r.flaky && <Chip size="small" label="Flaky" color="warning" variant="outlined" sx={{ ml: 0.5, height: 20 }} />}
                    </TableCell>
                    <TableCell>
                      {r.reason && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{r.reason}</Typography>}
                      {r.error && r.error !== r.reason && (
                        <Typography variant="caption" component="pre" sx={{ m: 0, mt: 0.5, color: 'text.secondary', whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere', fontFamily: 'monospace', maxHeight: 120, overflow: 'auto' }}>{r.error}</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : ''}
                      {r.attempts > 1 ? ` · ${r.attempts} tries` : ''}
                    </TableCell>
                    <TableCell>
                      {r.artifact_url && <MuiLink href={r.artifact_url} target="_blank" rel="noopener noreferrer" variant="body2">Trace</MuiLink>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </DialogContent>
      <ConfirmDialog open={deleting} title={`Delete ${run.key}?`} destructive confirmLabel="Delete" busy={busy}
        message="Its results go with it; each case shows the result it had before. This can't be undone."
        onConfirm={remove} onClose={() => setDeleting(false)} />
    </Dialog>
  )
}
