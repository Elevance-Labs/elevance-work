import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { WorkspaceProvider } from './workspace/WorkspaceProvider'
import { NotificationsProvider } from './workspace/notifications'
import Layout from './components/Layout'
import { Splash } from './components/common'
import Login from './pages/Login'
import Dashboard from './pages/home/Dashboard'
import Todos from './pages/home/Todos'
import Notes from './pages/home/Notes'
import Calendar from './pages/Calendar'
import Issues from './pages/Issues'
import Projects from './pages/Projects'
import BrowseIssue from './pages/BrowseIssue'
import ProjectLayout from './pages/project/ProjectLayout'
import Summary from './pages/project/Summary'
import Backlog from './pages/project/Backlog'
import Board from './pages/project/Board'
import ProjectIssues from './pages/project/ProjectIssues'
import Releases from './pages/project/Releases'
import ReleaseDetail from './pages/project/ReleaseDetail'
import Reports from './pages/project/Reports'
import Timeline from './pages/project/Timeline'
import ProjectCalendar from './pages/project/ProjectCalendar'
import ProjectDocs from './pages/project/Docs'
import ProjectNotes from './pages/project/Notes'
import ProjectSettings from './pages/project/Settings'
import People from './pages/admin/People'
import IssueTypes from './pages/admin/IssueTypes'
import WorkspaceSettings from './pages/admin/Workspace'

export default function App() {
  const { loading, profile, isAdmin } = useAuth()

  if (loading) return <Splash />
  if (!profile) return <Login />

  return (
    <WorkspaceProvider key={profile.id}>
      <NotificationsProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/todos" element={<Todos />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/issues" element={<Issues />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/browse/:key" element={<BrowseIssue />} />
          {/* Each project page checks the project is visible; settings also that you administer it. */}
          <Route path="/projects/:key" element={<ProjectLayout />}>
            <Route index element={<Summary />} />
            <Route path="backlog" element={<Backlog />} />
            <Route path="board" element={<Board />} />
            <Route path="issues" element={<ProjectIssues />} />
            <Route path="releases" element={<Releases />} />
            <Route path="releases/:releaseId" element={<ReleaseDetail />} />
            <Route path="timeline" element={<Timeline />} />
            <Route path="calendar" element={<ProjectCalendar />} />
            <Route path="reports" element={<Reports />} />
            <Route path="docs" element={<ProjectDocs />} />
            <Route path="notes" element={<ProjectNotes />} />
            <Route path="settings" element={<ProjectSettings />} />
          </Route>
          {isAdmin && (
            <>
              <Route path="/admin/people" element={<People />} />
              <Route path="/admin/issue-types" element={<IssueTypes />} />
              <Route path="/admin/workspace" element={<WorkspaceSettings />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
      </NotificationsProvider>
    </WorkspaceProvider>
  )
}
