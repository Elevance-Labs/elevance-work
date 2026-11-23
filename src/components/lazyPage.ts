// A page loaded only when it is first shown, so the first screen parses just
// the shell and Home. Installed, the service worker already holds every chunk;
// in a tab open across a deploy, a page whose chunk the host has removed
// reloads the app once (onto the new build) rather than showing a blank page.
import { lazy, type ComponentType } from 'react'

const RELOADED = 'elevance.work.chunk-reload'

// sessionStorage can throw (a private window, blocked site data): then no reload.
function reloadOnce(): boolean {
  try {
    if (window.sessionStorage.getItem(RELOADED)) return false
    window.sessionStorage.setItem(RELOADED, '1')
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export interface LazyPage {
  Page: ComponentType
  /** Fetch and parse the page ahead of its first showing. */
  preload: () => Promise<unknown>
}

export function lazyPage(load: () => Promise<{ default: ComponentType }>): LazyPage {
  let loading: Promise<{ default: ComponentType }> | null = null
  const preload = () => {
    loading ??= load().catch((error: unknown) => {
      loading = null
      // Never settles: the page is going away.
      if (reloadOnce()) return new Promise<never>(() => {})
      throw error
    })
    return loading
  }
  return { Page: lazy(preload), preload }
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

/**
 * A few seconds after the first screen, when the browser is idle, these are
 * parsed too, so the next tap is instant. Not on the first screen's time:
 * that page's own data is loading then. Returns a cancel.
 */
export function preloadWhenIdle(pages: LazyPage[], delay = 3000): () => void {
  const w = window as IdleWindow
  let idle: number | null = null
  const run = () => {
    for (const p of pages) p.preload().catch(() => {})
  }
  const timer = window.setTimeout(() => {
    // Safari has no requestIdleCallback: then just now.
    if (w.requestIdleCallback) idle = w.requestIdleCallback(run, { timeout: 5000 })
    else run()
  }, delay)
  return () => {
    window.clearTimeout(timer)
    if (idle !== null) w.cancelIdleCallback?.(idle)
  }
}
