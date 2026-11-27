// The editors that open over a sheet cell: text (one line or several), a
// choice from a list, and impacted areas (comma-separated, with
// suggestions). Each commits once, saying where the selection goes next, the
// way a spreadsheet does: Enter down, Tab right, Escape cancels, leaving the
// cell keeps what was typed.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Box, MenuItem, MenuList, Paper, Popper } from '@mui/material'

export type Move = 'down' | 'up' | 'right' | 'left' | 'none'

interface EditorProps {
  label: string
  initial: string
  /** Opened by typing a character (it replaces the value): arrows then leave the cell. */
  typed: boolean
  onCommit: (text: string, move: Move) => void
  onCancel: () => void
}

const shell = {
  position: 'absolute',
  top: -1,
  left: -1,
  zIndex: 4,
  minWidth: 'calc(100% + 2px)',
  bgcolor: 'background.paper',
  outline: 2,
  outlineColor: 'primary.main',
  boxShadow: 4,
} as const

const field = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  border: 0,
  outline: 0,
  resize: 'none',
  bgcolor: 'transparent',
  color: 'text.primary',
  font: 'inherit',
  lineHeight: '20px',
  px: 1,
  py: '7px',
} as const

/** Commits once: Enter, Tab or Escape unmount the editor, and its blur must not commit again. */
function useOnce(onCommit: EditorProps['onCommit'], onCancel: EditorProps['onCancel']) {
  const done = useRef(false)
  return {
    commit: (text: string, move: Move) => {
      if (done.current) return
      done.current = true
      onCommit(text, move)
    },
    cancel: () => {
      if (done.current) return
      done.current = true
      onCancel()
    },
  }
}

const arrowMove: Record<string, Move> = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' }

export function TextEditor({ label, initial, typed, multiline, minWidth, onCommit, onCancel }: EditorProps & { multiline?: boolean; minWidth?: number }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const { commit, cancel } = useOnce(onCommit, onCancel)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  // Grow with the text.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [value])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const newline = multiline && e.key === 'Enter' && (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey)
    if (newline) {
      if (e.altKey || e.metaKey || e.ctrlKey) {
        // Alt / Cmd+Enter don't type a line break by themselves.
        e.preventDefault()
        const el = e.currentTarget
        const at = el.selectionStart
        setValue(`${value.slice(0, at)}\n${value.slice(el.selectionEnd)}`)
        requestAnimationFrame(() => el.setSelectionRange(at + 1, at + 1))
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(value, e.shiftKey ? 'up' : 'down')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commit(value, e.shiftKey ? 'left' : 'right')
    } else if (e.key === 'Escape') {
      // Not the dialog's Escape too.
      e.preventDefault()
      e.stopPropagation()
      cancel()
    } else if (typed && arrowMove[e.key] && !e.shiftKey) {
      e.preventDefault()
      commit(value, arrowMove[e.key])
    }
  }

  return (
    <Box sx={{ ...shell, minWidth: minWidth ? `max(calc(100% + 2px), ${minWidth}px)` : shell.minWidth }}>
      <Box component="textarea" ref={ref} rows={1} value={value} aria-label={label}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
        onKeyDown={onKeyDown} onBlur={() => commit(value, 'none')} sx={field} />
    </Box>
  )
}

/** A list to pick from (type, level); typing filters it. */
export function ChoiceEditor({ label, initial, typed, options, onCommit, onCancel }: EditorProps & { options: string[] }) {
  const [query, setQuery] = useState(typed ? initial : '')
  const current = typed ? '' : initial
  const ref = useRef<HTMLInputElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { commit, cancel } = useOnce(onCommit, onCancel)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = options.filter((o) => o.toLowerCase().includes(q))
    // What it starts with first.
    return [...hits.filter((o) => o.toLowerCase().startsWith(q)), ...hits.filter((o) => !o.toLowerCase().startsWith(q))]
  }, [options, query])
  // The last entry clears the cell.
  const items = current ? [...shown, ''] : shown
  const [highlight, setHighlight] = useState(() => Math.max(0, typed ? 0 : options.indexOf(initial)))

  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true })
    setAnchor(ref.current)
  }, [])
  useEffect(() => {
    if (query) setHighlight(0)
  }, [query])

  const pick = (move: Move) => commit(items.length ? items[Math.min(highlight, items.length - 1)] : query, move)

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = items.length || 1
      setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(e.shiftKey ? 'up' : 'down')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      pick(e.shiftKey ? 'left' : 'right')
    } else if (e.key === 'Escape') {
      // Not the dialog's Escape too.
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
  }

  return (
    <Box sx={shell}>
      <Box component="input" ref={ref} value={query} placeholder={current || 'Choose…'} aria-label={label} role="combobox"
        aria-expanded="true" aria-autocomplete="list"
        onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} onKeyDown={onKeyDown}
        // Leaving the cell keeps a choice only if one was being typed.
        onBlur={() => (query ? pick('none') : cancel())} sx={field} />
      <Popper open={!!anchor} anchorEl={anchor} placement="bottom-start" sx={{ zIndex: 1400 }}>
        <Paper elevation={6} sx={{ minWidth: anchor?.offsetWidth ?? 160, maxHeight: 280, overflow: 'auto' }}>
          <MenuList dense role="listbox" aria-label={label}>
            {items.map((o, i) => (
              <MenuItem key={o || '(clear)'} role="option" selected={i === highlight} aria-selected={i === highlight}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(o, 'none')} sx={o ? undefined : { color: 'text.secondary', fontStyle: 'italic' }}>
                {o || 'Clear'}
              </MenuItem>
            ))}
            {!items.length && <MenuItem disabled>Not one of this project's {label.toLowerCase()}s</MenuItem>}
          </MenuList>
        </Paper>
      </Popper>
    </Box>
  )
}

/** Comma-separated areas, suggesting the project's own for the one being typed. */
export function AreasEditor({ label, initial, typed, known, onCommit, onCancel }: EditorProps & { known: string[] }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [highlight, setHighlight] = useState(-1)
  const { commit, cancel } = useOnce(onCommit, onCancel)
  const parts = value.split(',')
  const token = parts.at(-1)!.trim().toLowerCase()
  const chosen = parts.slice(0, -1).map((p) => p.trim().toLowerCase())
  const suggestions = token
    ? known.filter((k) => k.toLowerCase().includes(token) && k.toLowerCase() !== token && !chosen.includes(k.toLowerCase())).slice(0, 8)
    : []

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
    setAnchor(el)
  }, [])
  useEffect(() => setHighlight(-1), [token])

  const take = (s: string) => {
    setValue([...parts.slice(0, -1).map((p) => p.trim()), s].filter(Boolean).join(', ') + ', ')
    setHighlight(-1)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const n = suggestions.length
      setHighlight((h) => (e.key === 'ArrowDown' ? (h + 1) % n : (h - 1 + n) % n))
    } else if (e.key === 'Enter' && highlight >= 0 && suggestions[highlight]) {
      e.preventDefault()
      take(suggestions[highlight])
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(value, e.shiftKey ? 'up' : 'down')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commit(value, e.shiftKey ? 'left' : 'right')
    } else if (e.key === 'Escape') {
      // Not the dialog's Escape too.
      e.preventDefault()
      e.stopPropagation()
      cancel()
    } else if (typed && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
      e.preventDefault()
      commit(value, arrowMove[e.key])
    }
  }

  return (
    <Box sx={{ ...shell, minWidth: 'max(calc(100% + 2px), 240px)' }}>
      <Box component="input" ref={ref} value={value} aria-label={label} placeholder="Checkout, Payments…"
        onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)} onKeyDown={onKeyDown}
        onBlur={() => commit(value, 'none')} sx={field} />
      <Popper open={!!anchor && suggestions.length > 0} anchorEl={anchor} placement="bottom-start" sx={{ zIndex: 1400 }}>
        <Paper elevation={6} sx={{ minWidth: 200 }}>
          <MenuList dense role="listbox" aria-label={`${label} suggestions`}>
            {suggestions.map((s, i) => (
              <MenuItem key={s} role="option" selected={i === highlight} onMouseDown={(e) => e.preventDefault()} onClick={() => take(s)}>
                {s}
              </MenuItem>
            ))}
          </MenuList>
        </Paper>
      </Popper>
    </Box>
  )
}
