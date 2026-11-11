// Row shapes for the tables the app reads. Kept in step with
// supabase/schema.sql: change both together.

export type AppRole = 'admin' | 'member'
export type ProjectRole = 'admin' | 'member' | 'viewer'
export type ProjectKind = 'scrum' | 'kanban'
export type ProjectVisibility = 'private' | 'open'
export type StatusCategory = 'todo' | 'in_progress' | 'done'
export type IssueLevel = 'epic' | 'standard' | 'subtask'
export type IssuePriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest'
export type FieldKind = 'text' | 'number' | 'date' | 'select' | 'multi_select' | 'user' | 'url' | 'checkbox'
export type SprintState = 'future' | 'active' | 'closed'
export type ReleaseStatus = 'unreleased' | 'released' | 'archived'
export type LinkKind = 'blocks' | 'relates' | 'duplicates' | 'clones'
export type DocType = 'document' | 'spreadsheet' | 'presentation' | 'form' | 'drawing' | 'folder' | 'file'
export type NotificationKind = 'assigned' | 'mentioned' | 'commented' | 'status_changed'
export type NoteColor = 'yellow' | 'orange' | 'red' | 'pink' | 'purple' | 'blue' | 'teal' | 'green' | 'gray' | 'white'
export type IssueIcon = 'epic' | 'story' | 'task' | 'bug' | 'subtask' | 'spike' | 'improvement' | 'feature'

export type ChatEvent =
  | 'issue_created'
  | 'status_changed'
  | 'issue_assigned'
  | 'comment_added'
  | 'sprint_started'
  | 'sprint_completed'
  | 'release_released'
export type WorkspaceChatEvent = 'release_released'

export interface Profile {
  id: string
  email: string
  full_name: string
  title: string | null
  avatar_url: string | null
  app_role: AppRole
  active: boolean
  created_at: string
}

export interface Project {
  id: string
  key: string
  name: string
  description: string
  kind: ProjectKind
  visibility: ProjectVisibility
  lead_id: string | null
  color: string
  drive_folder_id: string | null
  archived_at: string | null
  created_at: string
}

export interface ProjectMember {
  project_id: string
  profile_id: string
  role: ProjectRole
}

export interface ProjectStatus {
  id: string
  project_id: string
  name: string
  category: StatusCategory
  position: number
  wip_limit: number | null
}

export interface IssueType {
  id: string
  name: string
  level: IssueLevel
  icon: IssueIcon
  color: string
  archived: boolean
}

export interface Field {
  id: string
  project_id: string
  name: string
  kind: FieldKind
  options: string[]
  issue_type_ids: string[] | null
  required: boolean
  position: number
}

export interface ProjectIntegrations {
  project_id: string
  chat_webhook_url: string | null
  chat_events: ChatEvent[]
}

export interface WorkspaceSettings {
  id: boolean
  chat_webhook_url: string | null
  chat_events: WorkspaceChatEvent[]
}

export interface Sprint {
  id: string
  project_id: string
  name: string
  goal: string
  state: SprintState
  start_date: string | null
  end_date: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface Release {
  id: string
  project_id: string
  name: string
  description: string
  start_date: string | null
  release_date: string | null
  status: ReleaseStatus
  released_at: string | null
  created_at: string
}

export type CustomValues = Record<string, string | number | boolean | string[]>

// What lists, boards and the backlog read (no description: see IssueDetail).
export interface Issue {
  id: string
  project_id: string
  number: number
  key: string
  type_id: string
  status_id: string
  title: string
  priority: IssuePriority
  assignee_id: string | null
  reporter_id: string | null
  parent_id: string | null
  sprint_id: string | null
  release_id: string | null
  story_points: number | null
  start_date: string | null
  due_date: string | null
  labels: string[]
  rank: number
  custom: CustomValues
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface IssueDetail extends Issue {
  description: string
  created_by: string | null
}

export interface IssueEvent {
  id: string
  issue_id: string
  project_id: string
  actor_id: string | null
  field: string
  from_value: string | null
  to_value: string | null
  from_id: string | null
  to_id: string | null
  created_at: string
}

export interface SprintIssue {
  sprint_id: string
  issue_id: string
  committed: boolean
  points_at_start: number | null
  points_at_end: number | null
  completed: boolean | null
}

export interface IssueLink {
  id: string
  source_id: string
  target_id: string
  kind: LinkKind
  created_at: string
}

export interface Comment {
  id: string
  issue_id: string
  author_id: string | null
  body: string
  created_at: string
  edited_at: string | null
}

export type DevLinkKind = 'branch' | 'commit' | 'pull_request'
export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed'

// A branch, commit or pull request on GitHub that names the issue's key.
// Written only by the `github` Edge Function.
export interface DevLink {
  id: string
  issue_id: string
  kind: DevLinkKind
  repo: string
  // The branch's name, the commit's sha, or the pull request's number.
  ref: string
  title: string
  url: string
  state: PullRequestState | null
  author: string | null
  happened_at: string
  updated_at: string
}

export interface Attachment {
  id: string
  issue_id: string
  drive_file_id: string
  file_name: string
  mime_type: string
  size_bytes: number
  web_view_link: string
  uploaded_by: string | null
  created_at: string
  // Added with this comment (null: added to the issue directly).
  comment_id: string | null
}

export interface Doc {
  id: string
  project_id: string
  issue_id: string | null
  title: string
  url: string
  doc_type: DocType
  drive_file_id: string | null
  created_by: string | null
  created_at: string
}

export interface SavedFilter {
  id: string
  owner_id: string
  name: string
  query: Record<string, unknown>
  shared: boolean
  created_at: string
}

// A meeting from your own Google Calendar, as the google-calendar function
// hands it over (never stored). All-day end dates are inclusive. Each
// occurrence of a repeating meeting has its own id.
export interface GoogleCalendarEvent {
  id: string
  title: string
  all_day: boolean
  start_date: string | null
  end_date: string | null
  starts_at: string | null
  ends_at: string | null
  url: string | null
  meeting_url: string | null
  location: string | null
  // Plain text.
  description: string | null
  organizer: { email: string; name: string | null } | null
  attendees: { email: string; name: string | null; response: 'accepted' | 'declined' | 'tentative' | 'needsAction' }[]
}

export interface Todo {
  id: string
  owner_id: string
  title: string
  notes: string
  due_on: string | null
  done_at: string | null
  issue_id: string | null
  // An issue's todo is in the issue's project; otherwise a project of its own, or none.
  project_id: string | null
  position: number
  created_at: string
  // Everyone on it besides its creator; they see, edit and tick it off too.
  shared_with: string[]
}

export interface NoteLabel {
  id: string
  owner_id: string
  name: string
  created_at: string
}

export interface Note {
  id: string
  owner_id: string
  title: string
  body: string
  color: NoteColor
  label_ids: string[]
  project_id: string | null
  // On the dashboard.
  pinned: boolean
  // The Google Calendar meeting it is about (one per person), with its title
  // and day copied in to show.
  meeting_id: string | null
  meeting_title: string | null
  meeting_on: string | null
  created_at: string
  updated_at: string
}

export interface Notification {
  id: string
  recipient_id: string
  actor_id: string | null
  kind: NotificationKind
  issue_id: string | null
  comment_id: string | null
  detail: string | null
  read_at: string | null
  created_at: string
}
