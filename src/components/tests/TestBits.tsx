// The small pieces around test cases: a result's pill, the counts bar, the
// environment you're recording on, and a case's history (results and changes).
import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Link as MuiLink, MenuItem, Popover, Stack, Tab, Tabs, TextField, Tooltip, Typography, alpha, useTheme,
} from '@mui/material'
import { useMe } from '../../auth/AuthProvider'
import { formatDayTime, timeAgo } from '../../lib/constants'
import { NOT_RUN, TEST_STATUSES, TEST_STATUS_COLORS, TEST_STATUS_HEX, TEST_STATUS_LABELS, type TestCounts } from '../../lib/testCases'
import { supabase } from '../../lib/supabase'
import type { Project, TestCaseEvent, TestResult, TestRun, TestStatus } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import type { TestCasesState } from './useTestCases'

export function StatusPill({ status }: { status: TestStatus | null }) {
  const theme = useTheme()
  if (!status) {
    return <Typography component="span" variant="body2" sx={{ color: 'text.disabled' }}>{NOT_RUN}</Typography>
  }
  const color = TEST_STATUS_COLORS[status]
  const main = color === 'default' ? theme.palette.text.secondary : theme.palette[color!].main
  return (
    <Box component="span" data-status={status}
      sx={{ display: 'inline-block', px: 0.75, py: 0.125, borderRadius: 1, fontSize: 12, fontWeight: 700, lineHeight: '18px',
        letterSpacing: 0.3, textTransform: 'uppercase', color: main, bgcolor: alpha(main, 0.14) }}>
      {TEST_STATUS_LABELS[status]}
    </Box>
  )
}

/** How many cases passed, failed… as a bar and in words. */
export function CountsBar({ counts, width = 160 }: { counts: TestCounts; width?: number }) {
  const parts = [...TEST_STATUSES, 'none' as const].filter((s) => counts[s] > 0)
  const words = parts.map((s) => `${counts[s]} ${s === 'none' ? NOT_RUN.toLowerCase() : TEST_STATUS_LABELS[s].toLowerCase()}`).join(' · ')
  if (!counts.total) return null
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }} aria-label="Results" role="group">
      <Box sx={{ display: 'flex', width, height: 8, borderRadius: 4, overflow: 'hidden', flexShrink: 0, bgcolor: 'background.muted' }}>
        {parts.map((s) => (
          <Box key={s} sx={{ width: `${(counts[s] / counts.total) * 100}%`, bgcolor: TEST_STATUS_HEX[s] }} />
        ))}
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }} data-counts>
        {counts.total} {counts.total === 1 ? 'case' : 'cases'} · {words}
      </Typography>
    </Stack>
  )
}

export function EnvironmentSelect({ project, value, onChange }: { project: Project; value: string | null; onChange: (env: string | null) => void }) {
  return (
    <Tooltip title="Results you record are marked with this environment" placement="top">
      <TextField select label="Environment" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} sx={{ minWidth: 140 }}>
        <MenuItem value=""><em>None</em></MenuItem>
        {project.test_environments.map((e) => <MenuItem key={e} value={e}>{e}</MenuItem>)}
      </TextField>
    </Tooltip>
  )
}

/** Field names in a case's history, as people say them. */
const CHANGE_LABELS: Record<string, string> = {
  created: 'Created', title: 'Summary', description: 'Description', expected: 'Expected result', type: 'Type', level: 'Level',
  areas: 'Impacted areas', issue: 'Issue', script: 'Automated by',
}

/**
 * A case's history: every result it has had, latest first (your own can be
 * taken back), with the run each came from; and every change to it, from the
 * app or through the API, with the reason given.
 */
export function ResultHistory({ anchor, caseId, caseKey, data, onClose }: {
  anchor: HTMLElement | null
  caseId: string
  caseKey: string
  data: TestCasesState
  onClose: () => void
}) {
  const me = useMe()
  const { profileById } = useWorkspace()
  const [tab, setTab] = useState<'results' | 'changes'>('results')
  const [results, setResults] = useState<TestResult[] | null>(null)
  const [runs, setRuns] = useState<Map<string, Pick<TestRun, 'id' | 'key' | 'mode'>>>(new Map())
  const [changes, setChanges] = useState<TestCaseEvent[] | null>(null)
  const load = useCallback(async () => {
    const list = await data.history(caseId)
    const runIds = [...new Set(list.map((r) => r.run_id).filter((x): x is string => !!x))]
    if (runIds.length) {
      const { data: found } = await supabase.from('test_runs').select('id, key, mode').in('id', runIds)
      setRuns(new Map(((found ?? []) as TestRun[]).map((r) => [r.id, r])))
    }
    setResults(list)
  }, [data, caseId])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (tab !== 'changes' || changes) return
    supabase.from('test_case_events').select('*').eq('case_id', caseId).order('created_at', { ascending: false })
      .then(({ data: rows }) => setChanges((rows ?? []) as TestCaseEvent[]))
  }, [tab, changes, caseId])

  const who = (r: TestResult) => {
    const run = r.run_id ? runs.get(r.run_id) : undefined
    if (run?.mode === 'cloud') return `Cloud · ${run.key}`
    const name = profileById(r.recorded_by)?.full_name ?? 'Someone'
    return run ? `${name} (local) · ${run.key}` : name
  }

  return (
    <Popover open={!!anchor} anchorEl={anchor} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
      <Box sx={{ p: 2, pt: 1, width: 420, maxWidth: 'calc(100vw - 32px)', maxHeight: 460, overflow: 'auto' }} role="dialog"
        aria-label={`History of ${caseKey}`}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1.5, minHeight: 36, '& .MuiTab-root': { minHeight: 36 } }}>
          <Tab value="results" label={`Results of ${caseKey}`} />
          <Tab value="changes" label="Changes" />
        </Tabs>
        {tab === 'results' ? (
          results === null ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 2 }}><CircularProgress size={24} /></Box>
          ) : results.length === 0 ? (
            <Alert severity="info">Not run yet.</Alert>
          ) : (
            <Stack spacing={1.5}>
              {results.map((r) => (
                <Box key={r.id} data-result={r.id}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <StatusPill status={r.status} />
                    {r.flaky && <Chip size="small" label="Flaky" color="warning" variant="outlined" sx={{ height: 20 }} />}
                    {r.environment && <Typography variant="caption" sx={{ fontWeight: 600 }}>{r.environment}</Typography>}
                    <Typography variant="caption" sx={{ color: 'text.secondary', flexGrow: 1 }} title={formatDayTime(r.created_at)}>
                      {who(r)} · {timeAgo(r.created_at)}{r.duration_ms != null ? ` · ${(r.duration_ms / 1000).toFixed(1)} s` : ''}
                    </Typography>
                    {r.recorded_by === me.id && (
                      <Button size="small" color="inherit" sx={{ color: 'text.secondary', minWidth: 0 }}
                        onClick={async () => {
                          if (await data.unrecord([r.id], [caseId])) load()
                        }}>
                        Take back
                      </Button>
                    )}
                  </Stack>
                  {r.reason && <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.reason}</Typography>}
                  {r.error && r.error !== r.reason && (
                    <Typography variant="caption" component="pre" sx={{ m: 0, mt: 0.5, color: 'text.secondary', whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere', fontFamily: 'monospace', maxHeight: 96, overflow: 'auto' }}>{r.error}</Typography>
                  )}
                  {r.artifact_url && (
                    <MuiLink href={r.artifact_url} target="_blank" rel="noopener noreferrer" variant="caption">Trace and screenshots</MuiLink>
                  )}
                </Box>
              ))}
            </Stack>
          )
        ) : changes === null ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 2 }}><CircularProgress size={24} /></Box>
        ) : changes.length === 0 ? (
          <Alert severity="info">No changes recorded.</Alert>
        ) : (
          <Stack spacing={1.5}>
            {changes.map((e) => (
              <Box key={e.id} data-change={e.field}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{CHANGE_LABELS[e.field] ?? e.field}</Typography>
                  {e.via === 'api' && (
                    <Tooltip title="Through the API: an AI tool, a test reporter or CI, with this person's token">
                      <Chip size="small" label="API" variant="outlined" sx={{ height: 20 }} />
                    </Tooltip>
                  )}
                  <Typography variant="caption" sx={{ color: 'text.secondary', flexGrow: 1 }} title={formatDayTime(e.created_at)}>
                    {profileById(e.actor_id)?.full_name ?? (e.via === 'api' ? 'CI' : 'Someone')} · {timeAgo(e.created_at)}
                  </Typography>
                </Stack>
                {e.field !== 'created' && (
                  <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    <Box component="span" sx={{ color: 'text.secondary', textDecoration: e.from_value ? 'line-through' : 'none' }}>{e.from_value || 'None'}</Box>
                    {' → '}{e.to_value || 'None'}
                  </Typography>
                )}
                {e.reason && <Typography variant="caption" component="div" sx={{ mt: 0.25, fontStyle: 'italic' }}>Why: {e.reason}</Typography>}
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Popover>
  )
}
