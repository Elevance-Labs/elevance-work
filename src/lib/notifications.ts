/**
 * What a notification says, and counting them. Pure. The push-send function
 * (supabase/functions/push-send/message.ts) mirrors the wording, so the bell
 * and a device say the same thing; test/push.test.ts holds them together.
 */
import type { NotificationKind } from './types'

/**
 * The bell's line, and the start of a device notification's body. One save
 * tells a person one thing; `detail` is the status that save moved the issue
 * to, so an assignment or a mention made with it says that too.
 */
export function notificationSentence(kind: NotificationKind, detail: string | null, actor: string | null) {
  const who = actor || 'Someone'
  const moved = detail ? ` and moved it to ${detail}` : ''
  switch (kind) {
    case 'assigned':
      return `${who} assigned you${moved}`
    case 'mentioned':
      return `${who} mentioned you${moved}`
    case 'commented':
      return `${who} commented`
    case 'status_changed':
      return `${who} moved it to ${detail || 'a new status'}`
    case 'test':
      return 'Notifications are working on this device.'
    default:
      return 'Something changed'
  }
}

/** A comment's words (stored as HTML), flat and short. */
export function excerpt(html: string | null | undefined, max = 140) {
  const flat = String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Whether a notification quotes its comment. */
export const quotesComment = (kind: NotificationKind) => kind === 'mentioned' || kind === 'commented'

export const unreadCount = (rows: { read_at: string | null }[]) => rows.filter((r) => !r.read_at).length

/** The number an installed app's icon wears: none at zero, and capped. */
export const badgeCount = (unread: number) => Math.max(0, Math.min(unread, 99))
