// Each Summary widget loads its own data, so one slow or failing query holds
// up nothing else. Results are kept per key for the session: a widget that
// remounts shows what it had while it refreshes, and two widgets asking for
// the same key (the recent finished work, say) share one request.
// `invalidateWidgets` marks a project's results stale after a change; only
// the widgets on screen fetch again, the rest when they next appear.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { errorMessage } from '../../lib/constants'

interface Entry {
  data?: unknown
  error?: string
  loading?: Promise<void>
  stale?: boolean
}

const store = new Map<string, Entry>()
const listeners = new Set<() => void>()
let version = 0

function notify() {
  version++
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function start(key: string, loader: () => Promise<unknown>) {
  const entry = store.get(key) ?? {}
  if (entry.loading) return
  store.set(key, entry)
  entry.loading = loader().then(
    (data) => {
      entry.data = data
      entry.error = undefined
    },
    (e: unknown) => {
      entry.error = e instanceof Error ? e.message : errorMessage(e as { message: string })
    },
  ).finally(() => {
    entry.loading = undefined
    entry.stale = false
    // Dropped while in flight (a retry, or a cache clear): don't resurrect it.
    if (store.get(key) === entry) notify()
  })
}

/** A Supabase answer's rows, or a thrown error the widget shows. */
export function must<T>(result: { data: T | null; error: { code?: string; message: string } | null }): T {
  if (result.error) throw new Error(errorMessage(result.error))
  return result.data as T
}

export interface WidgetQuery<T> {
  data: T | undefined
  error: string | null
  // Nothing to show yet (a refresh keeps showing the last answer).
  loading: boolean
  retry: () => void
}

/** Load once per key (include every parameter in it); null waits. */
export function useWidgetQuery<T>(key: string | null, loader: () => Promise<T>): WidgetQuery<T> {
  useSyncExternalStore(subscribe, () => version)
  const latest = useRef(loader)
  useEffect(() => {
    latest.current = loader
  })
  useEffect(() => {
    if (!key) return
    const entry = store.get(key)
    if (!entry || (entry.stale && !entry.loading)) start(key, () => latest.current())
  })
  const entry = key ? store.get(key) : undefined
  return {
    data: entry?.data as T | undefined,
    error: entry?.error ?? null,
    loading: !entry || (entry.data === undefined && !entry.error),
    retry: () => {
      if (!key) return
      store.delete(key)
      notify()
    },
  }
}

/** A project's widget data is out of date: refetch what is on screen. */
export function invalidateWidgets(projectId: string) {
  for (const [key, entry] of store) if (key.startsWith(`${projectId}:`)) entry.stale = true
  notify()
}

/** Forget everything (between tests). */
export function clearWidgetCache() {
  store.clear()
  notify()
}
