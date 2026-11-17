// Each widget's component, loaded only when its card first shows. A new
// widget is an entry in lib/widgets and a file here.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { WidgetKey } from '../../lib/widgets'
import type { WidgetProps } from './WidgetFrame'

export const WIDGET_COMPONENTS: Record<WidgetKey, LazyExoticComponent<ComponentType<WidgetProps>>> = {
  release: lazy(() => import('./ReleaseWidget')),
  sprint: lazy(() => import('./SprintHealthWidget')),
  flow: lazy(() => import('./FlowWidget')),
  attention: lazy(() => import('./AttentionWidget')),
  status_time: lazy(() => import('./StatusTimeWidget')),
  people: lazy(() => import('./PeopleWidget')),
  leaderboard: lazy(() => import('./LeaderboardWidget')),
  epics: lazy(() => import('./EpicsWidget')),
  activity: lazy(() => import('./ActivityWidget')),
  velocity: lazy(() => import('./VelocityWidget')),
  sprint_report: lazy(() => import('./SprintReportWidget')),
  created_resolved: lazy(() => import('./CreatedResolvedWidget')),
  cumulative_flow: lazy(() => import('./CumulativeFlowWidget')),
}
