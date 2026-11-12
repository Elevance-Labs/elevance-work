// The small pieces every issue list draws: type and priority icons, the
// status lozenge, the key, labels and points.
import { Link } from 'react-router-dom'
import { Box, Chip, Stack, Tooltip, Typography, type SxProps, type Theme } from '@mui/material'
import BoltIcon from '@mui/icons-material/Bolt'
import BookmarkIcon from '@mui/icons-material/Bookmark'
import BugReportIcon from '@mui/icons-material/BugReport'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown'
import KeyboardDoubleArrowUpIcon from '@mui/icons-material/KeyboardDoubleArrowUp'
import RemoveIcon from '@mui/icons-material/Remove'
import ScienceIcon from '@mui/icons-material/Science'
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import StarIcon from '@mui/icons-material/Star'
import { CATEGORY_LABELS, PRIORITY_HEX, PRIORITY_LABELS, formatPoints } from '../lib/constants'
import type { IssueIcon, IssuePriority, IssueType, ProjectStatus } from '../lib/types'
import { useIssueHref } from './useIssueHref'

const ICONS: Record<IssueIcon, typeof BoltIcon> = {
  epic: BoltIcon,
  story: BookmarkIcon,
  task: CheckBoxIcon,
  bug: BugReportIcon,
  subtask: SubdirectoryArrowRightIcon,
  spike: ScienceIcon,
  improvement: TrendingUpIcon,
  feature: StarIcon,
}

export function TypeIcon({ type, size = 18, tooltip = true }: { type: IssueType | undefined; size?: number; tooltip?: boolean }) {
  const Icon = ICONS[type?.icon ?? 'task']
  const icon = (
    <Box
      component="span"
      aria-label={type?.name ?? 'Issue'}
      sx={{
        display: 'inline-grid',
        placeItems: 'center',
        width: size,
        height: size,
        borderRadius: 0.75,
        bgcolor: type?.color ?? '#4bade8',
        color: '#fff',
        flexShrink: 0,
      }}
    >
      <Icon sx={{ fontSize: size * 0.78 }} />
    </Box>
  )
  return tooltip ? <Tooltip title={type?.name ?? 'Issue'}>{icon}</Tooltip> : icon
}

const PRIORITY_ICONS: Record<IssuePriority, typeof RemoveIcon> = {
  highest: KeyboardDoubleArrowUpIcon,
  high: KeyboardArrowUpIcon,
  medium: RemoveIcon,
  low: KeyboardArrowDownIcon,
  lowest: KeyboardDoubleArrowDownIcon,
}

export function PriorityIcon({ priority, size = 20 }: { priority: IssuePriority; size?: number }) {
  const Icon = PRIORITY_ICONS[priority]
  return (
    <Tooltip title={`${PRIORITY_LABELS[priority]} priority`}>
      <Icon aria-label={`${PRIORITY_LABELS[priority]} priority`} sx={{ fontSize: size, color: PRIORITY_HEX[priority], flexShrink: 0 }} />
    </Tooltip>
  )
}

// Each category's tint, light and dark.
const LOZENGE = {
  todo: (t: Theme) => ({ bgcolor: 'grey.200', color: 'grey.800', ...t.applyStyles('dark', { bgcolor: 'grey.800', color: 'grey.300' }) }),
  in_progress: (t: Theme) => ({ bgcolor: '#e9f2ff', color: '#0055cc', ...t.applyStyles('dark', { bgcolor: '#09326c', color: '#cce0ff' }) }),
  done: (t: Theme) => ({ bgcolor: '#dcfff1', color: '#216e4e', ...t.applyStyles('dark', { bgcolor: '#164b35', color: '#baf3db' }) }),
}

export function StatusLozenge({ status, sx }: { status: ProjectStatus | undefined; sx?: SxProps<Theme> }) {
  const category = status?.category ?? 'todo'
  return (
    <Tooltip title={CATEGORY_LABELS[category]}>
      <Box
        component="span"
        sx={[
          LOZENGE[category],
          {
            display: 'inline-block',
            px: 0.75,
            py: 0.125,
            borderRadius: 0.75,
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.2,
            whiteSpace: 'nowrap',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            verticalAlign: 'middle',
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {status?.name ?? '—'}
      </Box>
    </Tooltip>
  )
}

export function IssueKey({ issueKey, done, sx }: { issueKey: string; done?: boolean; sx?: SxProps<Theme> }) {
  const href = useIssueHref()
  return (
    <Typography
      component={Link}
      to={href(issueKey)}
      variant="body2"
      onClick={(e) => e.stopPropagation()}
      sx={[
        { color: 'text.secondary', fontWeight: 500, whiteSpace: 'nowrap', textDecoration: done ? 'line-through' : 'none',
          '&:hover': { textDecoration: 'underline' } },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {issueKey}
    </Typography>
  )
}

export function Points({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null
  return (
    <Tooltip title="Story points">
      <Box
        component="span"
        aria-label={`${formatPoints(value)} story points`}
        sx={{ bgcolor: 'action.selected', color: 'text.secondary', borderRadius: 5, px: 0.875, fontSize: 12, fontWeight: 600, lineHeight: '20px' }}
      >
        {formatPoints(value)}
      </Box>
    </Tooltip>
  )
}

export function Labels({ labels, max = 3 }: { labels: string[]; max?: number }) {
  if (!labels.length) return null
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      {labels.slice(0, max).map((l) => (
        <Chip key={l} label={l} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
      ))}
      {labels.length > max && <Chip label={`+${labels.length - max}`} size="small" sx={{ height: 20, fontSize: 11 }} />}
    </Stack>
  )
}

export function ProjectAvatar({ project, size = 24 }: { project: { key: string; color: string }; size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: 1,
        bgcolor: project.color,
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        fontSize: size * 0.42,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {project.key.slice(0, 2)}
    </Box>
  )
}
