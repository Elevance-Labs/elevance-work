/**
 * Notifications on a device (Web Push): whether this browser can have them,
 * what to tell the person when it cannot, and the shapes passed between the
 * browser's push subscription and the database. Pure: the browser calls are
 * in `src/pwa.ts`, the database calls in `components/usePushDevice`.
 *
 * Where it works: Chrome, Edge, Firefox and Samsung Internet on desktop and
 * Android, in a tab or installed; Safari on a Mac; and on iPhone and iPad
 * (iOS 16.4+) only once the app is on the Home Screen. Safari in a tab has no
 * push there at all.
 */
import type { Device } from './install'

/**
 *   unconfigured  this build has no VAPID key, or no service worker (development)
 *   unsupported   this browser has no Web Push
 *   install-first iPhone/iPad in a tab: add to the Home Screen first
 *   blocked       the person (or a policy) refused notifications for this site
 *   off           possible, but this device does not get them: never turned
 *                 on, or stopped (the browser's subscription is gone, or the
 *                 server no longer has this device: removed on another
 *                 device, dropped by the push service, or registered to
 *                 somebody else who used this browser since)
 *   on            this device gets them: subscribed here, permission granted,
 *                 and registered to you on the server (`registered`)
 */
export type PushStatus = 'unconfigured' | 'unsupported' | 'install-first' | 'blocked' | 'off' | 'on'

export interface PushFacts {
  vapidKey: string
  hasWorker: boolean
  hasPush: boolean
  hasNotification: boolean
  permission: NotificationPermission
  device: Device | null
  standalone: boolean
  subscribed: boolean
  registered: boolean
}

export function pushStatus(f: PushFacts): PushStatus {
  if (!f.vapidKey) return 'unconfigured'
  // iOS has the APIs only inside a Home Screen app; in a tab they are missing,
  // which is a reason to install, not a dead end.
  if (f.device?.os === 'ios' && !f.standalone) return 'install-first'
  if (!f.hasPush || !f.hasNotification) return 'unsupported'
  if (!f.hasWorker) return 'unconfigured'
  if (f.permission === 'denied') return 'blocked'
  return f.subscribed && f.registered && f.permission === 'granted' ? 'on' : 'off'
}

/** How long "Not now" keeps the bell's offer away. */
export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

export interface PushPrompt {
  kind: 'stopped' | 'off' | 'blocked' | 'install-first'
  severity: 'warning' | 'info'
  text: string
  canEnable: boolean
}

/**
 * What the bell says about this device, or null for nothing: an offer while
 * notifications are off, blocked, or need the app installed first (until
 * snoozed); and, louder, that they have *stopped* on a device that had them,
 * which no snooze hides.
 */
export function pushPrompt(
  status: PushStatus | 'loading',
  { device = null, wasOn = false, snoozedUntil = 0, now = Date.now() }:
    { device?: Device | null; wasOn?: boolean; snoozedUntil?: number; now?: number } = {},
): PushPrompt | null {
  if (wasOn && (status === 'off' || status === 'blocked')) {
    return {
      kind: 'stopped', severity: 'warning', canEnable: status === 'off',
      text: status === 'off'
        ? 'Notifications have stopped on this device. Turn them back on to keep getting them when the app is closed.'
        : `Notifications have stopped on this device. ${pushStatusText('blocked', device)}`,
    }
  }
  if (now < snoozedUntil) return null
  if (status === 'off') {
    return {
      kind: 'off', severity: 'info', canEnable: true,
      text: 'Notifications are off on this device. Turn them on to get these even when the app is closed.',
    }
  }
  if (status === 'blocked' || status === 'install-first') {
    return { kind: status, severity: status === 'blocked' ? 'warning' : 'info', canEnable: false, text: pushStatusText(status, device) }
  }
  return null
}

/** What the settings and the bell say about a status. */
export function pushStatusText(status: PushStatus | 'loading', device: Device | null) {
  switch (status) {
    case 'on':
      return 'This device gets a notification whenever something needs you.'
    case 'off':
      return 'Turn them on to hear about your issues here even when the app is closed.'
    case 'blocked':
      return device?.os === 'ios' || device?.os === 'mac'
        ? 'Notifications are blocked for this app. Allow them in System Settings → Notifications, then come back.'
        : 'Notifications are blocked for this site. Allow them from the site settings beside the address, then come back.'
    case 'install-first':
      return 'On iPhone and iPad, notifications work once the app is on your Home Screen. Add it there, open it from the Home Screen, and turn them on.'
    case 'unsupported':
      return 'This browser cannot show notifications from a web app. Chrome, Edge, Firefox and Safari can.'
    case 'loading':
      return ''
    default:
      return 'Device notifications are not set up for this installation.'
  }
}

/** A VAPID public key (base64url) as the bytes `pushManager.subscribe` wants. */
export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = String(key ?? '').trim().replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export interface SubscriptionKeys {
  endpoint: string
  p256dh: string
  auth: string
}

/** The three things the database keeps from a PushSubscription. */
export function subscriptionKeys(subscription: PushSubscription | PushSubscriptionJSON | null): SubscriptionKeys | null {
  const json: PushSubscriptionJSON | null =
    subscription && 'toJSON' in subscription && typeof subscription.toJSON === 'function'
      ? subscription.toJSON()
      : (subscription as PushSubscriptionJSON | null)
  const endpoint = json?.endpoint
  const p256dh = json?.keys?.p256dh
  const auth = json?.keys?.auth
  return endpoint && p256dh && auth ? { endpoint, p256dh, auth } : null
}

const OS_NAMES: Record<string, string> = { ios: 'iPhone or iPad', android: 'Android', mac: 'Mac', windows: 'Windows', other: '' }
const BROWSER_NAMES: Record<string, string> = {
  safari: 'Safari', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', samsung: 'Samsung Internet',
  opera: 'Opera', 'in-app': 'an app', other: '',
}

/** "Chrome on Android": how a person tells their devices apart. */
export function deviceLabel(device: Device | null, standalone = false) {
  const os = OS_NAMES[device?.os ?? 'other'] ?? ''
  const browser = standalone && device?.os === 'ios' ? 'Home Screen app' : (BROWSER_NAMES[device?.browser ?? 'other'] ?? '')
  if (browser && os) return `${browser} on ${os}`
  return browser || os || 'This device'
}
