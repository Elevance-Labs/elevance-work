import type { ChipProps } from '@mui/material'
import type {
  AppRole,
  ChatEvent,
  DocType,
  IssuePriority,
  LinkKind,
  ProjectKind,
  ProjectRole,
  ReleaseStatus,
  SprintState,
  StatusCategory,
  WorkspaceChatEvent,
} from './types'

export const APP_NAME = 'Elevance Work'
export const COMPANY_NAME = 'Elevance Labs'
export const COMPANY_DOMAIN = 'elevancelabs.com'
// The company's day: what "today" and all-day events go by (mirrored by
// the schema and calendar-sync).
export const COMPANY_TIME_ZONE = 'Asia/Karachi'

export const APP_ROLE_LABELS: Record<AppRole, string> = { admin: 'Workspace admin', member: 'Member' }

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

export const PROJECT_ROLE_HELP: Record<ProjectRole, string> = {
  admin: 'Everything a member can, plus settings, people, workflow and deleting issues',
  member: 'Creates and edits issues, plans sprints and releases',
  viewer: 'Reads, comments and watches',
}

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = { scrum: 'Scrum', kanban: 'Kanban' }
export const PROJECT_KIND_HELP: Record<ProjectKind, string> = {
  scrum: 'Plan work into sprints from a backlog',
  kanban: 'Work flows continuously across a board',
}

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

export const CATEGORY_COLORS: Record<StatusCategory, ChipProps['color']> = {
  todo: 'default',
  in_progress: 'info',
  done: 'success',
}

// For charts, where a chip colour isn't enough.
export const CATEGORY_HEX: Record<StatusCategory, string> = {
  todo: '#8590a2',
  in_progress: '#1d7afc',
  done: '#22a06b',
}

// Highest first, as the enum (and so ORDER BY priority) is.
export const PRIORITIES: IssuePriority[] = ['highest', 'high', 'medium', 'low', 'lowest']

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  highest: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  lowest: 'Lowest',
}

export const PRIORITY_HEX: Record<IssuePriority, string> = {
  highest: '#c9372c',
  high: '#e2483d',
  medium: '#e2b203',
  low: '#1d7afc',
  lowest: '#579dff',
}

export const SPRINT_STATE_LABELS: Record<SprintState, string> = {
  future: 'Planned',
  active: 'Active',
  closed: 'Completed',
}

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  unreleased: 'Unreleased',
  released: 'Released',
  archived: 'Archived',
}

export const RELEASE_STATUS_COLORS: Record<ReleaseStatus, ChipProps['color']> = {
  unreleased: 'info',
  released: 'success',
  archived: 'default',
}

// How a link reads from each end: ABC-1 blocks ABC-2 / ABC-2 is blocked by ABC-1.
export const LINK_LABELS: Record<LinkKind, { outward: string; inward: string }> = {
  blocks: { outward: 'blocks', inward: 'is blocked by' },
  relates: { outward: 'relates to', inward: 'relates to' },
  duplicates: { outward: 'duplicates', inward: 'is duplicated by' },
  clones: { outward: 'clones', inward: 'is cloned by' },
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  document: 'Google Doc',
  spreadsheet: 'Google Sheet',
  presentation: 'Google Slides',
  form: 'Google Form',
  drawing: 'Google Drawing',
  folder: 'Drive folder',
  file: 'Drive file',
}

export const CHAT_EVENT_LABELS: Record<ChatEvent, string> = {
  issue_created: 'An issue is created',
  status_changed: 'An issue changes status',
  issue_assigned: 'An issue is assigned',
  comment_added: 'Someone comments',
  sprint_started: 'A sprint starts',
  sprint_completed: 'A sprint is completed',
  release_released: 'A release is released',
}

export const WORKSPACE_CHAT_EVENT_LABELS: Record<WorkspaceChatEvent, string> = {
  release_released: 'Any project releases',
}

export const PROJECT_COLORS = ['#3f51b5', '#1d7afc', '#00897b', '#22a06b', '#e2b203', '#f57c00', '#e2483d', '#8f7ee7', '#6d4c41', '#455a64']

// ---------------------------------------------------------------------------
// Dates. Plain dates are `YYYY-MM-DD`, parsed as local time so they don't
// shift a day; instants are timestamptz, shown in the viewer's zone.
// ---------------------------------------------------------------------------

export function formatDate(value: string | null | undefined, withYear = true) {
  if (!value) return '—'
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}

export function formatDay(timestamp: string) {
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDayTime(timestamp: string) {
  return new Date(timestamp).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return 'No dates'
  if (!end || start === end) return formatDate(start)
  if (!start) return `Until ${formatDate(end)}`
  return `${formatDate(start, start.slice(0, 4) !== end.slice(0, 4))} – ${formatDate(end)}`
}

/** "3 minutes ago", "yesterday", "12 Mar" — for activity and notifications. */
export function timeAgo(timestamp: string, now = Date.now()) {
  const seconds = Math.round((now - new Date(timestamp).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return formatDay(timestamp)
}

/** This instant, as a timestamptz string. */
export const nowIso = () => new Date().toISOString()

/** Today as YYYY-MM-DD in the viewer's zone. */
export function todayIso(d = new Date()) {
  return isoDate(d)
}

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

export function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000)
}

export function formatPoints(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Turn a Postgres / PostgREST error into something a person can act on. */
export function errorMessage(error: { code?: string; message: string } | null | undefined, fallback = 'Something went wrong.') {
  if (!error) return fallback
  switch (error.code) {
    case '42501':
      return error.message.startsWith('permission denied') || error.message.includes('row-level security')
        ? "You don't have permission to do that."
        : error.message
    case '23505':
      return 'That name is already taken.'
    case '23503':
      return 'It is still in use, so it can’t be removed.'
    case '23514':
    case '22023':
      return error.message.includes('violates check constraint') ? 'Some of those values aren’t allowed.' : error.message
    default:
      return error.message || fallback
  }
}
