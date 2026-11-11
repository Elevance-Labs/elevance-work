// Google Drive and Docs: calling the `drive` Edge Function (which does the
// Drive work as the service account, after the database says the caller may),
// and making sense of Google links people paste.
import { supabase } from './supabase'
import type { Attachment, Doc, DocType } from './types'

// Mirrored by MAX_BYTES in supabase/functions/drive.
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

export type CreatableDocType = 'document' | 'spreadsheet' | 'presentation'

async function call<T>(body: Record<string, unknown> | FormData): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('drive', { body })
  if (error) {
    // FunctionsHttpError carries the function's own JSON message in its response.
    const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context
    const message = await context?.json?.().then((b) => b?.error).catch(() => undefined)
    return { data: null, error: message ?? 'Google Drive is not reachable right now.' }
  }
  return { data: data as T, error: null }
}

/** A file on the issue; with a comment id, one added with that comment (your own). */
export function uploadAttachment(issueId: string, file: File, commentId?: string) {
  const form = new FormData()
  form.append('issue_id', issueId)
  if (commentId) form.append('comment_id', commentId)
  form.append('file', file)
  return call<Attachment>(form)
}

export const tooBig = (file: File) => `${file.name} is over 25 MB. Put it in the project's Drive folder and link it instead.`

/**
 * Sends files to Drive one by one (with a comment id, as that comment's).
 * A file that fails doesn't stop the rest; each adds to the error.
 */
export async function uploadFiles(issueId: string, files: File[], commentId?: string, onEach?: (row: Attachment) => void) {
  const rows: Attachment[] = []
  const errors: string[] = []
  for (const file of files) {
    if (file.size > ATTACHMENT_MAX_BYTES) {
      errors.push(tooBig(file))
      continue
    }
    const { data, error } = await uploadAttachment(issueId, file, commentId)
    if (error || !data) errors.push(error ?? `${file.name}: the upload failed.`)
    else {
      rows.push(data)
      onEach?.(data)
    }
  }
  return { rows, error: errors.length ? errors.join(' ') : null }
}

export const deleteAttachment = (attachmentId: string) => call<{ ok: true }>({ action: 'delete_attachment', attachment_id: attachmentId })

/** The file's bytes, through the function, as an object URL (images preview without Drive cookies). */
export async function attachmentBlobUrl(attachmentId: string) {
  const { data, error } = await call<Blob>({ action: 'download', attachment_id: attachmentId })
  return error || !(data instanceof Blob) ? null : URL.createObjectURL(data)
}

/** A new Google file in the project's folder; a Doc may start with HTML content (Drive converts it). */
export const createDoc = (projectId: string, title: string, docType: CreatableDocType, issueId: string | null, html?: string) =>
  call<Doc>({ action: 'create_doc', project_id: projectId, issue_id: issueId, title, doc_type: docType, ...(html ? { html } : {}) })

export const projectFolderUrl = (projectId: string) => call<{ url: string }>({ action: 'project_folder', project_id: projectId })

/** What kind of Google file a link points at, or null if it isn't one. */
export function docTypeFromUrl(url: string): DocType | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  const path = u.pathname
  if (u.hostname === 'docs.google.com') {
    if (path.startsWith('/document/')) return 'document'
    if (path.startsWith('/spreadsheets/')) return 'spreadsheet'
    if (path.startsWith('/presentation/')) return 'presentation'
    if (path.startsWith('/forms/')) return 'form'
    if (path.startsWith('/drawings/')) return 'drawing'
    return 'file'
  }
  if (u.hostname === 'drive.google.com') return path.includes('/folders/') ? 'folder' : 'file'
  if (['sheets.google.com', 'slides.google.com', 'forms.google.com'].includes(u.hostname)) return 'file'
  return null
}

/**
 * The read-only view Google lets other sites frame (/preview), for the
 * kinds that have one; null for folders and the rest.
 */
export function embedUrl(url: string) {
  const type = docTypeFromUrl(url)
  if (!type || type === 'folder' || type === 'form') return null
  const m = /^(https:\/\/(?:docs|drive)\.google\.com\/(?:document|spreadsheets|presentation|drawings|file)\/d\/[\w-]+)/.exec(url)
  return m ? `${m[1]}/preview` : null
}

export const isImage = (mime: string) => /^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(mime)
