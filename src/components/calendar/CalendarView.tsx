// A calendar: a week (a day on phones) as a timeline of one-hour slots like
// Google Calendar's, or a month grid. The Calendar page and a project's
// Calendar tab both use it, each with its own layers and its own reading of
// the app's dates; meetings come from your own Google Calendar. The period
// shown lives in the address (?view=day|week&date=, or ?month=). Clicking
// anything opens its dialog; nothing is created here.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
  type SxProps,
  type Theme,
} from '@mui/material'
import EventIcon from '@mui/icons-material/Event'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { addDays, formatDate, formatTime, todayIso } from '../../lib/constants'
import {
  ITEM_LABELS,
  MEETING_COLOR,
  WEEKDAYS,
  calendarItems,
  gridRange,
  itemsOn,
  monthGrid,
  monthLabel,
  shiftMonth,
  timedBlocks,
  weekDays,
  weekLabel,
  type CalendarItem,
  type ItemKind,
} from '../../lib/calendar'
import type { Issue, Release, Todo } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useGoogleCalendar } from '../../workspace/useGoogleCalendar'
import { useIssueChanges } from '../../workspace/issueEvents'
import { useItemChanges } from '../../workspace/itemEvents'
import { useItemDialog } from './useItemDialog'

export interface Layer {
  key: ItemKind
  label: string
  // Shown until the viewer chooses otherwise (remembered on this device).
  on: boolean
}

export interface CalendarData {
  issues: Issue[]
  releases: Release[]
  todos: Todo[]
}

function ItemButton({ item, onOpen, sx, tooltip, children }: {
  item: CalendarItem
  onOpen: (i: CalendarItem) => void
  sx: SxProps<Theme>
  tooltip?: string
  children: ReactNode
}) {
  return (
    <Tooltip title={tooltip ?? `${ITEM_LABELS[item.kind]}: ${item.title}`}>
      <ButtonBase data-item={item.kind} sx={sx} onClick={(e) => { e.stopPropagation(); onOpen(item) }}>{children}</ButtonBase>
    </Tooltip>
  )
}

function ItemChip({ item, onOpen, continued }: { item: CalendarItem; onOpen: (i: CalendarItem) => void; continued?: boolean }) {
  const label = `${item.startsAt && !continued ? `${formatTime(item.startsAt.toISOString())} ` : ''}${item.title}`
  const sx = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    fontSize: 12,
    lineHeight: '18px',
    px: 0.75,
    borderRadius: 0.75,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textDecoration: item.done ? 'line-through' : 'none',
    ...(item.startsAt || item.kind === 'todo'
      ? { color: 'text.primary', borderLeft: `3px solid ${item.color}`, opacity: item.done ? 0.6 : 1 }
      : { bgcolor: item.color, color: '#fff', opacity: item.done ? 0.5 : continued ? 0.75 : 1 }),
  } as const
  return <ItemButton item={item} onOpen={onOpen} sx={sx}>{label}</ItemButton>
}

// One hour on the week and day timelines.
const HOUR_PX = 48
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const GUTTER = 56
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })

/** The week and day views: a column per day, one-hour slots, meetings placed by their times, all-day items above. */
function TimeGrid({ days, items, today, onOpen, onDay }: {
  days: string[]
  items: CalendarItem[]
  today: string
  onOpen: (i: CalendarItem) => void
  // Week view: a day's heading opens that day.
  onDay?: (day: string) => void
}) {
  const body = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(t)
  }, [])
  // Open on the working day, as Google Calendar does.
  const first = days[0]
  useEffect(() => {
    if (body.current) body.current.scrollTop = 7 * HOUR_PX
  }, [first, days.length])

  const columns = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`
  const allDay = days.map((d) => itemsOn(items, d).filter((i) => !i.startsAt))
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const fixed = { overflowY: 'hidden', scrollbarGutter: 'stable' } as const

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ ...fixed, borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: columns }}>
          <Box />
          {days.map((d) => {
            const date = new Date(`${d}T00:00:00`)
            const heading = (
              <>
                <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, color: d === today ? 'primary.main' : 'text.secondary' }}>
                  {date.toLocaleDateString(undefined, { weekday: 'short' })}
                </Typography>
                <Typography component="span" sx={{ display: 'inline-grid', placeItems: 'center', width: 32, height: 32, borderRadius: '50%', fontSize: 18,
                  bgcolor: d === today ? 'primary.main' : undefined, color: d === today ? '#fff' : 'text.primary' }}>
                  {date.getDate()}
                </Typography>
              </>
            )
            return (
              <Box key={d} sx={{ textAlign: 'center', py: 0.75, borderLeft: 1, borderColor: 'divider', minWidth: 0 }}>
                {onDay ? (
                  <ButtonBase aria-label={`Open ${formatDate(d)}`} onClick={() => onDay(d)} sx={{ display: 'block', mx: 'auto', px: 1, borderRadius: 1 }}>{heading}</ButtonBase>
                ) : heading}
              </Box>
            )
          })}
        </Box>
      </Box>
      {allDay.some((l) => l.length > 0) && (
        <Box sx={{ ...fixed, borderBottom: 1, borderColor: 'divider', maxHeight: 180, overflowY: 'auto' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: columns }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'right', pr: 1, pt: 0.5 }}>All day</Typography>
            {days.map((d, i) => (
              <Stack key={d} data-allday={d} spacing={0.25} sx={{ p: 0.5, borderLeft: 1, borderColor: 'divider', minWidth: 0 }}>
                {allDay[i].map((item) => <ItemChip key={item.id} item={item} onOpen={onOpen} continued={item.startDay < d && i > 0} />)}
              </Stack>
            ))}
          </Box>
        </Box>
      )}
      <Box ref={body} sx={{ overflowY: 'auto', scrollbarGutter: 'stable', height: { xs: 520, md: 'calc(100vh - 330px)' }, minHeight: 360 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: columns }}>
          <Box>
            {HOURS.map((h) => (
              <Box key={h} sx={{ height: HOUR_PX, position: 'relative' }}>
                {h > 0 && (
                  <Typography variant="caption" sx={{ position: 'absolute', top: -9, right: 8, color: 'text.secondary', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {hourLabel(h)}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
          {days.map((d) => (
            <Box key={d} data-day={d} sx={{ position: 'relative', borderLeft: 1, borderColor: 'divider', minWidth: 0 }}>
              {HOURS.map((h) => <Box key={h} sx={{ height: HOUR_PX, borderTop: h ? 1 : 0, borderColor: 'divider' }} />)}
              {timedBlocks(items, d).map((b) => {
                const height = ((b.end - b.start) / 60) * HOUR_PX
                const time = `${formatTime(b.item.startsAt!.toISOString())}${b.item.endsAt ? ` – ${formatTime(b.item.endsAt.toISOString())}` : ''}`
                const past = (b.item.endsAt ?? b.item.startsAt!) < now
                return (
                  <ItemButton key={b.item.id} item={b.item} onOpen={onOpen} tooltip={`${b.item.title} · ${time}`}
                    sx={{ position: 'absolute', top: (b.start / 60) * HOUR_PX + 1, height: Math.max(height - 2, 16),
                      left: `calc(${(b.col / b.cols) * 100}% + 2px)`, width: `calc(${100 / b.cols}% - 4px)`,
                      display: 'block', textAlign: 'left', overflow: 'hidden', px: 0.75, py: 0.25, borderRadius: 1, textDecoration: 'none',
                      color: 'text.primary', bgcolor: alpha(b.item.color, past ? 0.08 : 0.16), borderLeft: `3px solid ${b.item.color}`,
                      '&:hover': { bgcolor: alpha(b.item.color, 0.26) } }}>
                    <Typography component="span" sx={{ display: 'block', fontSize: 12, fontWeight: 600, lineHeight: '16px', whiteSpace: height < 40 ? 'nowrap' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {b.item.title}
                    </Typography>
                    {height >= 34 && (
                      <Typography component="span" sx={{ display: 'block', fontSize: 11, lineHeight: '14px', color: 'text.secondary', whiteSpace: 'nowrap' }}>{time}</Typography>
                    )}
                  </ItemButton>
                )
              })}
              {d === today && (
                <Box aria-hidden sx={{ position: 'absolute', left: 0, right: 0, top: (nowMinutes / 60) * HOUR_PX, height: 2, bgcolor: 'error.main', pointerEvents: 'none', zIndex: 1,
                  '&::before': { content: '""', position: 'absolute', left: -5, top: -4, width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main' } }} />
              )}
            </Box>
          ))}
        </Box>
      </Box>
    </Paper>
  )
}

type View = 'month' | 'week' | 'day'

function storedLayers(key: string, layers: Layer[]): ItemKind[] {
  try {
    const raw = window.localStorage.getItem(key)
    const saved = raw ? (JSON.parse(raw) as unknown) : null
    if (Array.isArray(saved)) return layers.filter((l) => saved.includes(l.key)).map((l) => l.key)
  } catch {
    // Not remembered; the defaults below.
  }
  return layers.filter((l) => l.on).map((l) => l.key)
}

export default function CalendarView({ layers: layerDefs, load, storageKey, toolbar, filter, empty }: {
  layers: Layer[]
  // Reads the app's own dates for [from, to]; `shown` says which layers are on.
  load: (from: string, to: string, shown: ItemKind[]) => Promise<CalendarData>
  // Where this calendar remembers its layers.
  storageKey: string
  // More controls beside the layers (the Calendar page's project).
  toolbar?: ReactNode
  // Hide some items (the Calendar page's project).
  filter?: (item: CalendarItem) => boolean
  // Shown under the calendar when nothing is on it.
  empty?: ReactNode
}) {
  const { projects, issueTypes, typeById } = useWorkspace()
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const [params, setParams] = useSearchParams()
  const today = todayIso()
  // ?month=YYYY-MM is the month view; otherwise ?view=week|day&date=YYYY-MM-DD.
  // Week by default (one day on a phone).
  const monthParam = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : null
  const dateParam = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : null
  const viewParam = params.get('view')
  const view: View = monthParam || viewParam === 'month' ? 'month' : viewParam === 'day' || viewParam === 'week' ? viewParam : phone ? 'day' : 'week'
  const anchor = dateParam ?? (monthParam ? `${monthParam}-01` : today)
  const month = anchor.slice(0, 7)
  const [layers, setLayersState] = useState<ItemKind[]>(() => storedLayers(storageKey, layerDefs))
  const [data, setData] = useState<CalendarData>({ issues: [], releases: [], todos: [] })
  const days = monthGrid(month)
  const shown = view === 'week' ? weekDays(anchor) : [anchor]
  const { from, to } = view === 'month' ? gridRange(month) : { from: shown[0], to: shown[shown.length - 1] }
  const meetingsOn = layers.includes('meeting') && layerDefs.some((l) => l.key === 'meeting')
  const google = useGoogleCalendar(from, to, meetingsOn)

  const setLayers = (next: ItemKind[]) => {
    setLayersState(next)
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // Not remembered; nothing else depends on it.
    }
  }

  // Bumped when an issue or todo changes, to read the calendar again.
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((v) => v + 1)
  useItemChanges(['todo'], reload)
  useIssueChanges(reload)
  const { open, dialog } = useItemDialog(reload)

  const layerKey = layers.join()
  useEffect(() => {
    let cancelled = false
    load(from, to, layerKey ? (layerKey.split(',') as ItemKind[]) : []).then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [load, from, to, layerKey, version])

  const epicTypes = new Set(issueTypes.filter((t) => t.level === 'epic').map((t) => t.id))
  const items = calendarItems({
    meetings: meetingsOn ? google.events : [],
    issues: data.issues.filter((i) => layers.includes(epicTypes.has(i.type_id) ? 'epic' : 'issue')),
    isEpic: (i) => epicTypes.has(i.type_id),
    typeColor: (i) => typeById(i.type_id)?.color,
    releases: layers.includes('release') ? data.releases : [],
    todos: layers.includes('todo') ? data.todos : [],
    projects,
  }, from, to).filter((i) => !filter || filter(i))

  const go = (v: View, date: string) => setParams((p) => {
    const next = new URLSearchParams(p)
    for (const k of ['month', 'view', 'date']) next.delete(k)
    if (v === 'month') next.set('month', date.slice(0, 7))
    else {
      next.set('view', v)
      next.set('date', date)
    }
    return next
  }, { replace: true })
  const shift = (by: number) =>
    go(view, view === 'month' ? `${shiftMonth(month, by)}-01` : addDays(anchor, by * (view === 'week' ? 7 : 1)))
  // Switching view keeps today in sight when it's in the period shown, else the period's first day.
  const switchTo = (v: View) => go(v, from <= today && today <= to && (view !== 'month' || today.slice(0, 7) === month) ? today : view === 'month' ? `${month}-01` : anchor)
  const title = view === 'month' ? monthLabel(month) : view === 'week' ? weekLabel(anchor)
    : new Date(`${anchor}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const grid = (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
        {WEEKDAYS.map((d) => (
          <Typography key={d} variant="caption" sx={{ p: 1, fontWeight: 600, color: 'text.secondary', textAlign: 'center' }}>{d}</Typography>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridAutoRows: 'minmax(110px, auto)' }}>
        {days.map((d, i) => {
          const list = itemsOn(items, d)
          const outside = d.slice(0, 7) !== month
          return (
            <Box key={d} data-day={d}
              sx={{ p: 0.5, borderRight: (i + 1) % 7 ? 1 : 0, borderBottom: i < 35 ? 1 : 0, borderColor: 'divider', minWidth: 0,
                bgcolor: outside ? 'grey.50' : 'background.paper' }}>
              <ButtonBase aria-label={`Open ${formatDate(d)}`} onClick={() => go('day', d)}
                sx={{ display: 'inline-grid', placeItems: 'center', width: 24, height: 24, borderRadius: '50%', mb: 0.25, fontSize: 12,
                  fontWeight: d === today ? 700 : 400, bgcolor: d === today ? 'primary.main' : undefined,
                  color: d === today ? '#fff' : outside ? 'text.disabled' : 'text.primary', '&:hover': { bgcolor: d === today ? 'primary.dark' : 'action.hover' } }}>
                {Number(d.slice(8))}
              </ButtonBase>
              <Stack spacing={0.25}>
                {list.slice(0, 4).map((item) => <ItemChip key={item.id} item={item} onOpen={open} continued={item.startDay < d && (i % 7) !== 0} />)}
                {list.length > 4 && (
                  <ButtonBase onClick={() => go('day', d)} sx={{ justifyContent: 'flex-start', pl: 0.5, borderRadius: 0.5 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>+{list.length - 4} more</Typography>
                  </ButtonBase>
                )}
              </Stack>
            </Box>
          )
        })}
      </Box>
    </Paper>
  )

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <IconButton aria-label={`Previous ${view}`} onClick={() => shift(-1)}><ChevronLeftIcon /></IconButton>
        <IconButton aria-label={`Next ${view}`} onClick={() => shift(1)}><ChevronRightIcon /></IconButton>
        <Typography variant="h6" component="h2" sx={{ minWidth: 170 }}>{title}</Typography>
        <Button size="small" onClick={() => go(view, today)}>Today</Button>
        <Box sx={{ flexGrow: 1 }} />
        {toolbar}
        <ToggleButtonGroup size="small" value={layers} onChange={(_, v: ItemKind[]) => setLayers(v)} aria-label="Show">
          {layerDefs.map((l) => <ToggleButton key={l.key} value={l.key}>{l.label}</ToggleButton>)}
        </ToggleButtonGroup>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && switchTo(v)} aria-label="View">
          <ToggleButton value="day">Day</ToggleButton>
          <ToggleButton value="week">Week</ToggleButton>
          <ToggleButton value="month">Month</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {meetingsOn && google.status === 'off' && (
        <Alert severity={google.lapsed ? 'warning' : 'info'} icon={<EventIcon />} sx={{ mb: 2 }}
          action={<Button color="inherit" size="small" onClick={google.connect}>Connect Google Calendar</Button>}>
          {google.lapsed
            ? 'Google no longer lets the app read your calendar. Connect it again to see your meetings here.'
            : 'Your meetings come from your Google Calendar. Connect it once to see them here (read-only, and only you see them).'}
        </Alert>
      )}
      {meetingsOn && google.error && (
        <Alert severity="warning" sx={{ mb: 2 }}
          action={google.status === 'error'
            ? <Button color="inherit" size="small" onClick={google.connect}>Connect Google Calendar</Button>
            : undefined}>
          {google.error}
        </Alert>
      )}
      {meetingsOn && google.status === 'on' && (
        <Stack direction="row" sx={{ mb: 1, alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: MEETING_COLOR }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Meetings from your Google Calendar ({google.email}), visible only to you. Click one to take notes.
          </Typography>
        </Stack>
      )}
      {view === 'month' ? grid : (
        <TimeGrid days={shown} items={items} today={today} onOpen={open} onDay={view === 'week' ? (d) => go('day', d) : undefined} />
      )}
      {!items.length && empty}
      {dialog}
    </>
  )
}
