// Whether work arrives faster than it is finished: issues created and
// resolved, added up day by day over 14, 30 or 90 days.
import { useState } from 'react'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { addDays, formatDate, todayIso } from '../../lib/constants'
import { fetchAll } from '../../lib/paging'
import { createdVsResolved } from '../../lib/reports'
import type { Issue } from '../../lib/types'
import { LineChart } from '../charts'
import type { WidgetProps } from './WidgetFrame'
import { WidgetLoading } from './WidgetFrame'
import { LoadError } from './parts'
import { must, useWidgetQuery } from './useWidgetQuery'

export function DaysToggle({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <ToggleButtonGroup exclusive size="small" value={days} onChange={(_, v: number | null) => v && onChange(v)} aria-label="Days">
      {[14, 30, 90].map((d) => <ToggleButton key={d} value={d} sx={{ py: 0.25 }}>{d} d</ToggleButton>)}
    </ToggleButtonGroup>
  )
}

export default function CreatedResolvedWidget({ project, header }: WidgetProps) {
  const today = todayIso()
  const [days, setDays] = useState(30)
  const since = new Date(`${addDays(today, -(days - 1))}T00:00:00`).toISOString()

  const q = useWidgetQuery(`${project.id}:created_resolved:${days}:${today}`, async () =>
    must(await fetchAll<Pick<Issue, 'id' | 'created_at' | 'resolved_at'>>((f, t) =>
      supabase.from('issues').select('id, created_at, resolved_at').eq('project_id', project.id)
        .or(`created_at.gte.${since},resolved_at.gte.${since}`).order('id').range(f, t))))

  const toggle = <DaysToggle days={days} onChange={setDays} />
  if (q.error) return <>{header(toggle)}<LoadError message={q.error} onRetry={q.retry} /></>
  if (q.loading) return <>{header(toggle)}<WidgetLoading /></>
  const series = createdVsResolved(q.data! as Issue[], days, today)
  return (
    <>
      {header(toggle)}
      <LineChart title="Created vs resolved" height={200} labels={series.map((p) => formatDate(p.day, false))} series={[
        { label: 'Created', color: '#e2483d', values: series.map((p) => p.created) },
        { label: 'Resolved', color: '#22a06b', values: series.map((p) => p.resolved) },
      ]} />
    </>
  )
}
