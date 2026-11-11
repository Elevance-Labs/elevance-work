import DOMPurify from 'dompurify'

// What the editor (components/RichText.tsx) can produce. Anything else is
// dropped, so pasted or stored HTML can't carry scripts, styles or images.
// Mentions are spans with data-type="mention", data-id (a profile id, which
// the database reads to notify them) and data-label. Tables keep their cell
// spans; the editor's inline widths (style) are dropped like any style.
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre', 'span',
  'table', 'colgroup', 'col', 'thead', 'tbody', 'tr', 'th', 'td',
]
const ALLOWED_ATTR = ['href', 'target', 'rel', 'data-type', 'data-id', 'data-label', 'class', 'colspan', 'rowspan']

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // Links always open in a new tab without access to this page.
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  }
  // Only mention spans keep their data-*; nothing else needs classes.
  if (node.tagName === 'SPAN' && node.getAttribute('data-type') !== 'mention') {
    for (const a of ['data-type', 'data-id', 'data-label']) node.removeAttribute(a)
  }
  if (node.hasAttribute('class') && !(node.tagName === 'SPAN' && node.getAttribute('data-type') === 'mention')) {
    node.removeAttribute('class')
  }
})

// Run on save and again wherever HTML is shown: never trust what's stored.
export function sanitizeHtml(html: string) {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })
}

export function isBlankHtml(html: string | null | undefined) {
  return !html || !html.replace(/<(?!span[^>]*data-type="mention")[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}

/** Plain text, for previews and notifications. */
export function htmlToText(html: string) {
  const div = document.createElement('div')
  div.innerHTML = sanitizeHtml(html)
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** The profile ids mentioned in editor HTML (mirror of mentioned_ids in the schema). */
export function mentionedIds(html: string) {
  const ids = new Set<string>()
  for (const m of html.matchAll(/<span[^>]*\sdata-id="([0-9a-f-]{36})"/g)) ids.add(m[1])
  return [...ids]
}

// Shared by the editor and the read-only view, so text looks the same while
// it's written as once it's saved.
export const richTextSx = {
  typography: 'body2',
  fontSize: '0.9375rem',
  lineHeight: 1.65,
  overflowWrap: 'anywhere',
  '& > :first-of-type': { mt: 0 },
  '& > :last-child': { mb: 0 },
  '& p': { my: 1 },
  '& h2': { typography: 'h6', mt: 2.5, mb: 1 },
  '& h3': { typography: 'subtitle1', fontWeight: 600, mt: 2, mb: 0.75 },
  '& ul, & ol': { pl: 3, my: 1 },
  '& li > p': { my: 0.25 },
  '& blockquote': { borderLeft: 3, borderColor: 'divider', pl: 2, ml: 0, color: 'text.secondary' },
  '& a': { color: 'primary.main' },
  '& code': { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.85em', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 },
  '& pre': { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.85em', bgcolor: 'action.hover', p: 1.5, borderRadius: 1, overflowX: 'auto' },
  '& pre code': { bgcolor: 'transparent', p: 0 },
  // Wide tables scroll sideways rather than stretch the dialog.
  '& table': { borderCollapse: 'collapse', my: 1.5, display: 'block', maxWidth: '100%', overflowX: 'auto', width: 'max-content' },
  '& .tableWrapper': { maxWidth: '100%', overflowX: 'auto', my: 1.5 },
  '& .tableWrapper table': { my: 0 },
  '& th, & td': { border: 1, borderColor: 'divider', px: 1, py: 0.5, verticalAlign: 'top', minWidth: 64, textAlign: 'left' },
  '& th': { bgcolor: 'action.hover', fontWeight: 600 },
  '& th > p, & td > p': { my: 0 },
  // The editor's cell selection (drag across cells).
  '& .selectedCell': { bgcolor: 'action.selected' },
  '& .mention': { color: 'primary.main', bgcolor: 'action.selected', borderRadius: 1, px: 0.5, fontWeight: 500 },
}
