// A release's notes, at the top of its page: what shipped, written for people
// outside the team (public one day; the description stays internal).
// Managers write them, starting from a draft of what is done; once every
// approver approved they are locked. Copy as text, or save as a Google Doc.
import { lazy, Suspense, useState } from 'react'
import { Box, Button, Paper, Stack, Tooltip, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/constants'
import { createDoc } from '../../lib/drive'
import { isBlankHtml, sanitizeHtml } from '../../lib/richText'
import { LOCKED_HINT, draftNotesHtml, notesHtml, notesText, type NotesSection } from '../../lib/releases'
import type { Project, Release } from '../../lib/types'
import { invalidateProjectMeta } from '../../workspace/useProjectMeta'
import { Loading } from '../common'
import { RichTextView } from '../RichTextView'

// The editor is heavy: only load it to write.
const RichTextEditor = lazy(() => import('../RichText').then((m) => ({ default: m.RichTextEditor })))

export default function ReleaseNotesCard({ project, release, sections, canEdit, canSaveDoc, locked, onError, onNotice }: {
  project: Project
  release: Release
  /** What is done, by kind of work: the draft. */
  sections: NotesSection[]
  canEdit: boolean
  canSaveDoc: boolean
  locked: boolean
  onError: (message: string | null) => void
  onNotice: (message: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editorKey, setEditorKey] = useState(0)
  const [busy, setBusy] = useState<'save' | 'doc' | null>(null)
  const written = !isBlankHtml(release.notes)
  const editable = canEdit && release.status !== 'archived'

  function startEditing(html: string) {
    setDraft(html)
    setEditorKey((k) => k + 1)
    setEditing(true)
  }

  function addDraft() {
    const next = (isBlankHtml(draft) ? '' : draft) + draftNotesHtml(sections)
    setDraft(next)
    setEditorKey((k) => k + 1)
  }

  async function save() {
    setBusy('save')
    onError(null)
    const notes = isBlankHtml(draft) ? '' : sanitizeHtml(draft)
    const { error } = await supabase.from('releases').update({ notes }).eq('id', release.id)
    setBusy(null)
    if (error) return onError(errorMessage(error))
    await invalidateProjectMeta(project.id)
    setEditing(false)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(notesText(project.name, release))
      onNotice('Release notes copied.')
    } catch {
      onError("Your browser didn't allow copying. Select the notes and copy them instead.")
    }
  }

  async function saveAsDoc() {
    setBusy('doc')
    onError(null)
    const { data, error } = await createDoc(project.id, `${project.name} ${release.name} release notes`, 'document', null,
      notesHtml(project.name, release))
    setBusy(null)
    if (error || !data) return onError(error ?? 'Google Drive is not reachable right now.')
    onNotice('Saved as a Google Doc in the project folder (see Docs).')
    window.open(data.url, '_blank', 'noopener')
  }

  const draftButton = sections.length > 0 && (
    <Button size="small" startIcon={<AutoAwesomeOutlinedIcon />} onClick={() => (editing ? addDraft() : startEditing(draftNotesHtml(sections)))}>
      Draft from done issues
    </Button>
  )

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} data-release-notes>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h2">Release notes</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>What shipped, for people outside the team</Typography>
        </Box>
        {!editing && written && (
          <>
            <Tooltip title="Copy as text">
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={copy}>Copy</Button>
            </Tooltip>
            {canSaveDoc && <Button size="small" onClick={saveAsDoc} loading={busy === 'doc'}>Save as Google Doc</Button>}
          </>
        )}
        {!editing && editable && written && (
          <Tooltip title={locked ? LOCKED_HINT : ''}>
            <span>
              <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} disabled={locked}
                onClick={() => startEditing(release.notes)}>Edit notes</Button>
            </span>
          </Tooltip>
        )}
      </Stack>

      {editing ? (
        <Stack spacing={1.5}>
          <Suspense fallback={<Loading minHeight={180} />}>
            <RichTextEditor key={editorKey} label="Release notes" value={draft} onChange={setDraft} minHeight={180} autoFocus
              placeholder="What's new, what changed, what was fixed" onSubmit={save} />
          </Suspense>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {draftButton}
            <Box sx={{ flexGrow: 1 }} />
            <Button onClick={() => setEditing(false)} disabled={busy === 'save'}>Cancel</Button>
            <Button variant="contained" onClick={save} loading={busy === 'save'}>Save notes</Button>
          </Stack>
        </Stack>
      ) : written ? (
        <RichTextView html={release.notes} />
      ) : (
        <Box>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No release notes yet.{editable ? '' : ' Its managers write them.'}
          </Typography>
          {editable && (
            <Tooltip title={locked ? LOCKED_HINT : ''}>
              <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
                <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} disabled={locked} onClick={() => startEditing('')}>
                  Write notes
                </Button>
                {!locked && draftButton}
              </Stack>
            </Tooltip>
          )}
        </Box>
      )}
    </Paper>
  )
}
