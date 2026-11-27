import { useCallback, useEffect, useState } from 'react'
import { environmentKey } from '../../lib/testCases'
import type { Project } from '../../lib/types'

/**
 * The environment results are recorded on: the one you last chose in this
 * project, in this browser; at first the project's first.
 */
export function useEnvironment(project: Project): [string | null, (env: string | null) => void] {
  const read = useCallback(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(environmentKey(project.id))
    } catch {
      // Storage can be off; the default will do.
    }
    if (saved === '') return null
    return saved && project.test_environments.includes(saved) ? saved : (project.test_environments[0] ?? null)
  }, [project.id, project.test_environments])
  const [env, setEnv] = useState(read)
  useEffect(() => setEnv(read()), [read])
  const choose = (next: string | null) => {
    setEnv(next)
    try {
      localStorage.setItem(environmentKey(project.id), next ?? '')
    } catch {
      // Kept for this visit only.
    }
  }
  return [env, choose]
}
