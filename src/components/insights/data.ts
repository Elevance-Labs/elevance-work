// The queries more than one widget asks, under one key each so they run once
// (see useWidgetQuery). Every query is narrow: a project, a window, the
// columns needed. Long lists are paged and long `in` filters chunked.
import { supabase } from '../../lib/supabase'
import { addDays } from '../../lib/constants'
import { fetchAll, fetchByIds } from '../../lib/paging'
import { groupEvents, workItems, type EventsByIssue } from '../../lib/insights'
import type { Issue, IssueEvent, IssueType, SprintIssue } from '../../lib/types'
import { must } from './useWidgetQuery'

/** What the widgets read about an issue (no description, custom values or labels). */
export const INSIGHT_COLUMNS =
  'id, project_id, number, key, type_id, status_id, title, priority, assignee_id, parent_id, sprint_id, release_id, ' +
  'story_points, start_date, due_date, resolved_at, created_at, flag_reason'

/** The rows widgets read: Issue's shape, minus what INSIGHT_COLUMNS leaves out. */
export const asIssues = (rows: unknown) => (rows ?? []) as Issue[]

const startOf = (day: string) => new Date(`${day}T00:00:00`).toISOString()

/** Status moves of these issues, at or after an instant if given. */
export async function statusEvents(issueIds: string[], since?: string): Promise<EventsByIssue> {
  if (!issueIds.length) return new Map()
  const rows = must(await fetchByIds<IssueEvent>(issueIds, (ids, from, to) => {
    let q = supabase.from('issue_events').select('id, issue_id, field, from_id, to_id, created_at').eq('field', 'status').in('issue_id', ids)
    if (since) q = q.gte('created_at', since)
    return q.order('id').range(from, to)
  }))
  return groupEvents(rows)
}

export interface RecentWork {
  // Issues of every level resolved in the window, and their status moves.
  resolved: Issue[]
  byIssue: EventsByIssue
}

/** The last twelve weeks' finished work: cycle times, throughput and the release forecast. */
export const RECENT_WEEKS = 12

export const recentWorkKey = (projectId: string, today: string) => `${projectId}:recent:${today}`

export async function loadRecentWork(projectId: string, today: string): Promise<RecentWork> {
  const since = startOf(addDays(today, -(RECENT_WEEKS * 7 - 1)))
  const resolved = asIssues(must(await fetchAll((from, to) =>
    supabase.from('issues').select(INSIGHT_COLUMNS).eq('project_id', projectId).gte('resolved_at', since).order('id').range(from, to))))
  return { resolved, byIssue: await statusEvents(resolved.map((i) => i.id)) }
}

/** Open issues blocking these ones (`blocks` links from an unresolved issue), as keys per blocked issue. */
export async function openBlockers(issueIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!issueIds.length) return out
  const links = must(await fetchByIds<{ id: string; source_id: string; target_id: string }>(issueIds, (ids, from, to) =>
    supabase.from('issue_links').select('id, source_id, target_id').eq('kind', 'blocks').in('target_id', ids).order('id').range(from, to)))
  if (!links.length) return out
  const blockers = must(await fetchByIds<{ id: string; key: string; resolved_at: string | null }>(links.map((l) => l.source_id), (ids, from, to) =>
    supabase.from('issues').select('id, key, resolved_at').in('id', ids).order('id').range(from, to)))
  const open = new Map(blockers.filter((b) => !b.resolved_at).map((b) => [b.id, b.key]))
  for (const l of links) {
    const key = open.get(l.source_id)
    if (key) out.set(l.target_id, [...(out.get(l.target_id) ?? []), key])
  }
  return out
}

/** Resolved work items in a period (null: all time), with what judging and timing them needs. */
export async function loadFinished(projectId: string, period: { from: string; to: string } | null, types: IssueType[]) {
  const rows = asIssues(must(await fetchAll((f, t) => {
    let q = supabase.from('issues').select(INSIGHT_COLUMNS).eq('project_id', projectId).not('resolved_at', 'is', null)
    if (period) q = q.gte('resolved_at', new Date(`${period.from}T00:00:00`).toISOString()).lte('resolved_at', new Date(`${period.to}T23:59:59.999`).toISOString())
    return q.order('id').range(f, t)
  })))
  const items = workItems(rows, types)
  const ids = items.map((i) => i.id)
  const [sprintRows, byIssue] = await Promise.all([
    ids.length
      ? fetchByIds<SprintIssue>(ids, (group, f, t) => supabase.from('sprint_issues').select('*').in('issue_id', group).order('sprint_id').range(f, t))
      : Promise.resolve({ data: [] as SprintIssue[], error: null }),
    statusEvents(ids),
  ])
  return { items, sprintRows: must(sprintRows), byIssue }
}
