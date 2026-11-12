// Notes: their colours, the filter on the notes page (and its URL form), and
// matching loaded notes against it. Notes are private to their owner, so a
// person's whole set is loaded and filtered here, not in the query. A note
// may be pinned (the dashboard shows those) and may be about one meeting from
// your Google Calendar. A note is archived before it can be deleted: the
// archive is its own view of the same list.
import { formatDate } from './constants'
import type { Note, NoteColor, NoteLabel } from './types'

/** Sticky-note yellow first: the default, as in the schema. */
export const NOTE_COLORS: Record<NoteColor, { label: string; bg: string }> = {
  yellow: { label: 'Yellow', bg: '#fff59d' },
  orange: { label: 'Orange', bg: '#ffd8a8' },
  red: { label: 'Red', bg: '#ffc9c9' },
  pink: { label: 'Pink', bg: '#fcc2d7' },
  purple: { label: 'Purple', bg: '#e5dbff' },
  blue: { label: 'Blue', bg: '#d0ebff' },
  teal: { label: 'Teal', bg: '#c3fae8' },
  green: { label: 'Green', bg: '#d3f9d8' },
  gray: { label: 'Gray', bg: '#e9ecef' },
  white: { label: 'White', bg: '#ffffff' },
}
export const NOTE_COLOR_KEYS = Object.keys(NOTE_COLORS) as NoteColor[]
export const DEFAULT_NOTE_COLOR: NoteColor = 'yellow'

export const NOTE_COLUMNS = '*'
export type NoteRow = Note

/** "Standup · Oct 21": the meeting a note is about. */
export function meetingLabel(note: Pick<Note, 'meeting_title' | 'meeting_on'>) {
  const title = note.meeting_title || 'A meeting'
  return note.meeting_on ? `${title} · ${formatDate(note.meeting_on, false)}` : title
}

/** The heading a note shows: its title, else its first line. */
export function noteHeading(note: Pick<Note, 'title' | 'body'>) {
  return note.title.trim() || note.body.trim().split('\n')[0].slice(0, 80)
}

export interface NoteFilter {
  text: string
  // A label's id, 'none' for notes without one, or '' for any.
  label: string
  color: NoteColor | ''
  // A project's id, or '' for any.
  project: string
  // The archive instead of the current notes.
  archived: boolean
}

export const EMPTY_NOTE_FILTER: NoteFilter = { text: '', label: '', color: '', project: '', archived: false }

export function noteFilterFromParams(params: URLSearchParams): NoteFilter {
  const color = params.get('color') ?? ''
  return {
    text: params.get('q') ?? '',
    label: params.get('label') ?? '',
    color: (NOTE_COLOR_KEYS as string[]).includes(color) ? (color as NoteColor) : '',
    project: params.get('project') ?? '',
    archived: params.get('archived') === '1',
  }
}

export function noteFilterToParams(filter: NoteFilter) {
  const params = new URLSearchParams()
  if (filter.text) params.set('q', filter.text)
  if (filter.label) params.set('label', filter.label)
  if (filter.color) params.set('color', filter.color)
  if (filter.project) params.set('project', filter.project)
  if (filter.archived) params.set('archived', '1')
  return params
}

/** Nothing narrows the view (current or archived) it is on. */
export const isNoteFilterEmpty = (f: NoteFilter) => !f.text.trim() && !f.label && !f.color && !f.project

/**
 * Does this note pass the filter? Every word of the search must appear in
 * its title, text, labels, project or meeting, ignoring case.
 */
export function matchesNote(
  note: NoteRow,
  filter: NoteFilter,
  ctx: { labels: Map<string, NoteLabel>; projectName: (id: string | null) => string | undefined },
) {
  if (!!note.archived_at !== filter.archived) return false
  if (filter.color && note.color !== filter.color) return false
  if (filter.project && note.project_id !== filter.project) return false
  const labelNames = note.label_ids.map((id) => ctx.labels.get(id)?.name).filter((n): n is string => !!n)
  if (filter.label === 'none' && labelNames.length) return false
  if (filter.label && filter.label !== 'none' && !note.label_ids.includes(filter.label)) return false
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = [note.title, note.body, ...labelNames, ctx.projectName(note.project_id) ?? '', note.meeting_title ?? '']
    .join('\n')
    .toLowerCase()
  return words.every((w) => haystack.includes(w))
}

/** Most recently edited first. */
export const byRecentEdit = (a: Note, b: Note) => b.updated_at.localeCompare(a.updated_at) || b.created_at.localeCompare(a.created_at)

/** Pinned first, then most recently edited. */
export const byPinnedThenRecent = (a: Note, b: Note) => Number(b.pinned) - Number(a.pinned) || byRecentEdit(a, b)
