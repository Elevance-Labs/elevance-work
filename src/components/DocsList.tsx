// Google Docs, Sheets, Slides and Drive links for a project or one issue:
// make a new one in the project's Drive folder, link an existing one, preview
// it here, open it in Google.
import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogTitle,
  IconButton,
  Link as MuiLink,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined'
import CloseIcon from '@mui/icons-material/Close'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import SlideshowOutlinedIcon from '@mui/icons-material/SlideshowOutlined'
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { can } from '../lib/permissions'
import { DOC_TYPE_LABELS, errorMessage, timeAgo } from '../lib/constants'
import { createDoc, docTypeFromUrl, embedUrl, type CreatableDocType } from '../lib/drive'
import type { Doc, DocType, ProjectRole } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { ConfirmDialog, FormDialog } from './common'

const ICON: Record<DocType, typeof ArticleOutlinedIcon> = {
  document: ArticleOutlinedIcon,
  spreadsheet: TableChartOutlinedIcon,
  presentation: SlideshowOutlinedIcon,
  form: ArticleOutlinedIcon,
  drawing: InsertDriveFileOutlinedIcon,
  folder: FolderOutlinedIcon,
  file: InsertDriveFileOutlinedIcon,
}

const HEX: Record<DocType, string> = {
  document: '#4285f4',
  spreadsheet: '#0f9d58',
  presentation: '#f4b400',
  form: '#7248b9',
  drawing: '#db4437',
  folder: '#5f6368',
  file: '#5f6368',
}

export function DocIcon({ type }: { type: DocType }) {
  const Icon = ICON[type]
  return <Icon sx={{ color: HEX[type] }} />
}

const NEW: { type: CreatableDocType; label: string }[] = [
  { type: 'document', label: 'Google Doc' },
  { type: 'spreadsheet', label: 'Google Sheet' },
  { type: 'presentation', label: 'Google Slides' },
]

export default function DocsList({
  projectId,
  issueId = null,
  docs,
  role,
  onChange,
  issueKeyOf,
  dense,
}: {
  projectId: string
  issueId?: string | null
  docs: Doc[]
  role: ProjectRole | null
  onChange: (docs: Doc[]) => void
  // On the project page, which issue a doc belongs to.
  issueKeyOf?: (issueId: string) => string | undefined
  dense?: boolean
}) {
  const me = useMe()
  const { profileById } = useWorkspace()
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [making, setMaking] = useState<CreatableDocType | null>(null)
  const [linking, setLinking] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Doc | null>(null)
  const [unlinking, setUnlinking] = useState<Doc | null>(null)

  async function make() {
    if (!making || !title.trim()) return setError('Give it a title.')
    setBusy(true)
    setError(null)
    const { data, error: e } = await createDoc(projectId, title.trim(), making, issueId)
    setBusy(false)
    if (e || !data) return setError(e ?? 'Google Drive is not reachable right now.')
    onChange([data, ...docs])
    setMaking(null)
    setTitle('')
    window.open(data.url, '_blank', 'noopener')
  }

  async function link() {
    const type = docTypeFromUrl(url)
    if (!type) return setError('Paste a link to a Google Doc, Sheet, Slides or a Drive file or folder.')
    if (!title.trim()) return setError('Give it a title.')
    setBusy(true)
    setError(null)
    const { data, error: e } = await supabase.from('documents')
      .insert({ project_id: projectId, issue_id: issueId, title: title.trim(), url: url.trim(), doc_type: type }).select().single()
    setBusy(false)
    if (e || !data) return setError(errorMessage(e))
    onChange([data as Doc, ...docs])
    setLinking(false)
    setTitle('')
    setUrl('')
  }

  async function unlink() {
    if (!unlinking) return
    setBusy(true)
    const { error: e } = await supabase.from('documents').delete().eq('id', unlinking.id)
    setBusy(false)
    if (e) return setError(errorMessage(e))
    onChange(docs.filter((d) => d.id !== unlinking.id))
    setUnlinking(null)
  }

  const embed = preview ? embedUrl(preview.url) : null

  return (
    <Box>
      {can.addDocs(role) && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Button size="small" variant={dense ? 'text' : 'outlined'} startIcon={<AddIcon />} onClick={(e) => setMenu(e.currentTarget)}>
            New
          </Button>
          <Button size="small" startIcon={<LinkIcon />} onClick={() => { setLinking(true); setError(null) }}>
            Link existing
          </Button>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            {NEW.map((n) => (
              <MenuItem key={n.type} onClick={() => { setMenu(null); setMaking(n.type); setError(null) }}>
                <ListItemIcon><DocIcon type={n.type} /></ListItemIcon>
                {n.label}
              </MenuItem>
            ))}
          </Menu>
        </Stack>
      )}
      {error && !making && !linking && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>{error}</Alert>}
      {!docs.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>No documents yet.</Typography>}
      <Stack spacing={1}>
        {docs.map((d) => (
          <Stack key={d.id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <DocIcon type={d.doc_type} />
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <MuiLink href={d.url} target="_blank" rel="noopener noreferrer" variant="body2" noWrap sx={{ display: 'block', fontWeight: 500 }}>
                {d.title}
              </MuiLink>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {DOC_TYPE_LABELS[d.doc_type]}
                {d.issue_id && issueKeyOf?.(d.issue_id) ? ` · ${issueKeyOf(d.issue_id)}` : ''}
                {' · '}{profileById(d.created_by)?.full_name ?? 'Someone'} · {timeAgo(d.created_at)}
              </Typography>
            </Box>
            {embedUrl(d.url) && (
              <Tooltip title="Preview">
                <IconButton size="small" aria-label={`Preview ${d.title}`} onClick={() => setPreview(d)}>
                  <VisibilityOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Open in Google">
              <IconButton size="small" component="a" href={d.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${d.title}`}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {can.deleteDoc(d.created_by, me, role) && (
              <Tooltip title="Unlink (the file stays in Drive)">
                <IconButton size="small" aria-label={`Unlink ${d.title}`} onClick={() => setUnlinking(d)}>
                  <LinkOffIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        ))}
      </Stack>

      <FormDialog open={!!making} title={`New ${making ? DOC_TYPE_LABELS[making] : ''}`} submitLabel="Create in Drive" busy={busy}
        error={error} maxWidth="xs" onSubmit={make} onClose={() => setMaking(null)}>
        <TextField label="Title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          It's made in the project's folder in the shared Google Drive and opens in a new tab.
        </Typography>
      </FormDialog>
      <FormDialog open={linking} title="Link a Google file" submitLabel="Link" busy={busy} error={error} maxWidth="xs"
        onSubmit={link} onClose={() => setLinking(false)}>
        <TextField label="Link" autoFocus placeholder="https://docs.google.com/…" value={url} onChange={(e) => {
          setUrl(e.target.value)
          if (!title) {
            const t = docTypeFromUrl(e.target.value)
            if (t) setTitle(DOC_TYPE_LABELS[t])
          }
        }} />
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </FormDialog>
      <ConfirmDialog open={!!unlinking} title="Unlink this document?" confirmLabel="Unlink" busy={busy}
        message="It's only removed from here; the file itself stays in Google Drive." onConfirm={unlink} onClose={() => setUnlinking(null)} />
      <Dialog open={!!preview} onClose={() => setPreview(null)} fullWidth maxWidth="lg" slotProps={{ paper: { sx: { height: '90vh' } } }}>
        <DialogTitle sx={{ pr: 12, display: 'flex', alignItems: 'center', gap: 1 }}>
          {preview && <DocIcon type={preview.doc_type} />}
          <Typography variant="h6" component="span" noWrap>{preview?.title}</Typography>
        </DialogTitle>
        <Stack direction="row" sx={{ position: 'absolute', top: 12, right: 12 }}>
          <Tooltip title="Open in Google to edit">
            <IconButton component="a" href={preview?.url} target="_blank" rel="noopener noreferrer" aria-label="Open in Google">
              <OpenInNewIcon />
            </IconButton>
          </Tooltip>
          <IconButton aria-label="Close" onClick={() => setPreview(null)}><CloseIcon /></IconButton>
        </Stack>
        {embed && <Box component="iframe" title={preview?.title} src={embed} sx={{ border: 0, width: '100%', flexGrow: 1 }} />}
      </Dialog>
    </Box>
  )
}
