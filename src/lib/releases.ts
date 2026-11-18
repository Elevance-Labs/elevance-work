// Release progress, approval, and release notes: what shipped, grouped by
// kind of work, as a draft to write the notes from, and the written notes as
// text to paste or a Google Doc.
import { daysBetween, formatDate, isoDate, todayIso } from './constants'
import { sanitizeHtml } from './richText'
import type { Issue, IssueType, ProjectStatus, Release, ReleaseApprover } from './types'

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

/** How close a release is: its days left in words, and how loudly to say it. */
export interface ReleaseCountdown {
  text: string
  tone: 'overdue' | 'soon' | 'later' | 'done'
}

/** Days left to an unreleased release's date ("9 days left", "Due today", "2 days late"); null without a date or once archived. */
export function releaseCountdown(release: Release, today = todayIso()): ReleaseCountdown | null {
  if (release.status === 'archived') return null
  if (release.status === 'released') {
    return { text: release.released_at ? `Released ${formatDate(isoDate(new Date(release.released_at)), false)}` : 'Released', tone: 'done' }
  }
  if (!release.release_date) return null
  const days = daysBetween(today, release.release_date)
  const on = formatDate(release.release_date, false)
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} late (due ${on})`, tone: 'overdue' }
  if (days === 0) return { text: `Due today (${on})`, tone: 'soon' }
  return { text: `${days} day${days === 1 ? '' : 's'} left (${on})`, tone: days <= 3 ? 'soon' : 'later' }
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

/** A first draft of the notes from what is done: a heading and a list per kind of work. */
export function draftNotesHtml(sections: NotesSection[]) {
  return sections.map((s) => `<h2>${escape(s.title)}</h2><ul>${s.issues.map((i) => `<li><p>${escape(i.key)} ${escape(i.title)}</p></li>`).join('')}</ul>`)
    .join('')
}

const notesHead = (projectName: string, release: Release) => `${projectName} ${release.name} — ${formatDate(release.release_date)}`

/** Rich text as plain text that keeps its shape: a line per paragraph or heading, bullets and numbers for lists. */
export function htmlToPlainText(html: string) {
  const root = document.createElement('div')
  root.innerHTML = sanitizeHtml(html)
  const lines: string[] = []
  const inline = (n: Node): string => (n.nodeType === Node.TEXT_NODE ? n.textContent ?? ''
    : n.nodeName === 'BR' ? '\n' : [...n.childNodes].map(inline).join(''))
  const walk = (el: Element, prefix = '') => {
    for (const child of [...el.children]) {
      const tag = child.tagName
      if (tag === 'UL' || tag === 'OL') {
        ;[...child.children].forEach((li, i) => {
          const mark = `${prefix}${tag === 'OL' ? `${i + 1}.` : '•'} `
          const own = [...li.childNodes].filter((c) => !(c instanceof Element && (c.tagName === 'UL' || c.tagName === 'OL')))
          lines.push(mark + own.map(inline).join(' ').replace(/[ \t]+/g, ' ').trim())
          walk(li, `${prefix}  `)
        })
        if (!prefix) lines.push('')
      } else if (tag === 'TABLE') {
        for (const tr of child.querySelectorAll('tr')) lines.push([...tr.children].map((c) => inline(c).trim()).join(' | '))
        lines.push('')
      } else if (!prefix) {
        const text = inline(child).replace(/[ \t]+/g, ' ').trim()
        if (text) lines.push(text, ...(tag === 'H2' || tag === 'H3' ? [] : ['']))
      }
    }
  }
  walk(root)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** The written notes as plain text (to paste in Chat or an email) and as HTML (for a Google Doc). */
export function notesText(projectName: string, release: Release) {
  return [notesHead(projectName, release), '', htmlToPlainText(release.notes)].join('\n').trim()
}

export function notesHtml(projectName: string, release: Release) {
  return `<h1>${escape(notesHead(projectName, release))}</h1>${sanitizeHtml(release.notes)}`
}

// ---------------------------------------------------------------------------
// Approval (mirrors release_cleared / release_approved in the schema)
// ---------------------------------------------------------------------------

/** Why a locked release's details, notes and approvers don't change. */
export const LOCKED_HINT = 'Approved and locked. Ask for approval again to change it.'

export type ApprovalState = 'none' | 'pending' | 'approved' | 'rejected'

export interface ReleaseApproval {
  state: ApprovalState
  total: number
  approved: number
  rejected: number
  pending: number
  /** Nothing stands in the way of releasing: every approver approved, or there are none. */
  cleared: boolean
  /** Approved by everyone and not yet released: details, notes and approvers don't change. */
  locked: boolean
}

export function releaseApproval(release: Pick<Release, 'status'>, approvers: Pick<ReleaseApprover, 'decision'>[]): ReleaseApproval {
  const approved = approvers.filter((a) => a.decision === 'approved').length
  const rejected = approvers.filter((a) => a.decision === 'rejected').length
  const total = approvers.length
  const state: ApprovalState = !total ? 'none' : rejected ? 'rejected' : approved < total ? 'pending' : 'approved'
  return {
    state, total, approved, rejected, pending: total - approved - rejected,
    cleared: approved === total,
    locked: release.status === 'unreleased' && state === 'approved',
  }
}

/** The approval in a few words, for a chip. */
export function approvalLabel(a: ReleaseApproval) {
  switch (a.state) {
    case 'none':
      return 'No approval needed'
    case 'pending':
      return `Awaiting approval (${a.approved} of ${a.total})`
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
  }
}

export const APPROVAL_COLORS: Record<ApprovalState, 'default' | 'warning' | 'success' | 'error'> = {
  none: 'default',
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
}
