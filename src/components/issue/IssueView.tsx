// One issue, everything about it: the issue dialog (?issue=KEY) and the
// /browse/KEY page both render this. Each field saves as it changes; the
// database checks every write (issues_guard) and the view shows its answer.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Divider,
  Fab,
  Grid,
  IconButton,
  Link as MuiLink,
  ListItemIcon,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import AddLinkIcon from '@mui/icons-material/AddLink'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CheckIcon from '@mui/icons-material/Check'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import LinkIcon from '@mui/icons-material/Link'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import WebAssetOutlinedIcon from '@mui/icons-material/WebAssetOutlined'
import { useMe } from '../../auth/AuthProvider'
import { useNotifications } from '../../workspace/notifications'
import { supabase } from '../../lib/supabase'
import { assignable, can, roleIn } from '../../lib/permissions'
import { errorMessage, formatDayTime, timeAgo } from '../../lib/constants'
import { ISSUE_COLUMNS, ISSUE_DETAIL_COLUMNS, issuePath, parentLevelFor, type IssueWrite } from '../../lib/issues'
import { isBlankHtml, sanitizeHtml } from '../../lib/richText'
import { featureOn } from '../../lib/projectFeatures'
import { releaseCountdown } from '../../lib/releases'
import { clearDraft, draftKey, readDraft, writeDraft } from '../../lib/drafts'
import type {
  Attachment, Comment, CustomValues, DevLink, Doc, Issue, IssueDetail, IssueEvent, IssueLink, IssueViewMode, Profile,
} from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { openSprints, useProjectMeta } from '../../workspace/useProjectMeta'
import { emitIssueChange } from '../../workspace/issueEvents'
import { ConfirmDialog, Loading, Section } from '../common'
import { CustomFieldInput, CustomFieldValue } from '../CustomFields'
import { fieldsFor } from '../../lib/fields'
import DocsList from '../DocsList'
import TodoList from '../TodoList'
import { useLayout } from '../layoutContext'
import { ProjectAvatar, TypeIcon } from '../IssueBits'
import { IssuePicker, LabelsInput, PersonPicker, PrioritySelect, StatusSelect } from '../pickers'
import { RichTextEditor } from '../RichText'
import { RichTextView } from '../RichTextView'
import Attachments from './Attachments'
import Development from './Development'
import Comments from './Comments'
import { FlagButton, FlagDialog } from './Flag'
import History from './History'
import { Children, Links, type LinkedIssue } from './Relations'

/** The sections that fold away while empty, each with its quick-add button. */
type QuickAdd = 'children' | 'links' | 'attach' | 'docs' | 'todos'
interface QuickButton {
  key: QuickAdd
  label: string
  icon: ReactNode
  onClick?: () => void
  // Opens a file input by its id, as a label does (the browser allows a file picker only from a click).
  htmlFor?: string
}

interface Loaded {
  issue: IssueDetail
  parent: Issue | null
  children: Issue[]
  links: LinkedIssue[]
  attachments: Attachment[]
  devLinks: DevLink[]
  docs: Doc[]
  comments: Comment[]
  events: IssueEvent[]
  watchers: string[]
}

async function loadIssue(key: string): Promise<Loaded | null> {
  const { data } = await supabase.from('issues').select(ISSUE_DETAIL_COLUMNS).eq('key', key).maybeSingle()
  if (!data) return null
  const issue = data as unknown as IssueDetail
  const [parent, children, out, inn, attachments, docs, comments, events, watchers, devLinks] = await Promise.all([
    issue.parent_id ? supabase.from('issues').select(ISSUE_COLUMNS).eq('id', issue.parent_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('issues').select(ISSUE_COLUMNS).eq('parent_id', issue.id),
    supabase.from('issue_links').select('*').eq('source_id', issue.id),
    supabase.from('issue_links').select('*').eq('target_id', issue.id),
    supabase.from('attachments').select('*').eq('issue_id', issue.id).order('created_at'),
    supabase.from('documents').select('*').eq('issue_id', issue.id).order('created_at', { ascending: false }),
    supabase.from('comments').select('*').eq('issue_id', issue.id).order('created_at'),
    supabase.from('issue_events').select('*').eq('issue_id', issue.id).order('created_at'),
    supabase.from('issue_watchers').select('profile_id').eq('issue_id', issue.id),
    supabase.from('issue_dev_links').select('*').eq('issue_id', issue.id),
  ])
  const linkRows = [...((out.data ?? []) as IssueLink[]), ...((inn.data ?? []) as IssueLink[])]
  const otherIds = [...new Set(linkRows.map((l) => (l.source_id === issue.id ? l.target_id : l.source_id)))]
  const others = otherIds.length
    ? (((await supabase.from('issues').select(ISSUE_COLUMNS).in('id', otherIds)).data ?? []) as unknown as Issue[])
    : []
  return {
    issue,
    parent: (parent.data as unknown as Issue | null) ?? null,
    children: (children.data ?? []) as unknown as Issue[],
    // A linked issue you can't see (another private project) isn't listed.
    links: linkRows.flatMap((link) => {
      const other = others.find((o) => o.id === (link.source_id === issue.id ? link.target_id : link.source_id))
      return other ? [{ link, other }] : []
    }),
    attachments: (attachments.data ?? []) as Attachment[],
    devLinks: (devLinks.data ?? []) as DevLink[],
    docs: (docs.data ?? []) as Doc[],
    comments: (comments.data ?? []) as Comment[],
    events: (events.data ?? []) as IssueEvent[],
    watchers: ((watchers.data ?? []) as { profile_id: string }[]).map((w) => w.profile_id),
  }
}

/** The height of the phone dialog's pinned activity tabs. */
const SHEET_BAR = 48

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', fontWeight: 600, mb: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}

/**
 * onClose: shown over a page (the dialog or the side panel) rather than as one.
 * panel: in the side panel (full height, so it scrolls itself).
 * viewMode / onViewMode: how issues open on a wide screen, chosen from here.
 */
export default function IssueView({ issueKey, onClose, panel = false, viewMode, onViewMode }: {
  issueKey: string
  onClose?: () => void
  panel?: boolean
  viewMode?: IssueViewMode
  onViewMode?: (mode: IssueViewMode) => Promise<string | null>
}) {
  const me = useMe()
  const navigate = useNavigate()
  const ws = useWorkspace()
  const { profiles, issueTypes, projectById, typeById, statusesOf, profileById, roleOf } = ws
  const [data, setData] = useState<Loaded | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'comments' | 'history'>('comments')
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState('')
  const [editingDescription, setEditingDescription] = useState(false)
  const [description, setDescription] = useState('')
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [flagging, setFlagging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [typeAnchor, setTypeAnchor] = useState<HTMLElement | null>(null)
  const [parentAnchor, setParentAnchor] = useState<HTMLElement | null>(null)
  // On a phone the dialog is already full screen (IssueDialog's breakpoint):
  // no "open as a page" nor a choice of how issues open. Two columns (the
  // issue, its fields beside it) from a desktop's width, in the dialog and the
  // side panel alike; narrower (a tablet, a phone) one column in reading order.
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const narrow = !useMediaQuery(theme.breakpoints.up('lg'))
  // Narrow and filling the height (a phone's dialog, the side panel): a bar
  // the issue scrolls under, and the activity a sheet pinned to the foot.
  const pinned = narrow && !!onClose && (phone || panel)
  // The side panel, wide: it scrolls itself, its header staying put.
  const panelScroll = panel && !pinned
  const [sheet, setSheet] = useState(false)
  const [viewAnchor, setViewAnchor] = useState<HTMLElement | null>(null)

  const reload = useCallback(async () => {
    setData(await loadIssue(issueKey))
  }, [issueKey])

  // Empty sections stay folded into the quick-add buttons until one is asked for.
  const [revealed, setRevealed] = useState<QuickAdd[]>([])
  // The todos load themselves; null until they have.
  const [todoCount, setTodoCount] = useState<number | null>(null)
  const { openCreate } = useLayout()

  useEffect(() => {
    setData(undefined)
    setRevealed([])
    setTodoCount(null)
    reload()
  }, [reload])

  const issue = data?.issue
  // Having looked at an issue is what reading its notifications means.
  const { markIssueRead } = useNotifications()
  useEffect(() => {
    if (issue?.id) markIssueRead(issue.id)
  }, [issue?.id, markIssueRead])
  // An unsaved description is kept in this browser until it is saved or
  // cancelled; editing again picks it up.
  const descriptionDraftKey = issue ? draftKey(me.id, 'issue-description', issue.id) : null
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    if (!descriptionDraftKey) return
    const kept = readDraft(descriptionDraftKey)
    // Saved since (here or elsewhere) to the same text: nothing is unsaved.
    if (kept !== null && kept === issue?.description) clearDraft(descriptionDraftKey)
    else setDraft(kept)
    // Read once per issue; the draft then follows the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptionDraftKey])

  const project = projectById(issue?.project_id)
  const meta = useProjectMeta(issue?.project_id)
  const role = roleOf(issue?.project_id)
  const editable = can.editIssues(role)
  const people = useMemo(() => (project && meta ? assignable(project, profiles, meta.members) : []), [project, meta, profiles])
  // Who @ can reach: whoever can see the project.
  const mentionables = useMemo<Profile[]>(
    () => (project && meta ? profiles.filter((p) => p.active && roleIn(project, p, meta.members) !== null) : []),
    [project, meta, profiles],
  )

  if (data === undefined) return <Loading minHeight={320} />
  if (!data || !issue || !project) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="warning" action={onClose && <Button onClick={onClose}>Close</Button>}>
          {issueKey} doesn't exist, or you don't have access to its project.
        </Alert>
      </Box>
    )
  }

  const type = typeById(issue.type_id)
  const level = type?.level ?? 'standard'

  // A section with something in it shows; an empty one only once asked for
  // from the quick-add buttons (and only to whoever can add to it).
  const has: Record<QuickAdd, boolean> = {
    children: data.children.length > 0,
    links: data.links.length > 0,
    attach: data.attachments.length > 0,
    docs: data.docs.length > 0,
    todos: !!todoCount,
  }
  const show = (k: QuickAdd) => has[k] || revealed.includes(k)
  const reveal = (k: QuickAdd) => () => setRevealed((r) => (r.includes(k) ? r : [...r, k]))
  const attachInputId = `attach-${issue.id}`
  const epicLevel = level === 'epic'
  const quickAdds = ([
    editable && level !== 'subtask' && {
      key: 'children', label: epicLevel ? 'Add issue' : 'Add sub-task', icon: <AccountTreeOutlinedIcon />,
      // An epic's issue is a whole issue: the create dialog, under this epic.
      onClick: epicLevel
        ? () => openCreate({ projectId: issue.project_id, parent: issue, onCreated: (i) => setData((d) => d && { ...d, children: [...d.children, i] }) })
        : reveal('children'),
    },
    editable && { key: 'links', label: 'Link issue', icon: <AddLinkIcon />, onClick: reveal('links') },
    editable && { key: 'attach', label: 'Attach', icon: <AttachFileIcon />, htmlFor: attachInputId },
    can.addDocs(role) && { key: 'docs', label: 'Add doc', icon: <DescriptionOutlinedIcon />, onClick: reveal('docs') },
    todoCount === 0 && { key: 'todos', label: 'Add todo', icon: <ChecklistOutlinedIcon />, onClick: reveal('todos') },
  ] as (QuickButton | false)[]).filter((q): q is QuickButton => !!q && !show(q.key))
  const statuses = statusesOf(issue.project_id)
  const fields = meta ? fieldsFor(meta.fields, issue.type_id) : []
  const watching = data.watchers.includes(me.id)
  const parentLevel = parentLevelFor(level)
  const parentWord = level === 'subtask' ? 'parent' : 'epic'
  // A type can change only within its level (issues_guard keeps the hierarchy).
  const sameLevelTypes = issueTypes.filter((t) => t.level === level && (!t.archived || t.id === issue.type_id))

  // Saves a change: whether it was saved; why not, in the view's alert.
  async function save(patch: IssueWrite) {
    setError(null)
    const failed = await write(patch)
    if (failed) setError(failed)
    return !failed
  }

  // Saves a change: why it wasn't saved, or null.
  async function write(patch: IssueWrite) {
    if (!issue) return "That change wasn't saved."
    const { data: row, error: e } = await supabase.from('issues').update(patch).eq('id', issue.id).select(ISSUE_DETAIL_COLUMNS).single()
    if (e || !row) return errorMessage(e, "That change wasn't saved.")
    setData((d) => (d ? { ...d, issue: row as unknown as IssueDetail } : d))
    emitIssueChange(issue.id)
    // The history and watchers come from triggers; so does a flag's comment.
    const flag = 'flag_reason' in patch
    const [events, watchers, comments] = await Promise.all([
      supabase.from('issue_events').select('*').eq('issue_id', issue.id).order('created_at'),
      supabase.from('issue_watchers').select('profile_id').eq('issue_id', issue.id),
      flag ? supabase.from('comments').select('*').eq('issue_id', issue.id).order('created_at') : Promise.resolve({ data: null }),
    ])
    setData((d) => d && {
      ...d,
      events: (events.data ?? d.events) as IssueEvent[],
      watchers: ((watchers.data ?? []) as { profile_id: string }[]).map((w) => w.profile_id),
      comments: (comments.data ?? d.comments) as Comment[],
    })
    return null
  }

  // The epic (or a sub-task's parent) is changed from the breadcrumb.
  async function changeParent(p: Issue | null) {
    if (level === 'subtask' && !p) return
    if (p?.id === issue!.parent_id) return setParentAnchor(null)
    if (await save({ parent_id: p?.id ?? null })) {
      setData((d) => d && { ...d, parent: p })
      setParentAnchor(null)
    }
  }

  async function saveTitle() {
    const t = title.trim()
    if (!t || t === issue!.title) return setEditingTitle(false)
    if (await save({ title: t })) setEditingTitle(false)
  }

  async function saveDescription() {
    if (await save({ description: isBlankHtml(description) ? '' : sanitizeHtml(description) })) {
      dropDraft()
      setEditingDescription(false)
    }
  }

  function editDescription(html: string) {
    setDescription(html)
    const unsaved = html === issue!.description || (isBlankHtml(html) && isBlankHtml(issue!.description)) ? null : html
    writeDraft(descriptionDraftKey!, unsaved)
    setDraft(unsaved)
  }

  function dropDraft() {
    clearDraft(descriptionDraftKey!)
    setDraft(null)
  }

  function cancelDescription() {
    dropDraft()
    setEditingDescription(false)
  }

  async function toggleWatch() {
    const { error: e } = watching
      ? await supabase.from('issue_watchers').delete().eq('issue_id', issue!.id).eq('profile_id', me.id)
      : await supabase.from('issue_watchers').insert({ issue_id: issue!.id, profile_id: me.id })
    if (e) return setError(errorMessage(e))
    setData((d) => d && { ...d, watchers: watching ? d.watchers.filter((w) => w !== me.id) : [...d.watchers, me.id] })
  }

  async function remove() {
    setBusy(true)
    const { error: e } = await supabase.from('issues').delete().eq('id', issue!.id)
    setBusy(false)
    if (e) return setError(errorMessage(e))
    setDeleting(false)
    emitIssueChange(issue!.id)
    if (onClose) onClose()
    else navigate(`/projects/${project!.key}`)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#${issuePath(issue!.key)}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be refused; the key is on screen anyway.
    }
  }

  const setCustom = (fieldId: string, v: CustomValues[string] | undefined) => {
    const next = { ...issue.custom }
    if (v === undefined) delete next[fieldId]
    else next[fieldId] = v
    return save({ custom: next })
  }

  const projectLink = (
    <MuiLink component={Link} to={`/projects/${project.key}`} underline="hover" color="text.secondary"
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <ProjectAvatar project={project} size={20} />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</Box>
    </MuiLink>
  )

  // The epic (or parent), changed from here.
  const parentCrumb =
    data.parent ? (
      <Stack key="parent" direction="row" sx={{ alignItems: 'center', '&:hover .change-parent, & .change-parent:focus-visible': { opacity: 1 } }}>
        <MuiLink component={Link} to={{ search: `?issue=${data.parent.key}` }} underline="hover" color="text.secondary"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <TypeIcon type={typeById(data.parent.type_id)} size={16} />
          {data.parent.key}
        </MuiLink>
        {editable && parentLevel && (
          <Tooltip title={`Change ${parentWord}`}>
            <IconButton size="small" className="change-parent" aria-label={`Change ${parentWord}`}
              onClick={(e) => setParentAnchor(e.currentTarget)}
              sx={{ ml: 0.25, p: 0.25, opacity: { xs: 1, md: 0 }, transition: 'opacity 120ms' }}>
              <EditOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    ) : (
      editable && parentLevel === 'epic' && (
        <Button key="parent" size="small" color="inherit" startIcon={<TypeIcon type={issueTypes.find((t) => t.level === 'epic')} size={16} tooltip={false} />}
          onClick={(e) => setParentAnchor(e.currentTarget)} sx={{ color: 'text.secondary', minWidth: 0, py: 0, whiteSpace: 'nowrap' }}>
          Add epic
        </Button>
      )
    )

  // The issue's type (changed from its icon), key and link.
  const keyCrumb = (
    <Stack key="issue" direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      {editable && sameLevelTypes.length > 1 ? (
        <Tooltip title={`${type?.name ?? 'Issue'}: change type`}>
          <IconButton size="small" aria-label="Change type" aria-haspopup="menu" onClick={(e) => setTypeAnchor(e.currentTarget)}
            sx={{ p: 0.25, borderRadius: 1 }}>
            <TypeIcon type={type} size={16} tooltip={false} />
          </IconButton>
        </Tooltip>
      ) : (
        <TypeIcon type={type} size={16} />
      )}
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{issue.key}</Typography>
      <Tooltip title={copied ? 'Link copied' : 'Copy link'}>
        <IconButton size="small" aria-label="Copy link" onClick={copyLink} sx={{ p: 0.25 }}>
          {copied ? <CheckIcon color="success" sx={{ fontSize: 16 }} /> : <LinkIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Tooltip>
    </Stack>
  )

  const actions = (
    <>
      <Tooltip title={watching ? 'Stop watching' : 'Watch: hear about every change'}>
        <Button size="small" color="inherit" startIcon={watching ? <VisibilityIcon /> : <VisibilityOutlinedIcon />} onClick={toggleWatch}
          aria-pressed={watching} aria-label={watching ? 'Stop watching' : 'Watch'}>
          {data.watchers.length}
        </Button>
      </Tooltip>
      {onClose && !phone && (
        <Tooltip title="Open as a page">
          <IconButton aria-label="Open as a page" component={Link} to={issuePath(issue.key)}><OpenInFullIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
      {onViewMode && !phone && (
        <>
          <Tooltip title="How issues open">
            <IconButton aria-label="How issues open" aria-haspopup="menu" onClick={(e) => setViewAnchor(e.currentTarget)}>
              {viewMode === 'drawer' ? <ViewSidebarOutlinedIcon fontSize="small" /> : <WebAssetOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Menu anchorEl={viewAnchor} open={!!viewAnchor} onClose={() => setViewAnchor(null)}>
            <Typography variant="caption" component="div" sx={{ px: 2, py: 0.5, color: 'text.secondary', fontWeight: 600 }}>
              Open issues as
            </Typography>
            {([['modal', 'Dialog', <WebAssetOutlinedIcon key="i" fontSize="small" />],
              ['drawer', 'Side panel', <ViewSidebarOutlinedIcon key="i" fontSize="small" />]] as const).map(([mode, label, icon]) => (
              <MenuItem key={mode} selected={viewMode === mode}
                onClick={async () => {
                  setViewAnchor(null)
                  if (mode === viewMode) return
                  const failed = await onViewMode(mode)
                  if (failed) setError(failed)
                }}>
                <ListItemIcon>{icon}</ListItemIcon>
                {label}
                {viewMode === mode && <CheckIcon fontSize="small" sx={{ ml: 'auto', pl: 2, color: 'primary.main' }} />}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      {can.deleteIssues(role) && (
        <>
          <IconButton aria-label="More actions" onClick={(e) => setMenu(e.currentTarget)}><MoreHorizIcon /></IconButton>
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            <MenuItem onClick={() => { setMenu(null); setDeleting(true) }} sx={{ color: 'error.main' }}>
              <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
              Delete issue
            </MenuItem>
          </Menu>
        </>
      )}
      {onClose && <IconButton aria-label="Close" onClick={onClose}><CloseIcon /></IconButton>}
      <Menu anchorEl={typeAnchor} open={!!typeAnchor} onClose={() => setTypeAnchor(null)}>
        <Typography variant="caption" component="div" sx={{ px: 2, py: 0.5, color: 'text.secondary', fontWeight: 600 }}>
          Change type
        </Typography>
        {sameLevelTypes.map((t) => (
          <MenuItem key={t.id} selected={t.id === issue.type_id} disabled={t.archived && t.id !== issue.type_id}
            onClick={() => {
              setTypeAnchor(null)
              if (t.id !== issue.type_id) save({ type_id: t.id })
            }}>
            <ListItemIcon><TypeIcon type={t} tooltip={false} /></ListItemIcon>
            {t.name}
          </MenuItem>
        ))}
      </Menu>
      <Popover open={!!parentAnchor} anchorEl={parentAnchor} onClose={() => setParentAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ p: 2, width: 360, maxWidth: 'calc(100vw - 32px)' }}>
          {parentLevel && (
            <IssuePicker label={level === 'subtask' ? 'Parent' : 'Epic'} value={data.parent} projectId={issue.project_id} autoFocus
              typeIds={issueTypes.filter((t) => t.level === parentLevel).map((t) => t.id)} exclude={[issue.id]}
              onChange={(p) => changeParent(p)} />
          )}
          {level === 'standard' && data.parent && (
            <Button size="small" color="inherit" sx={{ mt: 1 }} onClick={() => changeParent(null)}>Remove epic</Button>
          )}
        </Box>
      </Popover>
    </>
  )

  // Narrow: the key and the actions on top (on a phone or in the side panel, a
  // bar the issue scrolls under), the project and the epic beneath. Wide: one
  // row, the project leading the breadcrumb.
  const phoneBar = (
    <Stack direction="row" spacing={0.5} data-issue-bar
      sx={{ alignItems: 'center', minHeight: 48, flex: 'none',
        ...(pinned && { px: 2, pt: 0.5, borderBottom: 1, borderColor: 'divider' }) }}>
      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex' }}>{keyCrumb}</Box>
      {actions}
    </Stack>
  )
  const phoneTrail = (
    <Breadcrumbs sx={{ mt: 1, minWidth: 0, typography: 'body2', '& ol': { flexWrap: 'nowrap' }, '& li': { minWidth: 0 } }}>
      {projectLink}
      {parentCrumb}
    </Breadcrumbs>
  )
  const header = narrow ? (
    <>
      {phoneBar}
      {phoneTrail}
    </>
  ) : (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 40 }}>
      <Breadcrumbs sx={{ flexGrow: 1, minWidth: 0, '& ol': { flexWrap: 'nowrap' } }}>
        {projectLink}
        {parentCrumb}
        {keyCrumb}
      </Breadcrumbs>
      {actions}
    </Stack>
  )

  const titleText = editingTitle ? (
    <TextField
      autoFocus
      fullWidth
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={saveTitle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') saveTitle()
        if (e.key === 'Escape') setEditingTitle(false)
      }}
      slotProps={{ htmlInput: { 'aria-label': 'Summary', maxLength: 255 } }}
      sx={{ '& input': { typography: 'h5' } }}
    />
  ) : (
    <Typography
      variant="h5"
      component="h1"
      onClick={() => {
        if (!editable) return
        setTitle(issue.title)
        setEditingTitle(true)
      }}
      sx={{ cursor: editable ? 'text' : 'default', overflowWrap: 'anywhere', borderRadius: 1, px: 0.5, mx: -0.5,
        '&:hover': editable ? { bgcolor: 'action.hover' } : undefined }}
    >
      {issue.title}
    </Typography>
  )

  // The title, and at its far right the issue's flag: lit when flagged.
  const titleBlock = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>{titleText}</Box>
      <FlagButton issue={issue} editable={editable} onFlag={() => setFlagging(true)} onRemove={() => save({ flag_reason: null })} />
    </Stack>
  )

  const descriptionBlock = (
    <Section title="Description"
      action={draft !== null && editable && (
        <Typography variant="caption" data-draft sx={{ color: 'warning.main', fontWeight: 600 }}>
          {editingDescription ? 'Unsaved changes' : `Unsaved draft: ${phone ? 'tap' : 'click'} to continue`}
        </Typography>
      )}>
      {editingDescription ? (
        <Box>
          <RichTextEditor label="Description" value={description} onChange={editDescription} mentionables={mentionables} autoFocus
            minHeight={160} onSubmit={saveDescription} />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button variant="contained" size="small" onClick={saveDescription}>Save</Button>
            <Button size="small" onClick={cancelDescription}>Cancel</Button>
          </Stack>
        </Box>
      ) : (
        <Box
          onClick={() => {
            if (!editable) return
            setDescription(draft ?? issue.description)
            setEditingDescription(true)
          }}
          sx={{ cursor: editable ? 'text' : 'default', borderRadius: 1, p: 1, mx: -1, '&:hover': editable ? { bgcolor: 'action.hover' } : undefined }}
        >
          {isBlankHtml(issue.description) ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{editable ? 'Add a description…' : 'No description.'}</Typography>
          ) : (
            <RichTextView html={issue.description} />
          )}
        </Box>
      )}
    </Section>
  )

  // A Scrum issue picks its sprint; a sub-task shows its parent's.
  const sprintField =
    meta && project.kind === 'scrum' && level === 'standard' ? (
      <TextField select label="Sprint" value={issue.sprint_id ?? ''} disabled={!editable} fullWidth
        onChange={(e) => save({ sprint_id: e.target.value || null })}>
        <MenuItem value="">Backlog</MenuItem>
        {[...openSprints(meta), ...meta.sprints.filter((s) => s.state === 'closed' && s.id === issue.sprint_id)].map((s) => (
          <MenuItem key={s.id} value={s.id} disabled={s.state === 'closed'}>{s.name}{s.state === 'active' ? ' (active)' : ''}</MenuItem>
        ))}
      </TextField>
    ) : level === 'subtask' && issue.sprint_id ? (
      <Detail label="Sprint">
        <Typography variant="body2">{meta?.sprints.find((s) => s.id === issue.sprint_id)?.name} (from its parent)</Typography>
      </Detail>
    ) : null

  const statusField = (
    <StatusSelect value={issue.status_id} statuses={statuses} disabled={!editable} onChange={(id) => save({ status_id: id })} />
  )

  // How long the issue's release has: whoever works on it sees the days left.
  // With Releases off for the project the field is hidden; its value stays.
  const releasesOn = featureOn(project, 'releases')
  const release = meta?.releases.find((r) => r.id === issue.release_id)
  const releaseDue = release ? releaseCountdown(release) : null

  // Every other field. One column beside the issue; in one column, two per
  // row from tablet width (a wide field keeps its row), one on a phone.
  const single = narrow ? { xs: 12, sm: 6 } : 12
  const fieldsGrid = (
    <Grid container spacing={2}>
      <Grid size={single}>
        <PersonPicker label="Assignee" value={issue.assignee_id} options={people} disabled={!editable}
          onChange={(id) => save({ assignee_id: id })} />
        {editable && issue.assignee_id !== me.id && people.some((p) => p.id === me.id) && (
          <Button size="small" sx={{ mt: 0.5, ml: -0.5 }} onClick={() => save({ assignee_id: me.id })}>Assign to me</Button>
        )}
      </Grid>
      <Grid size={single}>
        <PrioritySelect value={issue.priority} disabled={!editable} onChange={(p) => save({ priority: p })} />
      </Grid>
      <Grid size={12}>
        {editable ? (
          <LabelsInput value={issue.labels} onChange={(labels) => save({ labels })} />
        ) : (
          <Detail label="Labels"><Typography variant="body2">{issue.labels.join(', ') || 'None'}</Typography></Detail>
        )}
      </Grid>
      <Grid size={single}>
        <TextField key={`sp-${issue.story_points}`} label="Story points" type="number" defaultValue={issue.story_points ?? ''} disabled={!editable}
          fullWidth slotProps={{ htmlInput: { min: 0, step: 0.5, inputMode: 'decimal' } }}
          onBlur={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value)
            if (v !== issue.story_points) save({ story_points: v })
          }} />
      </Grid>
      <Grid size={single}>
        <PersonPicker label="Reporter" value={issue.reporter_id} options={profiles.filter((p) => p.active)} disabled={!editable}
          allowNone={false} onChange={(id) => id && save({ reporter_id: id })} />
      </Grid>
      {sprintField && <Grid size={releasesOn ? 6 : 12}>{sprintField}</Grid>}
      {meta && releasesOn && (
        <Grid size={sprintField ? 6 : 12}>
          <TextField select label="Release" value={issue.release_id ?? ''} disabled={!editable} fullWidth
            helperText={releaseDue?.text} data-release-due={releaseDue?.tone}
            slotProps={{ formHelperText: { sx: { mx: 0, fontWeight: releaseDue?.tone === 'later' ? undefined : 600,
              color: releaseDue && { overdue: 'error.main', soon: 'warning.main', later: 'text.secondary', done: 'success.main' }[releaseDue.tone] } } }}
            onChange={(e) => save({ release_id: e.target.value || null })}>
            <MenuItem value="">None</MenuItem>
            {meta.releases.filter((r) => r.status !== 'archived' || r.id === issue.release_id).map((r) => (
              <MenuItem key={r.id} value={r.id}>{r.name}{r.status === 'released' ? ' (released)' : ''}</MenuItem>
            ))}
          </TextField>
        </Grid>
      )}
      <Grid size={6}>
        <TextField label="Start date" type="date" value={issue.start_date ?? ''} disabled={!editable} fullWidth
          slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => save({ start_date: e.target.value || null })} />
      </Grid>
      <Grid size={6}>
        <TextField label="Due date" type="date" value={issue.due_date ?? ''} disabled={!editable} fullWidth
          slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => save({ due_date: e.target.value || null })} />
      </Grid>
      {fields.map((f) => (
        <Grid key={f.id} size={f.kind === 'text' ? 12 : single}>
          {editable ? (
            <CustomFieldInput key={JSON.stringify(issue.custom[f.id] ?? null)} field={f} value={issue.custom[f.id]}
              people={profiles.filter((p) => p.active)} onChange={(v) => setCustom(f.id, v)} />
          ) : (
            <Detail label={f.name}>
              <CustomFieldValue field={f} value={issue.custom[f.id]} person={profileById(issue.custom[f.id] as string)} />
            </Detail>
          )}
        </Grid>
      ))}
    </Grid>
  )

  const stamps = (
    <Stack direction={narrow ? 'row' : 'column'} sx={{ flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }} title={formatDayTime(issue.created_at)}>
        Created {timeAgo(issue.created_at)}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }} title={formatDayTime(issue.updated_at)}>
        Updated {timeAgo(issue.updated_at)}
      </Typography>
      {issue.resolved_at && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }} title={formatDayTime(issue.resolved_at)}>
          Resolved {timeAgo(issue.resolved_at)}
        </Typography>
      )}
    </Stack>
  )

  const quickAddBar = quickAdds.length > 0 && (
    <Stack direction="row" role="toolbar" aria-label="Add to this issue" sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
      {quickAdds.map((q) => (
        <Button key={q.key} size="small" color="inherit" startIcon={q.icon} onClick={q.onClick}
          {...(q.htmlFor ? { component: 'label', htmlFor: q.htmlFor } : {})}
          sx={{ bgcolor: 'action.hover', color: 'text.secondary', borderRadius: 1.5, px: 1.25, fontWeight: 500, whiteSpace: 'nowrap',
            '&:hover': { bgcolor: 'action.selected', color: 'text.primary' } }}>
          {q.label}
        </Button>
      ))}
    </Stack>
  )

  // What's attached to the issue: each shows once it has something (or is asked for).
  const sections = (
    <>
      {show('children') && (
        <Children parent={issue} issues={data.children} role={role} startAdding={revealed.includes('children')}
          onChange={(children) => setData((d) => d && { ...d, children })} />
      )}
      {show('links') && (
        <Links issue={issue} links={data.links} role={role} startAdding={revealed.includes('links')}
          onChange={(links) => setData((d) => d && { ...d, links })} />
      )}
      <Development links={data.devLinks} />
      <Attachments issueId={issue.id} attachments={data.attachments} role={role} inputId={attachInputId} collapsed={!show('attach')}
        onChange={(attachments) => setData((d) => d && { ...d, attachments })} />
      {show('docs') && (
        <Section title="Docs">
          <DocsList projectId={issue.project_id} issueId={issue.id} docs={data.docs} role={role} dense
            onChange={(docs) => setData((d) => d && { ...d, docs })} />
        </Section>
      )}
      {/* Yours and the ones you're on: todos are not the issue's, so
          anyone who can see the issue may keep them here. Mounted while
          folded away, to know whether there are any. */}
      <Box hidden={!show('todos')}>
        <Section title="Todos">
          <TodoList issue={{ id: issue.id, key: issue.key }} onCount={setTodoCount} autoFocus={revealed.includes('todos')} />
        </Section>
      </Box>
    </>
  )

  const commentsLabel = `Comments${data.comments.length ? ` (${data.comments.length})` : ''}`
  const activityContent = tab === 'comments' ? (
    <Comments issueId={issue.id} comments={data.comments} attachments={data.attachments} role={role} mentionables={mentionables}
      onChange={(comments) => setData((d) => d && { ...d, comments })}
      onAttachmentsChange={(update) => setData((d) => d && { ...d, attachments: update(d.attachments) })} />
  ) : (
    <History events={releasesOn ? data.events : data.events.filter((e) => e.field !== 'release')} />
  )

  const activity = (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant={narrow ? 'fullWidth' : 'standard'}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="comments" label={commentsLabel} />
        <Tab value="history" label="History" />
      </Tabs>
      {activityContent}
    </Box>
  )

  // In the phone dialog and the narrow side panel, comments and history are tabs pinned to the foot: a
  // tab slides them up over the issue, under its bar; the same tab, the
  // floating button or Esc folds them away.
  const openTab = (v: typeof tab) => () => {
    if (sheet && tab === v) return setSheet(false)
    setTab(v)
    setSheet(true)
  }
  const safeBottom = 'env(safe-area-inset-bottom, 0px)'
  const activitySheet = (
    <Box data-activity={sheet ? 'open' : 'closed'}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && sheet && !e.defaultPrevented) {
          e.stopPropagation()
          setSheet(false)
        }
      }}
      sx={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper',
        borderTop: 1, borderColor: 'divider', boxShadow: sheet ? 8 : 'none',
        transform: sheet ? 'none' : `translateY(calc(100% - ${SHEET_BAR}px - ${safeBottom}))`,
        transition: theme.transitions.create(['transform', 'box-shadow'], { duration: theme.transitions.duration.shorter }) }}>
      <Stack direction="row" sx={{ alignItems: 'center', flex: 'none', pb: sheet ? 0 : safeBottom }}>
        <Tabs value={tab} variant="fullWidth" aria-label="Activity"
          sx={{ flexGrow: 1, minHeight: SHEET_BAR,
            '& .MuiTabs-indicator': { opacity: sheet ? 1 : 0 },
            ...(!sheet && { '& .MuiTab-root.Mui-selected': { color: 'text.secondary' } }) }}>
          <Tab value="comments" label={commentsLabel} onClick={openTab('comments')} sx={{ minHeight: SHEET_BAR }} />
          <Tab value="history" label="History" onClick={openTab('history')} sx={{ minHeight: SHEET_BAR }} />
        </Tabs>
      </Stack>
      <Box data-activity-body inert={!sheet} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pt: 2, pb: `calc(72px + ${safeBottom})` }}>
        {activityContent}
      </Box>
      {sheet && (
        <Fab size="small" color="default" aria-label="Hide activity" onClick={() => setSheet(false)}
          sx={{ position: 'absolute', right: 16, bottom: `calc(16px + ${safeBottom})` }}>
          <ExpandMoreIcon />
        </Fab>
      )}
    </Box>
  )

  const phoneBody = (
    // Narrow, the issue reads top to bottom: what it is, what state it's in,
    // what it says, what's on it, its fields, then the conversation.
    <Stack spacing={2.5} sx={{ mt: 3 }}>
      <Box>
        {titleBlock}
        {quickAddBar}
      </Box>
      {statusField}
      {descriptionBlock}
      {sections}
      <Section title="Details">
        {fieldsGrid}
        <Box sx={{ mt: 2 }}>{stamps}</Box>
      </Section>
      {!pinned && activity}
    </Stack>
  )

  const errorAlert = error && <Alert severity="error" onClose={() => setError(null)} sx={{ mt: 1 }}>{error}</Alert>
  const flagDialog = <FlagDialog issue={flagging ? issue : null} onSubmit={(reason) => write({ flag_reason: reason })} onClose={() => setFlagging(false)} />
  const confirmDelete = (
    <ConfirmDialog open={deleting} title={`Delete ${issue.key}?`} destructive confirmLabel="Delete" busy={busy}
      message={
        <>
          It and its comments, history{level === 'standard' ? ' and sub-tasks' : ''} are deleted for good.
          {level === 'epic' && ' Its issues stay, without an epic.'} Files stay in Google Drive.
        </>
      }
      onConfirm={remove} onClose={() => setDeleting(false)} />
  )

  // The phone dialog and the narrow side panel fill their height: the bar, the issue
  // scrolling beneath it, the activity tabs at the foot.
  if (pinned) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {phoneBar}
        {errorAlert && <Box sx={{ px: 2, flex: 'none' }}>{errorAlert}</Box>}
        <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <Box inert={sheet} sx={{ height: '100%', overflowY: 'auto', px: 2, pt: 1.5, pb: `calc(${SHEET_BAR + 24}px + ${safeBottom})` }}>
            {phoneTrail}
            {phoneBody}
          </Box>
          {activitySheet}
        </Box>
        {confirmDelete}
        {flagDialog}
      </Box>
    )
  }

  return (
    <Box sx={panelScroll ? { flex: 1, minHeight: 0, overflowY: 'auto', px: 3, pb: 3 } : undefined}>
      <Box sx={panelScroll ? { position: 'sticky', top: 0, zIndex: 2, bgcolor: 'background.paper', mx: -3, px: 3, pt: 1.5, pb: 1,
        borderBottom: 1, borderColor: 'divider' } : undefined}>
        {header}
      </Box>
      {errorAlert}
      {narrow ? phoneBody : (
        <Grid container spacing={4} sx={{ mt: 2.5 }}>
          <Grid size={8}>
            <Stack spacing={3}>
              <Box>
                {titleBlock}
                {quickAddBar}
              </Box>
              {descriptionBlock}
              {sections}
              {activity}
            </Stack>
          </Grid>
          <Grid size={4}>
            <Stack spacing={2} sx={{ position: 'sticky', top: panelScroll ? 72 : 0 }}>
              {statusField}
              {fieldsGrid}
              <Divider />
              {stamps}
            </Stack>
          </Grid>
        </Grid>
      )}
      {confirmDelete}
      {flagDialog}
    </Box>
  )
}
