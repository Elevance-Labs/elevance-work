// Reading the workspace (WorkspaceProvider's data), and starting that read
// early: AuthProvider calls `readWorkspaceEarly` beside `bind_profile`, so a
// sign-in waits one round trip, not two. Apart from AuthProvider and the
// provider, so neither imports the other.
import { supabase } from '../lib/supabase'
import type { IssueType, Profile, Project, ProjectMember, ProjectStatus, Sprint } from '../lib/types'

export interface WorkspaceData {
  profiles: Profile[]
  issueTypes: IssueType[]
  projects: Project[]
  statuses: ProjectStatus[]
  memberships: ProjectMember[]
  activeSprints: Sprint[]
}

const PROFILE_COLUMNS = 'id, email, full_name, title, avatar_url, app_role, active, created_at'
// PostgREST's page: an unfiltered read this long may have been cut short.
const PAGE = 1000

type Read = { data: WorkspaceData } | { error: string }

// The reads. `memberOf` names whose memberships; null reads every membership
// of every project you can see (the early read, before your profile id is
// known), which `takeEarlyWorkspace` then narrows to yours.
export async function readWorkspace(memberOf: string | null): Promise<Read> {
  const members = supabase.from('project_members').select('*')
  const [profiles, types, projects, statuses, memberships, sprints] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS).order('full_name'),
    supabase.from('issue_types').select('*').order('name'),
    supabase.from('projects').select('*').order('name'),
    supabase.from('project_statuses').select('*').order('position'),
    memberOf ? members.eq('profile_id', memberOf) : members,
    supabase.from('sprints').select('*').eq('state', 'active'),
  ])
  const failed = [profiles, types, projects, statuses, memberships, sprints].find((r) => r.error)
  if (failed?.error) return { error: failed.error.message }
  const levelOrder = { epic: 0, standard: 1, subtask: 2 }
  return {
    data: {
      profiles: profiles.data as Profile[],
      issueTypes: (types.data as IssueType[]).sort((a, b) => levelOrder[a.level] - levelOrder[b.level] || a.name.localeCompare(b.name)),
      projects: (projects.data as Project[]).sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at) || a.name.localeCompare(b.name)),
      statuses: statuses.data as ProjectStatus[],
      memberships: memberships.data as ProjectMember[],
      activeSprints: sprints.data as Sprint[],
    },
  }
}

// The early read: started by AuthProvider beside `bind_profile`, so signing
// in costs one round trip, not two. It stands only if it was read as a bound
// profile: every read is refused or empty before binding (a first sign-in),
// and a bound, active person always sees at least themselves.
let early: Promise<Read> | null = null

/** Start the workspace's reads now, for the session just found. */
export function readWorkspaceEarly() {
  early = readWorkspace(null)
  early.catch(() => {})
}

/** Drop an early read nobody will take (signed out, or another person). */
export function dropEarlyWorkspace() {
  early = null
}

/** The early read, if it stands for this profile; used once. */
export async function takeEarlyWorkspace(meId: string): Promise<WorkspaceData | null> {
  const pending = early
  early = null
  if (!pending) return null
  const read = await pending.catch(() => null)
  if (!read || 'error' in read) return null
  const { data } = read
  if (!data.profiles.some((p) => p.id === meId && p.active)) return null
  if (data.memberships.length >= PAGE) return null
  return { ...data, memberships: data.memberships.filter((m) => m.profile_id === meId) }
}
