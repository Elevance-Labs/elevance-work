// Your notes as sticky notes: the notes page (every note, with search and
// filters), a project's notes tab, and the dashboard's pinned notes all use
// this, scoped to what they show. Pinned notes come first. Notes are private (RLS), so the query
// is only ever for your own; the filters run on what is loaded. Archived
// notes are their own view (the toolbar's Archived), where they are restored
// or deleted; nowhere else shows them.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import PushPinIcon from '@mui/icons-material/PushPin'
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined'
import SearchIcon from '@mui/icons-material/Search'
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined'
import { useMe } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { errorMessage, timeAgo } from '../../lib/constants'
import {
  EMPTY_NOTE_FILTER,
  NOTE_COLORS,
  noteColor,
  NOTE_COLOR_KEYS,
  NOTE_COLUMNS,
  byPinnedThenRecent,
  isNoteFilterEmpty,
  matchesNote,
  meetingLabel,
  noteFilterFromParams,
  noteFilterToParams,
  noteHeading,
  type NoteFilter,
  type NoteRow,
} from '../../lib/notes'
import type { NoteLabel } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { EmptyState, Loading } from '../common'
import NoteDialog, { type NoteDefaults } from './NoteDialog'
import NoteLabelsDialog from './NoteLabelsDialog'
import { useItemChanges } from '../../workspace/itemEvents'

export interface NotesScope {
  projectId?: string
  // Only pinned notes (the dashboard); new ones are pinned.
  pinned?: boolean
}

function NoteCard({
  note,
  labels,
  hide,
  onOpen,
}: {
  note: NoteRow
  labels: Map<string, NoteLabel>
  hide: { project?: boolean }
  onOpen: () => void
}) {
  const { projectById } = useWorkspace()
  const project = hide.project ? undefined : projectById(note.project_id)
  const heading = noteHeading(note)
  const body = note.title.trim() ? note.body.trim() : note.body.trim().split('\n').slice(1).join('\n').trim()
  const noteLabels = note.label_ids.map((id) => labels.get(id)).filter((l): l is NoteLabel => !!l)
  return (
    <ButtonBase onClick={onOpen} aria-label={`Note: ${heading}`} data-note={note.id}
      sx={{ display: 'block', width: '100%', textAlign: 'left', p: 1.5, borderRadius: 2, bgcolor: (t) => noteColor(note.color, t.palette.mode),
        border: 1, borderColor: 'divider', boxShadow: '0 1px 2px rgba(0,0,0,0.08)', breakInside: 'avoid', mb: 2,
        transition: 'box-shadow 120ms', '&:hover': { boxShadow: '0 3px 8px rgba(0,0,0,0.16)' } }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="subtitle2" sx={{ wordBreak: 'break-word', flexGrow: 1 }}>{heading}</Typography>
        {note.pinned && <PushPinIcon aria-label="Pinned" sx={{ fontSize: 16, color: 'text.secondary', transform: 'rotate(30deg)' }} />}
      </Stack>
      {body && (
        <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: '-webkit-box',
          WebkitLineClamp: 12, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {body}
        </Typography>
      )}
      {(noteLabels.length > 0 || project || note.meeting_id) && (
        <Stack direction="row" sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
          {noteLabels.map((l) => <Chip key={l.id} size="small" label={l.name} sx={{ bgcolor: 'action.selected' }} />)}
          {project && <Chip size="small" variant="outlined" label={project.name} />}
          {note.meeting_id && <Chip size="small" variant="outlined" icon={<EventOutlinedIcon />} label={meetingLabel(note)} />}
        </Stack>
      )}
      <Typography variant="caption" component="div" sx={{ mt: 1, color: 'text.secondary' }}>Edited {timeAgo(note.updated_at)}</Typography>
    </ButtonBase>
  )
}

export default function NotesBoard({
  scope = {},
  urlFilters,
  compact,
}: {
  scope?: NotesScope
  // Keep the search and filters in the URL (the notes page and project tab).
  urlFilters?: boolean
  // A short list with no filters, as on the dashboard.
  compact?: boolean
}) {
  const me = useMe()
  const { projects, projectById } = useWorkspace()
  const [params, setParams] = useSearchParams()
  // Held here (router updates are transitions, which a controlled search box
  // can't wait on) and mirrored to the address when asked.
  const [filter, setFilterState] = useState<NoteFilter>(() => (urlFilters ? noteFilterFromParams(params) : EMPTY_NOTE_FILTER))
  const setFilter = (patch: Partial<NoteFilter>) => {
    const next = { ...filter, ...patch }
    setFilterState(next)
    if (urlFilters) setParams(noteFilterToParams(next), { replace: true })
  }
  const [notes, setNotes] = useState<NoteRow[] | null>(null)
  const [labels, setLabels] = useState<NoteLabel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{ note: NoteRow | null } | null>(null)
  const [managing, setManaging] = useState(false)
  const { projectId, pinned } = scope

  const load = useCallback(async () => {
    let q = supabase.from('notes').select(NOTE_COLUMNS).eq('owner_id', me.id)
    if (projectId) q = q.eq('project_id', projectId)
    if (pinned) q = q.eq('pinned', true)
    const [n, l] = await Promise.all([q, supabase.from('note_labels').select('*').eq('owner_id', me.id).order('name')])
    if (n.error) setError(errorMessage(n.error))
    setNotes(((n.data ?? []) as unknown as NoteRow[]).sort(byPinnedThenRecent))
    setLabels((l.data ?? []) as NoteLabel[])
  }, [me.id, projectId, pinned])

  useEffect(() => {
    load()
  }, [load])
  useItemChanges(['note'], load)

  // ?note=ID (from search) opens that note, once it's loaded.
  const noteParam = urlFilters ? params.get('note') : null
  useEffect(() => {
    if (!noteParam || !notes) return
    const found = notes.find((n) => n.id === noteParam)
    if (found) setOpen({ note: found })
    setParams((p) => {
      const next = new URLSearchParams(p)
      next.delete('note')
      return next
    }, { replace: true })
  }, [noteParam, notes, setParams])

  const labelMap = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])
  const projectName = (id: string | null) => projectById(id)?.name
  if (!notes) return compact ? null : <Loading />

  const archive = filter.archived
  const inView = notes.filter((n) => !!n.archived_at === archive)
  const shown = inView.filter((n) => matchesNote(n, filter, { labels: labelMap, projectName }))
  const defaults: NoteDefaults = { project_id: projectId ?? null, pinned: !!pinned }
  const hide = { project: !!projectId }

  const saved = (note: NoteRow) => {
    // A note moved off this project, or unpinned from the dashboard, leaves its list.
    const inScope = (!projectId || note.project_id === projectId) && (!pinned || note.pinned)
    setNotes((ns) => [...(inScope ? [note] : []), ...(ns ?? []).filter((n) => n.id !== note.id)].sort(byPinnedThenRecent))
  }
  const deleted = (id: string) => {
    setNotes((ns) => (ns ?? []).filter((n) => n.id !== id))
    setOpen(null)
  }
  const labelGone = (id: string) =>
    setNotes((ns) => (ns ?? []).map((n) => (n.label_ids.includes(id) ? { ...n, label_ids: n.label_ids.filter((x) => x !== id) } : n)))

  const newButton = (
    <Button variant={compact ? 'text' : 'contained'} size={compact ? 'small' : 'medium'} startIcon={<AddIcon />}
      onClick={() => setOpen({ note: null })}>
      {compact ? 'Add a note' : 'New note'}
    </Button>
  )

  const toolbar = !compact && (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 2, alignItems: { md: 'center' } }}>
      <TextField placeholder="Search your notes" value={filter.text} onChange={(e) => setFilter({ text: e.target.value })}
        sx={{ flexGrow: 1, maxWidth: { md: 360 } }}
        slotProps={{
          htmlInput: { 'aria-label': 'Search notes' },
          input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
        }} />
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <TextField select value={filter.label} onChange={(e) => setFilter({ label: e.target.value })} sx={{ minWidth: 150 }}
          slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Label' } }}>
          <MenuItem value="">All labels</MenuItem>
          {labels.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
          <MenuItem value="none">No label</MenuItem>
        </TextField>
        <TextField select value={filter.color} onChange={(e) => setFilter({ color: e.target.value as NoteFilter['color'] })} sx={{ minWidth: 130 }}
          slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Colour' } }}>
          <MenuItem value="">Any colour</MenuItem>
          {NOTE_COLOR_KEYS.map((c) => (
            <MenuItem key={c} value={c}>
              <Box component="span" sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: (t) => noteColor(c, t.palette.mode), border: 1,
                borderColor: 'divider', mr: 1, display: 'inline-block', verticalAlign: 'middle' }} />
              {NOTE_COLORS[c].label}
            </MenuItem>
          ))}
        </TextField>
        {!projectId && (
          <TextField select value={filter.project} onChange={(e) => setFilter({ project: e.target.value })} sx={{ minWidth: 150 }}
            slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Project' } }}>
            <MenuItem value="">All projects</MenuItem>
            {projects.filter((p) => !p.archived_at || p.id === filter.project).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
        )}
        {!isNoteFilterEmpty(filter) && <Button onClick={() => setFilter({ ...EMPTY_NOTE_FILTER, archived: archive })}>Clear</Button>}
      </Stack>
      <Box sx={{ flexGrow: 1 }} />
      <Stack direction="row" spacing={1}>
        <Button startIcon={<ArchiveOutlinedIcon />} variant={archive ? 'outlined' : 'text'} aria-pressed={archive}
          onClick={() => setFilter({ archived: !archive })}>
          Archived
        </Button>
        <Button startIcon={<LabelOutlinedIcon />} onClick={() => setManaging(true)}>Labels</Button>
        {!archive && newButton}
      </Stack>
    </Stack>
  )

  return (
    <Box>
      {toolbar}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {compact ? (
        <>
          {shown.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {pinned ? 'Pin a note to keep it here. Only you see your notes.' : 'None yet. Only you will see the ones you add.'}
            </Typography>
          )}
          <Box sx={{ mt: 1 }}>{shown.map((n) => <NoteCard key={n.id} note={n} labels={labelMap} hide={hide} onOpen={() => setOpen({ note: n })} />)}</Box>
          {newButton}
        </>
      ) : archive && inView.length === 0 ? (
        <EmptyState icon={<ArchiveOutlinedIcon />} title="Nothing archived">
          Archive a note to put it away. Archived notes can be restored, or deleted for good.
        </EmptyState>
      ) : inView.length === 0 ? (
        <EmptyState icon={<StickyNote2OutlinedIcon />} title="No notes yet">
          {projectId ? 'Notes you link to this project show here.' : 'Jot something down.'} Only you can see your notes.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState title="No notes match">Try other words or filters.</EmptyState>
      ) : (
        <Box sx={{ columnWidth: 240, columnGap: 2 }}>
          {shown.map((n) => <NoteCard key={n.id} note={n} labels={labelMap} hide={hide} onOpen={() => setOpen({ note: n })} />)}
        </Box>
      )}
      {open && (
        <NoteDialog note={open.note} defaults={defaults} labels={labels}
          onLabelCreated={(l) => setLabels((ls) => [...ls, l].sort((a, b) => a.name.localeCompare(b.name)))}
          onClose={() => setOpen(null)} onSaved={saved} onDeleted={deleted} />
      )}
      {managing && (
        <NoteLabelsDialog labels={labels} usage={(id) => notes.filter((n) => n.label_ids.includes(id)).length}
          onChange={setLabels} onDeleted={labelGone} onClose={() => setManaging(false)} />
      )}
    </Box>
  )
}
