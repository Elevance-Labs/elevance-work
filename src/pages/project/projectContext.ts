import { createContext, useContext } from 'react'
import type { Project, ProjectRole } from '../../lib/types'

export interface ProjectContextValue {
  project: Project
  role: ProjectRole | null
}

// Set by ProjectLayout for the project page below it.
export const ProjectContext = createContext<ProjectContextValue | null>(null)

export function useProject() {
  const ctx = useContext(ProjectContext)
  if (!ctx) throw new Error('useProject must be used inside a project page')
  return ctx
}
