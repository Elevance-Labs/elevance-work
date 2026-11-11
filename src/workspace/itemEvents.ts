// "A todo or note changed": Create (Cmd/Ctrl+K) makes them from any page,
// and a meeting's note is written from its dialog, so whatever page shows
// them (the Todos, Notes and Calendar pages, the dashboard, an issue's todos)
// reads them again. Issues have their own bus, issueEvents.
import { useEffect, useRef } from 'react'

export type ItemKind = 'todo' | 'note'

type Listener = (kind: ItemKind) => void
const listeners = new Set<Listener>()

export function emitItemChange(kind: ItemKind) {
  for (const l of listeners) l(kind)
}

/** Calls onChange when one of these kinds changes. */
export function useItemChanges(kinds: ItemKind[], onChange: () => void) {
  const ref = useRef({ kinds, onChange })
  useEffect(() => {
    ref.current = { kinds, onChange }
  })
  useEffect(() => {
    const l: Listener = (kind) => ref.current.kinds.includes(kind) && ref.current.onChange()
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
}
