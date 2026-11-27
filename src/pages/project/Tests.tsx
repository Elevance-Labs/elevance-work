// A project's test cases: every case, as a sheet, filtered from the address
// (?q=&type=&level=&status=&area=&for=ISSUE-KEY), optionally grouped
// (?group=type|level|area|issue), with how they stand. Or its test runs
// (?view=runs), as qa-api recorded them.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, IconButton, InputAdornment, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import WrapTextIcon from '@mui/icons-material/WrapText'
import { can } from '../../lib/permissions'
import {
  NOT_RUN,
  PROJECT_SHEET,
  TEST_GROUP_BYS,
  TEST_GROUP_LABELS,
  TEST_STATUSES,
  TEST_STATUS_LABELS,
  groupFromParams,
  groupTestCases,
  isFiltered,
  knownAreas,
  matchesTestCase,
  testCounts,
  testFilterFromParams,
  testFilterToParams,
  type TestFilter,
} from '../../lib/testCases'
import { Loading } from '../../components/common'
import TestSheet from '../../components/tests/TestSheet'
import RunsPanel from '../../components/tests/Runs'
import { CountsBar, EnvironmentSelect } from '../../components/tests/TestBits'
import { useEnvironment } from '../../components/tests/useEnvironment'
import { isTmp, useTestCases } from '../../components/tests/useTestCases'
import { useProject } from './projectContext'

const WRAP_KEY = 'elevance.work.test-sheet.wrap'

function readWrap() {
  try {
    return localStorage.getItem(WRAP_KEY) === '1'
  } catch {
    return false
  }
}

export default function ProjectTests() {
  const { project, role } = useProject()
  const editable = can.editTests(role)
  const data = useTestCases(project.id)
  const [params, setParams] = useSearchParams()
  const filter = useMemo(() => testFilterFromParams(params), [params])
  const groupBy = groupFromParams(params)
  const [env, setEnv] = useEnvironment(project)
  const [wrap, setWrap] = useState(readWrap)
  const [q, setQ] = useState(filter.q)
  // The issue filtered to: its id, null if there's none, undefined while looking.
  const [forIssueId, setForIssueId] = useState<string | null | undefined>(undefined)
  const { cases, issueKey, issueById, fresh, findIssue } = data

  const setView = (patch: Partial<TestFilter>, group = groupBy) => {
    const next = testFilterToParams({ ...filter, ...patch })
    if (group) next.set('group', group)
    // An issue open over the page stays open.
    const open = params.get('issue')
    if (open) next.set('issue', open)
    setParams(next, { replace: true })
  }
  const setFilter = (patch: Partial<TestFilter>) => setView(patch)

  // Typing in the search box filters as you type; the address follows.
  useEffect(() => {
    if (q === filter.q) return
    const t = setTimeout(() => setFilter({ q }), 200)
    return () => clearTimeout(t)
  })

  // Filtered to an issue, a new case is written for it.
  useEffect(() => {
    let live = true
    setForIssueId(filter.issue ? undefined : null)
    if (filter.issue) findIssue(filter.issue).then((i) => live && setForIssueId(i?.id ?? null))
    return () => {
      live = false
    }
  }, [filter.issue, findIssue])

  const visible = useMemo(
    () => (cases ?? []).filter((c) => isTmp(c.id) || fresh.has(c.id) || matchesTestCase(c, filter, issueKey)),
    [cases, fresh, issueKey, filter],
  )
  const areas = useMemo(() => knownAreas(cases ?? []), [cases])
  const groups = useMemo(
    () => (groupBy ? groupTestCases(visible, groupBy, { types: project.test_types, levels: project.test_levels, issue: issueById }) : undefined),
    [groupBy, visible, project.test_types, project.test_levels, issueById],
  )
  const counts = testCounts(visible.filter((c) => !isTmp(c.id)))

  const runsView = params.get('view') === 'runs'
  const switcher = (
    <ToggleButtonGroup exclusive size="small" value={runsView ? 'runs' : 'cases'} aria-label="Show"
      onChange={(_, v) => {
        if (!v) return
        const next = new URLSearchParams(v === 'runs' ? { view: 'runs' } : {})
        const open = params.get('issue')
        if (open) next.set('issue', open)
        setParams(next, { replace: true })
      }}>
      <ToggleButton value="cases">Cases</ToggleButton>
      <ToggleButton value="runs">Runs</ToggleButton>
    </ToggleButtonGroup>
  )
  if (runsView) {
    return (
      <Box>
        <Box sx={{ mb: 2 }}>{switcher}</Box>
        <RunsPanel project={project} role={role} />
      </Box>
    )
  }

  if (cases === null) return data.error ? <Alert severity="error">{data.error}</Alert> : <Loading />

  const select = (label: string, value: string, options: [string, string][], onChange: (v: string) => void, width = 140) => (
    <TextField select label={label} value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: width }}>
      <MenuItem value="">Any</MenuItem>
      {options.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
    </TextField>
  )

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1.5, alignItems: 'center' }}>
        {switcher}
        <TextField value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search test cases" sx={{ width: { xs: '100%', sm: 220 } }}
          slotProps={{
            htmlInput: { 'aria-label': 'Search test cases' },
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
          }} />
        {select('Type', filter.type, project.test_types.map((t) => [t, t]), (type) => setFilter({ type }))}
        {select('Level', filter.level, project.test_levels.map((l) => [l, l]), (level) => setFilter({ level }))}
        {select('Status', filter.status, [...TEST_STATUSES.map((s) => [s, TEST_STATUS_LABELS[s]] as [string, string]), ['none', NOT_RUN]],
          (status) => setFilter({ status: status as TestFilter['status'] }))}
        {areas.length > 0 && select('Area', filter.area, areas.map((a) => [a, a]), (area) => setFilter({ area }), 160)}
        <TextField label="Issue" value={filter.issue} placeholder={`${project.key}-1`} sx={{ width: 120 }}
          onChange={(e) => setFilter({ issue: e.target.value.trim().toUpperCase() })}
          slotProps={{ htmlInput: { 'aria-label': 'Issue' }, inputLabel: { shrink: true } }} />
        {isFiltered(filter) && <Button onClick={() => { setQ(''); setFilter({ q: '', type: '', level: '', status: '', area: '', issue: '' }) }}>Clear</Button>}
        <TextField select label="Group by" value={groupBy ?? ''} sx={{ minWidth: 150 }}
          onChange={(e) => setView({}, (e.target.value || null) as typeof groupBy)}>
          <MenuItem value="">Nothing</MenuItem>
          {TEST_GROUP_BYS.map((g) => <MenuItem key={g} value={g}>{TEST_GROUP_LABELS[g]}</MenuItem>)}
        </TextField>
        <Box sx={{ flexGrow: 1 }} />
        <CountsBar counts={counts} />
        {editable && <EnvironmentSelect project={project} value={env} onChange={setEnv} />}
        <Tooltip title={wrap ? 'Show one line per case' : 'Show long text in full'}>
          <IconButton aria-label="Wrap text" aria-pressed={wrap} color={wrap ? 'primary' : 'default'}
            onClick={() => {
              setWrap(!wrap)
              try {
                localStorage.setItem(WRAP_KEY, wrap ? '0' : '1')
              } catch {
                // Kept for this visit only.
              }
            }}>
            <WrapTextIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      {data.error && <Alert severity="error" onClose={() => data.setError(null)} sx={{ mb: 1.5 }}>{data.error}</Alert>}
      {editable && !cases.length && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Type a summary in the first row to add a case, or paste rows from Google Sheets: with their header row (Summary, Description,
          Expected result, Type, Level, Impacted areas), the columns are matched by name.
        </Alert>
      )}
      {filter.issue && forIssueId === null && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>There's no issue {filter.issue} in {project.name}.</Alert>
      )}
      <TestSheet project={project} editable={editable} data={data} rows={visible} groups={groups} columns={PROJECT_SHEET} environment={env} wrap={wrap}
        label="Test cases" defaults={forIssueId ? { issue_id: forIssueId } : undefined} maxHeight="calc(100vh - 300px)" />
    </Box>
  )
}
