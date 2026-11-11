// "An issue changed": the issue dialog and the create dialog announce what
// they wrote, so whatever page is underneath (board, backlog, list) reloads
// without knowing who changed it. Other people's changes arrive through
// Supabase Realtime on the pages that listen for them.
import { useEffect, useRef } from 'react'

type Listener = (issueId: string | null) => void
const listeners = new Set<Listener>()

export function emitIssueChange(issueId: string | null = null) {
  for (const l of listeners) l(issueId)
}

export function useIssueChanges(onChange: Listener) {
  const ref = useRef(onChange)
  useEffect(() => {
    ref.current = onChange
  })
  useEffect(() => {
    const l: Listener = (id) => ref.current(id)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
}
