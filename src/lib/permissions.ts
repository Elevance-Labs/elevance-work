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

/** can_edit_project: admins, managers and members. */
const edits = (role: ProjectRole | null) => role === 'admin' || role === 'manager' || role === 'member'
/** can_manage_project: admins and managers (releases, removing what others made). */
const manages = (role: ProjectRole | null) => role === 'admin' || role === 'manager'

export const can = {
  editIssues: edits,
  deleteIssues: manages,
  // Viewers too: they read, comment and watch.
  comment: (role: ProjectRole | null) => role !== null,
  /** A thumbs up or down on a comment: whoever may comment. */
  react: (role: ProjectRole | null) => role !== null,
  planSprints: edits,
  manageReleases: manages,
  deleteReleases: manages,
  /** Settings: the project, people, workflow, fields, integrations, features, the Summary's widgets. */
  manageProject: (role: ProjectRole | null) => role === 'admin',
  addDocs: edits,
  /** A comment's author edits it; its author or a project admin or manager removes it. */
  editComment: (authorId: string | null, me: Profile) => authorId === me.id,
  deleteComment: (authorId: string | null, me: Profile, role: ProjectRole | null) => authorId === me.id || manages(role),
  deleteAttachment: (uploadedBy: string | null, me: Profile, role: ProjectRole | null) =>
    uploadedBy === me.id || manages(role),
  /** Files go with your own comments, if you may add files to the issue (the drive function checks both). */
  attachToComment: (authorId: string | null, me: Profile, role: ProjectRole | null) =>
    authorId === me.id && edits(role),
  deleteDoc: (createdBy: string | null, me: Profile, role: ProjectRole | null) => createdBy === me.id || manages(role),
  /** The shared calendar: the creator or a workspace admin. */
  editEvent: (createdBy: string | null, me: Profile) => createdBy === me.id || me.app_role === 'admin',
}

/** Who may be assigned in a project: those who edit it (not viewers), and workspace admins. */
export function assignable(project: Project, profiles: Profile[], members: ProjectMember[]) {
  return profiles.filter((p) => p.active && edits(roleIn(project, p, members)))
}

/** Who may approve a release: anyone active who can see the project (release_approvers_guard). */
export function canApprove(project: Project, profiles: Profile[], members: ProjectMember[]) {
  return profiles.filter((p) => p.active && roleIn(project, p, members) !== null)
}
