// Release progress and release notes: what shipped, grouped by kind of work.
import { formatDate } from './constants'
import type { Issue, IssueType, ProjectStatus, Release } from './types'

export interface ReleaseProgress {
  total: number
  done: number
  inProgress: number
  todo: number
}

export function releaseProgress(issues: Issue[], statuses: ProjectStatus[]): ReleaseProgress {
  const cat = new Map(statuses.map((s) => [s.id, s.category]))
  const of = (c: string) => issues.filter((i) => cat.get(i.status_id) === c).length
  return { total: issues.length, done: of('done'), inProgress: of('in_progress'), todo: of('todo') }
}

// Bugs read as fixes; everything else by its type's name, in this order.
const SECTION_ORDER = ['Epic', 'Story', 'Feature', 'Improvement', 'Task', 'Bug']

export interface NotesSection {
  title: string
  issues: Issue[]
}

/** The release's done issues by type (sub-tasks roll into their parents), unfinished ones last. */
export function releaseNotes(issues: Issue[], types: IssueType[], statuses: ProjectStatus[]) {
  const cat = new Map(statuses.map((s) => [s.id, s.category]))
  const typeOf = new Map(types.map((t) => [t.id, t]))
  const shipped = issues.filter((i) => cat.get(i.status_id) === 'done' && typeOf.get(i.type_id)?.level !== 'subtask')
  const names = [...new Set(shipped.map((i) => typeOf.get(i.type_id)?.name ?? 'Other'))]
    .sort((a, b) => (SECTION_ORDER.indexOf(a) + 1 || 99) - (SECTION_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b))
  const sections: NotesSection[] = names.map((name) => ({
    title: name === 'Bug' ? 'Bug fixes' : name === 'Story' ? 'New and changed' : `${name}s`,
    issues: shipped.filter((i) => (typeOf.get(i.type_id)?.name ?? 'Other') === name).sort((a, b) => a.number - b.number),
  }))
  const unfinished = issues.filter((i) => cat.get(i.status_id) !== 'done' && typeOf.get(i.type_id)?.level !== 'subtask')
  return { sections, unfinished }
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The notes as plain text (to paste in Chat or an email) and as HTML (for a Google Doc). */
export function notesText(projectName: string, release: Release, sections: NotesSection[]) {
  const head = `${projectName} ${release.name}${release.release_date ? ` — ${formatDate(release.release_date)}` : ''}`
  const lines = [head, '', ...(release.description ? [release.description, ''] : [])]
  for (const s of sections) {
    lines.push(s.title, ...s.issues.map((i) => `• ${i.key} ${i.title}`), '')
  }
  return lines.join('\n').trim()
}

export function notesHtml(projectName: string, release: Release, sections: NotesSection[]) {
  const date = release.release_date ? ` — ${formatDate(release.release_date)}` : ''
  return [
    `<h1>${escape(projectName)} ${escape(release.name)}${escape(date)}</h1>`,
    release.description ? `<p>${escape(release.description)}</p>` : '',
    ...sections.map((s) => `<h2>${escape(s.title)}</h2><ul>${s.issues.map((i) => `<li>${escape(i.key)} ${escape(i.title)}</li>`).join('')}</ul>`),
  ].join('')
}
