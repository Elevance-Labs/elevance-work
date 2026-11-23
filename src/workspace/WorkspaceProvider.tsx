// What nearly every page needs and is small enough to hold once: the people,
// the issue types, the projects you can see with their workflows, your
// memberships, and the active sprints. Loaded after sign-in; pages call
// `reload()` after changing any of it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Alert, Box, Button } from '@mui/material'
import { useMe } from '../auth/AuthProvider'
import { roleIn } from '../lib/permissions'
import { Splash } from '../components/common'
import { readWorkspace, takeEarlyWorkspace, type WorkspaceData } from './workspaceRead'
import { statusesOf } from '../lib/issues'
import type { IssueType, Profile, Project, ProjectMember, ProjectRole, ProjectStatus, Sprint } from '../lib/types'

interface Workspace {
  profiles: Profile[]
  issueTypes: IssueType[]
  // Visible projects, by name; archived ones last.
  projects: Project[]
  statuses: ProjectStatus[]
  memberships: ProjectMember[]
  activeSprints: Sprint[]
  profileById: (id: string | null | undefined) => Profile | undefined
  typeById: (id: string | null | undefined) => IssueType | undefined
  projectById: (id: string | null | undefined) => Project | undefined
  projectByKey: (key: string | null | undefined) => Project | undefined
  statusById: (id: string | null | undefined) => ProjectStatus | undefined
  statusesOf: (projectId: string) => ProjectStatus[]
  roleOf: (projectId: string | null | undefined) => ProjectRole | null
  reload: () => Promise<void>
}

const WorkspaceContext = createContext<Workspace | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const me = useMe()
  const [data, setData] = useState<WorkspaceData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const read = await readWorkspace(me.id)
    if ('error' in read) {
      setError(read.error)
      return
    }
    setError(null)
    setData(read.data)
  }, [me.id])

  // The first load takes the early read when it stands, else reads now.
  useEffect(() => {
    let cancelled = false
    takeEarlyWorkspace(me.id).then((ready) => {
      if (cancelled) return
      if (ready) setData(ready)
      else reload()
    })
    return () => {
      cancelled = true
    }
  }, [me.id, reload])

  const value = useMemo<Workspace | null>(() => {
    if (!data) return null
    const byId = <T extends { id: string }>(rows: T[]) => {
      const map = new Map(rows.map((r) => [r.id, r]))
      return (id: string | null | undefined) => (id ? map.get(id) : undefined)
    }
    const projectById = byId(data.projects)
    return {
      ...data,
      profileById: byId(data.profiles),
      typeById: byId(data.issueTypes),
      projectById,
      projectByKey: (key) => data.projects.find((p) => p.key === key?.toUpperCase()),
      statusById: byId(data.statuses),
      statusesOf: (projectId) => statusesOf(projectId, data.statuses),
      roleOf: (projectId) => {
        const p = projectById(projectId)
        return p ? roleIn(p, me, data.memberships) : null
      },
      reload,
    }
  }, [data, me, reload])

  if (error && !value) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error" action={<Button onClick={reload}>Retry</Button>}>
          Couldn't load the workspace: {error}
        </Alert>
      </Box>
    )
  }
  if (!value) return <Splash />
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}
