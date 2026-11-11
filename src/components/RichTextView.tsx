import { useMemo } from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'
import { richTextSx, sanitizeHtml } from '../lib/richText'

export function RichTextView({ html, sx }: { html: string; sx?: SxProps<Theme> }) {
  const clean = useMemo(() => sanitizeHtml(html), [html])
  return <Box sx={[richTextSx, ...(Array.isArray(sx) ? sx : [sx])]} dangerouslySetInnerHTML={{ __html: clean }} />
}
