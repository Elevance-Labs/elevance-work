import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { WorkspaceProvider } from './workspace/WorkspaceProvider'
import { NotificationsProvider } from './workspace/notifications'
import Layout from './components/Layout'
import { Splash } from './components/common'
import Login from './pages/Login'
// Home is where the app opens: it comes with the shell. Every other page is
// its own chunk, parsed when first shown (or when the browser is idle).
import Dashboard from './pages/home/Dashboard'
import { preloadWhenIdle } from './components/lazyPage'
import * as pages from './lazyPages'

function PreloadNavPages() {
  useEffect(() => preloadWhenIdle(pages.NAV_PAGES), [])
  return null
}

export default function App() {
  const { loading, profile, isAdmin } = useAuth()

  if (loading) return <Splash />
  if (!profile) return <Login />

  return (
    <WorkspaceProvider key={profile.id}>
      <NotificationsProvider>
      <PreloadNavPages />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/todos" element={<pages.todos.Page />} />
          <Route path="/notes" element={<pages.notes.Page />} />
          <Route path="/calendar" element={<pages.calendar.Page />} />
          <Route path="/issues" element={<pages.issues.Page />} />
          <Route path="/work" element={<pages.work.Page />} />
          {/* Work replaced the projects list. */}
          <Route path="/projects" element={<Navigate to="/work" replace />} />
          <Route path="/browse/:key" element={<pages.browseIssue.Page />} />
          {/* Each project page checks the project is visible; settings also that you administer it. */}
          <Route path="/projects/:key" element={<pages.projectLayout.Page />}>
            <Route index element={<pages.summary.Page />} />
            <Route path="backlog" element={<pages.backlog.Page />} />
            <Route path="board" element={<pages.board.Page />} />
            <Route path="issues" element={<pages.projectIssues.Page />} />
            <Route path="tests" element={<pages.projectTests.Page />} />
            <Route path="releases" element={<pages.releases.Page />} />
            <Route path="releases/:releaseId" element={<pages.releaseDetail.Page />} />
            <Route path="timeline" element={<pages.timeline.Page />} />
            <Route path="calendar" element={<pages.projectCalendar.Page />} />
            {/* Reports are Summary widgets now; old links land there. */}
            <Route path="reports" element={<Navigate to=".." relative="path" replace />} />
            <Route path="docs" element={<pages.projectDocs.Page />} />
            {/* Your notes on a project live in Notes, filtered to it. */}
            <Route path="notes" element={<pages.projectNotesRedirect.Page />} />
            <Route path="settings" element={<pages.projectSettings.Page />} />
          </Route>
          {isAdmin && (
            <Route path="/admin" element={<pages.adminLayout.Page />}>
              <Route index element={<Navigate to="/admin/people" replace />} />
              <Route path="people" element={<pages.people.Page />} />
              <Route path="issue-types" element={<pages.issueTypes.Page />} />
              <Route path="workspace" element={<pages.workspaceSettings.Page />} />
            </Route>
          )}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
      </NotificationsProvider>
    </WorkspaceProvider>
  )
}
