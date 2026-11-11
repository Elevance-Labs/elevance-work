import IssueSearch from '../../components/IssueSearch'
import { useProject } from './projectContext'

export default function ProjectIssues() {
  const { project } = useProject()
  return <IssueSearch key={project.id} projectId={project.id} />
}
