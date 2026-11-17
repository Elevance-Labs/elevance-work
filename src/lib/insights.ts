// The Summary's judgements: will the next release ship, is the sprint on
// track, how long work takes and where it waits, who finishes on time, which
// epics are slipping, and what needs someone today. Pure functions over rows
// the widgets load; every threshold a verdict uses is here, and README.md
// says the same in words.
//
// Two shared definitions:
// - A work item is an issue at the standard level: epics are containers and
//   sub-tasks are parts of an item, so neither is counted on its own.
// - Cycle time runs from an item's first move into an in-progress status to
//   its resolution; an item that never showed as in progress counts from its
//   creation.
import { addDays, daysBetween, isoDate } from './constants'
import { timeProgress, type BurndownPoint, type Unit } from './reports'
import type { TimelineRow } from './timeline'
import type { Issue, IssueEvent, IssueType, ProjectStatus, Release, Sprint, SprintIssue, StatusCategory } from './types'

const DAY = 86_400_000
const ms = (t: string) => new Date(t).getTime()
const dayOf = (t: string) => isoDate(new Date(t))

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

/** A judgement: how it reads (tone) and what it says. */
export interface Verdict {
  tone: Tone
  label: string
}

/** Issue events per issue, oldest first: built once, read by everything below. */
export type EventsByIssue = Map<string, IssueEvent[]>

export function groupEvents(events: IssueEvent[]): EventsByIssue {
  const out: EventsByIssue = new Map()
  for (const e of events) {
    const list = out.get(e.issue_id)
    if (list) list.push(e)
    else out.set(e.issue_id, [e])
  }
  for (const list of out.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return out
}

/** The standard-level issues: what counts as a piece of work. */
export function workItems<T extends Pick<Issue, 'type_id'>>(issues: T[], types: IssueType[]): T[] {
  const standard = new Set(types.filter((t) => t.level === 'standard').map((t) => t.id))
  return issues.filter((i) => standard.has(i.type_id))
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** The value `p` (0–1) of the way up the sorted values (nearest rank). */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
}

/** A day count for people: "3.5 days", "under a day". */
export function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days < 1) return days < 1 / 24 ? 'under an hour' : `${Math.round(days * 24)} h`
  const d = Math.round(days * 10) / 10
  return `${d} day${d === 1 ? '' : 's'}`
}

// ---------------------------------------------------------------------------
// Cycle time and throughput
// ---------------------------------------------------------------------------

/** When an item started: its first move into an in-progress status, else its creation. */
export function startedAt(issue: Pick<Issue, 'id' | 'created_at'>, byIssue: EventsByIssue, statuses: ProjectStatus[]): number {
  const category = new Map(statuses.map((s) => [s.id, s.category]))
  const first = (byIssue.get(issue.id) ?? []).find((e) => e.field === 'status' && e.to_id && category.get(e.to_id) === 'in_progress')
  return ms(first?.created_at ?? issue.created_at)
}

/** Days from start to resolution, for a resolved item; null if open. */
export function cycleDays(issue: Pick<Issue, 'id' | 'created_at' | 'resolved_at'>, byIssue: EventsByIssue, statuses: ProjectStatus[]) {
  if (!issue.resolved_at) return null
  return Math.max(0, (ms(issue.resolved_at) - startedAt(issue, byIssue, statuses)) / DAY)
}

export interface FlowWeek {
  // The week's last day.
  end: string
  completed: number
  medianCycle: number | null
}

/**
 * Week by week (seven days ending today, then the seven before, …), how many
 * items were resolved and their median cycle time; oldest week first.
 */
export function flowSeries(
  resolved: Pick<Issue, 'id' | 'created_at' | 'resolved_at'>[],
  byIssue: EventsByIssue,
  statuses: ProjectStatus[],
  weeks: number,
  today: string,
): FlowWeek[] {
  const out: FlowWeek[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const end = addDays(today, -7 * w)
    const start = addDays(end, -6)
    const inWeek = resolved.filter((i) => i.resolved_at && dayOf(i.resolved_at) >= start && dayOf(i.resolved_at) <= end)
    out.push({
      end,
      completed: inWeek.length,
      medianCycle: median(inWeek.map((i) => cycleDays(i, byIssue, statuses)!)),
    })
  }
  return out
}

/** Weekly resolved counts for forecasting, without the empty weeks before anything was ever finished. */
export function throughputSamples(weeks: FlowWeek[]): number[] {
  const first = weeks.findIndex((w) => w.completed > 0)
  return first < 0 ? [] : weeks.slice(first).map((w) => w.completed)
}

/**
 * How long in progress is too long: the 85th percentile of recent cycle times
 * (most work finishes sooner). With fewer than five finished items to learn
 * from, two weeks.
 */
export function agingThreshold(cycles: number[]): number {
  if (cycles.length < 5) return 14
  return Math.max(1, percentile(cycles, 0.85)!)
}

// ---------------------------------------------------------------------------
// Forecasting
// ---------------------------------------------------------------------------

/** A small seeded random generator: the same forecast for the same release, render after render. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedOf(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const MAX_WEEKS = 104

/**
 * Monte Carlo: replay `remaining` items against weeks drawn at random from
 * the team's recent weekly throughput, `trials` times. Returns how many days
 * each trial took, shortest first (Infinity: not within two years), or null
 * when the history has nothing finished to draw on.
 */
export function monteCarlo(remaining: number, samples: number[], trials: number, rng: () => number): number[] | null {
  if (remaining <= 0) return Array(trials).fill(0)
  if (!samples.some((s) => s > 0)) return null
  const days: number[] = []
  for (let t = 0; t < trials; t++) {
    let left = remaining
    let took = Infinity
    for (let w = 0; w < MAX_WEEKS; w++) {
      const done = samples[Math.floor(rng() * samples.length)]
      if (done >= left) {
        // Part-way through this week, at its pace.
        took = w * 7 + Math.ceil((7 * left) / done)
        break
      }
      left -= done
    }
    days.push(took)
  }
  return days.sort((a, b) => a - b)
}

export interface Forecast {
  // Days from today: half the trials finish by p50, 85% by p85.
  p50: number
  p85: number
  // Share of trials finishing by the release date; null without a date.
  chance: number | null
}

export function forecastFrom(days: number[], daysLeft: number | null): Forecast {
  return {
    p50: percentile(days, 0.5)!,
    p85: percentile(days, 0.85)!,
    chance: daysLeft === null ? null : days.filter((d) => d <= daysLeft).length / days.length,
  }
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

/** The release to watch: the unreleased one due soonest (undated ones last, oldest first). */
export function nextRelease(releases: Release[]): Release | null {
  return [...releases]
    .filter((r) => r.status === 'unreleased')
    .sort((a, b) =>
      (a.release_date ?? '9999').localeCompare(b.release_date ?? '9999') || a.created_at.localeCompare(b.created_at))[0] ?? null
}

/** How much history a forecast needs: three weeks of the team finishing things. */
export const MIN_SAMPLE_WEEKS = 3

export interface ReleaseHealth {
  total: number
  done: number
  inProgress: number
  todo: number
  points: { total: number; done: number }
  // Open items with no assignee / no estimate (the latter only if the release uses points).
  unassigned: number
  unestimated: number
  daysLeft: number | null
  // Share of the release's dates gone by, 0–1; null without both dates.
  elapsed: number | null
  forecast: Forecast | null
  verdict: Verdict
}

/**
 * A release's state and outlook. The verdict:
 * - Ready: nothing left open. Overdue: its date has passed.
 * - With a date and enough history: On track at ≥ 80% chance of finishing by
 *   it, At risk at ≥ 50%, Off track below.
 * - With a date but too little history: At risk when more than 20 points of
 *   its time have gone than of its work, else On track.
 * - No date: No date (the forecast still says when).
 */
export function releaseHealth(
  release: Release,
  items: Issue[],
  statuses: ProjectStatus[],
  samples: number[],
  today: string,
  rng: () => number = mulberry32(seedOf(release.id)),
): ReleaseHealth {
  const category = new Map(statuses.map((s) => [s.id, s.category]))
  const cat = (i: Issue): StatusCategory => category.get(i.status_id) ?? 'todo'
  const open = items.filter((i) => cat(i) !== 'done')
  const usesPoints = items.some((i) => (i.story_points ?? 0) > 0)
  const done = items.length - open.length
  const daysLeft = release.release_date ? daysBetween(today, release.release_date) : null
  const elapsed = timeProgress(release.start_date, release.release_date, today)
  const runs = samples.length >= MIN_SAMPLE_WEEKS ? monteCarlo(open.length, samples, 2000, rng) : null
  const forecast = runs && open.length ? forecastFrom(runs, daysLeft !== null ? Math.max(0, daysLeft) : null) : null

  let verdict: Verdict
  if (!items.length) verdict = { tone: 'neutral', label: 'No issues yet' }
  else if (!open.length) verdict = { tone: 'good', label: 'Ready' }
  else if (daysLeft !== null && daysLeft < 0) verdict = { tone: 'bad', label: 'Overdue' }
  else if (daysLeft === null) verdict = { tone: 'neutral', label: 'No date' }
  else if (forecast?.chance != null) {
    verdict = forecast.chance >= 0.8 ? { tone: 'good', label: 'On track' }
      : forecast.chance >= 0.5 ? { tone: 'warn', label: 'At risk' }
        : { tone: 'bad', label: 'Off track' }
  } else if (elapsed !== null && elapsed - done / items.length > 0.2) verdict = { tone: 'warn', label: 'At risk' }
  else verdict = { tone: 'good', label: 'On track' }

  return {
    total: items.length,
    done,
    inProgress: items.filter((i) => cat(i) === 'in_progress').length,
    todo: items.filter((i) => cat(i) === 'todo').length,
    points: {
      total: items.reduce((s, i) => s + (i.story_points ?? 0), 0),
      done: items.filter((i) => cat(i) === 'done').reduce((s, i) => s + (i.story_points ?? 0), 0),
    },
    unassigned: open.filter((i) => !i.assignee_id).length,
    unestimated: usesPoints ? open.filter((i) => i.story_points === null).length : 0,
    daysLeft,
    elapsed,
    forecast,
    verdict,
  }
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

export interface SprintHealth {
  verdict: Verdict
  // Work at the start, left now, and projected left at the end, in the unit.
  start: number
  remaining: number | null
  projected: number | null
}

const plural = (n: number, unit: Unit) => `${n} ${unit === 'points' ? (n === 1 ? 'point' : 'points') : n === 1 ? 'issue' : 'issues'}`

/**
 * Whether a sprint will finish, from its burndown so far. The pace is the
 * average daily burn since it started; carried to the end date, the work it
 * leaves is the projection. On track: nothing left. At risk: up to 15% of
 * the starting scope. Otherwise it will spill about that much. A closed
 * sprint says what spilled.
 */
export function sprintHealth(sprint: Sprint, points: BurndownPoint[], unit: Unit): SprintHealth {
  const start = points[0]?.ideal ?? 0
  const known = points.filter((p) => p.remaining !== null)
  const remaining = known.at(-1)?.remaining ?? null
  if (sprint.state === 'closed') {
    const left = remaining ?? 0
    return {
      verdict: left > 0 ? { tone: 'bad', label: `Spilled ${plural(round1(left), unit)}` } : { tone: 'good', label: 'Completed' },
      start, remaining, projected: left,
    }
  }
  if (!points.length) return { verdict: { tone: 'neutral', label: 'No dates' }, start, remaining, projected: null }
  if (start === 0 && !remaining) return { verdict: { tone: 'neutral', label: 'Nothing planned' }, start, remaining, projected: null }
  if (known.length < 2) return { verdict: { tone: 'neutral', label: 'Too early' }, start, remaining, projected: null }
  const pace = (known[0].remaining! - remaining!) / (known.length - 1)
  const daysLeft = points.length - known.length
  const projected = Math.max(0, round1(remaining! - pace * daysLeft))
  const verdict: Verdict = projected <= 0 ? { tone: 'good', label: 'On track' }
    : projected <= 0.15 * start ? { tone: 'warn', label: 'At risk' }
      : { tone: 'bad', label: `Will spill ~${plural(Math.ceil(projected), unit)}` }
  return { verdict, start, remaining, projected }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Issues that joined / left the sprint after it started. */
export function scopeChange(sprint: Sprint, byIssue: EventsByIssue) {
  const since = sprint.started_at ? ms(sprint.started_at) : Infinity
  const added = new Set<string>()
  const removed = new Set<string>()
  for (const [id, evs] of byIssue) {
    for (const e of evs) {
      if (e.field !== 'sprint' || ms(e.created_at) <= since) continue
      if (e.to_id === sprint.id) added.add(id)
      if (e.from_id === sprint.id) removed.add(id)
    }
  }
  return { added: [...added], removed: [...removed] }
}

// ---------------------------------------------------------------------------
// Time in status
// ---------------------------------------------------------------------------

export interface StatusTime {
  status: ProjectStatus
  // In it at the end of the window.
  now: number
  // Spent any time in it during the window.
  passed: number
  // Median per issue that passed through, and all of it together, in days.
  median: number | null
  total: number
}

/**
 * Where time went, status by status, between `from` and `to` (instants).
 * Each issue's status at the window's start is rebuilt by undoing its later
 * moves, then its moves inside the window are walked; time is clipped to the
 * window (and to the issue's creation). Needs every status event after `from`.
 */
export function timeInStatus(
  issues: Pick<Issue, 'id' | 'status_id' | 'created_at'>[],
  byIssue: EventsByIssue,
  statuses: ProjectStatus[],
  from: number,
  to: number,
): StatusTime[] {
  const spent = new Map<string, number[]>(statuses.map((s) => [s.id, []]))
  const now = new Map<string, number>()
  for (const issue of issues) {
    const born = ms(issue.created_at)
    const t0 = Math.max(from, born)
    if (t0 >= to) continue
    const moves = (byIssue.get(issue.id) ?? []).filter((e) => e.field === 'status' && e.to_id)
    let status = issue.status_id
    for (let k = moves.length - 1; k >= 0 && ms(moves[k].created_at) > t0; k--) status = moves[k].from_id ?? status
    const mine = new Map<string, number>()
    const add = (s: string, d: number) => d > 0 && mine.set(s, (mine.get(s) ?? 0) + d)
    let t = t0
    for (const e of moves) {
      const at = ms(e.created_at)
      if (at <= t0 || at > to) continue
      add(status, at - t)
      status = e.to_id!
      t = at
    }
    add(status, to - t)
    now.set(status, (now.get(status) ?? 0) + 1)
    for (const [s, d] of mine) spent.get(s)?.push(d / DAY)
  }
  return [...statuses].sort((a, b) => a.position - b.position).map((status) => {
    const days = spent.get(status.id) ?? []
    return {
      status,
      now: now.get(status.id) ?? 0,
      passed: days.length,
      median: median(days),
      total: days.reduce((s, d) => s + d, 0),
    }
  })
}

/** Where work waits longest: the in-progress status with the highest median, if any time was spent there. */
export function bottleneck(rows: StatusTime[]): StatusTime | null {
  const candidates = rows.filter((r) => r.status.category === 'in_progress' && r.median !== null)
  return candidates.sort((a, b) => b.median! - a.median!)[0] ?? null
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Whether a resolved issue was finished on time:
 * - with a due date, resolved on or before it;
 * - else, if it was in a sprint, it never spilled out of one and was
 *   resolved by the end of the sprint it finished in;
 * - else it isn't judged (null). Open issues aren't either.
 */
export function onTime(
  issue: Pick<Issue, 'resolved_at' | 'due_date' | 'sprint_id'>,
  rows: Pick<SprintIssue, 'completed'>[],
  sprintsById: Map<string, Pick<Sprint, 'end_date'>>,
): boolean | null {
  if (!issue.resolved_at) return null
  const day = dayOf(issue.resolved_at)
  if (issue.due_date) return day <= issue.due_date
  if (rows.some((r) => r.completed === false)) return false
  const end = issue.sprint_id ? sprintsById.get(issue.sprint_id)?.end_date : null
  if (end) return day <= end
  return rows.length ? true : null
}

export interface PersonStats {
  assignee: string
  issues: number
  points: number
  judged: number
  onTime: number
  // onTime / judged, or null when nothing was judged.
  rate: number | null
  medianCycle: number | null
}

/** Resolved work per assignee (unassigned work is left out), most points first. */
export function personStats(
  resolved: Issue[],
  sprintRows: SprintIssue[],
  sprints: Sprint[],
  byIssue: EventsByIssue,
  statuses: ProjectStatus[],
): PersonStats[] {
  const sprintsById = new Map(sprints.map((s) => [s.id, s]))
  const rowsOf = new Map<string, SprintIssue[]>()
  for (const r of sprintRows) rowsOf.set(r.issue_id, [...(rowsOf.get(r.issue_id) ?? []), r])
  const by = new Map<string, { stats: PersonStats; cycles: number[] }>()
  for (const i of resolved) {
    if (!i.assignee_id || !i.resolved_at) continue
    const entry = by.get(i.assignee_id) ?? {
      stats: { assignee: i.assignee_id, issues: 0, points: 0, judged: 0, onTime: 0, rate: null, medianCycle: null },
      cycles: [],
    }
    entry.stats.issues++
    entry.stats.points += i.story_points ?? 0
    const ok = onTime(i, rowsOf.get(i.id) ?? [], sprintsById)
    if (ok !== null) {
      entry.stats.judged++
      if (ok) entry.stats.onTime++
    }
    entry.cycles.push(cycleDays(i, byIssue, statuses)!)
    by.set(i.assignee_id, entry)
  }
  return [...by.values()]
    .map(({ stats, cycles }) => ({ ...stats, rate: stats.judged ? stats.onTime / stats.judged : null, medianCycle: median(cycles) }))
    .sort((a, b) => b.points - a.points || b.issues - a.issues)
}

/** Ranked by points (by issues when nothing is estimated), then by on-time rate. */
export function leaderboard(stats: PersonStats[]): { unit: Unit; rows: PersonStats[] } {
  const unit: Unit = stats.some((s) => s.points > 0) ? 'points' : 'issues'
  const score = (s: PersonStats) => (unit === 'points' ? s.points : s.issues)
  return { unit, rows: [...stats].sort((a, b) => score(b) - score(a) || (b.rate ?? -1) - (a.rate ?? -1)) }
}

// ---------------------------------------------------------------------------
// Epics
// ---------------------------------------------------------------------------

export interface EpicHealth {
  row: TimelineRow
  total: number
  done: number
  points: { total: number; done: number }
  verdict: Verdict
}

/** An open epic worth watching: some of its work has started, or its dates cover today. */
export function epicInProgress(row: TimelineRow, statuses: ProjectStatus[], today: string) {
  if (row.epic.resolved_at) return false
  const category = new Map(statuses.map((s) => [s.id, s.category]))
  const started = row.children.some((c) => category.get(c.status_id) !== 'todo')
  return started || (!!row.start && !!row.end && row.start <= today && today <= row.end)
}

/**
 * An epic's progress and verdict. Overdue: its end has passed with work open.
 * At risk: more than 20 points more of its time gone than of its issues
 * done. On track otherwise; No dates without an end.
 */
export function epicHealth(row: TimelineRow, statuses: ProjectStatus[], today: string): EpicHealth {
  const category = new Map(statuses.map((s) => [s.id, s.category]))
  const isDone = (i: Issue) => category.get(i.status_id) === 'done'
  const total = row.children.length
  const done = row.children.filter(isDone).length
  const points = {
    total: row.children.reduce((s, c) => s + (c.story_points ?? 0), 0),
    done: row.children.filter(isDone).reduce((s, c) => s + (c.story_points ?? 0), 0),
  }
  const share = total ? done / total : 0
  const elapsed = timeProgress(row.start, row.end, today)
  let verdict: Verdict
  if (!total) verdict = { tone: 'neutral', label: 'No issues' }
  else if (done === total) verdict = { tone: 'good', label: 'Done' }
  else if (row.end && row.end < today) verdict = { tone: 'bad', label: 'Overdue' }
  else if (!row.end) verdict = { tone: 'neutral', label: 'No dates' }
  else if (elapsed !== null && elapsed - share > 0.2) verdict = { tone: 'warn', label: 'At risk' }
  else verdict = { tone: 'good', label: 'On track' }
  return { row, total, done, points, verdict }
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export type AttentionKind = 'blocked' | 'overdue' | 'aging' | 'unassigned' | 'unestimated'

export interface Attention {
  issue: Issue
  reasons: { kind: AttentionKind; text: string }[]
}

const WEIGHT: Record<AttentionKind, number> = { blocked: 3, overdue: 3, aging: 2, unassigned: 1, unestimated: 1 }

/**
 * Open work someone should look at, worst first:
 * - blocked by an issue that is still open;
 * - past its due date;
 * - in progress for longer than `agingDays` (see agingThreshold);
 * - in the active sprint or the next release (`focus`) with nobody on it,
 *   or with no estimate when the project estimates (and the issue is a kind
 *   that is estimated: not in `unestimated`, e.g. sub-tasks).
 */
export function needsAttention(input: {
  open: Issue[]
  byIssue: EventsByIssue
  statuses: ProjectStatus[]
  // Open issues blocking each issue, by key.
  blockers: Map<string, string[]>
  focus: Set<string>
  usesPoints: boolean
  // Issues not expected to carry an estimate.
  unestimated?: Set<string>
  agingDays: number
  today: string
  now: number
}): Attention[] {
  const category = new Map(input.statuses.map((s) => [s.id, s.category]))
  const out: Attention[] = []
  for (const issue of input.open) {
    const reasons: Attention['reasons'] = []
    const blockedBy = input.blockers.get(issue.id) ?? []
    if (blockedBy.length) reasons.push({ kind: 'blocked', text: `Blocked by ${blockedBy.join(', ')}` })
    if (issue.due_date && issue.due_date < input.today) {
      const late = daysBetween(issue.due_date, input.today)
      reasons.push({ kind: 'overdue', text: `${late} day${late === 1 ? '' : 's'} overdue` })
    }
    if (category.get(issue.status_id) === 'in_progress') {
      const age = (input.now - startedAt(issue, input.byIssue, input.statuses)) / DAY
      if (age > input.agingDays) reasons.push({ kind: 'aging', text: `In progress ${formatDays(age)}` })
    }
    if (input.focus.has(issue.id)) {
      if (!issue.assignee_id) reasons.push({ kind: 'unassigned', text: 'Nobody on it' })
      if (input.usesPoints && issue.story_points === null && !input.unestimated?.has(issue.id)) reasons.push({ kind: 'unestimated', text: 'Not estimated' })
    }
    if (reasons.length) out.push({ issue, reasons })
  }
  const score = (a: Attention) => a.reasons.reduce((s, r) => s + WEIGHT[r.kind], 0)
  return out.sort((a, b) => score(b) - score(a) || a.issue.number - b.issue.number)
}
