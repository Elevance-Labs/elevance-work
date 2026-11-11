// An issue's links to GitHub (recorded by the `github` Edge Function).
import type { DevLink } from './types'

const ORDER = { pull_request: 0, branch: 1, commit: 2 } as const

/** Pull requests, then branches, then commits; newest first within each. */
export function sortDevLinks(links: DevLink[]) {
  return [...links].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.happened_at.localeCompare(a.happened_at))
}
