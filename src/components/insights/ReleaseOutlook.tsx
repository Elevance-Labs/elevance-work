// A release's outlook in parts, shared by the Summary's release widget and
// the release page's side panel: the progress bar, the headline figures
// (days left, time gone, likely done, chance by the date) and what is in the
// way (unassigned, not estimated, blocked).
import { Link } from 'react-router-dom'
import { Box, Grid, Link as MuiLink, Stack, Tooltip, Typography } from '@mui/material'
import { CATEGORY_HEX, CATEGORY_LABELS, addDays, formatDate, formatPoints, todayIso } from '../../lib/constants'
import type { ReleaseHealth } from '../../lib/insights'
import { releaseCountdown } from '../../lib/releases'
import type { Project, Release } from '../../lib/types'
import { WidgetLoading } from './WidgetFrame'
import { Figure, LoadError, Quiet, VerdictChip } from './parts'
import { issuesHref } from './helpers'
import { useReleaseHealth } from './useReleaseHealth'

const pct = (x: number) => `${Math.round(x * 100)}%`

export function ReleaseProgressBar({ h }: { h: ReleaseHealth }) {
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

/** Days left, time gone, likely done and the chance by the date; `narrow` puts two on a row. */
export function ReleaseFigures({ h, release, narrow }: { h: ReleaseHealth; release: Release; narrow?: boolean }) {
  const today = todayIso()
  const countdown = releaseCountdown(release, today)
  const size = narrow ? { xs: 6 } : { xs: 6, sm: 3 }
  return (
    <>
      <Grid container spacing={2}>
        <Grid size={size}>
          <Figure value={countdown ? (h.daysLeft !== null && h.daysLeft >= 0 ? `${h.daysLeft} d` : 'Late') : '—'}
            label="left" hint={formatDate(release.release_date, false)} />
        </Grid>
        <Grid size={size}>
          <Figure value={h.elapsed === null ? '—' : pct(h.elapsed)} label="of the time gone"
            hint={h.total ? `${pct(h.done / h.total)} of the work done` : undefined} />
        </Grid>
        <Grid size={size}>
          <Figure value={h.forecast ? formatDate(addDays(today, h.forecast.p50), false) : '—'} label="likely done"
            hint={h.forecast ? `85% by ${formatDate(addDays(today, h.forecast.p85), false)}` : undefined} />
        </Grid>
        <Grid size={size}>
          <Figure value={h.forecast?.chance != null ? pct(h.forecast.chance) : '—'} label="chance by the date" />
        </Grid>
      </Grid>
      {!h.forecast && h.done < h.total && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1.5 }}>
          The forecast needs three weeks of finished work; until then the verdict compares the time gone with the work done.
        </Typography>
      )}
    </>
  )
}

/** What is in the way: unassigned (a link to them), not estimated, blocked. */
export function ReleaseFlags({ h, blocked, project, release }: {
  h: ReleaseHealth
  blocked: number
  project: Pick<Project, 'id' | 'key' | 'disabled_features'>
  release: Release
}) {
  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      <Typography variant="body2">
        {h.unassigned > 0
          ? <MuiLink component={Link} to={issuesHref(project, { releases: [release.id], assignees: ['none'], resolution: 'unresolved' })}>
            {h.unassigned} unassigned</MuiLink>
          : <Box component="span" sx={{ color: 'text.secondary' }}>All assigned</Box>}
      </Typography>
      {h.unestimated > 0 && <Typography variant="body2">{h.unestimated} not estimated</Typography>}
      {blocked > 0 && <Typography variant="body2" sx={{ color: 'error.main' }}>{blocked} blocked</Typography>}
    </Stack>
  )
}

/** The release page's outlook: the same judgement as the Summary's release widget, stacked for a side panel. */
export default function ReleaseOutlook({ project, release }: { project: Project; release: Release }) {
  const o = useReleaseHealth(project, release)
  if (o.error) return <LoadError message={o.error} onRetry={o.retry} />
  if (o.loading || !o.health) return <WidgetLoading />
  const h = o.health
  if (!h.total) return <Quiet>Nothing is in {release.name} yet. Add issues to see how it is going.</Quiet>
  return (
    <Stack spacing={2} data-outlook>
      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <Typography variant="h5" component="div" sx={{ fontWeight: 700 }}>{pct(h.done / h.total)}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>{h.done} of {h.total} issues done</Typography>
          <VerdictChip verdict={h.verdict} />
        </Stack>
        {h.points.total > 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {formatPoints(h.points.done)} of {formatPoints(h.points.total)} points
          </Typography>
        )}
      </Box>
      <ReleaseProgressBar h={h} />
      <Box><ReleaseFigures h={h} release={release} narrow /></Box>
      <ReleaseFlags h={h} blocked={o.blocked} project={project} release={release} />
    </Stack>
  )
}
