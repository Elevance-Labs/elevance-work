// One widget's card. It loads the widget's code and data only once the card
// is near the screen, shows a skeleton until then, and keeps a widget that
// breaks to itself: the rest of the Summary carries on.
import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Box, IconButton, Paper, Skeleton, Stack, Tooltip, Typography } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import type { WidgetInfo } from '../../lib/widgets'
import type { Project } from '../../lib/types'
import { LoadError } from './parts'
import { WIDGET_COMPONENTS } from './registry'

export interface WidgetProps {
  project: Project
  // The card's title row, with the widget's own controls on the right.
  header: (action?: ReactNode) => ReactNode
}

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : 'Something went wrong.' }
  }
  render() {
    return this.state.error
      ? <LoadError message={this.state.error} onRetry={() => this.setState({ error: null })} />
      : this.props.children
  }
}

/** Whether the element has come within 200px of the screen (always, without IntersectionObserver). */
function useNearScreen() {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !ref.current) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true)
    }, { rootMargin: '200px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [near])
  return { ref, near }
}

function Placeholder() {
  return (
    <Stack spacing={1} aria-busy="true">
      <Skeleton variant="rounded" height={20} width="60%" />
      <Skeleton variant="rounded" height={120} />
    </Stack>
  )
}

export default function WidgetFrame({ info, project }: { info: WidgetInfo; project: Project }) {
  const { ref, near } = useNearScreen()
  const Widget = WIDGET_COMPONENTS[info.key]
  const header = (action?: ReactNode) => (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, minHeight: 32, flexWrap: 'wrap', rowGap: 1 }}>
      <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', flexGrow: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" component="h2" noWrap>{info.title}</Typography>
        <Tooltip title={info.help}>
          <IconButton size="small" aria-label={`About ${info.title}`} sx={{ color: 'text.secondary' }}>
            <InfoOutlinedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Stack>
      {action}
    </Stack>
  )
  return (
    <Paper ref={ref} variant="outlined" data-widget={info.key} sx={{ p: { xs: 2, md: 2.5 }, height: '100%', minWidth: 0 }}>
      {near ? (
        <Boundary>
          <Suspense fallback={<>{header()}<Placeholder /></>}>
            <Widget project={project} header={header} />
          </Suspense>
        </Boundary>
      ) : (
        <Box>{header()}<Placeholder /></Box>
      )}
    </Paper>
  )
}

/** While a widget's data loads, its title over a skeleton. */
export function WidgetLoading() {
  return <Placeholder />
}
