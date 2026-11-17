// The next release, most prominent: how much is done, how the time compares
// with the work, and when it will likely be finished at the team's recent
// pace (a Monte Carlo forecast over the last eight weeks).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Grid, Link as MuiLink, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { supabase } from '../../lib/supabase'
import { CATEGORY_HEX, CATEGORY_LABELS, addDays, formatDate, formatPoints, todayIso } from '../../lib/constants'
import { fetchAll } from '../../lib/paging'
import { flowSeries, nextRelease, releaseHealth, throughputSamples, workItems, type ReleaseHealth } from '../../lib/insights'
import { releaseCountdown } from '../../lib/releases'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { INSIGHT_COLUMNS, asIssues, loadRecentWork, openBlockers, recentWorkKey } from './data'
import { Figure, LoadError, Quiet, VerdictChip } from './parts'
import { issuesHref } from './helpers'
import { must, useWidgetQuery } from './useWidgetQuery'

const pct = (x: number) => `${Math.round(x * 100)}%`

function Progress({ h }: { h: ReleaseHealth }) {
  const parts = [
    { key: 'done' as const, n: h.done },
    { key: 'in_progress' as const, n: h.inProgress },
    { key: 'todo' as const, n: h.todo },
  ].filter((p) => p.n > 0)
  return (
    <Box>
      <Stack direction="row" sx={{ height: 12, borderRadius: 1, overflow: 'hidden', gap: '2px', bgcolor: 'background.muted' }}
        role="img" aria-label={`${h.done} done, ${h.inProgress} in progress, ${h.todo} to do`}>
        {parts.map((p) => (
          <Tooltip key={p.key} title={`${CATEGORY_LABELS[p.key]}: ${p.n}`}>
            <Box sx={{ flexGrow: p.n, flexBasis: 0, bgcolor: CATEGORY_HEX[p.key] }} />
          </Tooltip>
        ))}
      </Stack>
      <Stack direction="row" spacing={2} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
        {(['done', 'in_progress', 'todo'] as const).map((c) => (
          <Stack key={c} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: CATEGORY_HEX[c] }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {CATEGORY_LABELS[c]} {c === 'done' ? h.done : c === 'in_progress' ? h.inProgress : h.todo}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

export default function ReleaseWidget({ project, header }: WidgetProps) {
  const { statusesOf, issueTypes } = useWorkspace()
  const meta = useProjectMeta(project.id)
  const statuses = statusesOf(project.id)
  const today = todayIso()
  const [chosen, setChosen] = useState<string | null>(null)
  const [menu, setMenu] = useState<HTMLElement | null>(null)

  const unreleased = (meta?.releases ?? []).filter((r) => r.status === 'unreleased')
  const release = unreleased.find((r) => r.id === chosen) ?? nextRelease(unreleased)

  const items = useWidgetQuery(release ? `${project.id}:release:${release.id}` : null, async () => {
    const rows = asIssues(must(await fetchAll((from, to) =>
      supabase.from('issues').select(INSIGHT_COLUMNS).eq('release_id', release!.id).order('id').range(from, to))))
    const open = rows.filter((i) => !i.resolved_at).map((i) => i.id)
    return { rows, blockers: await openBlockers(open) }
  })
  const recent = useWidgetQuery(recentWorkKey(project.id, today), () => loadRecentWork(project.id, today))

  if (!meta) return <>{header()}<WidgetLoading /></>
  if (!release) {
    return (
      <>
        {header()}
        <Quiet>
          No release planned. {' '}
          <MuiLink component={Link} to={`/projects/${project.key}/releases`}>Plan one</MuiLink> to see how it is going here.
        </Quiet>
      </>
    )
  }

  const switcher = (
    <>
      <Button size="small" endIcon={unreleased.length > 1 ? <ArrowDropDownIcon /> : undefined} aria-label="Release"
        onClick={(e) => unreleased.length > 1 && setMenu(e.currentTarget)} sx={{ textTransform: 'none', fontWeight: 600 }}>
        {release.name}
      </Button>
      <Menu open={!!menu} anchorEl={menu} onClose={() => setMenu(null)}>
        {unreleased.map((r) => (
          <MenuItem key={r.id} selected={r.id === release.id} onClick={() => { setChosen(r.id); setMenu(null) }}>
            {r.name}{r.release_date ? ` · ${formatDate(r.release_date, false)}` : ''}
          </MenuItem>
        ))}
      </Menu>
    </>
  )

  const error = items.error ?? recent.error
  if (error) return <>{header(switcher)}<LoadError message={error} onRetry={() => { items.retry(); recent.retry() }} /></>
  if (items.loading || recent.loading) return <>{header(switcher)}<WidgetLoading /></>

  const types = issueTypes
  const work = workItems(items.data!.rows, types)
  const samples = throughputSamples(flowSeries(workItems(recent.data!.resolved, types), recent.data!.byIssue, statuses, 8, today))
  const h = releaseHealth(release, work, statuses, samples, today)
  const blocked = work.filter((i) => !i.resolved_at && items.data!.blockers.has(i.id)).length
  const countdown = releaseCountdown(release, today)
  const releaseHref = `/projects/${project.key}/releases/${release.id}`

  return (
    <>
      {header(<>{switcher}<VerdictChip verdict={h.verdict} /></>)}
      {!h.total ? (
        <Quiet>Nothing is in {release.name} yet. Set the release on issues to track it.</Quiet>
      ) : (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 5 }}>
            <Typography variant="h4" component="div" sx={{ fontWeight: 700 }}>
              {pct(h.done / h.total)}
              <Typography component="span" variant="body1" sx={{ color: 'text.secondary', ml: 1 }}>
                {h.done} of {h.total} issues done
              </Typography>
            </Typography>
            {h.points.total > 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                {formatPoints(h.points.done)} of {formatPoints(h.points.total)} points
              </Typography>
            )}
            <Box sx={{ mt: 1 }}><Progress h={h} /></Box>
            <MuiLink component={Link} to={releaseHref} variant="body2" sx={{ display: 'inline-block', mt: 1.5 }}>Open the release</MuiLink>
          </Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Figure value={countdown ? (h.daysLeft !== null && h.daysLeft >= 0 ? `${h.daysLeft} d` : 'Late') : '—'}
                  label="left" hint={release.release_date ? formatDate(release.release_date, false) : 'No date set'} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Figure value={h.elapsed === null ? '—' : pct(h.elapsed)} label="of the time gone"
                  hint={`${pct(h.done / h.total)} of the work done`} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Figure value={h.forecast ? formatDate(addDays(today, h.forecast.p50), false) : '—'} label="likely done"
                  hint={h.forecast ? `85% by ${formatDate(addDays(today, h.forecast.p85), false)}` : undefined} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Figure value={h.forecast?.chance != null ? pct(h.forecast.chance) : '—'} label="chance by the date" />
              </Grid>
            </Grid>
            {!h.forecast && h.done < h.total && (
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1.5 }}>
                The forecast needs three weeks of finished work; until then the verdict compares the time gone with the work done.
              </Typography>
            )}
            <Stack direction="row" spacing={2} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography variant="body2">
                {h.unassigned > 0
                  ? <MuiLink component={Link} to={issuesHref(project, { releases: [release.id], assignees: ['none'], resolution: 'unresolved' })}>
                    {h.unassigned} unassigned</MuiLink>
                  : <Box component="span" sx={{ color: 'text.secondary' }}>All assigned</Box>}
              </Typography>
              {h.unestimated > 0 && <Typography variant="body2">{h.unestimated} not estimated</Typography>}
              {blocked > 0 && <Typography variant="body2" sx={{ color: 'error.main' }}>{blocked} blocked</Typography>}
            </Stack>
          </Grid>
        </Grid>
      )}
    </>
  )
}
