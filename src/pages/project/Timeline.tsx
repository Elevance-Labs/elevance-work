// The project's epics laid out against the calendar: a bar from each epic's
// start to its due date, its issues underneath on request, and the releases
// and sprints they have to fit around (each release also marks its day down
// the whole timeline; clicking one opens it). People who can edit the project
// drag a bar to move it, or an end to stretch it; everyone else reads.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Alert, Box, IconButton, LinearProgress, Link as MuiLink, Paper, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
  useMediaQuery, useTheme,
} from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import TimelineIcon from '@mui/icons-material/ViewTimelineOutlined'
import { supabase } from '../../lib/supabase'
import { errorMessage, formatDate, formatDateRange, todayIso } from '../../lib/constants'
import { ISSUE_COLUMNS, isDone } from '../../lib/issues'
import { can } from '../../lib/permissions'
import { dragged, place, spanOf, timelineRows, timelineWindow, type DragMode, type TimelineRow } from '../../lib/timeline'
import type { Issue, Release } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import { useIssueChanges } from '../../workspace/issueEvents'
import { EmptyState, Loading } from '../../components/common'
import { IssueKey, TypeIcon } from '../../components/IssueBits'
import { useIssueHref } from '../../components/useIssueHref'
import { ReleaseDialog } from '../../components/calendar/ItemDialogs'
import { useProject } from './projectContext'

const LABEL_WIDTH = 300
const ROW = 44
const CHILD_ROW = 34
// How wide a day is drawn at each zoom.
const ZOOMS = { weeks: 16, months: 6, quarters: 2.5 } as const
type Zoom = keyof typeof ZOOMS

interface Drag {
  id: string
  mode: DragMode
  days: number
}

export default function Timeline() {
  const { project, role } = useProject()
  const { statusesOf, issueTypes, typeById } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('md'))
  const href = useIssueHref()
  const navigate = useNavigate()
  const statuses = statusesOf(project.id)
  const editable = can.editIssues(role)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState<Zoom>('months')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [release, setRelease] = useState<Release | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const grabbed = useRef<{ x: number; moved: boolean } | null>(null)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from('issues').select(ISSUE_COLUMNS).eq('project_id', project.id)
    if (e) setError(errorMessage(e))
    setIssues((data ?? []) as unknown as Issue[])
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])
  useIssueChanges(() => load())

  const today = todayIso()
  const px = ZOOMS[zoom]
  const rows = issues ? timelineRows(issues, issueTypes, statuses) : []
  const releases = (meta?.releases ?? []).filter((r) => r.release_date && r.status !== 'archived')
  const sprints = (meta?.sprints ?? []).filter((s) => s.start_date && s.end_date)
  const window_ = timelineWindow(
    [
      ...rows.flatMap((r) => [r.start, r.end, ...r.children.flatMap((c) => [c.start_date, c.due_date])]),
      ...releases.map((r) => r.release_date),
      ...sprints.flatMap((s) => [s.start_date, s.end_date]),
    ],
    today,
  )
  const todayLeft = place(window_, today, today).offset * px
  const loaded = issues !== null

  // Open on today rather than on the first month there is anything in.
  useLayoutEffect(() => {
    if (loaded && scroller.current) scroller.current.scrollLeft = Math.max(0, todayLeft - 160)
    // Only when the timeline first appears or is re-scaled, not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, zoom])

  if (!issues) return <Loading />
  if (!rows.length && !releases.length) {
    return (
      <EmptyState icon={<TimelineIcon />} title="No epics yet">
        The timeline shows this project's epics and releases across the calendar. Create an epic and give it a start and a due date,
        or a release and its date.
      </EmptyState>
    )
  }
  const releaseColor = (r: Release) => (r.status === 'released' ? theme.palette.success.main : theme.palette.warning.main)
  const releaseDialog = release && <ReleaseDialog release={release} onClose={() => setRelease(null)} />

  /** The dates a bar shows: its saved ones, or where it is being dragged to. */
  function shown(issue: Issue, span: { start: string; end: string }) {
    return drag?.id === issue.id ? dragged(span.start, span.end, drag.mode, drag.days) : span
  }

  async function save(issue: Issue, next: { start: string; end: string }) {
    const patch = { start_date: next.start, due_date: next.end }
    if (issue.start_date === patch.start_date && issue.due_date === patch.due_date) return
    const before = issues
    setIssues((list) => list && list.map((i) => (i.id === issue.id ? { ...i, ...patch } : i)))
    setError(null)
    const { error: e } = await supabase.from('issues').update(patch).eq('id', issue.id)
    if (e) {
      setIssues(before)
      setError(errorMessage(e))
    }
  }

  function bar(issue: Issue, span: { start: string; end: string }, opts: { height: number; color: string; progress?: number; borrowed?: boolean }) {
    const at = shown(issue, span)
    const { offset, length } = place(window_, at.start, at.end)
    const resolved = isDone(issue, statuses)
    const label = `${issue.key} ${issue.title}, ${formatDateRange(at.start, at.end)}`

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      grabbed.current = { x: e.clientX, moved: false }
      if (!editable) return
      const mode = ((e.target as HTMLElement).dataset.handle as DragMode | undefined) ?? 'move'
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrag({ id: issue.id, mode, days: 0 })
    }
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
      if (!grabbed.current || !drag || drag.id !== issue.id) return
      const days = Math.round((e.clientX - grabbed.current.x) / px)
      if (days !== 0) grabbed.current.moved = true
      if (days !== drag.days) setDrag({ ...drag, days })
    }
    const onPointerUp = () => {
      const was = grabbed.current
      grabbed.current = null
      const moved = drag?.id === issue.id && drag.days !== 0 ? dragged(span.start, span.end, drag.mode, drag.days) : null
      setDrag(null)
      if (moved) save(issue, moved)
      // A press that went nowhere is a click: open the issue.
      else if (was && !was.moved) navigate(href(issue.key))
    }
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter') return navigate(href(issue.key))
      if (!editable || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      e.preventDefault()
      const mode: DragMode = e.shiftKey ? 'end' : e.altKey ? 'start' : 'move'
      save(issue, dragged(span.start, span.end, mode, e.key === 'ArrowLeft' ? -1 : 1))
    }
    const handle = (side: 'start' | 'end') =>
      editable && (
        <Box
          data-handle={side}
          sx={{ position: 'absolute', top: 0, bottom: 0, width: 8, cursor: 'ew-resize', [side === 'start' ? 'left' : 'right']: 0 }}
        />
      )

    return (
      <Tooltip
        title={
          <>
            {label}
            {opts.borrowed && <><br />From its issues' dates. Drag it to give the epic its own.</>}
            {editable && <><br />Drag to move, drag an end to stretch.</>}
          </>
        }
        disableInteractive
        open={drag?.id === issue.id ? false : undefined}
      >
        <Box
          role="button"
          tabIndex={0}
          aria-label={`${label}.${editable ? ' Arrow keys move it a day; with Shift, the due date; with Alt, the start.' : ''} Enter opens it.`}
          data-bar={issue.key}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            grabbed.current = null
            setDrag(null)
          }}
          onKeyDown={onKeyDown}
          sx={{
            position: 'absolute',
            left: offset * px,
            width: Math.max(length * px, 10),
            top: `calc(50% - ${opts.height / 2}px)`,
            height: opts.height,
            borderRadius: 1,
            bgcolor: opts.color,
            opacity: resolved ? 0.55 : 1,
            border: opts.borrowed ? '1px dashed rgba(255,255,255,0.9)' : 0,
            cursor: editable ? 'grab' : 'pointer',
            overflow: 'hidden',
            touchAction: 'pan-y',
            userSelect: 'none',
            '&:focus-visible': { outline: `2px solid ${theme.palette.text.primary}`, outlineOffset: 2 },
          }}
        >
          {opts.progress !== undefined && (
            <Box sx={{ position: 'absolute', inset: 0, width: `${opts.progress * 100}%`, bgcolor: 'rgba(0,0,0,0.22)' }} />
          )}
          {handle('start')}
          {handle('end')}
          {opts.height >= 20 && (
            <Typography variant="caption" noWrap sx={{ position: 'relative', display: 'block', px: 1.25, lineHeight: `${opts.height}px`, color: '#fff', fontWeight: 500, pointerEvents: 'none' }}>
              {issue.title}
            </Typography>
          )}
        </Box>
      </Tooltip>
    )
  }

  const colorOf = (issue: Issue) => typeById(issue.type_id)?.color ?? theme.palette.primary.main

  // ---------------- a phone: the same facts as a list ----------------
  if (narrow) {
    return (
      <Stack spacing={1.5}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {releases.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2 }} data-timeline="releases">
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Releases</Typography>
            <Stack spacing={0.75}>
              {[...releases].sort((a, b) => a.release_date!.localeCompare(b.release_date!)).map((r) => (
                <Stack key={r.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <RocketLaunchOutlinedIcon sx={{ fontSize: 18, color: releaseColor(r) }} />
                  <MuiLink component="button" underline="hover" color="inherit" onClick={() => setRelease(r)} sx={{ fontWeight: 500, textAlign: 'left' }}>
                    {r.name}
                  </MuiLink>
                  <Typography variant="body2" sx={{ color: 'text.secondary', ml: 'auto !important' }}>{formatDate(r.release_date)}</Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>
        )}
        {rows.map((r) => (
          <Paper key={r.epic.id} variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
              <TypeIcon type={typeById(r.epic.type_id)} />
              <IssueKey issueKey={r.epic.key} done={isDone(r.epic, statuses)} />
            </Stack>
            <MuiLink component={Link} to={href(r.epic.key)} underline="hover" color="inherit" sx={{ fontWeight: 500 }}>
              {r.epic.title}
            </MuiLink>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {r.start && r.end ? formatDateRange(r.start, r.end) : 'No dates yet'}
              {r.children.length > 0 && ` · ${r.done} of ${r.children.length} done`}
            </Typography>
            {r.children.length > 0 && (
              <LinearProgress variant="determinate" value={(r.done / r.children.length) * 100} sx={{ mt: 1, borderRadius: 1 }} />
            )}
          </Paper>
        ))}
        {releaseDialog}
      </Stack>
    )
  }

  // ---------------- the timeline ----------------
  const width = window_.days * px
  const labelCell = (children: ReactNode, height: number, extra: object = {}) => (
    <Box
      sx={{
        position: 'sticky', left: 0, zIndex: 2, width: LABEL_WIDTH, flexShrink: 0, height, px: 1.5,
        display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider', ...extra,
      }}
    >
      {children}
    </Box>
  )
  const line = (height: number, label: ReactNode, track: ReactNode, key: string, extra: object = {}) => (
    <Box key={key} role="row" sx={{ display: 'flex', borderBottom: 1, borderColor: 'divider', ...extra }}>
      {labelCell(label, height)}
      <Box sx={{ position: 'relative', width, height, flexShrink: 0 }}>{track}</Box>
    </Box>
  )
  const quiet = (text: string) => <Typography variant="caption" sx={{ color: 'text.secondary' }}>{text}</Typography>

  function epicLine(r: TimelineRow) {
    const expanded = open.has(r.epic.id)
    const toggle = () =>
      setOpen((was) => {
        const next = new Set(was)
        if (next.has(r.epic.id)) next.delete(r.epic.id)
        else next.add(r.epic.id)
        return next
      })
    const label = (
      <>
        <IconButton
          size="small" edge="start" onClick={toggle} disabled={!r.children.length}
          aria-label={`${expanded ? 'Hide' : 'Show'} the issues in ${r.epic.key}`} aria-expanded={expanded}
          sx={{ visibility: r.children.length ? 'visible' : 'hidden' }}
        >
          {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        </IconButton>
        <TypeIcon type={typeById(r.epic.type_id)} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <MuiLink component={Link} to={href(r.epic.key)} underline="hover" color="inherit" noWrap sx={{ display: 'block', fontWeight: 500, fontSize: 14 }}>
            {r.epic.title}
          </MuiLink>
        </Box>
        {r.children.length > 0 && quiet(`${r.done}/${r.children.length}`)}
      </>
    )
    const track =
      r.start && r.end
        ? bar(r.epic, { start: r.start, end: r.end }, { height: 26, color: colorOf(r.epic), progress: r.children.length ? r.done / r.children.length : undefined, borrowed: !r.own })
        : <Box sx={{ position: 'absolute', left: todayLeft + 12, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>{quiet('No dates yet. Open the epic to set them.')}</Box>
    return [
      line(ROW, label, track, r.epic.id),
      ...(expanded
        ? r.children.map((c) => {
            const span = spanOf(c)
            return line(
              CHILD_ROW,
              <>
                <Box sx={{ width: 34, flexShrink: 0 }} />
                <TypeIcon type={typeById(c.type_id)} size={16} />
                <IssueKey issueKey={c.key} done={isDone(c, statuses)} />
                <MuiLink component={Link} to={href(c.key)} underline="hover" color="text.secondary" noWrap sx={{ fontSize: 13, minWidth: 0 }}>
                  {c.title}
                </MuiLink>
              </>,
              span
                ? bar(c, span, { height: 12, color: theme.palette.grey[500] })
                : null,
              c.id,
              { bgcolor: 'background.subtle' },
            )
          })
        : []),
    ]
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          {editable ? 'Drag a bar to move it, or an end to change one date.' : 'Each bar runs from an epic’s start to its due date.'}
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={zoom} onChange={(_, v: Zoom | null) => v && setZoom(v)} aria-label="Scale">
          <ToggleButton value="weeks">Weeks</ToggleButton>
          <ToggleButton value="months">Months</ToggleButton>
          <ToggleButton value="quarters">Quarters</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Box ref={scroller} role="table" aria-label="Epic timeline" sx={{ overflowX: 'auto', position: 'relative' }}>
          <Box sx={{ width: LABEL_WIDTH + width, position: 'relative' }}>
            {/* Behind the rows: a line at each month, and today. */}
            <Box aria-hidden sx={{ position: 'absolute', top: 0, bottom: 0, left: LABEL_WIDTH, width, pointerEvents: 'none' }}>
              {window_.months.map((m) => (
                <Box key={m.offset} sx={{ position: 'absolute', top: 0, bottom: 0, left: m.offset * px, borderLeft: 1, borderColor: 'divider' }} />
              ))}
              {releases.map((r) => (
                <Box key={r.id} data-release-line={r.id} sx={{ position: 'absolute', top: 36, bottom: 0, left: place(window_, r.release_date!, r.release_date!).offset * px + px / 2,
                  borderLeft: `1px dashed ${releaseColor(r)}`, opacity: 0.6 }} />
              ))}
              <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: todayLeft + px / 2, borderLeft: 2, borderColor: 'error.main', opacity: 0.7 }} />
            </Box>

            {line(
              36,
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>Epics</Typography>,
              window_.months.map((m) => (
                <Typography key={m.offset} variant="caption" noWrap sx={{ position: 'absolute', left: m.offset * px + 8, top: 9, color: 'text.secondary', fontWeight: 600 }}>
                  {m.days * px > 44 ? m.label : m.label.slice(0, 1)}
                </Typography>
              )),
              'months',
              { bgcolor: 'background.subtle' },
            )}

            {sprints.length > 0 && line(
              30,
              quiet('Sprints'),
              sprints.map((s) => {
                const at = place(window_, s.start_date!, s.end_date!)
                return (
                  <Tooltip key={s.id} title={`${s.name}, ${formatDateRange(s.start_date, s.end_date)}`}>
                    <Box sx={{
                      position: 'absolute', left: at.offset * px, width: at.length * px, top: 6, height: 18, borderRadius: 0.5, overflow: 'hidden',
                      bgcolor: s.state === 'active' ? 'primary.light' : 'action.disabledBackground', color: s.state === 'active' ? 'primary.contrastText' : 'text.secondary',
                    }}>
                      <Typography variant="caption" noWrap sx={{ px: 0.75, display: 'block', lineHeight: '18px' }}>{s.name}</Typography>
                    </Box>
                  </Tooltip>
                )
              }),
              'sprints',
            )}

            {releases.length > 0 && line(
              34,
              quiet('Releases'),
              releases.map((r) => {
                const left = place(window_, r.release_date!, r.release_date!).offset * px + px / 2
                const span = r.start_date && r.start_date < r.release_date! ? place(window_, r.start_date, r.release_date!) : null
                const label = `Release ${r.name}, ${r.start_date ? formatDateRange(r.start_date, r.release_date) : formatDate(r.release_date)}`
                return (
                  <Box key={r.id}>
                    {span && (
                      <Box aria-hidden sx={{ position: 'absolute', left: span.offset * px, width: left - span.offset * px, top: 15, height: 4,
                        borderRadius: 2, bgcolor: releaseColor(r), opacity: 0.3 }} />
                    )}
                    <Tooltip title={`${label}${r.status === 'released' ? ' (released)' : ''}`}>
                      <Box component="button" type="button" data-release={r.id} aria-label={label} onClick={() => setRelease(r)}
                        sx={{ position: 'absolute', left: left - 6, top: 11, width: 12, height: 12, p: 0, border: 0, cursor: 'pointer',
                          transform: 'rotate(45deg)', bgcolor: releaseColor(r), '&:focus-visible': { outline: `2px solid ${theme.palette.text.primary}`, outlineOffset: 2 } }} />
                    </Tooltip>
                    {px * 30 > 60 && (
                      <Typography variant="caption" noWrap aria-hidden
                        sx={{ position: 'absolute', left: left + 10, top: 8, maxWidth: 140, color: 'text.secondary', fontWeight: 600, pointerEvents: 'none' }}>
                        {r.name}
                      </Typography>
                    )}
                  </Box>
                )
              }),
              'releases',
            )}

            {rows.flatMap(epicLine)}
            {!rows.length && line(ROW, quiet('No epics yet'), null, 'no-epics')}
          </Box>
        </Box>
      </Paper>
      {releaseDialog}
    </Stack>
  )
}
