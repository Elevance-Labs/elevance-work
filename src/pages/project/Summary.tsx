// A project's intelligence: the widgets its admins chose (lib/widgets), each
// loading its own data once it is on screen (components/insights). This page
// fetches nothing itself; it lays the cards out and tells them when issues
// change.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Button, Grid, Stack, Typography } from '@mui/material'
import TuneIcon from '@mui/icons-material/Tune'
import { can } from '../../lib/permissions'
import { widgetInfo, widgetsFor } from '../../lib/widgets'
import { useIssueChanges } from '../../workspace/issueEvents'
import WidgetFrame from '../../components/insights/WidgetFrame'
import { invalidateWidgets } from '../../components/insights/useWidgetQuery'
import { useProject } from './projectContext'

const CustomizeDialog = lazy(() => import('../../components/insights/CustomizeDialog'))

export default function Summary() {
  const { project, role } = useProject()
  const [customizing, setCustomizing] = useState(false)
  const widgets = widgetsFor(project)

  // A burst of saves (a drag on the board, a bulk edit) refreshes once.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useIssueChanges(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => invalidateWidgets(project.id), 800)
  })
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return (
    <>
      {can.manageProject(role) && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: -1, mb: 1.5 }}>
          <Button size="small" startIcon={<TuneIcon />} onClick={() => setCustomizing(true)}>Customize</Button>
        </Stack>
      )}
      {widgets.length ? (
        <Grid container spacing={2}>
          {widgets.map((key) => {
            const info = widgetInfo(key)
            return (
              <Grid key={key} size={{ xs: 12, md: info.width === 'full' ? 12 : 6 }}>
                <WidgetFrame info={info} project={project} />
              </Grid>
            )
          })}
        </Grid>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No widgets on this summary.{can.manageProject(role) ? ' Customize it to add some.' : ''}
        </Typography>
      )}
      {customizing && (
        <Suspense fallback={null}>
          <CustomizeDialog project={project} onClose={() => setCustomizing(false)} />
        </Suspense>
      )}
    </>
  )
}
