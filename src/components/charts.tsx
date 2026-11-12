// Hand-drawn SVG charts for the Summary and Reports pages: lines, grouped
// bars, stacked areas, a donut and labelled bars. No charting dependency;
// each scales to its container's width.
import { useId, type ReactNode } from 'react'
import { Box, Stack, Tooltip, Typography, useTheme } from '@mui/material'

export interface Series {
  label: string
  color: string
  values: (number | null)[]
  dashed?: boolean
}

const W = 640
const PAD = { top: 12, right: 12, bottom: 28, left: 36 }

function niceMax(n: number) {
  if (n <= 5) return Math.max(1, Math.ceil(n))
  const mag = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / (mag / 2)) * (mag / 2)
}

function ticks(max: number) {
  const step = max / 4
  return [0, 1, 2, 3, 4].map((i) => Math.round(step * i * 10) / 10)
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 1 }}>
      {items.map((i) => (
        <Stack key={i.label} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 14, height: 0, borderTop: `3px ${i.dashed ? 'dashed' : 'solid'} ${i.color}` }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{i.label}</Typography>
        </Stack>
      ))}
    </Stack>
  )
}

function Frame({ height, labels, max, children, title }: { height: number; labels: string[]; max: number; children: ReactNode; title: string }) {
  const plotH = height - PAD.top - PAD.bottom
  const every = Math.max(1, Math.ceil(labels.length / 8))
  const x = (i: number) => PAD.left + (labels.length <= 1 ? 0 : (i * (W - PAD.left - PAD.right)) / (labels.length - 1))
  const { palette } = useTheme()
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={title} style={{ display: 'block', overflow: 'visible' }}>
      {ticks(max).map((t) => {
        const y = PAD.top + plotH - (t / max) * plotH
        return (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={palette.divider} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="11" fill={palette.text.secondary}>{t}</text>
          </g>
        )
      })}
      {labels.map((l, i) => (i % every === 0 || i === labels.length - 1) && (
        <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill={palette.text.secondary}>{l}</text>
      ))}
      {children}
    </svg>
  )
}

/** Lines over days (burndown, created vs resolved). A null value breaks the line. */
export function LineChart({ labels, series, height = 240, title }: { labels: string[]; series: Series[]; height?: number; title: string }) {
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))))
  const plotH = height - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (labels.length <= 1 ? 0 : (i * (W - PAD.left - PAD.right)) / (labels.length - 1))
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH
  return (
    <Box>
      <Frame height={height} labels={labels} max={max} title={title}>
        {series.map((s) => {
          const d = s.values
            .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
            .reduce<string[]>((acc, p, i, all) => {
              if (p) acc.push(`${i === 0 || all[i - 1] === null ? 'M' : 'L'}${p}`)
              return acc
            }, [])
            .join(' ')
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? '6 5' : undefined} />
              {!s.dashed && s.values.map((v, i) => v !== null && (
                <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={s.color}>
                  <title>{`${labels[i]}: ${v}`}</title>
                </circle>
              ))}
            </g>
          )
        })}
      </Frame>
      <Legend items={series} />
    </Box>
  )
}

/** Stacked areas over days (cumulative flow). Series stack bottom-up in order. */
export function StackedAreaChart({ labels, series, height = 240, title }: { labels: string[]; series: Series[]; height?: number; title: string }) {
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0))
  const max = niceMax(Math.max(1, ...totals))
  const plotH = height - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (labels.length <= 1 ? 0 : (i * (W - PAD.left - PAD.right)) / (labels.length - 1))
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH
  const base = labels.map(() => 0)
  const areas = series.map((s) => {
    const lower = [...base]
    const upper = lower.map((b, i) => b + (s.values[i] ?? 0))
    upper.forEach((u, i) => (base[i] = u))
    const top = upper.map((u, i) => `${x(i)},${y(u)}`).join(' L')
    const bottom = lower.map((l, i) => `${x(i)},${y(l)}`).reverse().join(' L')
    return { s, d: `M${top} L${bottom} Z` }
  })
  return (
    <Box>
      <Frame height={height} labels={labels} max={max} title={title}>
        {areas.map(({ s, d }) => <path key={s.label} d={d} fill={s.color} fillOpacity={0.75} stroke={s.color} />)}
      </Frame>
      <Legend items={series} />
    </Box>
  )
}

/** Grouped bars per label (velocity: committed against completed). */
export function BarChart({ labels, series, height = 240, title }: { labels: string[]; series: Series[]; height?: number; title: string }) {
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0))))
  const plotH = height - PAD.top - PAD.bottom
  const slot = (W - PAD.left - PAD.right) / Math.max(1, labels.length)
  const bar = Math.min(28, (slot * 0.7) / series.length)
  const { palette } = useTheme()
  return (
    <Box>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={title} style={{ display: 'block' }}>
        {ticks(max).map((t) => {
          const y = PAD.top + plotH - (t / max) * plotH
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={palette.divider} />
              <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="11" fill={palette.text.secondary}>{t}</text>
            </g>
          )
        })}
        {labels.map((l, i) => {
          const cx = PAD.left + slot * i + slot / 2
          return (
            <g key={i}>
              {series.map((s, j) => {
                const v = s.values[i] ?? 0
                const h = (v / max) * plotH
                return (
                  <rect key={s.label} x={cx - (bar * series.length) / 2 + j * bar} y={PAD.top + plotH - h} width={bar - 2} height={h} rx={2} fill={s.color}>
                    <title>{`${l} · ${s.label}: ${v}`}</title>
                  </rect>
                )
              })}
              <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill={palette.text.secondary}>{l.length > 14 ? `${l.slice(0, 13)}…` : l}</text>
            </g>
          )
        })}
      </svg>
      <Legend items={series} />
    </Box>
  )
}

export interface DonutSlice {
  label: string
  value: number
  color: string
}

export function Donut({ slices, size = 160, center, title }: { slices: DonutSlice[]; size?: number; center?: ReactNode; title: string }) {
  const id = useId()
  const total = slices.reduce((s, x) => s + x.value, 0)
  const r = 15.915 // circumference 100
  const { palette } = useTheme()
  let offset = 25
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ alignItems: 'center' }}>
      <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg viewBox="0 0 42 42" width={size} height={size} role="img" aria-labelledby={id}>
          <title id={id}>{title}</title>
          <circle cx="21" cy="21" r={r} fill="none" stroke={palette.background.muted} strokeWidth="6" />
          {total > 0 && slices.filter((s) => s.value > 0).map((s) => {
            const pct = (s.value / total) * 100
            const el = (
              <circle key={s.label} cx="21" cy="21" r={r} fill="none" stroke={s.color} strokeWidth="6"
                strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset}>
                <title>{`${s.label}: ${s.value}`}</title>
              </circle>
            )
            offset -= pct
            return el
          })}
        </svg>
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>{center}</Box>
      </Box>
      <Stack spacing={0.75} sx={{ minWidth: 0 }}>
        {slices.map((s) => (
          <Stack key={s.label} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
            <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>{s.label}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', pl: 2 }}>{s.value}</Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}

/** Labelled horizontal bars, each a share of the largest (or of `total`). */
export function BarList({ rows, total }: { rows: { label: ReactNode; value: number; color?: string; hint?: string }[]; total?: number }) {
  const max = total ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <Stack spacing={1.25}>
      {rows.map((r, i) => (
        <Box key={i}>
          <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>{r.label}</Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', pl: 1 }}>{r.value}</Typography>
          </Stack>
          <Tooltip title={r.hint ?? ''}>
            <Box sx={{ height: 8, bgcolor: 'background.muted', borderRadius: 4, overflow: 'hidden' }}>
              <Box sx={{ width: `${(r.value / max) * 100}%`, height: '100%', bgcolor: r.color ?? 'primary.main', borderRadius: 4 }} />
            </Box>
          </Tooltip>
        </Box>
      ))}
    </Stack>
  )
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', height: '100%' }}>
      <Typography variant="h5" component="div">{value}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{label}</Typography>
      {hint && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{hint}</Typography>}
    </Box>
  )
}
