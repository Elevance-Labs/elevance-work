// A project has no notes tab: your notes on it are in Notes, filtered to it.
// Old links to /projects/:key/notes land there.
import { Navigate } from 'react-router-dom'
import { useProject } from './projectContext'

export default function ProjectNotesRedirect() {
  const { project } = useProject()
  return <Navigate to={`/notes?project=${project.id}`} replace />
}
