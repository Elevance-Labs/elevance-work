// An issue's comments, newest first. A comment may carry files: they are
// issue attachments that name the comment, uploaded once it is saved (the
// drive function only takes files for your own comment). Anyone who may
// comment gives a comment a thumbs up or down: one each, again to take it back.
import { useState } from 'react'
import { Alert, Box, Button, ButtonBase, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import ThumbDownIcon from '@mui/icons-material/ThumbDown'
import ThumbDownOutlinedIcon from '@mui/icons-material/ThumbDownOutlined'
import ThumbUpIcon from '@mui/icons-material/ThumbUp'
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined'
import { useMe } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { uploadFiles } from '../../lib/drive'
import { can } from '../../lib/permissions'
import { errorMessage, formatDayTime, timeAgo } from '../../lib/constants'
import { isBlankHtml, sanitizeHtml } from '../../lib/richText'
import type { Attachment, Comment, CommentReaction, Profile, ProjectRole, ReactionKind } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { ConfirmDialog, PersonAvatar } from '../common'
import { RichTextEditor } from '../RichText'
import { RichTextView } from '../RichTextView'
import { AttachmentList, PendingFiles } from './Attachments'

// Changes to the issue's attachments, as the comments make them.
interface FileChanges {
  onAdded: (rows: Attachment[]) => void
  onRemoved: (id: string) => void
}

function Composer({
  issueId,
  role,
  mentionables,
  files: fileChanges,
  onSent,
  onFileError,
}: {
  issueId: string
  role: ProjectRole | null
  mentionables: Profile[]
  files: FileChanges
  onSent: (c: Comment) => void
  // The comment is saved by then; a file that didn't make it is said above the list.
  onFileError: (message: string) => void
}) {
  const me = useMe()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [key, setKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (isBlankHtml(body) || busy) return
    setBusy(true)
    setError(null)
    const { data, error: e } = await supabase.from('comments').insert({ issue_id: issueId, body: sanitizeHtml(body) }).select().single()
    if (e || !data) {
      setBusy(false)
      return setError(errorMessage(e))
    }
    const comment = data as Comment
    onSent(comment)
    if (files.length) {
      setUploading(true)
      const { rows, error: fileError } = await uploadFiles(issueId, files, comment.id)
      setUploading(false)
      if (rows.length) fileChanges.onAdded(rows)
      if (fileError) onFileError(`The comment is saved, but not every file: ${fileError}`)
    }
    setBusy(false)
    setBody('')
    setFiles([])
    setKey((k) => k + 1)
    setOpen(false)
  }

  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <PersonAvatar person={me} size={32} />
      {open ? (
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <RichTextEditor key={key} label="Comment" value={body} onChange={setBody} mentionables={mentionables} autoFocus
            minHeight={80} placeholder="Type @ to mention someone" onSubmit={send} />
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
          {uploading && <LinearProgress aria-label="Uploading files to Drive" sx={{ mt: 1 }} />}
          <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="contained" size="small" loading={busy} disabled={isBlankHtml(body)} onClick={send}>Save</Button>
            <Button size="small" disabled={busy} onClick={() => { setOpen(false); setFiles([]) }}>Cancel</Button>
            {can.attachToComment(me.id, me, role) && <PendingFiles files={files} onChange={setFiles} />}
            <Typography variant="caption" sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
              Ctrl/⌘ + Enter to save
            </Typography>
          </Stack>
        </Box>
      ) : (
        <ButtonBase
          onClick={() => setOpen(true)}
          sx={{ flexGrow: 1, justifyContent: 'flex-start', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1,
            color: 'text.secondary', typography: 'body2' }}
        >
          Add a comment…
        </ButtonBase>
      )}
    </Stack>
  )
}

type ReactionsUpdate = (update: (rows: CommentReaction[]) => CommentReaction[]) => void

const REACTIONS: { kind: ReactionKind; label: string; on: typeof ThumbUpIcon; off: typeof ThumbUpIcon }[] = [
  { kind: 'up', label: 'Thumbs up', on: ThumbUpIcon, off: ThumbUpOutlinedIcon },
  { kind: 'down', label: 'Thumbs down', on: ThumbDownIcon, off: ThumbDownOutlinedIcon },
]

// A comment's thumbs up and down: counts, who, and yours lit.
function Reactions({
  comment,
  reactions,
  canReact,
  onChange,
  onError,
}: {
  comment: Comment
  // This comment's.
  reactions: CommentReaction[]
  canReact: boolean
  onChange: ReactionsUpdate
  onError: (message: string | null) => void
}) {
  const me = useMe()
  const { profileById } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const mine = reactions.find((r) => r.profile_id === me.id)

  async function react(kind: ReactionKind) {
    if (busy) return
    setBusy(true)
    onError(null)
    const others = (rows: CommentReaction[]) => rows.filter((r) => !(r.comment_id === comment.id && r.profile_id === me.id))
    // The same again takes it back; the other one switches.
    if (mine?.kind === kind) {
      const { error } = await supabase.from('comment_reactions').delete().eq('comment_id', comment.id).eq('profile_id', me.id)
      setBusy(false)
      if (error) return onError(errorMessage(error))
      return onChange(others)
    }
    const { data, error } = mine
      ? await supabase.from('comment_reactions').update({ kind }).eq('comment_id', comment.id).eq('profile_id', me.id).select().single()
      : await supabase.from('comment_reactions').insert({ comment_id: comment.id, kind }).select().single()
    setBusy(false)
    if (error || !data) return onError(errorMessage(error))
    onChange((rows) => [...others(rows), data as CommentReaction])
  }

  return (
    <>
      {REACTIONS.map(({ kind, label, on: On, off: Off }) => {
        const these = reactions.filter((r) => r.kind === kind)
        if (!canReact && !these.length) return null
        const lit = mine?.kind === kind
        const names = these.map((r) => (r.profile_id === me.id ? 'You' : profileById(r.profile_id)?.full_name ?? 'Someone'))
        const Icon = lit ? On : Off
        return (
          <Tooltip key={kind} describeChild title={names.length ? names.join(', ') : label}>
            <span>
              <Button size="small" color={lit ? 'primary' : 'inherit'} disabled={!canReact} onClick={() => react(kind)}
                aria-label={`${label}${these.length ? ` (${these.length})` : ''}`} aria-pressed={lit}
                sx={{ minWidth: 0, px: 1, color: lit ? undefined : 'text.secondary' }}
                startIcon={<Icon fontSize="small" />}>
                {these.length || null}
              </Button>
            </span>
          </Tooltip>
        )
      })}
    </>
  )
}

function CommentItem({
  comment,
  attachments,
  reactions,
  role,
  mentionables,
  files: fileChanges,
  onChanged,
  onDeleted,
  onReactionsChange,
}: {
  comment: Comment
  // The files added with it.
  attachments: Attachment[]
  // Its thumbs up and down.
  reactions: CommentReaction[]
  onReactionsChange: ReactionsUpdate
  role: ProjectRole | null
  mentionables: Profile[]
  files: FileChanges
  onChanged: (c: Comment) => void
  onDeleted: (id: string) => void
}) {
  const me = useMe()
  const { profileById } = useWorkspace()
  const author = profileById(comment.author_id)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(comment.body)
  const [files, setFiles] = useState<File[]>([])
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (isBlankHtml(body) || busy) return
    setBusy(true)
    setError(null)
    // Only the files: an unchanged comment isn't marked edited.
    if (body !== comment.body) {
      const { data, error: e } = await supabase.from('comments').update({ body: sanitizeHtml(body) }).eq('id', comment.id).select().single()
      if (e || !data) {
        setBusy(false)
        return setError(errorMessage(e))
      }
      onChanged(data as Comment)
    }
    if (files.length) {
      const { rows, error: fileError } = await uploadFiles(comment.issue_id, files, comment.id)
      if (rows.length) fileChanges.onAdded(rows)
      setFiles([])
      if (fileError) {
        setBusy(false)
        return setError(fileError)
      }
    }
    setBusy(false)
    setEditing(false)
  }

  async function remove() {
    setBusy(true)
    const { error: e } = await supabase.from('comments').delete().eq('id', comment.id)
    setBusy(false)
    if (e) return setError(errorMessage(e))
    onDeleted(comment.id)
  }

  return (
    <Stack direction="row" spacing={1.5} data-comment={comment.id} sx={{ alignItems: 'flex-start' }}>
      <PersonAvatar person={author} size={32} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Typography variant="subtitle2">{author?.full_name ?? 'Someone'}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }} title={formatDayTime(comment.created_at)}>
            {timeAgo(comment.created_at)}
            {comment.edited_at ? ' · edited' : ''}
          </Typography>
        </Stack>
        {editing ? (
          <Box sx={{ mt: 0.5 }}>
            <RichTextEditor label="Edit comment" value={body} onChange={setBody} mentionables={mentionables} autoFocus minHeight={60} onSubmit={save} />
            {busy && files.length > 0 && <LinearProgress aria-label="Uploading files to Drive" sx={{ mt: 1 }} />}
            <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="contained" size="small" loading={busy} onClick={save}>Save</Button>
              <Button size="small" disabled={busy} onClick={() => { setEditing(false); setBody(comment.body); setFiles([]) }}>Cancel</Button>
              {can.attachToComment(comment.author_id, me, role) && <PendingFiles files={files} onChange={setFiles} />}
            </Stack>
          </Box>
        ) : (
          <RichTextView html={comment.body} sx={{ mt: 0.25 }} />
        )}
        {attachments.length > 0 && (
          <Box sx={{ mt: 1 }} role="group" aria-label="Files with this comment">
            <AttachmentList attachments={attachments} role={role} dense onRemoved={fileChanges.onRemoved} />
          </Box>
        )}
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        {!editing && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.25, ml: -1, alignItems: 'center' }}>
            <Reactions comment={comment} reactions={reactions} canReact={can.react(role)} onChange={onReactionsChange} onError={setError} />
            {can.editComment(comment.author_id, me) && <Button size="small" onClick={() => setEditing(true)}>Edit</Button>}
            {can.deleteComment(comment.author_id, me, role) && (
              <Button size="small" color="error" onClick={() => setConfirm(true)}>Delete</Button>
            )}
          </Stack>
        )}
      </Box>
      <ConfirmDialog open={confirm} title="Delete this comment?" message="It can't be brought back." confirmLabel="Delete"
        destructive busy={busy} onConfirm={remove} onClose={() => setConfirm(false)} />
    </Stack>
  )
}

export default function Comments({
  issueId,
  comments,
  attachments,
  reactions,
  role,
  mentionables,
  onChange,
  onReactionsChange,
  onAttachmentsChange,
}: {
  issueId: string
  comments: Comment[]
  // All the issue's files; each comment shows those added with it.
  attachments: Attachment[]
  // All the comments' thumbs up and down.
  reactions: CommentReaction[]
  // Takes an updater, as the attachments do.
  onReactionsChange: ReactionsUpdate
  role: ProjectRole | null
  mentionables: Profile[]
  onChange: (comments: Comment[]) => void
  // Takes an updater: uploads finish after other changes to the list.
  onAttachmentsChange: (update: (rows: Attachment[]) => Attachment[]) => void
}) {
  const [fileError, setFileError] = useState<string | null>(null)
  const files: FileChanges = {
    onAdded: (rows) => onAttachmentsChange((all) => [...all, ...rows]),
    onRemoved: (id) => onAttachmentsChange((all) => all.filter((a) => a.id !== id)),
  }
  // Newest first, under the box for a new one.
  const sorted = [...comments].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return (
    <Stack spacing={2.5}>
      {can.comment(role) && (
        <Composer issueId={issueId} role={role} mentionables={mentionables} files={files}
          onSent={(c) => onChange([...comments, c])} onFileError={setFileError} />
      )}
      {fileError && <Alert severity="error" onClose={() => setFileError(null)}>{fileError}</Alert>}
      {sorted.map((c) => (
        <CommentItem key={c.id} comment={c} role={role} mentionables={mentionables} files={files}
          attachments={attachments.filter((a) => a.comment_id === c.id)}
          reactions={reactions.filter((r) => r.comment_id === c.id)} onReactionsChange={onReactionsChange}
          onChanged={(n) => onChange(comments.map((x) => (x.id === n.id ? n : x)))}
          onDeleted={(id) => {
            onChange(comments.filter((x) => x.id !== id))
            // Its reactions go with it.
            onReactionsChange((all) => all.filter((r) => r.comment_id !== id))
            // The database keeps its files on the issue, no longer with the comment.
            onAttachmentsChange((all) => all.map((a) => (a.comment_id === id ? { ...a, comment_id: null } : a)))
          }} />
      ))}
      {!comments.length && <Typography variant="body2" sx={{ color: 'text.secondary' }}>No comments yet.</Typography>}
    </Stack>
  )
}
