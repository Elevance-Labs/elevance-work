import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { nowIso } from '../lib/constants'
import { badgeCount, unreadCount } from '../lib/notifications'
import type { Notification } from '../lib/types'
import { onWorkerMessage, setAppBadge } from '../pwa'

export type NotificationRow = Notification & {
  issue: { key: string; title: string } | null
  comment: { body: string } | null
}

/** How many of the latest the bell holds. Older ones stay in the table. */
const FEED_SIZE = 40

// The issue and comment come along so the bell can name the issue and quote
// the comment without a second round trip.
const SELECT = '*, issue:issues(key, title), comment:comments(body)'

interface NotificationsState {
  items: NotificationRow[]
  unread: number
  reload: () => Promise<void>
  markRead: (ids: string[]) => Promise<void>
  markIssueRead: (issueId: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const noop = async () => {}
// Outside a provider (a component rendered on its own in a test) everything
// is a harmless no-op.
const NotificationsContext = createContext<NotificationsState>({
  items: [], unread: 0, reload: noop, markRead: noop, markIssueRead: noop, markAllRead: noop,
})
export function useNotifications() {
  return useContext(NotificationsContext)
}

/**
 * Your notifications, for the bell and for whatever marks them read.
 *
 * Live: rows arrive over Supabase Realtime as the triggers write them (RLS
 * sends each person only their own), and again whenever a push lands or the
 * app comes back to the front, since a phone asleep in a pocket misses
 * Realtime messages and the push is what woke it. The unread count is also
 * the badge on an installed app's icon.
 *
 * Opening an issue marks its notifications read (`markIssueRead`, called by
 * the issue view): having looked is what reading one means.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const me = useMe()
  const [items, setItems] = useState<NotificationRow[]>([])
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)

  const reload = useCallback(async () => {
    const { data } = await supabase.from('notifications').select(SELECT)
      .eq('recipient_id', me.id).order('created_at', { ascending: false }).limit(FEED_SIZE)
    setItems((data ?? []) as unknown as NotificationRow[])
  }, [me.id])

  // A burst of rows (a comment reaching five watchers) is one reload.
  const soon = useCallback(() => {
    clearTimeout(pending.current)
    pending.current = setTimeout(reload, 250)
  }, [reload])

  useEffect(() => {
    reload()
    const channel = supabase
      .channel(`notifications:${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${me.id}` }, soon)
      .subscribe()
    const offWorker = onWorkerMessage((m) => {
      if (m.type === 'push') soon()
    })
    const onVisible = () => {
      if (document.visibilityState === 'visible') soon()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(pending.current)
      supabase.removeChannel(channel)
      offWorker()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [me.id, reload, soon])

  const unread = unreadCount(items)
  useEffect(() => {
    setAppBadge(badgeCount(unread))
  }, [unread])

  /** Marks these read: on screen at once, then in the table. */
  const markRead = useCallback(async (ids: string[]) => {
    const list = ids.filter(Boolean)
    if (!list.length) return
    const now = nowIso()
    setItems((rows) => rows.map((r) => (list.includes(r.id) && !r.read_at ? { ...r, read_at: now } : r)))
    await supabase.from('notifications').update({ read_at: now }).in('id', list)
  }, [])

  // By issue rather than by the ids on screen: older unread ones about it,
  // past the end of the feed, are just as read. Writes only when the feed
  // holds something unread about it, so opening an issue costs nothing else.
  // New ones arriving while the issue is open are read as well: it is on
  // screen.
  const markIssueRead = useCallback(async (issueId: string) => {
    if (!items.some((r) => r.issue_id === issueId && !r.read_at)) return
    const now = nowIso()
    setItems((rows) => rows.map((r) => (r.issue_id === issueId && !r.read_at ? { ...r, read_at: now } : r)))
    await supabase.from('notifications').update({ read_at: now })
      .eq('recipient_id', me.id).eq('issue_id', issueId).is('read_at', null)
  }, [items, me.id])

  const markAllRead = useCallback(async () => {
    const now = nowIso()
    setItems((rows) => rows.map((r) => (r.read_at ? r : { ...r, read_at: now })))
    await supabase.from('notifications').update({ read_at: now }).eq('recipient_id', me.id).is('read_at', null)
  }, [me.id])

  const value = useMemo(
    () => ({ items, unread, reload, markRead, markIssueRead, markAllRead }),
    [items, unread, reload, markRead, markIssueRead, markAllRead],
  )
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}
