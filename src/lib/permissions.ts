// Client mirror of the database's access rules (role_in_project and the RLS
// policies in supabase/schema.sql). It decides what the UI offers; the
// database decides what happens. Change both together.
import type { Profile, Project, ProjectMember, ProjectRole } from './types'

/** Mirror of role_in_project: null means the project is invisible. */
export function roleIn(project: Project, me: Profile, memberships: ProjectMember[]): ProjectRole | null {
  if (!me.active) return null
  if (me.app_role === 'admin') return 'admin'
  const member = memberships.find((m) => m.project_id === project.id && m.profile_id === me.id)?.role ?? null
  if (project.archived_at) return member || project.visibility === 'open' ? 'viewer' : null
  return member ?? (project.visibility === 'open' ? 'viewer' : null)
}

export const can = {
  editIssues: (role: ProjectRole | null) => role === 'admin' || role === 'member',
  deleteIssues: (role: ProjectRole | null) => role === 'admin',
  // Viewers too: they read, comment and watch.
  comment: (role: ProjectRole | null) => role !== null,
  planSprints: (role: ProjectRole | null) => role === 'admin' || role === 'member',
  manageReleases: (role: ProjectRole | null) => role === 'admin' || role === 'member',
  deleteReleases: (role: ProjectRole | null) => role === 'admin',
  manageProject: (role: ProjectRole | null) => role === 'admin',
  addDocs: (role: ProjectRole | null) => role === 'admin' || role === 'member',
  /** A comment's author edits it; its author or a project admin removes it. */
  editComment: (authorId: string | null, me: Profile) => authorId === me.id,
  deleteComment: (authorId: string | null, me: Profile, role: ProjectRole | null) => authorId === me.id || role === 'admin',
  deleteAttachment: (uploadedBy: string | null, me: Profile, role: ProjectRole | null) =>
    uploadedBy === me.id || role === 'admin',
  /** Files go with your own comments, if you may add files to the issue (the drive function checks both). */
  attachToComment: (authorId: string | null, me: Profile, role: ProjectRole | null) =>
    authorId === me.id && (role === 'admin' || role === 'member'),
  deleteDoc: (createdBy: string | null, me: Profile, role: ProjectRole | null) => createdBy === me.id || role === 'admin',
  /** The shared calendar: the creator or a workspace admin. */
  editEvent: (createdBy: string | null, me: Profile) => createdBy === me.id || me.app_role === 'admin',
}

/** Who may be assigned in a project: its members and admins (not viewers), and workspace admins. */
export function assignable(project: Project, profiles: Profile[], members: ProjectMember[]) {
  return profiles.filter((p) => {
    if (!p.active) return false
    const role = roleIn(project, p, members)
    return role === 'admin' || role === 'member'
  })
}
