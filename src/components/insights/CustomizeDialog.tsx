// A project admin chooses the Summary's widgets for everyone on the project:
// which show, in what order, or back to the default.
import { useState } from 'react'
import { Box, Button, IconButton, Paper, Stack, Switch, Tooltip, Typography } from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/constants'
import { availableWidgets, defaultWidgets, layoutToSave, moveWidget, toggleWidget, widgetInfo, widgetsFor, type WidgetKey } from '../../lib/widgets'
import type { Project } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { FormDialog } from '../common'

export default function CustomizeDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { reload } = useWorkspace()
  const [shown, setShown] = useState<WidgetKey[]>(() => widgetsFor(project))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hidden = availableWidgets(project).filter((w) => !shown.includes(w.key))

  async function save() {
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.from('projects').update({ summary_widgets: layoutToSave(project, shown) }).eq('id', project.id)
    if (e) {
      setBusy(false)
      return setError(errorMessage(e))
    }
    await reload()
    setBusy(false)
    onClose()
  }

  const row = (key: WidgetKey, on: boolean, i: number) => {
    const info = widgetInfo(key)
    return (
      <Stack key={key} direction="row" spacing={1} sx={{ alignItems: 'center', px: 1.5, py: 1, borderTop: i ? 1 : 0, borderColor: 'divider' }}
        data-customize={key}>
        <Switch size="small" checked={on} onChange={(e) => setShown(toggleWidget(shown, key, e.target.checked))}
          slotProps={{ input: { 'aria-label': info.title } }} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{info.title}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{info.help}</Typography>
        </Box>
        {on && (
          <>
            <Tooltip title="Move up">
              <span><IconButton size="small" aria-label={`Move ${info.title} up`} disabled={i === 0} onClick={() => setShown(moveWidget(shown, key, -1))}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton></span>
            </Tooltip>
            <Tooltip title="Move down">
              <span><IconButton size="small" aria-label={`Move ${info.title} down`} disabled={i === shown.length - 1}
                onClick={() => setShown(moveWidget(shown, key, 1))}>
                <ArrowDownwardIcon fontSize="small" />
              </IconButton></span>
            </Tooltip>
          </>
        )}
      </Stack>
    )
  }

  return (
    <FormDialog open title="Customize the summary" busy={busy} error={error} onSubmit={save} onClose={onClose}
      extraActions={<Button onClick={() => setShown(widgetsFor({ ...project, summary_widgets: defaultWidgets(project.kind) }))} disabled={busy}>
        Reset to default
      </Button>}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Everyone on {project.name} sees these, in this order.
      </Typography>
      <Box>
        <Typography variant="overline" sx={{ color: 'text.secondary' }}>Shown</Typography>
        <Paper variant="outlined">
          {shown.map((k, i) => row(k, true, i))}
          {!shown.length && <Typography variant="body2" sx={{ color: 'text.secondary', p: 1.5 }}>Nothing: turn a widget on below.</Typography>}
        </Paper>
      </Box>
      {hidden.length > 0 && (
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>Available</Typography>
          <Paper variant="outlined">{hidden.map((w, i) => row(w.key, false, i))}</Paper>
        </Box>
      )}
    </FormDialog>
  )
}
