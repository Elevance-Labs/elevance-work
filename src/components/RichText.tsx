// The rich text editor (TipTap) for descriptions, comments and release
// notes, with @mentions and simple tables (no merged cells or resizing). It is heavy, so only lazily loaded modules import it
// (the issue view, the create dialog); read-only text uses RichTextView.
//
// Mounts with `value` and reports changes; it doesn't follow `value` after
// that, so give it a `key` to reset it (e.g. after a comment is sent).
import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import { TableKit } from '@tiptap/extension-table'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import {
  Box,
  Button,
  Divider,
  FormLabel,
  IconButton,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Popper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CodeIcon from '@mui/icons-material/Code'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import FormatQuoteIcon from '@mui/icons-material/FormatQuote'
import GridOnIcon from '@mui/icons-material/GridOn'
import LinkIcon from '@mui/icons-material/Link'
import { richTextSx } from '../lib/richText'
import type { Profile } from '../lib/types'
import { PersonAvatar } from './common'

function ToolButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: ReactElement
  active?: boolean
  onClick: (e: MouseEvent<HTMLElement>) => void
}) {
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        aria-pressed={active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        sx={{ borderRadius: 1, color: active ? 'primary.main' : 'text.secondary', bgcolor: active ? 'action.selected' : undefined }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h3: e.isActive('heading', { level: 3 }),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
    }),
  })
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null)
  const [tableAnchor, setTableAnchor] = useState<HTMLElement | null>(null)
  const [href, setHref] = useState('')
  const chain = () => editor.chain().focus()

  function applyLink() {
    const url = href.trim()
    if (!url) chain().extendMarkRange('link').unsetLink().run()
    else chain().extendMarkRange('link').setLink({ href: /^[a-z]+:/i.test(url) ? url : `https://${url}` }).run()
    setLinkAnchor(null)
  }

  return (
    <Stack direction="row" spacing={0.25} sx={{ px: 0.5, py: 0.25, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap', alignItems: 'center' }}>
      <ToolButton label="Bold" icon={<FormatBoldIcon fontSize="small" />} active={state.bold} onClick={() => chain().toggleBold().run()} />
      <ToolButton label="Italic" icon={<FormatItalicIcon fontSize="small" />} active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <Tooltip title="Heading">
        <Button
          size="small"
          aria-label="Heading"
          aria-pressed={state.h3}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
          sx={{ minWidth: 32, px: 0.5, color: state.h3 ? 'primary.main' : 'text.secondary' }}
        >
          H
        </Button>
      </Tooltip>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
      <ToolButton label="Bulleted list" icon={<FormatListBulletedIcon fontSize="small" />} active={state.bullets} onClick={() => chain().toggleBulletList().run()} />
      <ToolButton label="Numbered list" icon={<FormatListNumberedIcon fontSize="small" />} active={state.numbers} onClick={() => chain().toggleOrderedList().run()} />
      <ToolButton label="Quote" icon={<FormatQuoteIcon fontSize="small" />} active={state.quote} onClick={() => chain().toggleBlockquote().run()} />
      <ToolButton label="Code block" icon={<CodeIcon fontSize="small" />} active={state.code} onClick={() => chain().toggleCodeBlock().run()} />
      <ToolButton
        label="Link"
        icon={<LinkIcon fontSize="small" />}
        active={state.link}
        onClick={(e) => {
          setHref((editor.getAttributes('link').href as string | undefined) ?? '')
          setLinkAnchor(e.currentTarget)
        }}
      />
      <ToolButton
        label={state.table ? 'Table options' : 'Insert table'}
        icon={<GridOnIcon fontSize="small" />}
        active={state.table}
        onClick={(e) => {
          if (state.table) setTableAnchor(e.currentTarget)
          else chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }}
      />
      <Menu open={!!tableAnchor} anchorEl={tableAnchor} onClose={() => setTableAnchor(null)}
        // Keep the editor's selection: it says which row and column.
        disableRestoreFocus slotProps={{ list: { dense: true, 'aria-label': 'Table options' } }}>
        {TABLE_ACTIONS.map(([label, run, divider]) => (
          <MenuItem key={label} divider={divider} onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              run(chain()).run()
              setTableAnchor(null)
            }}>
            {label}
          </MenuItem>
        ))}
      </Menu>
      <Popover open={!!linkAnchor} anchorEl={linkAnchor} onClose={() => setLinkAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Stack
          component="form"
          direction="row"
          spacing={1}
          sx={{ p: 1.5, alignItems: 'center' }}
          onSubmit={(e) => {
            e.preventDefault()
            applyLink()
          }}
        >
          <TextField label="Link URL" autoFocus value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://" sx={{ width: 240 }} />
          <Button type="submit" variant="contained">{href.trim() ? 'Apply' : 'Remove'}</Button>
        </Stack>
      </Popover>
    </Stack>
  )
}

type Chain = ReturnType<Editor['chain']>

// What the table button offers inside a table: label, command, divider after.
const TABLE_ACTIONS: [string, (c: Chain) => Chain, boolean?][] = [
  ['Add row above', (c) => c.addRowBefore()],
  ['Add row below', (c) => c.addRowAfter()],
  ['Add column left', (c) => c.addColumnBefore()],
  ['Add column right', (c) => c.addColumnAfter(), true],
  ['Delete row', (c) => c.deleteRow()],
  ['Delete column', (c) => c.deleteColumn(), true],
  ['Header row on / off', (c) => c.toggleHeaderRow()],
  ['Delete table', (c) => c.deleteTable()],
]

interface SuggestState {
  items: Profile[]
  index: number
  rect: (() => DOMRect | null) | null
  command: ((item: { id: string; label: string }) => void) | null
}

const CLOSED: SuggestState = { items: [], index: 0, rect: null, command: null }

export function RichTextEditor({
  label,
  value,
  onChange,
  placeholder,
  mentionables = [],
  minHeight = 140,
  autoFocus,
  onSubmit,
}: {
  label: string
  value: string
  onChange: (html: string) => void
  placeholder?: string
  // Who @ suggests: people who can see the issue.
  mentionables?: Profile[]
  minHeight?: number
  autoFocus?: boolean
  // Ctrl/⌘+Enter.
  onSubmit?: () => void
}) {
  const [suggest, setSuggest] = useState<SuggestState>(CLOSED)
  // The editor is built once; these refs keep its callbacks current.
  const suggestRef = useRef(suggest)
  const peopleRef = useRef(mentionables)
  const submitRef = useRef(onSubmit)
  useEffect(() => {
    suggestRef.current = suggest
    peopleRef.current = mentionables
    submitRef.current = onSubmit
  })

  const pick = (p: Profile) => suggestRef.current.command?.({ id: p.id, label: p.full_name })

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      TableKit.configure({ table: { resizable: false } }),
      // TipTap calls these callbacks on keystrokes, never during render; the
      // refs give them the current people and handlers.
      // oxlint-disable-next-line react/refs
      Mention.configure({
        HTMLAttributes: { class: 'mention' },
        renderText: ({ node }) => `@${node.attrs.label ?? ''}`,
        suggestion: {
          char: '@',
          items: ({ query }) => {
            const q = query.toLowerCase()
            return peopleRef.current
              .filter((p) => p.active && (p.full_name.toLowerCase().includes(q) || p.email.startsWith(q)))
              .slice(0, 6)
          },
          render: () => ({
            onStart: (props: SuggestionProps<Profile>) =>
              setSuggest({ items: props.items, index: 0, rect: props.clientRect ?? null, command: props.command }),
            onUpdate: (props: SuggestionProps<Profile>) =>
              setSuggest((s) => ({ items: props.items, index: Math.min(s.index, Math.max(0, props.items.length - 1)),
                rect: props.clientRect ?? null, command: props.command })),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              const s = suggestRef.current
              if (!s.items.length) return false
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const step = event.key === 'ArrowDown' ? 1 : -1
                setSuggest({ ...s, index: (s.index + step + s.items.length) % s.items.length })
                return true
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const p = s.items[s.index]
                if (p) s.command?.({ id: p.id, label: p.full_name })
                return true
              }
              if (event.key === 'Escape') {
                setSuggest(CLOSED)
                return true
              }
              return false
            },
            onExit: () => setSuggest(CLOSED),
          }),
        },
      }),
    ],
    content: value,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && submitRef.current) {
          submitRef.current()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML()),
  })
  const empty = useEditorState({ editor, selector: ({ editor: e }) => e?.isEmpty ?? true })

  useEffect(() => () => setSuggest(CLOSED), [])

  const anchor = suggest.rect
    ? { getBoundingClientRect: () => suggest.rect?.() ?? new DOMRect(), contextElement: undefined }
    : null

  return (
    <Box>
      <FormLabel sx={{ display: 'block', mb: 0.75, typography: 'body2' }}>{label}</FormLabel>
      <Paper
        variant="outlined"
        sx={{
          overflow: 'hidden',
          '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` },
        }}
      >
        {editor && <Toolbar editor={editor} />}
        <Box sx={[richTextSx, { position: 'relative', '& .ProseMirror': { minHeight, px: 1.5, py: 1, outline: 'none' } }]}>
          {empty && placeholder && (
            <Box aria-hidden sx={{ position: 'absolute', top: 8, left: 12, color: 'text.disabled', pointerEvents: 'none' }}>
              {placeholder}
            </Box>
          )}
          <EditorContent editor={editor} />
        </Box>
      </Paper>
      <Popper open={!!anchor && suggest.items.length > 0} anchorEl={anchor} placement="bottom-start" sx={{ zIndex: 1500 }}>
        <Paper elevation={6} sx={{ minWidth: 220 }}>
          <List dense role="listbox" aria-label="People to mention">
            {suggest.items.map((p, i) => (
              <ListItemButton
                key={p.id}
                role="option"
                selected={i === suggest.index}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(p)
                }}
                sx={{ gap: 1 }}
              >
                <PersonAvatar person={p} size={22} />
                <Typography variant="body2" noWrap>{p.full_name}</Typography>
              </ListItemButton>
            ))}
          </List>
        </Paper>
      </Popper>
    </Box>
  )
}
