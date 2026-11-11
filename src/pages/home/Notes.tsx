import { PageHeader } from '../../components/common'
import NotesBoard from '../../components/notes/NotesBoard'

export default function Notes() {
  return (
    <>
      <PageHeader title="Notes" subtitle="Your own notes: only you can see them. Link one to a project or a meeting to find it there." />
      <NotesBoard urlFilters />
    </>
  )
}
