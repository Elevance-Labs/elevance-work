// Your own notes on this project. Private to you, like every note: others
// see theirs here, not yours.
import { Typography } from '@mui/material'
import NotesBoard from '../../components/notes/NotesBoard'
import { useProject } from './projectContext'

export default function ProjectNotes() {
  const { project } = useProject()
  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Your notes on {project.name}. Only you can see them.
      </Typography>
      <NotesBoard scope={{ projectId: project.id }} urlFilters />
    </>
  )
}
