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
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LinkIcon from '@mui/icons-material/Link'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { useMe } from '../../auth/AuthProvider'
import { useNotifications } from '../../workspace/notifications'
import { supabase } from '../../lib/supabase'
import { assignable, can, roleIn } from '../../lib/permissions'
import { errorMessage, formatDayTime, timeAgo } from '../../lib/constants'
import { ISSUE_COLUMNS, ISSUE_DETAIL_COLUMNS, issuePath, parentLevelFor, type IssueWrite } from '../../lib/issues'
import { isBlankHtml, sanitizeHtml } from '../../lib/richText'
import type { Attachment, Comment, CustomValues, DevLink, Doc, Issue, IssueDetail, IssueEvent, IssueLink, Profile } from '../../lib/types'
import { useWorkspace } from '../../workspace/WorkspaceProvider'
import { openSprints, useProjectMeta } from '../../workspace/useProjectMeta'
import { emitIssueChange } from '../../workspace/issueEvents'
import { ConfirmDialog, Loading, PersonAvatar, Section } from '../common'
import { CustomFieldInput, CustomFieldValue } from '../CustomFields'
import { fieldsFor } from '../../lib/fields'
import DocsList from '../DocsList'
import TodoList from '../TodoList'
import { ProjectAvatar, StatusLozenge, TypeIcon } from '../IssueBits'
import { IssuePicker, LabelsInput, PersonPicker, PrioritySelect, StatusSelect } from '../pickers'
import { RichTextEditor } from '../RichText'
import { RichTextView } from '../RichTextView'
import Attachments from './Attachments'
import Development from './Development'
import Comments from './Comments'
import History from './History'
import { Children, Links, type LinkedIssue } from './Relations'

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

export default function IssueView({ issueKey, onClose }: { issueKey: string; onClose?: () => void }) {
  const me = useMe()
  const navigate = useNavigate()
  const ws = useWorkspace()
  const { profiles, issueTypes, projectById, typeById, statusById, statusesOf, profileById, roleOf } = ws
  const [data, setData] = useState<Loaded | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'comments' | 'history'>('comments')
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState('')
  const [editingDescription, setEditingDescription] = useState(false)
  const [description, setDescription] = useState('')
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [typeAnchor, setTypeAnchor] = useState<HTMLElement | null>(null)
  const [parentAnchor, setParentAnchor] = useState<HTMLElement | null>(null)

  const reload = useCallback(async () => {
    setData(await loadIssue(issueKey))
  }, [issueKey])

  useEffect(() => {
    setData(undefined)
    reload()
  }, [reload])

  const issue = data?.issue
  // Having looked at an issue is what reading its notifications means.
  const { markIssueRead } = useNotifications()
  useEffect(() => {
    if (issue?.id) markIssueRead(issue.id)
  }, [issue?.id, markIssueRead])
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
  const statuses = statusesOf(issue.project_id)
  const fields = meta ? fieldsFor(meta.fields, issue.type_id) : []
  const watching = data.watchers.includes(me.id)
  const parentLevel = parentLevelFor(level)
  const parentWord = level === 'subtask' ? 'parent' : 'epic'
  // A type can change only within its level (issues_guard keeps the hierarchy).
  const sameLevelTypes = issueTypes.filter((t) => t.level === level && (!t.archived || t.id === issue.type_id))

  async function save(patch: IssueWrite) {
    if (!issue) return false
    setError(null)
    const { data: row, error: e } = await supabase.from('issues').update(patch).eq('id', issue.id).select(ISSUE_DETAIL_COLUMNS).single()
    if (e || !row) {
      setError(errorMessage(e, "That change wasn't saved."))
      return false
    }
    setData((d) => (d ? { ...d, issue: row as unknown as IssueDetail } : d))
    emitIssueChange(issue.id)
    // The history and watchers come from triggers.
    const [events, watchers] = await Promise.all([
      supabase.from('issue_events').select('*').eq('issue_id', issue.id).order('created_at'),
      supabase.from('issue_watchers').select('profile_id').eq('issue_id', issue.id),
    ])
    setData((d) => d && {
      ...d,
      events: (events.data ?? d.events) as IssueEvent[],
      watchers: ((watchers.data ?? []) as { profile_id: string }[]).map((w) => w.profile_id),
    })
    return true
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
    if (await save({ description: isBlankHtml(description) ? '' : sanitizeHtml(description) })) setEditingDescription(false)
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

  const header = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minHeight: 40 }}>
      <Breadcrumbs sx={{ flexGrow: 1, minWidth: 0, '& ol': { flexWrap: 'nowrap' } }}>
        <MuiLink component={Link} to={`/projects/${project.key}`} underline="hover" color="text.secondary"
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <ProjectAvatar project={project} size={20} />
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{project.name}</Box>
        </MuiLink>
        {data.parent ? (
          <Stack direction="row" sx={{ alignItems: 'center', '&:hover .change-parent, & .change-parent:focus-visible': { opacity: 1 } }}>
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
            <Button size="small" color="inherit" startIcon={<TypeIcon type={issueTypes.find((t) => t.level === 'epic')} size={16} tooltip={false} />}
              onClick={(e) => setParentAnchor(e.currentTarget)} sx={{ color: 'text.secondary', minWidth: 0, py: 0, whiteSpace: 'nowrap' }}>
              Add epic
            </Button>
          )
        )}
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
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
      </Breadcrumbs>
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
      <Tooltip title={watching ? 'Stop watching' : 'Watch: hear about every change'}>
        <Button size="small" color="inherit" startIcon={watching ? <VisibilityIcon /> : <VisibilityOutlinedIcon />} onClick={toggleWatch}
          aria-pressed={watching} aria-label={watching ? 'Stop watching' : 'Watch'}>
          {data.watchers.length}
        </Button>
      </Tooltip>
      {onClose && (
        <Tooltip title="Open as a page">
          <IconButton aria-label="Open as a page" component={Link} to={issuePath(issue.key)}><OpenInFullIcon fontSize="small" /></IconButton>
        </Tooltip>
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
    </Stack>
  )

  const titleBlock = editingTitle ? (
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

  const descriptionBlock = (
    <Section title="Description">
      {editingDescription ? (
        <Box>
          <RichTextEditor label="Description" value={description} onChange={setDescription} mentionables={mentionables} autoFocus
            minHeight={160} onSubmit={saveDescription} />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button variant="contained" size="small" onClick={saveDescription}>Save</Button>
            <Button size="small" onClick={() => setEditingDescription(false)}>Cancel</Button>
          </Stack>
        </Box>
      ) : (
        <Box
          onClick={() => {
            if (!editable) return
            setDescription(issue.description)
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

  const details = (
    <Stack spacing={2}>
      <StatusSelect value={issue.status_id} statuses={statuses} disabled={!editable} onChange={(id) => save({ status_id: id })} />
      <Box>
        <PersonPicker label="Assignee" value={issue.assignee_id} options={people} disabled={!editable}
          onChange={(id) => save({ assignee_id: id })} />
        {editable && issue.assignee_id !== me.id && people.some((p) => p.id === me.id) && (
          <Button size="small" sx={{ mt: 0.5, ml: -0.5 }} onClick={() => save({ assignee_id: me.id })}>Assign to me</Button>
        )}
      </Box>
      <PrioritySelect value={issue.priority} disabled={!editable} onChange={(p) => save({ priority: p })} />
      {editable ? (
        <LabelsInput value={issue.labels} onChange={(labels) => save({ labels })} />
      ) : (
        <Detail label="Labels"><Typography variant="body2">{issue.labels.join(', ') || 'None'}</Typography></Detail>
      )}
      <TextField key={`sp-${issue.story_points}`} label="Story points" type="number" defaultValue={issue.story_points ?? ''} disabled={!editable}
        fullWidth slotProps={{ htmlInput: { min: 0, step: 0.5 } }}
        onBlur={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value)
          if (v !== issue.story_points) save({ story_points: v })
        }} />
      <Grid container spacing={2}>
        {sprintField && <Grid size={6}>{sprintField}</Grid>}
        {meta && (
          <Grid size={sprintField ? 6 : 12}>
            <TextField select label="Release" value={issue.release_id ?? ''} disabled={!editable} fullWidth
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
      </Grid>
      {fields.map((f) =>
        editable ? (
          <CustomFieldInput key={`${f.id}-${JSON.stringify(issue.custom[f.id] ?? null)}`} field={f} value={issue.custom[f.id]}
            people={profiles.filter((p) => p.active)} onChange={(v) => setCustom(f.id, v)} />
        ) : (
          <Detail key={f.id} label={f.name}>
            <CustomFieldValue field={f} value={issue.custom[f.id]} person={profileById(issue.custom[f.id] as string)} />
          </Detail>
        ),
      )}
      <PersonPicker label="Reporter" value={issue.reporter_id} options={profiles.filter((p) => p.active)} disabled={!editable}
        allowNone={false} onChange={(id) => id && save({ reporter_id: id })} />
      <Divider />
      <Stack spacing={0.5}>
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
    </Stack>
  )

  return (
    <Box>
      {header}
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mt: 1 }}>{error}</Alert>}
      <Grid container spacing={{ xs: 3, md: 4 }} sx={{ mt: 0.5 }}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={3}>
            <Box>
              {titleBlock}
              <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: 'center', display: { md: 'none' } }}>
                <StatusLozenge status={statusById(issue.status_id)} />
                <PersonAvatar person={profileById(issue.assignee_id)} size={22} tooltip />
              </Stack>
            </Box>
            {descriptionBlock}
            <Children parent={issue} issues={data.children} role={role} onChange={(children) => setData((d) => d && { ...d, children })} />
            <Links issue={issue} links={data.links} role={role} onChange={(links) => setData((d) => d && { ...d, links })} />
            <Development links={data.devLinks} />
            <Attachments issueId={issue.id} attachments={data.attachments} role={role}
              onChange={(attachments) => setData((d) => d && { ...d, attachments })} />
            <Section title="Docs">
              <DocsList projectId={issue.project_id} issueId={issue.id} docs={data.docs} role={role} dense
                onChange={(docs) => setData((d) => d && { ...d, docs })} />
            </Section>
            {/* Yours and the ones you're on: todos are not the issue's, so
                anyone who can see the issue may keep them here. */}
            <Section title="Todos">
              <TodoList issue={{ id: issue.id, key: issue.key }} />
            </Section>
            <Box>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Tab value="comments" label={`Comments${data.comments.length ? ` (${data.comments.length})` : ''}`} />
                <Tab value="history" label="History" />
              </Tabs>
              {tab === 'comments' ? (
                <Comments issueId={issue.id} comments={data.comments} attachments={data.attachments} role={role} mentionables={mentionables}
                  onChange={(comments) => setData((d) => d && { ...d, comments })}
                  onAttachmentsChange={(update) => setData((d) => d && { ...d, attachments: update(d.attachments) })} />
              ) : (
                <History events={data.events} />
              )}
            </Box>
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }} sx={{ order: { xs: -1, md: 0 } }}>
          <Box sx={{ position: { md: 'sticky' }, top: { md: 0 } }}>{details}</Box>
        </Grid>
      </Grid>
      <ConfirmDialog open={deleting} title={`Delete ${issue.key}?`} destructive confirmLabel="Delete" busy={busy}
        message={
          <>
            It and its comments, history{level === 'standard' ? ' and sub-tasks' : ''} are deleted for good.
            {level === 'epic' && ' Its issues stay, without an epic.'} Files stay in Google Drive.
          </>
        }
        onConfirm={remove} onClose={() => setDeleting(false)} />
    </Box>
  )
}
