// Search (Cmd/Ctrl+S, or the box in the header): one box, results grouped as
// Issues, Todos and Notes, a few of each. Issues come from the database as
// you type; todos and notes are only your own (and todos you're on). Arrow
// keys move, Enter opens.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Dialog,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  TextField,
  Typography,
} from '@mui/material'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import SearchIcon from '@mui/icons-material/Search'
import StickyNote2Icon from '@mui/icons-material/StickyNote2'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/constants'
import { ISSUE_COLUMNS, parseIssueKey } from '../lib/issues'
import { NOTE_COLORS, noteHeading } from '../lib/notes'
import { SEARCH_LIMIT, searchNotes, searchTodos } from '../lib/search'
import type { Issue, Note, Todo } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { StatusLozenge, TypeIcon } from './IssueBits'
import { useIssueHref } from './useIssueHref'

type Group = 'Issues' | 'Todos' | 'Notes' | ''
interface Result {
  id: string
  group: Group
  icon: ReactNode
  primary: ReactNode
  secondary?: ReactNode
  aside?: ReactNode
  go: () => void
}

type TodoHit = Todo & { issue: { key: string } | null }
interface Local {
  todos: TodoHit[]
  notes: Note[]
}

export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const me = useMe()
  const navigate = useNavigate()
  const issueHref = useIssueHref()
  const { typeById, statusById, projectById } = useWorkspace()
  const [q, setQ] = useState('')
  const [issues, setIssues] = useState<{ q: string; rows: Issue[] }>({ q: '', rows: [] })
  const [local, setLocal] = useState<Local | null>(null)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const text = q.trim()

  // Your todos and notes, once per opening.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('todos').select('*, issue:issues(key)'),
      supabase.from('notes').select('*').eq('owner_id', me.id),
    ]).then(([t, n]) => {
      if (!cancelled) setLocal({
        todos: (t.data ?? []) as unknown as TodoHit[],
        notes: (n.data ?? []) as Note[],
      })
    })
    return () => {
      cancelled = true
    }
  }, [me.id])

  // Issues: a key goes straight to it; words search their text.
  useEffect(() => {
    if (!text) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const key = parseIssueKey(text)
      let query = supabase.from('issues').select(ISSUE_COLUMNS)
      query = key ? query.eq('key', `${key.projectKey}-${key.number}`) : query.textSearch('search', text, { type: 'websearch', config: 'simple' })
      const { data } = await query.order('updated_at', { ascending: false }).limit(SEARCH_LIMIT)
      if (!cancelled) setIssues({ q: text, rows: (data ?? []) as unknown as Issue[] })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text])

  const go = (to: string) => () => {
    onClose()
    navigate(to)
  }

  const results = useMemo<Result[]>(() => {
    if (!text) return []
    const out: Result[] = []
    for (const i of issues.q === text ? issues.rows : []) {
      out.push({
        id: `issue:${i.id}`, group: 'Issues', icon: <TypeIcon type={typeById(i.type_id)} />,
        primary: i.title, secondary: `${i.key} · ${projectById(i.project_id)?.name ?? ''}`,
        aside: <StatusLozenge status={statusById(i.status_id)} />, go: go(issueHref(i.key)),
      })
    }
    if (local) {
      for (const t of searchTodos(local.todos, text)) {
        const bits = [t.done_at ? 'Done' : t.due_on ? `Due ${formatDate(t.due_on, false)}` : 'No date', t.issue?.key].filter(Boolean)
        out.push({
          id: `todo:${t.id}`, group: 'Todos',
          icon: t.done_at ? <CheckBoxIcon fontSize="small" color="disabled" /> : <CheckBoxOutlineBlankIcon fontSize="small" />,
          primary: t.title, secondary: bits.join(' · '), go: go('/todos'),
        })
      }
      for (const n of searchNotes(local.notes, text)) {
        out.push({
          id: `note:${n.id}`, group: 'Notes', icon: <StickyNote2Icon fontSize="small" sx={{ color: NOTE_COLORS[n.color].bg, stroke: 'rgba(0,0,0,.25)' }} />,
          primary: noteHeading(n), secondary: n.title.trim() ? n.body.split('\n')[0].slice(0, 80) : undefined,
          go: go(`/notes?note=${n.id}`),
        })
      }
    }
    if (!parseIssueKey(text)) {
      out.push({
        id: 'all-issues', group: '', icon: <SearchIcon fontSize="small" />,
        primary: <>Search all issues for “{text}”</>, go: go(`/issues?text=${encodeURIComponent(text)}`),
      })
    }
    return out
    // go/issueHref are rebuilt each render from the location; the inputs below are what change the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, issues, local, typeById, statusById, projectById])

  // A new search starts at the top.
  const current = Math.min(active, Math.max(results.length - 1, 0))
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!results.length) return
      const by = e.key === 'ArrowDown' ? 1 : -1
      setActive((current + by + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const key = parseIssueKey(text)
      // A key opens that issue even before the search has answered.
      if (key && !results.length) go(issueHref(`${key.projectKey}-${key.number}`))()
      else results[current]?.go()
    }
  }

  const loading = !!text && (issues.q !== text || !local)
  let lastGroup: Group | null = null

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm"
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
      slotProps={{ paper: { sx: { mt: { xs: 2, sm: '10vh' }, mx: { xs: 2, sm: 4 }, width: { xs: 'calc(100% - 32px)', sm: undefined } } } }}>
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <TextField autoFocus fullWidth placeholder="Search issues, todos and notes" value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          slotProps={{
            htmlInput: {
              'aria-label': 'Search issues, todos and notes', role: 'combobox', 'aria-expanded': results.length > 0, 'aria-controls': 'search-results',
              'aria-activedescendant': results[current] ? `search-${results[current].id}` : undefined, autoComplete: 'off',
            },
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
          }} />
      </Box>
      {!text ? (
        <Typography variant="body2" sx={{ p: 2, color: 'text.secondary' }}>
          Type to search issues, and your todos and notes. A key like WEB-12 opens that issue.
        </Typography>
      ) : (
        <List id="search-results" role="listbox" ref={listRef} dense sx={{ maxHeight: '60vh', overflow: 'auto', py: 0 }}>
          {results.map((r, index) => {
            const heading = r.group && r.group !== lastGroup ? (
              <ListSubheader key={`h-${r.group}`} role="presentation" sx={{ lineHeight: '32px', fontWeight: 700 }}>{r.group}</ListSubheader>
            ) : null
            lastGroup = r.group
            return [
              heading,
              <ListItemButton key={r.id} id={`search-${r.id}`} role="option" aria-selected={index === current} selected={index === current}
                data-result={r.id} onMouseMove={() => index !== current && setActive(index)} onClick={r.go} sx={{ gap: 1 }}>
                <ListItemIcon sx={{ minWidth: 28 }}>{r.icon}</ListItemIcon>
                <ListItemText primary={r.primary} secondary={r.secondary}
                  slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} sx={{ minWidth: 0 }} />
                {r.aside}
              </ListItemButton>,
            ]
          })}
          {loading && results.length <= 1 && (
            <Typography variant="body2" sx={{ px: 2, py: 1.5, color: 'text.secondary' }}>Searching…</Typography>
          )}
          {!loading && results.every((r) => !r.group) && (
            <Typography variant="body2" sx={{ px: 2, py: 1.5, color: 'text.secondary' }}>Nothing matches “{text}”.</Typography>
          )}
        </List>
      )}
    </Dialog>
  )
}
