/**
 * Registers the service worker that vite.pwa builds, and reports when a newer
 * build is ready.
 *
 * `onUpdate(apply)` is called once a new version has been downloaded and is
 * waiting; calling `apply()` switches to it and reloads the page. Nothing is
 * ever swapped under a page that did not ask.
 *
 * Not registered in development, inside another site's frame, or when `skip`
 * says so (a public page, whose visitors are not installing anything).
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void, skip?: () => boolean) {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  if (window.top !== window.self || skip?.()) return

  let applying = false
  // The first install also takes control of the page; only a requested update
  // should reload it.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) window.location.reload()
  })

  const offer = (worker: ServiceWorker) =>
    onUpdate(() => {
      applying = true
      worker.postMessage('skip-waiting')
    })

  // Beside index.html, wherever the app is deployed: its folder is its scope.
  navigator.serviceWorker
    .register(new URL('sw.js', new URL(import.meta.env.BASE_URL, window.location.href)))
    .then((registration) => {
      // `controller` is null on a first visit: that install is not an update.
      if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting)
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker)
        })
      })
      // An installed app can stay open for days: look for a new build whenever
      // it comes back to the front.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {})
      })
    })
    .catch(() => {})
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

/** Chrome, Edge and Samsung Internet's offer to install the app (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallState {
  /** Installed during this visit (the page itself is still a browser tab). */
  installed: boolean
}

let offer: BeforeInstallPromptEvent | null = null
let state: InstallState = { installed: false }
const listeners = new Set<() => void>()
let listening = false

const setState = (next: InstallState) => {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

/**
 * Keeps the browser's install offer for the Install button, instead of the
 * browser's own banner. The offer can come as soon as the page loads, so
 * main.tsx calls this before rendering; calling it again does nothing.
 */
export function listenForInstall() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    offer = event as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    offer = null
    setState({ installed: true })
  })
}

export const installState = () => state
export function subscribeInstall(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Shows the browser's install dialog. An offer can be used once: afterwards
 * the button falls back to the steps. `null` when there was no offer to use.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | null> {
  const event = offer
  if (!event) return null
  offer = null
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    return outcome
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Notifications (Web Push)
// ---------------------------------------------------------------------------
//
// The browser's half: permission, the push subscription, the worker's
// messages and the icon's badge. Which of these to use, and what to say about
// them, is `lib/push.ts`; saving a subscription is `components/usePushDevice`.

const appBase = () => new URL(import.meta.env.BASE_URL, window.location.href).pathname

/** This app's service worker registration, or null (development, no support). */
export async function workerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    return (await navigator.serviceWorker.getRegistration(appBase())) ?? null
  } catch {
    return null
  }
}

export interface PushEnvironment {
  subscription: PushSubscription | null
  hasWorker: boolean
  hasPush: boolean
  hasNotification: boolean
  permission: NotificationPermission
}

/** What the browser offers here, for `pushStatus` in lib/push.ts. */
export async function pushEnvironment(): Promise<PushEnvironment> {
  const registration = await workerRegistration()
  const subscription = registration?.pushManager
    ? await registration.pushManager.getSubscription().catch(() => null)
    : null
  return {
    subscription,
    hasWorker: !!registration,
    hasPush: typeof window !== 'undefined' && 'PushManager' in window,
    hasNotification: typeof Notification !== 'undefined',
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
  }
}

/**
 * Asks for permission (it must come from a click) and subscribes this browser
 * with the app's VAPID key. A subscription made with another key (the key was
 * changed) is replaced. Resolves to the subscription, or throws with a reason
 * a person can read.
 */
export async function subscribePush(applicationServerKey: Uint8Array<ArrayBuffer>): Promise<PushSubscription> {
  const registration = await workerRegistration()
  if (!registration?.pushManager) throw new Error('This browser cannot receive notifications here.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? 'Notifications are blocked for this site.' : 'Notifications were not allowed.')
  }
  const options = { userVisibleOnly: true, applicationServerKey }
  try {
    return await registration.pushManager.subscribe(options)
  } catch (err) {
    const old = await registration.pushManager.getSubscription().catch(() => null)
    if (!old) throw err
    await old.unsubscribe().catch(() => {})
    return registration.pushManager.subscribe(options)
  }
}

/** Unsubscribes this browser. Resolves to the endpoint it had, or null. */
export async function unsubscribePush(): Promise<string | null> {
  const registration = await workerRegistration()
  const subscription = await registration?.pushManager?.getSubscription().catch(() => null)
  if (!subscription) return null
  const { endpoint } = subscription
  await subscription.unsubscribe().catch(() => {})
  return endpoint
}

export type WorkerMessage = { type: 'push'; id: string | null } | { type: 'open'; url: string }

/** Messages from the service worker: a push arrived, or a tapped one names a page. */
export function onWorkerMessage(handler: (message: WorkerMessage) => void) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {}
  const listener = (event: MessageEvent) => {
    if (event.data && typeof event.data === 'object') handler(event.data as WorkerMessage)
  }
  navigator.serviceWorker.addEventListener('message', listener)
  return () => navigator.serviceWorker.removeEventListener('message', listener)
}

/**
 * The router's address ("/dashboard?issue=WEB-1") for a full URL of this app
 * (the HashRouter keeps it after `#`), or null for anywhere else.
 */
export function routerPath(url: string): string | null {
  try {
    const target = new URL(url, window.location.href)
    if (target.origin !== window.location.origin || !target.pathname.startsWith(appBase())) return null
    const route = target.hash.replace(/^#/, '')
    return route.startsWith('/') ? route : '/'
  } catch {
    return null
  }
}

/** The number on an installed app's icon; nothing at zero. */
export function setAppBadge(count: number) {
  if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return
  const nav = navigator as Navigator & { setAppBadge(n: number): Promise<void>; clearAppBadge(): Promise<void> }
  ;(count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => {})
}
