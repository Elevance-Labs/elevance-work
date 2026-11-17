// Small pieces the Summary's widgets share: a verdict chip, a period picker,
// the one-line empty and error states, and headline figures.
import { type ReactElement, type ReactNode } from 'react'
import { Box, Button, Chip, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlined'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { Tone, Verdict } from '../../lib/insights'
import { presetPeriod, type Period } from './helpers'

const TONE: Record<Tone, { color: 'success' | 'warning' | 'error' | 'default'; icon: ReactElement }> = {
  good: { color: 'success', icon: <CheckCircleOutlineIcon /> },
  warn: { color: 'warning', icon: <WarningAmberIcon /> },
  bad: { color: 'error', icon: <ErrorOutlineIcon /> },
  neutral: { color: 'default', icon: <RemoveCircleOutlineIcon /> },
}

/** A judgement, always in words beside its colour and icon. */
export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const t = TONE[verdict.tone]
  return <Chip size="small" variant="outlined" color={t.color} icon={t.icon} label={verdict.label} data-verdict={verdict.tone} />
}

/** A widget with nothing to show, in one line. */
export function Quiet({ children }: { children: ReactNode }) {
  return <Typography variant="body2" sx={{ color: 'text.secondary' }}>{children}</Typography>
}

/** A widget whose data didn't load, with a way to try again; the others carry on. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="alert">
      <Typography variant="body2" sx={{ color: 'error.main', flexGrow: 1 }}>Couldn’t load: {message}</Typography>
      <Button size="small" onClick={onRetry}>Retry</Button>
    </Stack>
  )
}

/** Preset buttons and a Custom choice that shows two dates. Compact enough for a phone. */
export function PeriodSelect({ value, onChange, presets, today, label }: {
  value: Period
  onChange: (p: Period) => void
  presets: { mode: string; label: string }[]
  today: string
  label: string
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
      <ToggleButtonGroup exclusive size="small" value={value.mode} aria-label={label}
        onChange={(_, mode: string | null) => {
          if (!mode) return
          onChange(mode === 'custom' ? { mode, from: value.from, to: value.to } : presetPeriod(mode, today))
        }}>
        {presets.map((p) => <ToggleButton key={p.mode} value={p.mode} sx={{ py: 0.25 }}>{p.label}</ToggleButton>)}
        <ToggleButton value="custom" sx={{ py: 0.25 }}>Custom</ToggleButton>
      </ToggleButtonGroup>
      {value.mode === 'custom' && (
        <Stack direction="row" spacing={1}>
          <TextField size="small" type="date" label="From" value={value.from} sx={{ width: 150 }}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: value.to } }}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
          <TextField size="small" type="date" label="To" value={value.to} sx={{ width: 150 }}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: value.from, max: today } }}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
        </Stack>
      )}
    </Stack>
  )
}

/** A labelled number, for a widget's headline figures. */
export function Figure({ value, label, hint }: { value: ReactNode; label: string; hint?: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="h6" component="div" sx={{ lineHeight: 1.2 }}>{value}</Typography>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{label}</Typography>
      {hint && <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{hint}</Typography>}
    </Box>
  )
}
