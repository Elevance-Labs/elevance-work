import { useCallback, useEffect, useState } from 'react'
import { Paper, Typography } from '@mui/material'
import { supabase } from '../../lib/supabase'
import type { Doc } from '../../lib/types'
import { Loading } from '../../components/common'
import DocsList from '../../components/DocsList'
import { useProject } from './projectContext'

// Every Google Doc, Sheet, Slides deck and Drive link of the project, its
// issues' included. New ones are made in the project's shared Drive folder.
export default function ProjectDocs() {
  const { project, role } = useProject()
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [keys, setKeys] = useState<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    const { data } = await supabase.from('documents').select('*').eq('project_id', project.id).order('created_at', { ascending: false })
    const rows = (data ?? []) as Doc[]
    setDocs(rows)
    const ids = [...new Set(rows.map((d) => d.issue_id).filter((x): x is string => !!x))]
    if (ids.length) {
      const { data: issues } = await supabase.from('issues').select('id, key').in('id', ids)
      setKeys(new Map(((issues ?? []) as { id: string; key: string }[]).map((i) => [i.id, i.key])))
    }
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  if (!docs) return <Loading />
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Specs, notes, sheets and decks for {project.name}. Anything made here lives in the project's folder in the shared Google Drive.
      </Typography>
      <DocsList projectId={project.id} docs={docs} role={role} onChange={setDocs} issueKeyOf={(id) => keys.get(id)} />
    </Paper>
  )
}
