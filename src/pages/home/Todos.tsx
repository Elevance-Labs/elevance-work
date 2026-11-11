import { Paper } from '@mui/material'
import { PageHeader } from '../../components/common'
import TodoList from '../../components/TodoList'

export default function Todos() {
  return (
    <>
      <PageHeader title="Todos" subtitle="Yours, and the ones people add you to. Only the people on a todo see it. Tie one to an issue to keep the context." />
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, maxWidth: 860 }}>
        <TodoList />
      </Paper>
    </>
  )
}
