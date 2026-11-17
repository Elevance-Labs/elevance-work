// Reading more rows than one request returns. PostgREST caps a response
// (1000 rows on Supabase), and a capped answer looks like a complete one, so
// anything that must see every matching row pages through them.

export const PAGE = 1000

type PgError = { code?: string; message: string }
// What one request answers (a query builder, awaited).
interface Answer {
  data: unknown
  error: PgError | null
}
interface Page<T> {
  data: T[] | null
  error: PgError | null
}

/**
 * Every row of a query, a page at a time. `page(from, to)` builds the query
 * for one page, ordered by a unique column (`.order('id').range(from, to)`),
 * so pages neither overlap nor skip.
 */
export async function fetchAll<T = unknown>(page: (from: number, to: number) => PromiseLike<Answer>): Promise<Page<T>> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) return { data: null, error }
    const got = (data ?? []) as T[]
    rows.push(...got)
    if (got.length < PAGE) return { data: rows, error: null }
  }
}

/** Ids in groups small enough for an `in (...)` filter in a URL. */
export function chunks<T>(xs: T[], size = 150): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/** Every row matching a query over a long list of ids: one paged query per group of ids. */
export async function fetchByIds<T = unknown>(ids: string[], page: (ids: string[], from: number, to: number) => PromiseLike<Answer>): Promise<Page<T>> {
  const rows: T[] = []
  for (const group of chunks([...new Set(ids)])) {
    const { data, error } = await fetchAll<T>((from, to) => page(group, from, to))
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
  }
  return { data: rows, error: null }
}
