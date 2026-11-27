// A project's test cases (or one issue's) for the sheet: loaded once, kept
// live with Realtime, and written optimistically so typing never waits on the
// network. A new row shows at once under a temporary id; anything done to it
// before the database answers waits for its real id. A refused write puts the
// row back and says why.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/constants'
import { rankBetween } from '../../lib/issues'
import { TEST_CASE_COLUMNS, type TestCaseWrite } from '../../lib/testCases'
import type { TestCase, TestResult, TestStatus } from '../../lib/types'

export interface IssueRef {
  id: string
  key: string
  title: string
}

export interface TestCasesState {
  /** By rank; null while loading. */
  cases: TestCase[] | null
  error: string | null
  setError: (e: string | null) => void
  /** Writes still on their way. */
  saving: number
  /** Ids of cases added here this visit (kept in view whatever the filter). */
  fresh: Set<string>
  issueKey: (id: string) => string | undefined
  issueById: (id: string) => IssueRef | undefined
  reload: () => Promise<void>
  update: (id: string, patch: TestCaseWrite) => Promise<boolean>
  /** New cases at the end; resolves to their ids (real ones), or null if refused. */
  insert: (rows: TestCaseWrite[]) => Promise<string[] | null>
  remove: (ids: string[]) => Promise<boolean>
  /** Put a case between two others (either may be missing: the top or the end). */
  move: (id: string, prevId: string | null, nextId: string | null) => Promise<boolean>
  /** Record one status for several cases; resolves to the new results' ids. */
  record: (ids: string[], status: TestStatus, reason: string, environment: string | null) => Promise<string[] | null>
  unrecord: (resultIds: string[], caseIds: string[]) => Promise<boolean>
  history: (caseId: string) => Promise<TestResult[]>
  findIssue: (key: string) => Promise<IssueRef | null>
}

let tmpCounter = 0
/** A row still on its way to the database. */
export const isTmp = (id: string) => id.startsWith('tmp-')
const byRank = (a: TestCase, b: TestCase) => a.rank - b.rank || a.number - b.number

export function useTestCases(projectId: string, issueId?: string): TestCasesState {
  const [cases, setCasesState] = useState<TestCase[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)
  const [issues, setIssuesState] = useState<Map<string, IssueRef>>(new Map())
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  // The same, for the writers: always current, even between renders.
  const casesRef = useRef<TestCase[] | null>(null)
  const issuesRef = useRef<Map<string, IssueRef>>(new Map())
  const setCases = useCallback((next: TestCase[] | null | ((prev: TestCase[] | null) => TestCase[] | null)) => {
    casesRef.current = typeof next === 'function' ? next(casesRef.current) : next
    setCasesState(casesRef.current)
  }, [])
  const setIssues = useCallback((next: (prev: Map<string, IssueRef>) => Map<string, IssueRef>) => {
    issuesRef.current = next(issuesRef.current)
    setIssuesState(issuesRef.current)
  }, [])
  // A temporary id's insert, and what was changed on the row meanwhile.
  const pendingIds = useRef(new Map<string, Promise<string | null>>())
  const tmpPatches = useRef(new Map<string, TestCaseWrite>())
  // A temporary id, once the row has its real one (undo may still name it).
  const aliases = useRef(new Map<string, string>())
  const canon = useCallback((id: string) => aliases.current.get(id) ?? id, [])
  const inFlight = useRef(0)
  const reloadSoon = useRef<ReturnType<typeof setTimeout>>(undefined)

  const track = useCallback(async <T,>(work: Promise<T>) => {
    inFlight.current++
    setSaving((n) => n + 1)
    try {
      return await work
    } finally {
      inFlight.current--
      setSaving((n) => n - 1)
    }
  }, [])

  const learnIssues = useCallback(async (rows: TestCase[]) => {
    const missing = [...new Set(rows.map((c) => c.issue_id).filter((id): id is string => !!id && !issuesRef.current.has(id)))]
    if (!missing.length) return
    const found: IssueRef[] = []
    // A few at a time: the ids go in the address.
    for (let i = 0; i < missing.length; i += 100) {
      const { data } = await supabase.from('issues').select('id, key, title').in('id', missing.slice(i, i + 100))
      found.push(...((data ?? []) as IssueRef[]))
    }
    if (found.length) setIssues((m) => new Map([...m, ...found.map((f) => [f.id, f] as const)]))
  }, [setIssues])

  const reload = useCallback(async () => {
    let q = supabase.from('test_cases').select(TEST_CASE_COLUMNS).eq('project_id', projectId)
    if (issueId) q = q.eq('issue_id', issueId)
    const { data, error: e } = await q.order('rank')
    if (e) return setError(errorMessage(e, 'The test cases could not be loaded.'))
    const rows = ((data ?? []) as unknown as TestCase[]).sort(byRank)
    // Rows still being created stay, so a reload mid-typing loses nothing.
    setCases((prev) => [...rows, ...(prev ?? []).filter((c) => isTmp(c.id))])
    learnIssues(rows)
  }, [projectId, issueId, learnIssues, setCases])

  useEffect(() => {
    setCases(null)
    reload()
  }, [reload, setCases])

  // Someone else's edits arrive live; ours wait until our own writes land.
  useEffect(() => {
    const schedule = () => {
      clearTimeout(reloadSoon.current)
      reloadSoon.current = setTimeout(() => (inFlight.current ? schedule() : reload()), 400)
    }
    const channel = supabase
      .channel(`tests:${projectId}:${issueId ?? 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_cases', filter: `project_id=eq.${projectId}` }, schedule)
      .subscribe()
    return () => {
      clearTimeout(reloadSoon.current)
      supabase.removeChannel(channel)
    }
  }, [projectId, issueId, reload])

  const replace = useCallback((id: string, row: TestCase | null) => {
    setCases((list) => {
      if (!list) return list
      const next = row ? list.map((c) => (c.id === id ? row : c)) : list.filter((c) => c.id !== id)
      return next.sort(byRank)
    })
  }, [setCases])

  const patchLocal = useCallback((id: string, patch: Partial<TestCase>) => {
    setCases((list) => list && list.map((c) => (c.id === id ? { ...c, ...patch } : c)).sort(byRank))
  }, [setCases])

  const resolve = useCallback(async (id: string) => {
    const c = aliases.current.get(id) ?? id
    return isTmp(c) ? (await pendingIds.current.get(c)) ?? null : c
  }, [])

  const update = useCallback(async (rawId: string, patch: TestCaseWrite) => {
    const id = canon(rawId)
    const before = (casesRef.current ?? []).find((c) => c.id === id)
    if (!before) return false
    setError(null)
    patchLocal(id, patch)
    if (isTmp(id)) tmpPatches.current.set(id, { ...tmpPatches.current.get(id), ...patch })
    return track((async () => {
      const real = await resolve(id)
      if (!real) return false
      const { data, error: e } = await supabase.from('test_cases').update(patch).eq('id', real).select(TEST_CASE_COLUMNS).single()
      if (e || !data) {
        setError(errorMessage(e, "That change wasn't saved."))
        const current = (casesRef.current ?? []).find((c) => c.id === real)
        if (current) replace(real, { ...current, ...Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof TestCase]])) })
        return false
      }
      replace(real, data as unknown as TestCase)
      if ('issue_id' in patch) learnIssues([data as unknown as TestCase])
      return true
    })())
  }, [canon, patchLocal, replace, resolve, track, learnIssues])

  const insert = useCallback(async (rows: TestCaseWrite[]) => {
    if (!rows.length) return []
    setError(null)
    const list = casesRef.current ?? []
    const last = list.filter((c) => !isTmp(c.id)).at(-1)?.rank ?? list.at(-1)?.rank ?? 0
    const lastAll = Math.max(last, ...list.map((c) => c.rank))
    const now = new Date().toISOString()
    const temps: TestCase[] = rows.map((r, i) => ({
      id: `tmp-${++tmpCounter}`, project_id: projectId, number: 0, key: '…', issue_id: issueId ?? null, title: '', description: '',
      expected: '', type: null, level: null, areas: [], rank: lastAll + 1024 * (i + 1), last_status: null, last_reason: null,
      last_environment: null, last_recorded_by: null, last_recorded_at: null, created_by: null, created_at: now, updated_at: now,
      updated_by: null, script_repo: null, script_path: null, script_title: null, automated_at: null,
      ...r,
    }))
    setCases((l) => [...(l ?? []), ...temps].sort(byRank))
    const payload = temps.map((t, i) => ({ project_id: projectId, issue_id: rows[i].issue_id ?? issueId ?? null, ...rows[i], rank: t.rank }))
    let settle: (ids: (string | null)[]) => void = () => {}
    const ready = new Promise<(string | null)[]>((r) => (settle = r))
    temps.forEach((t, i) => pendingIds.current.set(t.id, ready.then((ids) => ids[i])))
    return track((async () => {
      const { data, error: e } = await supabase.from('test_cases').insert(payload).select(TEST_CASE_COLUMNS)
      const created = (data ?? []) as unknown as TestCase[]
      if (e || created.length !== temps.length) {
        settle(temps.map(() => null))
        setError(errorMessage(e, "Those test cases weren't added."))
        setCases((l) => l && l.filter((c) => !temps.some((t) => t.id === c.id)))
        return null
      }
      // Whatever was typed into the row while it was on its way stays.
      setCases((l) => l && l.map((c) => {
        const i = temps.findIndex((t) => t.id === c.id)
        return i < 0 ? c : { ...created[i], ...tmpPatches.current.get(c.id) }
      }).sort(byRank))
      setFresh((f) => new Set([...f, ...created.map((c) => c.id)]))
      temps.forEach((t, i) => aliases.current.set(t.id, created[i].id))
      settle(created.map((c) => c.id))
      temps.forEach((t) => tmpPatches.current.delete(t.id))
      learnIssues(created)
      return created.map((c) => c.id)
    })())
  }, [projectId, issueId, track, learnIssues, setCases])

  const remove = useCallback(async (rawIds: string[]) => {
    const ids = rawIds.map(canon)
    setError(null)
    const gone = (casesRef.current ?? []).filter((c) => ids.includes(c.id))
    setCases((l) => l && l.filter((c) => !ids.includes(c.id)))
    return track((async () => {
      const real = (await Promise.all(ids.map(resolve))).filter((x): x is string => !!x)
      const { error: e } = await supabase.from('test_cases').delete().in('id', real)
      if (e) {
        setError(errorMessage(e, "Those test cases weren't deleted."))
        setCases((l) => l && [...l, ...gone].sort(byRank))
        return false
      }
      return true
    })())
  }, [canon, resolve, track, setCases])

  const move = useCallback(async (rawId: string, rawPrev: string | null, rawNext: string | null) => {
    const [id, prevId, nextId] = [canon(rawId), rawPrev && canon(rawPrev), rawNext && canon(rawNext)]
    const rankOf = (x: string | null) => (x ? (casesRef.current ?? []).find((c) => c.id === x)?.rank : undefined)
    let rank = rankBetween(rankOf(prevId), rankOf(nextId))
    if (rank === null) {
      // Too close to split: renumber the project's order, then place it.
      const { error: e } = await supabase.rpc('test_cases_rerank', { p_project: projectId })
      if (e) {
        setError(errorMessage(e))
        return false
      }
      await reload()
      const { data } = await supabase.from('test_cases').select('id, rank').in('id', [prevId, nextId].filter((x): x is string => !!x))
      const ranks = new Map(((data ?? []) as { id: string; rank: number }[]).map((r) => [r.id, r.rank]))
      rank = rankBetween(prevId ? ranks.get(prevId) : undefined, nextId ? ranks.get(nextId) : undefined)
      if (rank === null) return false
    }
    return update(id, { rank })
  }, [canon, projectId, reload, update])

  const refreshCases = useCallback(async (ids: string[]) => {
    const { data } = await supabase.from('test_cases').select(TEST_CASE_COLUMNS).in('id', ids)
    for (const row of (data ?? []) as unknown as TestCase[]) replace(row.id, row)
  }, [replace])

  const record = useCallback(async (rawIds: string[], status: TestStatus, reason: string, environment: string | null) => {
    const ids = rawIds.map(canon)
    setError(null)
    const before = (casesRef.current ?? []).filter((c) => ids.includes(c.id))
    const now = new Date().toISOString()
    for (const id of ids) {
      patchLocal(id, { last_status: status, last_reason: reason.trim(), last_environment: environment, last_recorded_at: now })
    }
    return track((async () => {
      const real = (await Promise.all(ids.map(resolve))).filter((x): x is string => !!x)
      const { data, error: e } = await supabase.from('test_results')
        .insert(real.map((case_id) => ({ case_id, status, reason: reason.trim(), environment })))
        .select('id')
      if (e) {
        setError(errorMessage(e, "That result wasn't recorded."))
        for (const b of before) patchLocal(b.id, {
          last_status: b.last_status, last_reason: b.last_reason, last_environment: b.last_environment, last_recorded_at: b.last_recorded_at,
        })
        return null
      }
      await refreshCases(real)
      return ((data ?? []) as { id: string }[]).map((r) => r.id)
    })())
  }, [canon, patchLocal, refreshCases, resolve, track])

  const unrecord = useCallback(async (resultIds: string[], caseIds: string[]) => {
    setError(null)
    return track((async () => {
      const { error: e } = await supabase.from('test_results').delete().in('id', resultIds)
      if (e) {
        setError(errorMessage(e))
        return false
      }
      await refreshCases(caseIds.map(canon))
      return true
    })())
  }, [canon, refreshCases, track])

  const history = useCallback(async (caseId: string) => {
    const real = await resolve(caseId)
    if (!real) return []
    const { data } = await supabase.from('test_results').select('*').eq('case_id', real).order('created_at', { ascending: false })
    return (data ?? []) as TestResult[]
  }, [resolve])

  const findIssue = useCallback(async (key: string) => {
    const known = [...issuesRef.current.values()].find((i) => i.key === key)
    if (known) return known
    const { data } = await supabase.from('issues').select('id, key, title').eq('project_id', projectId).eq('key', key).maybeSingle()
    const found = (data as IssueRef | null) ?? null
    if (found) setIssues((m) => new Map(m).set(found.id, found))
    return found
  }, [projectId, setIssues])

  const issueKey = useCallback((id: string) => issues.get(id)?.key, [issues])
  const issueById = useCallback((id: string) => issues.get(id), [issues])

  return useMemo(() => ({
    cases, error, setError, saving, fresh, issueKey, issueById, reload, update, insert, remove, move, record, unrecord, history, findIssue,
  }), [cases, error, saving, fresh, issueKey, issueById, reload, update, insert, remove, move, record, unrecord, history, findIssue])
}
