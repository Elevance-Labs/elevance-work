import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/constants'
import { pushPrompt, pushStatusText, type PushStatus } from '../lib/push'
import type { PushSubscriptionRow } from '../lib/types'
import usePushDevice from './usePushDevice'

const STATUS_CHIP: Partial<Record<PushStatus, { label: string; color: 'success' | 'default' | 'warning' }>> = {
  on: { label: 'On', color: 'success' },
  off: { label: 'Off', color: 'default' },
  blocked: { label: 'Blocked', color: 'warning' },
  'install-first': { label: 'Install first', color: 'default' },
  unsupported: { label: 'Not supported', color: 'default' },
  unconfigured: { label: 'Not set up', color: 'default' },
}

/**
 * Notifications on your devices (account menu → Notifications): this one on,
 * off or tested, and every device you turned them on for, to remove.
 * Removing another device tells it nothing until it next looks, when it says
 * its notifications have stopped.
 */
export default function NotificationSettings({ onClose }: { onClose: () => void }) {
  const me = useMe()
  const push = usePushDevice(me.id)
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const [devices, setDevices] = useState<PushSubscriptionRow[]>([])
  const [sent, setSent] = useState(false)

  const loadDevices = useCallback(async () => {
    const { data } = await supabase.from('push_subscriptions')
      .select('id, profile_id, endpoint, device, created_at, last_used_at').eq('profile_id', me.id).order('created_at')
    setDevices((data ?? []) as PushSubscriptionRow[])
  }, [me.id])

  // Turning this device on or off changes the list as well.
  useEffect(() => {
    loadDevices()
  }, [loadDevices, push.status])

  async function remove(d: PushSubscriptionRow) {
    if (d.endpoint === push.endpoint) {
      await push.disable()
      return
    }
    await supabase.from('push_subscriptions').delete().eq('id', d.id)
    loadDevices()
  }

  async function test() {
    setSent(false)
    if (await push.test()) setSent(true)
  }

  const stopped = push.wasOn && (push.status === 'off' || push.status === 'blocked')
  const chip = stopped ? { label: 'Stopped', color: 'warning' as const } : push.status === 'loading' ? undefined : STATUS_CHIP[push.status]

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={phone} aria-labelledby="notification-settings-title">
      <DialogTitle id="notification-settings-title">Notifications</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2.5 }}>
          You're notified when you're assigned an issue or someone @mentions you, and when an issue you watch gets a
          comment or changes status. You watch an issue once you report it, are assigned it or comment on it; the eye
          on an issue changes that. They're always in the bell; here you choose which devices also get them when the
          app is closed.
        </Typography>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <Typography variant="subtitle2">On this device</Typography>
          {chip && <Chip size="small" label={chip.label} color={chip.color} />}
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {stopped ? pushPrompt(push.status, { device: push.device, wasOn: true })?.text : pushStatusText(push.status, push.device)}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          {push.status === 'off' && (
            <Button variant="contained" disabled={push.busy} onClick={push.enable}>
              {push.wasOn ? 'Turn back on' : 'Turn on'}
            </Button>
          )}
          {push.status === 'on' && (
            <>
              <Button variant="outlined" disabled={push.busy} onClick={test}>Send a test</Button>
              <Button color="inherit" disabled={push.busy} onClick={push.disable}>Turn off</Button>
            </>
          )}
        </Stack>
        {sent && (
          <Alert severity="success" sx={{ mt: 2 }} onClose={() => setSent(false)}>
            Sent. It should appear on this device in a moment.
          </Alert>
        )}
        {push.error && <Alert severity="error" sx={{ mt: 2 }} onClose={push.clearError}>{push.error}</Alert>}

        <Divider sx={{ my: 2.5 }} />
        <Typography variant="subtitle2">Your devices</Typography>
        {!devices.length ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            None yet. Turn notifications on from each phone or computer you want them on.
          </Typography>
        ) : (
          <List dense disablePadding aria-label="Your devices">
            {devices.map((d) => {
              const here = d.endpoint === push.endpoint
              return (
                <ListItem key={d.id} disableGutters secondaryAction={
                  <Tooltip title={here ? 'Turn off on this device' : 'Remove'}>
                    <IconButton edge="end" aria-label={`Remove ${d.device ?? 'device'}`} disabled={push.busy} onClick={() => remove(d)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }>
                  <ListItemText
                    primary={`${d.device || 'A device'}${here ? ' (this device)' : ''}`}
                    secondary={d.last_used_at ? `Last notified ${timeAgo(d.last_used_at)}` : `Added ${timeAgo(d.created_at)}`}
                  />
                </ListItem>
              )
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  )
}
