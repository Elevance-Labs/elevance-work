// Workspace-wide settings: the company Google Chat space that hears about
// new calendar events and releases. (Each project's own space is set in its
// settings.)
import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Checkbox, FormControlLabel, FormGroup, Paper, Stack, TextField, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import { WORKSPACE_CHAT_EVENT_LABELS, errorMessage } from '../../lib/constants'
import type { WorkspaceChatEvent, WorkspaceSettings as Settings } from '../../lib/types'
import { Loading, PageHeader } from '../../components/common'

export default function WorkspaceSettings() {
  const [row, setRow] = useState<Settings | null>(null)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<WorkspaceChatEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('workspace_settings').select('*').maybeSingle()
    const r = data as Settings | null
    setRow(r)
    setUrl(r?.chat_webhook_url ?? '')
    setEvents(r?.chat_events ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    const webhook = url.trim() || null
    if (webhook && !/^https:\/\/chat\.googleapis\.com\//.test(webhook)) {
      return setError('That isn’t a Google Chat webhook address (it starts with https://chat.googleapis.com/).')
    }
    setBusy(true)
    setError(null)
    setSaved(false)
    const { error: e } = await supabase.from('workspace_settings').update({ chat_webhook_url: webhook, chat_events: events }).eq('id', true)
    setBusy(false)
    if (e) return setError(errorMessage(e))
    setSaved(true)
  }

  if (!row) return <Loading />
  return (
    <>
      <PageHeader title="Workspace" subtitle="Settings for everyone." />
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, maxWidth: 680 }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h6">Company Google Chat space</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Announce new calendar events and releases to a space everyone is in. In the space: <em>Apps &amp; integrations → Webhooks →
              Add webhook</em>, and paste its address. Projects post their own news to their own spaces (project settings → Google Chat).
            </Typography>
          </Box>
          <TextField label="Webhook URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://chat.googleapis.com/v1/spaces/…"
            helperText="Anyone with this address can post into the space, so only workspace admins can see it." />
          <FormGroup>
            {(Object.keys(WORKSPACE_CHAT_EVENT_LABELS) as WorkspaceChatEvent[]).map((ev) => (
              <FormControlLabel key={ev} label={WORKSPACE_CHAT_EVENT_LABELS[ev]} control={
                <Checkbox checked={events.includes(ev)} onChange={(e) => setEvents((xs) => (e.target.checked ? [...xs, ev] : xs.filter((x) => x !== ev)))} />
              } />
            ))}
          </FormGroup>
          {error && <Alert severity="error">{error}</Alert>}
          {saved && <Alert severity="success">Saved.</Alert>}
          <Box><Button variant="contained" onClick={save} loading={busy}>Save</Button></Box>
        </Stack>
      </Paper>
    </>
  )
}
