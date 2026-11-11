import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
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
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { nowIso, timeAgo } from '../lib/constants'
import type { Notification } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { PersonAvatar } from './common'

type Row = Notification & { issue: { key: string; title: string } | null }

const SELECT = '*, issue:issues(key, title)'

function sentence(n: Row, actor: string) {
  switch (n.kind) {
    case 'assigned':
      return `${actor} assigned you`
    case 'mentioned':
      return `${actor} mentioned you`
    case 'commented':
      return `${actor} commented`
    case 'status_changed':
      return `${actor} moved it to ${n.detail ?? 'a new status'}`
  }
}

export default function NotificationsBell() {
  const me = useMe()
  const { profileById } = useWorkspace()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [rows, setRows] = useState<Row[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('notifications').select(SELECT)
      .eq('recipient_id', me.id).order('created_at', { ascending: false }).limit(40)
    setRows((data ?? []) as unknown as Row[])
  }, [me.id])

  useEffect(() => {
    load()
    // New ones arrive live; RLS means only your own are sent.
    const channel = supabase
      .channel(`notifications:${me.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${me.id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, me.id])

  const unread = rows.filter((r) => !r.read_at)

  async function open(n: Row) {
    setAnchor(null)
    if (!n.read_at) {
      const now = nowIso()
      setRows((rs) => rs.map((r) => (r.id === n.id ? { ...r, read_at: now } : r)))
      await supabase.from('notifications').update({ read_at: now }).eq('id', n.id)
    }
    if (n.issue) navigate({ search: `?issue=${n.issue.key}` })
  }

  async function markAllRead() {
    const now = nowIso()
    setRows((rs) => rs.map((r) => ({ ...r, read_at: r.read_at ?? now })))
    await supabase.from('notifications').update({ read_at: now }).eq('recipient_id', me.id).is('read_at', null)
  }

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton aria-label={`Notifications${unread.length ? ` (${unread.length} unread)` : ''}`} onClick={(e) => setAnchor(e.currentTarget)}>
          <Badge badgeContent={unread.length} color="error" max={99}>
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
        slotProps={{ paper: { sx: { width: 380, maxWidth: 'calc(100vw - 16px)', maxHeight: '70vh' } } }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1.25 }}>
          <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 600 }}>Notifications</Typography>
          <Button size="small" disabled={!unread.length} onClick={markAllRead}>Mark all read</Button>
        </Stack>
        <Divider />
        {!rows.length && (
          <Typography variant="body2" sx={{ color: 'text.secondary', p: 3, textAlign: 'center' }}>
            Nothing yet. You'll hear about issues you're assigned, mentioned on or watching.
          </Typography>
        )}
        <List disablePadding>
          {rows.map((n) => {
            const actor = profileById(n.actor_id)
            return (
              <ListItemButton key={n.id} onClick={() => open(n)} sx={{ alignItems: 'flex-start', gap: 1.5, py: 1.25,
                bgcolor: n.read_at ? undefined : 'action.hover' }}>
                <PersonAvatar person={actor} size={32} />
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2">{sentence(n, actor?.full_name ?? 'Someone')}</Typography>
                  {n.issue && (
                    <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                      {n.issue.key} · {n.issue.title}
                    </Typography>
                  )}
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{timeAgo(n.created_at)}</Typography>
                </Box>
                {!n.read_at && <Box aria-label="Unread" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mt: 1 }} />}
              </ListItemButton>
            )
          })}
        </List>
      </Popover>
    </>
  )
}
