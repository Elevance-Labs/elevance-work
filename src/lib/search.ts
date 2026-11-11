// Search (Cmd/Ctrl+S) and its keyboard shortcuts. Issues are searched by the
// database; your todos and notes are loaded once when search opens (they are
// a person's own) and matched here.
import { noteHeading } from './notes'
import type { Note, Todo } from './types'

/** At most this many results in each group. */
export const SEARCH_LIMIT = 5

const wordsOf = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)

/** Every word of the query appears somewhere in the texts, ignoring case. */
export function matchesWords(q: string, ...texts: (string | null | undefined)[]) {
  const words = wordsOf(q)
  if (!words.length) return false
  const hay = texts.filter(Boolean).join('\n').toLowerCase()
  return words.every((w) => hay.includes(w))
}

// A title that starts with the query comes before one that merely contains it.
const startsFirst = (q: string, title: string) => (title.toLowerCase().startsWith(q.trim().toLowerCase()) ? 0 : 1)

/** Open todos first (soonest due), then done ones (latest first). */
export function searchTodos<T extends Pick<Todo, 'title' | 'notes' | 'due_on' | 'done_at' | 'position'>>(todos: T[], q: string, limit = SEARCH_LIMIT) {
  return todos
    .filter((t) => matchesWords(q, t.title, t.notes))
    .sort((a, b) =>
      Number(!!a.done_at) - Number(!!b.done_at) ||
      startsFirst(q, a.title) - startsFirst(q, b.title) ||
      (a.done_at ? (b.done_at ?? '').localeCompare(a.done_at) : (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999')) ||
      a.position - b.position)
    .slice(0, limit)
}

/** By title and text, most recently edited first. */
export function searchNotes<T extends Pick<Note, 'title' | 'body' | 'updated_at'>>(notes: T[], q: string, limit = SEARCH_LIMIT) {
  return notes
    .filter((n) => matchesWords(q, n.title, n.body))
    .sort((a, b) => startsFirst(q, noteHeading(a)) - startsFirst(q, noteHeading(b)) || b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit)
}

/** Cmd on a Mac, Ctrl elsewhere. */
export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** "⌘S" on a Mac, "Ctrl+S" elsewhere. */
export const shortcutLabel = (key: string) => (isMac() ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`)

/** Is this keydown Cmd/Ctrl + key (and nothing else but Shift-free)? */
export const isShortcut = (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, key: string) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key
