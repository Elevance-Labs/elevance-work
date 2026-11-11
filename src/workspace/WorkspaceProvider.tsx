// What nearly every page needs and is small enough to hold once: the people,
// the issue types, the projects you can see with their workflows, your
// memberships, and the active sprints. Loaded after sign-in; pages call
// `reload()` after changing any of it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Alert, Box, Button, CircularProgress } from '@mui/material'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { roleIn } from '../lib/permissions'
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

interface Data {
  profiles: Profile[]
  issueTypes: IssueType[]
  projects: Project[]
  statuses: ProjectStatus[]
  memberships: ProjectMember[]
  activeSprints: Sprint[]
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const me = useMe()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [profiles, types, projects, statuses, memberships, sprints] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, title, avatar_url, app_role, active, created_at').order('full_name'),
      supabase.from('issue_types').select('*').order('name'),
      supabase.from('projects').select('*').order('name'),
      supabase.from('project_statuses').select('*').order('position'),
      supabase.from('project_members').select('*').eq('profile_id', me.id),
      supabase.from('sprints').select('*').eq('state', 'active'),
    ])
    const failed = [profiles, types, projects, statuses, memberships, sprints].find((r) => r.error)
    if (failed?.error) {
      setError(failed.error.message)
      return
    }
    const levelOrder = { epic: 0, standard: 1, subtask: 2 }
    setError(null)
    setData({
      profiles: profiles.data as Profile[],
      issueTypes: (types.data as IssueType[]).sort((a, b) => levelOrder[a.level] - levelOrder[b.level] || a.name.localeCompare(b.name)),
      projects: (projects.data as Project[]).sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at) || a.name.localeCompare(b.name)),
      statuses: statuses.data as ProjectStatus[],
      memberships: memberships.data as ProjectMember[],
      activeSprints: sprints.data as Sprint[],
    })
  }, [me.id])

  useEffect(() => {
    reload()
  }, [reload])

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
  if (!value) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}
