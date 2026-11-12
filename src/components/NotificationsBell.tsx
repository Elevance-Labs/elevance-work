import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined'
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined'
import { useMe } from '../auth/AuthProvider'
import { timeAgo } from '../lib/constants'
import { excerpt, notificationSentence, quotesComment } from '../lib/notifications'
import { pushPrompt, SNOOZE_MS } from '../lib/push'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { useNotifications, type NotificationRow } from '../workspace/notifications'
import { PersonAvatar } from './common'
import usePushDevice from './usePushDevice'

// Until when the offer to turn on device notifications was put off here.
const SNOOZE_KEY = 'el-work:push-offer-snoozed-until'
const readSnooze = () => {
  try {
    return Number(window.localStorage.getItem(SNOOZE_KEY)) || 0
  } catch {
    return 0
  }
}

/**
 * The header's bell: your latest notifications, newest first, unread ones
 * marked, live. Opening one shows its issue and marks it read; so does
 * opening the issue any other way.
 *
 * While this device does not get notifications, the top of the list says so:
 * off (with Turn on), blocked (and how to allow them), or install first on an
 * iPhone in Safari. "Not now" puts that off for a week. A device that *had*
 * them and stopped says that instead, and no snooze hides it. Checked again
 * every time the list opens.
 */
export default function NotificationsBell() {
  const me = useMe()
  const { profileById } = useWorkspace()
  const { items, unread, markRead, markAllRead } = useNotifications()
  const push = usePushDevice(me.id)
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [snoozedUntil, setSnoozedUntil] = useState(readSnooze)

  function open(n: NotificationRow) {
    setAnchor(null)
    if (!n.read_at) markRead([n.id])
    if (n.issue) navigate({ search: `?issue=${n.issue.key}` })
  }

  function snooze() {
    const until = Date.now() + SNOOZE_MS
    setSnoozedUntil(until)
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(until))
    } catch {
      // This visit only.
    }
  }

  function show(e: React.MouseEvent<HTMLElement>) {
    setAnchor(e.currentTarget)
    push.refresh()
  }

  const prompt = pushPrompt(push.status, { device: push.device, wasOn: push.wasOn, snoozedUntil })
  const stopped = prompt?.kind === 'stopped'

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          onClick={show}
          aria-label={['Notifications', unread ? `(${unread} unread)` : '', stopped ? '— stopped on this device' : '']
            .filter(Boolean).join(' ')}
        >
          {/* The count when there is one; otherwise a dot if this device has
              stopped getting them, since that is only said inside. */}
          <Badge badgeContent={unread} color="error" max={99}
            {...(!unread && stopped ? { variant: 'dot' as const, color: 'warning' as const, badgeContent: 1 } : {})}>
            <NotificationsNoneOutlinedIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 400, maxWidth: 'calc(100vw - 16px)', maxHeight: '75vh' } } }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1.25 }}>
          <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 600 }}>Notifications</Typography>
          <Button size="small" disabled={!unread} onClick={markAllRead}>Mark all read</Button>
        </Stack>
        <Divider />

        {prompt && (
          <Alert severity={prompt.severity} data-push-prompt={prompt.kind}
            icon={<NotificationsOffOutlinedIcon fontSize="small" />} sx={{ m: 1.5, mb: 0.5 }}>
            {prompt.text}
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              {prompt.canEnable && (
                <Button variant="contained" size="small" disableElevation disabled={push.busy} onClick={push.enable}>
                  {stopped ? 'Turn back on' : 'Turn on'}
                </Button>
              )}
              {/* A device that stopped is worth saying every time; an offer is not. */}
              {!stopped && <Button size="small" color="inherit" onClick={snooze}>Not now</Button>}
            </Stack>
          </Alert>
        )}
        {push.error && (
          <Alert severity="warning" onClose={push.clearError} sx={{ m: 1.5, mb: 0.5 }}>{push.error}</Alert>
        )}

        {!items.length && (
          <Typography variant="body2" sx={{ color: 'text.secondary', p: 3, textAlign: 'center' }}>
            Nothing yet. You'll hear about issues you're assigned, mentioned on or watching.
          </Typography>
        )}
        <List disablePadding aria-label="Notification list">
          {items.map((n) => {
            const actor = profileById(n.actor_id)
            const quote = quotesComment(n.kind) ? excerpt(n.comment?.body, 120) : ''
            return (
              <ListItemButton key={n.id} onClick={() => open(n)} sx={{ alignItems: 'flex-start', gap: 1.5, py: 1.25,
                bgcolor: n.read_at ? undefined : 'action.hover' }}>
                {actor ? (
                  <PersonAvatar person={actor} size={32} />
                ) : (
                  <Avatar sx={{ width: 32, height: 32, bgcolor: 'action.selected', color: 'text.secondary' }}>
                    <NotificationsActiveOutlinedIcon sx={{ fontSize: 18 }} />
                  </Avatar>
                )}
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: n.read_at ? 400 : 600 }}>
                    {notificationSentence(n.kind, n.detail, actor?.full_name ?? null)}
                  </Typography>
                  {n.issue && (
                    <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                      {n.issue.key} · {n.issue.title}
                    </Typography>
                  )}
                  {quote && (
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                      “{quote}”
                    </Typography>
                  )}
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{timeAgo(n.created_at)}</Typography>
                </Box>
                {!n.read_at && <Box aria-label="Unread" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mt: 1, flexShrink: 0 }} />}
              </ListItemButton>
            )
          })}
        </List>
      </Popover>
    </>
  )
}
