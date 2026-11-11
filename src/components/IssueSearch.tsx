// Issue lists and filters: the global Issues page and each project's Issues
// tab. The filter lives in the URL, so a filtered list is a link to share;
// saved filters keep one by name, for yourself or shared with everyone.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import DownloadIcon from '@mui/icons-material/Download'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutlined'
import SearchIcon from '@mui/icons-material/Search'
import TuneIcon from '@mui/icons-material/Tune'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { CATEGORY_LABELS, PRIORITIES, PRIORITY_LABELS, errorMessage, formatDate, formatPoints, timeAgo, todayIso } from '../lib/constants'
import { ISSUE_COLUMNS } from '../lib/issues'
import {
  EMPTY_FILTER,
  SORT_LABELS,
  applyFilter,
  filterFromQuery,
  filterFromSearch,
  filterToQuery,
  filterToSearch,
  isEmptyFilter,
  issuesToCsv,
  type IssueFilter,
  type IssueQuery,
  type SortKey,
} from '../lib/filters'
import type { Issue, SavedFilter, StatusCategory } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { useProjectMeta } from '../workspace/useProjectMeta'
import { useIssueChanges } from '../workspace/issueEvents'
import { EmptyState, FormDialog, Loading, PersonAvatar, PersonName } from './common'
import { IssueKey, Labels, PriorityIcon, StatusLozenge, TypeIcon } from './IssueBits'
import { useIssueHref } from './useIssueHref'

const PAGE = 100

interface Option {
  value: string
  label: string
  icon?: ReactNode
}

function MultiFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Option[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  return (
    <Select
      multiple
      displayEmpty
      value={value}
      onChange={(e) => onChange(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
      inputProps={{ 'aria-label': label }}
      renderValue={(v) =>
        v.length === 0 ? label : v.length === 1 ? `${label}: ${options.find((o) => o.value === v[0])?.label ?? '1'}` : `${label}: ${v.length}`}
      sx={{ minWidth: 120, maxWidth: 220, bgcolor: value.length ? 'action.selected' : 'background.paper' }}
      MenuProps={{ slotProps: { paper: { sx: { maxHeight: 420 } } } }}
    >
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value} dense>
          <Checkbox size="small" checked={value.includes(o.value)} sx={{ p: 0.5, mr: 1 }} />
          {o.icon && <ListItemIcon sx={{ minWidth: 30 }}>{o.icon}</ListItemIcon>}
          <ListItemText primary={o.label} />
        </MenuItem>
      ))}
    </Select>
  )
}

export default function IssueSearch({ projectId }: { projectId?: string }) {
  const me = useMe()
  const { projects, issueTypes, statuses, profiles, activeSprints, projectById, typeById, statusById, profileById, statusesOf } = useWorkspace()
  const meta = useProjectMeta(projectId)
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const href = useIssueHref()
  const [params, setParams] = useSearchParams()
  const filter = useMemo(() => {
    const f = filterFromSearch(params)
    return projectId ? { ...f, projects: [projectId] } : f
  }, [params, projectId])
  const [text, setText] = useState(filter.text)
  const [rows, setRows] = useState<Issue[] | null>(null)
  const [count, setCount] = useState(0)
  const [limit, setLimit] = useState(PAGE)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState<HTMLElement | null>(null)
  const [savedMenu, setSavedMenu] = useState<HTMLElement | null>(null)
  const [saved, setSaved] = useState<SavedFilter[]>([])
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveShared, setSaveShared] = useState(false)
  const [busy, setBusy] = useState(false)

  const setFilter = useCallback((next: Partial<IssueFilter>) => {
    const f = { ...filter, ...next }
    if (projectId) f.projects = []
    setLimit(PAGE)
    setParams(filterToSearch(f, params), { replace: true })
  }, [filter, params, projectId, setParams])

  // Typing waits for a pause before searching.
  useEffect(() => setText(filter.text), [filter.text])
  useEffect(() => {
    if (text === filter.text) return
    const t = setTimeout(() => setFilter({ text }), 350)
    return () => clearTimeout(t)
  }, [text, filter.text, setFilter])

  const search = useCallback(async () => {
    setError(null)
    const query = applyFilter(
      supabase.from('issues').select(ISSUE_COLUMNS, { count: 'exact' }) as unknown as IssueQuery,
      filter,
      { me: me.id, statuses, activeSprintIds: activeSprints.map((s) => s.id) },
    )
    const { data, error: e, count: total } = await query.range(0, limit - 1)
    if (e) {
      setError(errorMessage(e))
      setRows([])
      return
    }
    setRows((data ?? []) as unknown as Issue[])
    setCount(total ?? 0)
  }, [filter, limit, me.id, statuses, activeSprints])

  useEffect(() => {
    search()
  }, [search])
  useIssueChanges(() => search())

  const loadSaved = useCallback(async () => {
    const { data } = await supabase.from('saved_filters').select('*').order('name')
    setSaved((data ?? []) as SavedFilter[])
  }, [])
  useEffect(() => {
    loadSaved()
  }, [loadSaved])

  async function saveFilter() {
    if (!saveName.trim()) return
    setBusy(true)
    const { error: e } = await supabase.from('saved_filters')
      .insert({ name: saveName.trim(), shared: saveShared, query: filterToQuery(projectId ? { ...filter, projects: [projectId] } : filter) })
    setBusy(false)
    if (e) return setError(errorMessage(e))
    setSaving(false)
    setSaveName('')
    loadSaved()
  }

  async function deleteSaved(id: string) {
    await supabase.from('saved_filters').delete().eq('id', id)
    loadSaved()
  }

  function exportCsv() {
    if (!rows) return
    const csv = issuesToCsv(rows.map((i) => ({
      Key: i.key,
      Summary: i.title,
      Type: typeById(i.type_id)?.name ?? '',
      Status: statusById(i.status_id)?.name ?? '',
      Priority: PRIORITY_LABELS[i.priority],
      Assignee: profileById(i.assignee_id)?.full_name ?? '',
      Reporter: profileById(i.reporter_id)?.full_name ?? '',
      'Story points': i.story_points,
      Labels: i.labels.join(' '),
      Due: i.due_date,
      Created: i.created_at.slice(0, 10),
      Updated: i.updated_at.slice(0, 10),
      Resolved: i.resolved_at?.slice(0, 10) ?? null,
    })))
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `issues-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const single = projectId ?? (filter.projects.length === 1 ? filter.projects[0] : null)
  const people: Option[] = [
    { value: 'me', label: 'Me' },
    { value: 'none', label: 'Unassigned' },
    ...profiles.filter((p) => p.active && p.id !== me.id).map((p) => ({ value: p.id, label: p.full_name, icon: <PersonAvatar person={p} size={20} /> })),
  ]
  const sprintOptions: Option[] = [
    { value: 'open', label: 'Active sprints' },
    { value: 'backlog', label: 'No sprint (backlog)' },
    ...(single && meta ? meta.sprints.filter((s) => s.state !== 'closed').map((s) => ({ value: s.id, label: s.name })) : []),
  ]
  const releaseOptions: Option[] = [
    { value: 'none', label: 'No release' },
    ...(single && meta ? meta.releases.map((r) => ({ value: r.id, label: r.name })) : []),
  ]
  const emptyHere = isEmptyFilter(filter, projectId ? ['sort', 'projects'] : ['sort'])
  const showProject = !single

  const bar = (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center', mb: 2 }}>
      <TextField
        placeholder="Search issues"
        value={text}
        onChange={(e) => setText(e.target.value)}
        slotProps={{ htmlInput: { 'aria-label': 'Search text' }, input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> } }}
        sx={{ width: { xs: '100%', sm: 240 }, bgcolor: 'background.paper' }}
      />
      {!projectId && (
        <MultiFilter label="Project" value={filter.projects} onChange={(v) => setFilter({ projects: v, statuses: [], sprints: [], releases: [] })}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      )}
      <MultiFilter label="Type" value={filter.types} onChange={(v) => setFilter({ types: v })}
        options={issueTypes.map((t) => ({ value: t.id, label: t.name, icon: <TypeIcon type={t} /> }))} />
      {single ? (
        <MultiFilter label="Status" value={filter.statuses} onChange={(v) => setFilter({ statuses: v })}
          options={statusesOf(single).map((s) => ({ value: s.id, label: s.name }))} />
      ) : (
        <MultiFilter label="Status" value={filter.categories} onChange={(v) => setFilter({ categories: v as StatusCategory[] })}
          options={(['todo', 'in_progress', 'done'] as StatusCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
      )}
      <MultiFilter label="Assignee" value={filter.assignees} onChange={(v) => setFilter({ assignees: v })} options={people} />
      <MultiFilter label="Priority" value={filter.priorities} onChange={(v) => setFilter({ priorities: v as IssueFilter['priorities'] })}
        options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p], icon: <PriorityIcon priority={p} /> }))} />
      <Button startIcon={<TuneIcon />} onClick={(e) => setMore(e.currentTarget)} color="inherit">More</Button>
      {!emptyHere && <Button onClick={() => setParams(filterToSearch(EMPTY_FILTER, params), { replace: true })}>Clear</Button>}
      <Box sx={{ flexGrow: 1 }} />
      <Select value={filter.sort} onChange={(e) => setFilter({ sort: e.target.value as SortKey })} inputProps={{ 'aria-label': 'Sort by' }}
        sx={{ bgcolor: 'background.paper' }}>
        {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <MenuItem key={k} value={k}>{SORT_LABELS[k]}</MenuItem>)}
      </Select>
      <Button startIcon={<BookmarkBorderIcon />} onClick={(e) => setSavedMenu(e.currentTarget)} color="inherit">Filters</Button>
      <Tooltip title="Download as CSV">
        <IconButton aria-label="Download as CSV" onClick={exportCsv} disabled={!rows?.length}><DownloadIcon /></IconButton>
      </Tooltip>
    </Stack>
  )

  const morePanel = (
    <Popover open={!!more} anchorEl={more} onClose={() => setMore(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
      <Box sx={{ p: 2, width: 340, maxWidth: '90vw' }}>
        <Grid container spacing={1.5}>
          <Grid size={12}><MultiFilter label="Reporter" value={filter.reporters} onChange={(v) => setFilter({ reporters: v })}
            options={people.filter((p) => p.value !== 'none')} /></Grid>
          <Grid size={12}><MultiFilter label="Sprint" value={filter.sprints} onChange={(v) => setFilter({ sprints: v })} options={sprintOptions} /></Grid>
          <Grid size={12}><MultiFilter label="Release" value={filter.releases} onChange={(v) => setFilter({ releases: v })} options={releaseOptions} /></Grid>
          <Grid size={12}>
            <TextField fullWidth label="Labels" placeholder="comma, separated" defaultValue={filter.labels.join(', ')}
              onBlur={(e) => setFilter({ labels: e.target.value.split(',').map((l) => l.trim().toLowerCase()).filter(Boolean) })} />
          </Grid>
          <Grid size={6}>
            <TextField select fullWidth label="Resolution" value={filter.resolution} onChange={(e) => setFilter({ resolution: e.target.value as IssueFilter['resolution'] })}>
              <MenuItem value="any">Any</MenuItem>
              <MenuItem value="unresolved">Unresolved</MenuItem>
              <MenuItem value="resolved">Resolved</MenuItem>
            </TextField>
          </Grid>
          <Grid size={6}>
            <TextField select fullWidth label="Due" value={filter.due} onChange={(e) => setFilter({ due: e.target.value as IssueFilter['due'] })}>
              <MenuItem value="">Any time</MenuItem>
              <MenuItem value="overdue">Overdue</MenuItem>
              <MenuItem value="week">In the next 7 days</MenuItem>
            </TextField>
          </Grid>
          <Grid size={6}>
            <TextField select fullWidth label="Created" value={filter.created} onChange={(e) => setFilter({ created: e.target.value as IssueFilter['created'] })}>
              <MenuItem value="">Any time</MenuItem>
              <MenuItem value="7d">Last 7 days</MenuItem>
              <MenuItem value="30d">Last 30 days</MenuItem>
              <MenuItem value="90d">Last 90 days</MenuItem>
            </TextField>
          </Grid>
          <Grid size={6}>
            <TextField select fullWidth label="Updated" value={filter.updated} onChange={(e) => setFilter({ updated: e.target.value as IssueFilter['updated'] })}>
              <MenuItem value="">Any time</MenuItem>
              <MenuItem value="7d">Last 7 days</MenuItem>
              <MenuItem value="30d">Last 30 days</MenuItem>
            </TextField>
          </Grid>
        </Grid>
      </Box>
    </Popover>
  )

  const savedPanel = (
    <Menu anchorEl={savedMenu} open={!!savedMenu} onClose={() => setSavedMenu(null)} slotProps={{ paper: { sx: { minWidth: 280 } } }}>
      <MenuItem disabled={emptyHere} onClick={() => { setSavedMenu(null); setSaving(true) }}>
        <ListItemText primary="Save current filter…" />
      </MenuItem>
      <Divider />
      {!saved.length && <MenuItem disabled><ListItemText primary="No saved filters yet" /></MenuItem>}
      {saved.map((s) => (
        <MenuItem
          key={s.id}
          onClick={() => {
            setSavedMenu(null)
            setParams(filterToSearch(filterFromQuery(s.query), params), { replace: true })
          }}
        >
          {s.shared && <ListItemIcon><PeopleOutlineIcon fontSize="small" /></ListItemIcon>}
          <ListItemText inset={!s.shared} primary={s.name} secondary={s.owner_id === me.id ? null : profileById(s.owner_id)?.full_name} />
          {s.owner_id === me.id && (
            <IconButton size="small" edge="end" aria-label={`Delete ${s.name}`} onClick={(e) => { e.stopPropagation(); deleteSaved(s.id) }}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          )}
        </MenuItem>
      ))}
    </Menu>
  )

  const project = (i: Issue) => projectById(i.project_id)
  const today = todayIso()

  return (
    <Box>
      {bar}
      {morePanel}
      {savedPanel}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {rows === null ? (
        <Loading />
      ) : !rows.length ? (
        <Paper variant="outlined"><EmptyState title="No issues match">Try fewer filters, or different words.</EmptyState></Paper>
      ) : wide ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 32 }} />
                <TableCell>Key</TableCell>
                <TableCell>Summary</TableCell>
                {showProject && <TableCell>Project</TableCell>}
                <TableCell>Status</TableCell>
                <TableCell>Assignee</TableCell>
                <TableCell align="center">Priority</TableCell>
                <TableCell align="right">Points</TableCell>
                <TableCell>Due</TableCell>
                <TableCell>Updated</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((i) => (
                <TableRow key={i.id} hover>
                  <TableCell><TypeIcon type={typeById(i.type_id)} /></TableCell>
                  <TableCell><IssueKey issueKey={i.key} done={!!i.resolved_at} /></TableCell>
                  <TableCell sx={{ maxWidth: 420 }}>
                    <Typography component={Link} to={href(i.key)} variant="body2" sx={{ color: 'text.primary', textDecoration: 'none', display: 'block',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', '&:hover': { textDecoration: 'underline' } }}>
                      {i.title}
                    </Typography>
                    <Labels labels={i.labels} max={2} />
                  </TableCell>
                  {showProject && <TableCell><Typography variant="body2" noWrap>{project(i)?.name}</Typography></TableCell>}
                  <TableCell><StatusLozenge status={statusById(i.status_id)} /></TableCell>
                  <TableCell><PersonName person={profileById(i.assignee_id)} /></TableCell>
                  <TableCell align="center"><PriorityIcon priority={i.priority} /></TableCell>
                  <TableCell align="right">{formatPoints(i.story_points)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', color: i.due_date && !i.resolved_at && i.due_date < today ? 'error.main' : undefined }}>
                    {i.due_date ? formatDate(i.due_date, false) : '—'}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{timeAgo(i.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Stack spacing={1}>
          {rows.map((i) => (
            <Paper key={i.id} variant="outlined" component={Link} to={href(i.key)} sx={{ p: 1.5, display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <TypeIcon type={typeById(i.type_id)} />
                <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>{i.key}</Typography>
                <Box sx={{ flexGrow: 1 }} />
                <PriorityIcon priority={i.priority} />
                <PersonAvatar person={profileById(i.assignee_id)} size={22} />
              </Stack>
              <Typography variant="body2" sx={{ mb: 0.75 }}>{i.title}</Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <StatusLozenge status={statusById(i.status_id)} />
                {showProject && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{project(i)?.name}</Typography>}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
      {rows && rows.length > 0 && (
        <Stack direction="row" spacing={2} sx={{ mt: 1.5, alignItems: 'center' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {rows.length < count ? `Showing ${rows.length} of ${count}` : `${count} issue${count === 1 ? '' : 's'}`}
          </Typography>
          {rows.length < count && <Button onClick={() => setLimit((l) => l + PAGE)}>Show more</Button>}
        </Stack>
      )}
      <FormDialog open={saving} title="Save filter" busy={busy} maxWidth="xs" onSubmit={saveFilter} onClose={() => setSaving(false)}>
        <TextField label="Name" autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} />
        <FormControlLabel control={<Checkbox checked={saveShared} onChange={(e) => setSaveShared(e.target.checked)} />}
          label="Share with everyone in the workspace" />
      </FormDialog>
    </Box>
  )
}
