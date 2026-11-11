// An issue's files, kept in its project's Google Drive folder. Uploads and
// removals go through the drive function; images preview through it too, so
// they show without Drive cookies. Files added with a comment are listed
// here as well as under their comment (AttachmentList is shared).
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  IconButton,
  LinearProgress,
  Link as MuiLink,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { useMe } from '../../auth/AuthProvider'
import { can } from '../../lib/permissions'
import { formatBytes, timeAgo } from '../../lib/constants'
import { ATTACHMENT_MAX_BYTES, attachmentBlobUrl, deleteAttachment, isImage, tooBig, uploadFiles } from '../../lib/drive'
import type { Attachment, ProjectRole } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { ConfirmDialog, Section } from '../common'

function Thumbnail({ attachment, size, onOpen }: { attachment: Attachment; size: number; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoked = false
    let made: string | null = null
    if (isImage(attachment.mime_type)) {
      attachmentBlobUrl(attachment.id).then((u) => {
        made = u
        if (!revoked) setUrl(u)
        else if (u) URL.revokeObjectURL(u)
      })
    }
    return () => {
      revoked = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [attachment.id, attachment.mime_type])

  const box = { width: size, height: size, borderRadius: 1, flexShrink: 0, bgcolor: 'action.hover', display: 'grid', placeItems: 'center' }
  return url ? (
    <Box component="button" type="button" aria-label={`Preview ${attachment.file_name}`} onClick={() => onOpen(url)}
      sx={{ ...box, p: 0, border: 0, cursor: 'zoom-in', background: `center / cover no-repeat url(${url})` }} />
  ) : (
    <Box sx={box}><InsertDriveFileOutlinedIcon fontSize={size < 40 ? 'small' : 'medium'} sx={{ color: 'text.secondary' }} /></Box>
  )
}

/** Files with a thumbnail, a Drive link and (for the uploader or a project admin) a remove button. */
export function AttachmentList({
  attachments,
  role,
  dense,
  onRemoved,
}: {
  attachments: Attachment[]
  role: ProjectRole | null
  // Under a comment: smaller, and without saying a comment holds them.
  dense?: boolean
  onRemoved: (id: string) => void
}) {
  const me = useMe()
  const { profileById } = useWorkspace()
  const [preview, setPreview] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Attachment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!removing) return
    setBusy(true)
    const { error: e } = await deleteAttachment(removing.id)
    setBusy(false)
    if (e) return setError(e)
    onRemoved(removing.id)
    setRemoving(null)
  }

  if (!attachments.length) return null
  return (
    <>
      <Stack spacing={dense ? 0.75 : 1}>
        {attachments.map((a) => (
          <Stack key={a.id} direction="row" spacing={dense ? 1 : 1.5} sx={{ alignItems: 'center' }}>
            <Thumbnail attachment={a} size={dense ? 32 : 48} onOpen={setPreview} />
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <MuiLink href={a.web_view_link} target="_blank" rel="noopener noreferrer" variant="body2" noWrap sx={{ display: 'block' }}>
                {a.file_name}
              </MuiLink>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {formatBytes(a.size_bytes)}
                {!dense && <> · {profileById(a.uploaded_by)?.full_name ?? 'Someone'} · {timeAgo(a.created_at)}</>}
                {!dense && a.comment_id && ' · in a comment'}
              </Typography>
            </Box>
            <Tooltip title="Open in Google Drive">
              <IconButton size="small" component="a" href={a.web_view_link} target="_blank" rel="noopener noreferrer" aria-label={`Open ${a.file_name} in Drive`}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {can.deleteAttachment(a.uploaded_by, me, role) && (
              <Tooltip title="Remove (moves it to the Drive trash)">
                <IconButton size="small" aria-label={`Remove ${a.file_name}`} onClick={() => setRemoving(a)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        ))}
      </Stack>
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mt: 1 }}>{error}</Alert>}
      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="lg">
        <IconButton aria-label="Close" onClick={() => setPreview(null)} sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper' }}>
          <CloseIcon />
        </IconButton>
        <DialogContent sx={{ p: 1 }}>
          {preview && <Box component="img" src={preview} alt="" sx={{ maxWidth: '100%', maxHeight: '85vh', display: 'block' }} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!removing} title="Remove this file?" destructive confirmLabel="Remove" busy={busy}
        message={`${removing?.file_name} goes to the Google Drive trash, where an admin can still restore it.`}
        onConfirm={remove} onClose={() => setRemoving(null)} />
    </>
  )
}

/**
 * Files picked to go with a comment, before it's saved: a paperclip button
 * and a chip per file. The parent uploads them once the comment exists.
 */
export function PendingFiles({ files, onChange, label = 'Attach files to the comment' }: {
  files: File[]
  onChange: (files: File[]) => void
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Tooltip title="Attach files (kept in the project's Google Drive folder)">
        <IconButton size="small" aria-label="Attach files" onClick={() => input.current?.click()}>
          <AttachFileIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <input ref={input} type="file" multiple hidden aria-label={label}
        onChange={(e) => {
          onChange([...files, ...Array.from(e.target.files ?? [])])
          e.target.value = ''
        }} />
      {files.map((f, i) => (
        <Chip key={`${f.name}-${i}`} size="small" icon={<InsertDriveFileOutlinedIcon />} label={f.name}
          color={f.size > ATTACHMENT_MAX_BYTES ? 'error' : 'default'} title={f.size > ATTACHMENT_MAX_BYTES ? tooBig(f) : formatBytes(f.size)}
          onDelete={() => onChange(files.filter((_, j) => j !== i))} sx={{ maxWidth: 200 }} />
      ))}
    </>
  )
}

export default function Attachments({
  issueId,
  attachments,
  role,
  onChange,
}: {
  issueId: string
  attachments: Attachment[]
  role: ProjectRole | null
  onChange: (rows: Attachment[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const editable = can.editIssues(role)

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    let rows = attachments
    const list = Array.from(files)
    setUploading(list.length === 1 ? list[0].name : `${list.length} files`)
    const { error: e } = await uploadFiles(issueId, list, undefined, (row) => {
      rows = [...rows, row]
      onChange(rows)
    })
    setError(e)
    setUploading(null)
    if (input.current) input.current.value = ''
  }

  return (
    <Section
      title={`Attachments${attachments.length ? ` (${attachments.length})` : ''}`}
      action={editable && (
        <Tooltip title="Add files (kept in the project's Google Drive folder)">
          <Button size="small" startIcon={<AttachFileIcon />} onClick={() => input.current?.click()} disabled={!!uploading}>
            Attach
          </Button>
        </Tooltip>
      )}
    >
      <input ref={input} type="file" multiple hidden aria-label="Attach files to the issue" onChange={(e) => upload(e.target.files)} />
      {uploading && (
        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Uploading {uploading} to Drive…</Typography>
          <LinearProgress />
        </Box>
      )}
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>{error}</Alert>}
      {!attachments.length && !uploading && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>No files.</Typography>
      )}
      <AttachmentList attachments={attachments} role={role} onRemoved={(id) => onChange(attachments.filter((a) => a.id !== id))} />
    </Section>
  )
}
