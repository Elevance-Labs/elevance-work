// The app's pages loaded when first shown (App's routes). Home comes with the
// shell; every other page is its own chunk.
import { lazyPage } from './components/lazyPage'

export const todos = lazyPage(() => import('./pages/home/Todos'))
export const notes = lazyPage(() => import('./pages/home/Notes'))
export const calendar = lazyPage(() => import('./pages/Calendar'))
export const issues = lazyPage(() => import('./pages/Issues'))
export const work = lazyPage(() => import('./pages/Work'))
export const browseIssue = lazyPage(() => import('./pages/BrowseIssue'))
export const projectLayout = lazyPage(() => import('./pages/project/ProjectLayout'))
export const summary = lazyPage(() => import('./pages/project/Summary'))
export const backlog = lazyPage(() => import('./pages/project/Backlog'))
export const board = lazyPage(() => import('./pages/project/Board'))
export const projectIssues = lazyPage(() => import('./pages/project/ProjectIssues'))
export const releases = lazyPage(() => import('./pages/project/Releases'))
export const releaseDetail = lazyPage(() => import('./pages/project/ReleaseDetail'))
export const timeline = lazyPage(() => import('./pages/project/Timeline'))
export const projectCalendar = lazyPage(() => import('./pages/project/ProjectCalendar'))
export const projectDocs = lazyPage(() => import('./pages/project/Docs'))
export const projectSettings = lazyPage(() => import('./pages/project/Settings'))
export const projectNotesRedirect = lazyPage(() => import('./pages/project/NotesRedirect'))
export const adminLayout = lazyPage(() => import('./pages/admin/AdminLayout'))
export const people = lazyPage(() => import('./pages/admin/People'))
export const issueTypes = lazyPage(() => import('./pages/admin/IssueTypes'))
export const workspaceSettings = lazyPage(() => import('./pages/admin/Workspace'))

// The sidebar's pages: parsed once the first screen is up, so a tap is instant.
export const NAV_PAGES = [calendar, work, todos, notes, issues]

/** Every lazy page, loaded now (tests, so nothing suspends mid-check). */
export const preloadAllPages = () => Promise.all([
  todos, notes, calendar, issues, work, browseIssue, projectLayout, summary, backlog, board, projectIssues,
  releases, releaseDetail, timeline, projectCalendar, projectDocs, projectSettings, projectNotesRedirect,
  adminLayout, people, issueTypes, workspaceSettings,
].map((p) => p.preload()))

