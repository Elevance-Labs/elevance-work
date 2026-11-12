import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import { WorkIcon } from './ElevanceIcons'
import type { Profile } from '../lib/types'

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <Avatar variant="rounded" sx={{ width: size, height: size, bgcolor: 'primary.main' }}>
      <WorkIcon sx={{ fontSize: size * 0.62 }} />
    </Avatar>
  )
}

/** The first load: the app's icon, centred, with a bar running beneath it. */
export function Splash() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Stack spacing={3} sx={{ alignItems: 'center' }}>
        <Logo size={72} />
        <LinearProgress aria-label="Loading" sx={{ width: 160, borderRadius: 1 }} />
      </Stack>
    </Box>
  )
}

function colorFor(name: string) {
  let hue = 0
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${hue} 40% 48%)`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** A person's Google photo, or their initials; a dashed ring when nobody. */
export function PersonAvatar({
  person,
  size = 28,
  tooltip,
}: {
  person: Pick<Profile, 'full_name' | 'avatar_url'> | null | undefined
  size?: number
  tooltip?: boolean
}) {
  const avatar = person ? (
    <Avatar
      src={person.avatar_url ?? undefined}
      alt={person.full_name}
      slotProps={{ img: { referrerPolicy: 'no-referrer' } }}
      sx={{ width: size, height: size, fontSize: size * 0.4, bgcolor: colorFor(person.full_name) }}
    >
      {initials(person.full_name)}
    </Avatar>
  ) : (
    <Avatar
      aria-label="Unassigned"
      sx={{ width: size, height: size, bgcolor: 'transparent', border: '1.5px dashed', borderColor: 'text.disabled' }}
    >
      {' '}
    </Avatar>
  )
  return tooltip ? (
    <Tooltip title={person?.full_name ?? 'Unassigned'}>
      <span style={{ display: 'inline-flex' }}>{avatar}</span>
    </Tooltip>
  ) : (
    avatar
  )
}

export function PersonName({ person, size = 24 }: { person: Profile | null | undefined; size?: number }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
      <PersonAvatar person={person} size={size} />
      <Typography variant="body2" noWrap sx={{ color: person ? 'text.primary' : 'text.secondary' }}>
        {person?.full_name ?? 'Unassigned'}
      </Typography>
    </Stack>
  )
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  back?: string
  actions?: ReactNode
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ mb: 3, alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
      {back && (
        <IconButton component={Link} to={back} aria-label="Back" edge="start">
          <ArrowBackIcon />
        </IconButton>
      )}
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="h5" component="h1" noWrap>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  destructive?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{message}</DialogContentText>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color={destructive ? 'error' : 'primary'} loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function FormDialog({
  open,
  title,
  submitLabel = 'Save',
  error,
  busy,
  maxWidth = 'sm',
  extraActions,
  paperColor,
  onSubmit,
  onClose,
  children,
}: {
  open: boolean
  title: string
  submitLabel?: string
  error?: string | null
  busy?: boolean
  maxWidth?: 'xs' | 'sm' | 'md'
  extraActions?: ReactNode
  // A background for the dialog (a note takes its own colour).
  paperColor?: string
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
}) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth={maxWidth}
      fullWidth
      fullScreen={phone}
      slotProps={{
        paper: {
          component: 'form',
          // A dialog opened from inside another one is its child in React,
          // so its submit would otherwise reach the outer form too.
          onSubmit: (e: FormEvent) => {
            e.preventDefault()
            e.stopPropagation()
            onSubmit()
          },
          ...(paperColor && { sx: { bgcolor: paperColor } }),
        },
      }}
    >
      <DialogTitle sx={{ pr: 7 }}>{title}</DialogTitle>
      <IconButton aria-label="Close" onClick={onClose} disabled={busy} sx={{ position: 'absolute', top: 12, right: 12 }}>
        <CloseIcon />
      </IconButton>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {children}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {extraActions}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" loading={busy}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function Loading({ minHeight = 200 }: { minHeight?: number }) {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight }}>
      <CircularProgress />
    </Box>
  )
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center', py: 6, px: 2, color: 'text.secondary' }}>
      {icon && <Box sx={{ '& svg': { fontSize: 40 }, color: 'text.disabled' }}>{icon}</Box>}
      <Typography variant="subtitle1" sx={{ color: 'text.primary' }}>
        {title}
      </Typography>
      {children && (
        <Typography variant="body2" component="div">
          {children}
        </Typography>
      )}
    </Stack>
  )
}

/** A small titled block, as used down the side of the issue view and on the summary. */
export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 1, minHeight: 32 }}>
        <Typography variant="subtitle2" component="h2" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  )
}
