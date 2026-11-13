import { useSyncExternalStore } from 'react'
import { APP_DISPLAY_MODES, isStandalone } from '../lib/install'

// Old browsers have no media queries from script: a browser tab, then.
const media = (query: string) => (typeof window.matchMedia === 'function' ? window.matchMedia(query) : null)

const subscribeDisplayMode = (onChange: () => void) => {
  // Desktop Chrome and Edge can move a tab into an app window while it is open.
  const lists = APP_DISPLAY_MODES.map((mode) => media(`(display-mode: ${mode})`))
  for (const l of lists) l?.addEventListener?.('change', onChange)
  return () => {
    for (const l of lists) l?.removeEventListener?.('change', onChange)
  }
}
const standaloneNow = () =>
  isStandalone((q) => media(q)?.matches === true, (navigator as Navigator & { standalone?: boolean }).standalone)

/** Whether the app is running installed, in its own window, rather than in a browser tab. */
export function useStandalone(): boolean {
  return useSyncExternalStore(subscribeDisplayMode, standaloneNow)
}
