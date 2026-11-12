import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { detectDevice, isStandalone } from '../lib/install'
import { deviceLabel, pushStatus, subscriptionKeys, vapidKeyBytes, type PushStatus } from '../lib/push'
import { pushEnvironment, subscribePush, unsubscribePush } from '../pwa'

/** The app's VAPID public key: the same value as push-send's VAPID_PUBLIC_KEY. */
const VAPID_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? ''

// Who last had notifications on in this browser (their profile id). Tells
// "never turned on" from "stopped" (permission revoked, the device removed
// elsewhere, the push service dropping it), and only for that person.
const WAS_ON_KEY = 'el-work:push-on'
const readWasOn = () => {
  try {
    return window.localStorage.getItem(WAS_ON_KEY)
  } catch {
    return null
  }
}
const writeWasOn = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(WAS_ON_KEY, id)
    else window.localStorage.removeItem(WAS_ON_KEY)
  } catch {
    // This visit only.
  }
}

const standaloneNow = () =>
  isStandalone((q) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches,
    (navigator as Navigator & { standalone?: boolean }).standalone)
const thisDevice = () => detectDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)

/**
 * Hands this browser's subscription to the database. Turning on registers it
 * as the signed-in person's; a check (`refreshOnly`) never registers anything,
 * only refreshes a registration that is still theirs. Resolves to whether the
 * device gets their notifications.
 */
async function save(subscription: PushSubscription, refreshOnly = false) {
  const keys = subscriptionKeys(subscription)
  if (!keys) throw new Error('The browser returned an incomplete subscription.')
  const { data, error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: keys.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
    p_device: deviceLabel(thisDevice(), standaloneNow()), p_refresh_only: refreshOnly,
  })
  if (error) throw new Error(error.message)
  return data === true
}

/**
 * Signing out: this device stops getting the person's notifications. The row
 * goes, and the browser's subscription with it, so whoever signs in next on a
 * shared machine starts with nothing. Never holds up the sign-out for long.
 */
export async function forgetPushDevice() {
  writeWasOn(null)
  if (!VAPID_KEY) return
  const work = (async () => {
    const { subscription } = await pushEnvironment()
    if (!subscription) return
    await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
    await unsubscribePush()
  })().catch(() => {})
  await Promise.race([work, new Promise((r) => setTimeout(r, 2000))])
}

/**
 * Notifications on this device: whether it really gets them, and turning them
 * on, off, or testing them. Used by the bell and the notification settings.
 *
 * "On" is checked, not assumed: the browser must be subscribed with permission
 * granted, *and* the server must still have this device as yours. Checked when
 * mounted, whenever the app comes back to the front, when the browser's
 * permission changes, and on `refresh()` (the bell opening), so a device that
 * stopped getting them shows as off, and `wasOn` says it used to.
 */
export default function usePushDevice(profileId: string) {
  const device = useMemo(() => thisDevice(), [])
  const [status, setStatus] = useState<PushStatus | 'loading'>('loading')
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [wasOn, setWasOn] = useState(() => readWasOn() === profileId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const env = await pushEnvironment()
    let registered = false
    if (VAPID_KEY && env.subscription && env.permission === 'granted') {
      registered = await save(env.subscription, true).catch(() => false)
    }
    const next = pushStatus({
      vapidKey: VAPID_KEY, device, standalone: standaloneNow(),
      subscribed: !!env.subscription, registered, ...env,
    })
    if (next === 'on') writeWasOn(profileId)
    setWasOn(readWasOn() === profileId)
    setEndpoint(env.subscription?.endpoint ?? null)
    setStatus(next)
    return next
  }, [device, profileId])

  useEffect(() => {
    refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    // The browser says when its permission changes (Chrome, Edge, Firefox);
    // elsewhere, coming back to the front catches it.
    let permission: PermissionStatus | null = null
    navigator.permissions?.query?.({ name: 'notifications' })
      .then((p) => {
        permission = p
        p.onchange = () => refresh()
      })
      .catch(() => {})
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (permission) permission.onchange = null
    }
  }, [refresh])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const enable = () => run(async () => save(await subscribePush(vapidKeyBytes(VAPID_KEY))))

  // Turned off on purpose: not "stopped", so nothing nags about it.
  const disable = () => run(async () => {
    writeWasOn(null)
    const gone = await unsubscribePush()
    if (gone) {
      const { error: e } = await supabase.from('push_subscriptions').delete().eq('endpoint', gone)
      if (e) throw new Error(e.message)
    }
  })

  const test = () => run(async () => {
    const { error: e } = await supabase.rpc('send_test_notification')
    if (e) throw new Error(e.message)
  })

  return { status, wasOn, endpoint, device, busy, error, refresh, enable, disable, test, clearError: () => setError('') }
}

export type PushDevice = ReturnType<typeof usePushDevice>
