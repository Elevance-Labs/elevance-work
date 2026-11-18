// The next release, most prominent: how much is done, how the time compares
// with the work, and when it will likely be finished at the team's recent
// pace (a Monte Carlo forecast over the last eight weeks). The release page
// shows the same outlook (ReleaseOutlook).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Grid, Link as MuiLink, Menu, MenuItem, Typography } from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { formatDate, formatPoints } from '../../lib/constants'
import { nextRelease } from '../../lib/insights'
import { useProjectMeta } from '../../workspace/useProjectMeta'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { LoadError, Quiet, VerdictChip } from './parts'
import { ReleaseFigures, ReleaseFlags, ReleaseProgressBar } from './ReleaseOutlook'
import { useReleaseHealth } from './useReleaseHealth'

const pct = (x: number) => `${Math.round(x * 100)}%`

export default function ReleaseWidget({ project, header }: WidgetProps) {
  const meta = useProjectMeta(project.id)
  const [chosen, setChosen] = useState<string | null>(null)
  const [menu, setMenu] = useState<HTMLElement | null>(null)

  const unreleased = (meta?.releases ?? []).filter((r) => r.status === 'unreleased')
  const release = unreleased.find((r) => r.id === chosen) ?? nextRelease(unreleased)
  const outlook = useReleaseHealth(project, release)

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
            {r.name} · {formatDate(r.release_date, false)}
          </MenuItem>
        ))}
      </Menu>
    </>
  )

  if (outlook.error) return <>{header(switcher)}<LoadError message={outlook.error} onRetry={outlook.retry} /></>
  if (outlook.loading || !outlook.health) return <>{header(switcher)}<WidgetLoading /></>

  const h = outlook.health
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
            <Box sx={{ mt: 1 }}><ReleaseProgressBar h={h} /></Box>
            <MuiLink component={Link} to={releaseHref} variant="body2" sx={{ display: 'inline-block', mt: 1.5 }}>Open the release</MuiLink>
          </Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <ReleaseFigures h={h} release={release} />
            <Box sx={{ mt: 2 }}><ReleaseFlags h={h} blocked={outlook.blocked} project={project} release={release} /></Box>
          </Grid>
        </Grid>
      )}
    </>
  )
}
