// Inputs shared by the create dialog, the issue view and the filter bar.
import { useEffect, useState } from 'react'
import { Autocomplete, Box, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { supabase } from '../lib/supabase'
import { ISSUE_COLUMNS, parseIssueKey } from '../lib/issues'
import { PRIORITIES, PRIORITY_LABELS } from '../lib/constants'
import type { Issue, IssuePriority, IssueType, Profile, ProjectStatus } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { PersonAvatar } from './common'
import { PriorityIcon, StatusLozenge, TypeIcon } from './IssueBits'

export function PersonPicker({
  label,
  value,
  options,
  onChange,
  disabled,
  allowNone = true,
  noneLabel = 'Unassigned',
  autoFocus,
}: {
  label: string
  value: string | null
  options: Profile[]
  onChange: (id: string | null) => void
  disabled?: boolean
  allowNone?: boolean
  noneLabel?: string
  autoFocus?: boolean
}) {
  const { profileById } = useWorkspace()
  const selected = profileById(value) ?? null
  // Someone no longer assignable (left the project) still shows as chosen.
  const all = selected && !options.some((o) => o.id === selected.id) ? [selected, ...options] : options
  return (
    <Autocomplete
      value={selected}
      options={all}
      disabled={disabled}
      disableClearable={!allowNone}
      getOptionLabel={(p) => p.full_name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, p) => onChange(p?.id ?? null)}
      renderOption={({ key, ...props }, p) => (
        <Box component="li" key={key} {...props} sx={{ gap: 1 }}>
          <PersonAvatar person={p} size={24} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>{p.full_name}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>{p.email}</Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          autoFocus={autoFocus}
          placeholder={allowNone ? noneLabel : undefined}
          slotProps={{
            ...params.slotProps,
            input: { ...params.slotProps.input, startAdornment: <PersonAvatar person={selected} size={22} /> },
          }}
        />
      )}
    />
  )
}

export function PeoplePicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string[]
  options: Profile[]
  onChange: (ids: string[]) => void
}) {
  const { profileById } = useWorkspace()
  const selected = value.map((id) => profileById(id)).filter((p): p is Profile => !!p)
  return (
    <Autocomplete
      multiple
      value={selected}
      options={options}
      filterSelectedOptions
      getOptionLabel={(p) => p.full_name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, ps) => onChange(ps.map((p) => p.id))}
      renderValue={(ps, getItemProps) =>
        ps.map((p, index) => {
          const { key, ...itemProps } = getItemProps({ index })
          return <Chip key={key} {...itemProps} size="small" avatar={<PersonAvatar person={p} size={20} />} label={p.full_name} />
        })
      }
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  )
}

export function LabelsInput({
  value,
  onChange,
  suggestions = [],
  label = 'Labels',
}: {
  value: string[]
  onChange: (labels: string[]) => void
  suggestions?: string[]
  label?: string
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      value={value}
      options={suggestions.filter((s) => !value.includes(s))}
      onChange={(_, labels) => onChange(labels.map((l) => l.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))}
      renderValue={(labels, getItemProps) =>
        labels.map((l, index) => {
          const { key, ...itemProps } = getItemProps({ index })
          return <Chip key={key} {...itemProps} size="small" label={l} />
        })
      }
      renderInput={(params) => <TextField {...params} label={label} placeholder={value.length ? '' : 'Type and press Enter'} />}
    />
  )
}

export function StatusSelect({
  value,
  statuses,
  onChange,
  label = 'Status',
  disabled,
}: {
  value: string
  statuses: ProjectStatus[]
  onChange: (id: string) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <TextField select label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} fullWidth>
      {statuses.map((s) => (
        <MenuItem key={s.id} value={s.id}>
          <StatusLozenge status={s} />
        </MenuItem>
      ))}
    </TextField>
  )
}

export function PrioritySelect({
  value,
  onChange,
  disabled,
}: {
  value: IssuePriority
  onChange: (p: IssuePriority) => void
  disabled?: boolean
}) {
  return (
    <TextField select label="Priority" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as IssuePriority)} fullWidth>
      {PRIORITIES.map((p) => (
        <MenuItem key={p} value={p}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <PriorityIcon priority={p} />
            <span>{PRIORITY_LABELS[p]}</span>
          </Stack>
        </MenuItem>
      ))}
    </TextField>
  )
}

export function TypeSelect({
  value,
  types,
  onChange,
  disabled,
}: {
  value: string
  types: IssueType[]
  onChange: (id: string) => void
  disabled?: boolean
}) {
  return (
    <TextField select label="Type" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} fullWidth>
      {types.map((t) => (
        <MenuItem key={t.id} value={t.id}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TypeIcon type={t} />
            <span>{t.name}</span>
          </Stack>
        </MenuItem>
      ))}
    </TextField>
  )
}

/**
 * Find an issue by key or words. `projectId` narrows the search; `filter`
 * drops what can't be picked (e.g. the issue itself, or the wrong level).
 */
export function IssuePicker({
  label,
  value,
  onChange,
  projectId,
  typeIds,
  exclude = [],
  autoFocus,
}: {
  label: string
  value: Issue | null
  onChange: (issue: Issue | null) => void
  projectId?: string
  typeIds?: string[]
  exclude?: string[]
  autoFocus?: boolean
}) {
  const { typeById } = useWorkspace()
  const [input, setInput] = useState('')
  const [options, setOptions] = useState<Issue[]>([])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      let q = supabase.from('issues').select(ISSUE_COLUMNS)
      if (projectId) q = q.eq('project_id', projectId)
      if (typeIds) q = q.in('type_id', typeIds)
      const text = input.trim()
      const key = parseIssueKey(text)
      if (key) q = q.eq('key', `${key.projectKey}-${key.number}`)
      else if (text) q = q.textSearch('search', text, { type: 'websearch', config: 'simple' })
      const { data } = await q.order('updated_at', { ascending: false }).limit(20)
      if (!cancelled) setOptions(((data ?? []) as unknown as Issue[]).filter((i) => !exclude.includes(i.id)))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // exclude/typeIds are recreated by callers on each render; their contents are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, projectId, typeIds?.join(), exclude.join()])

  return (
    <Autocomplete
      value={value}
      options={value && !options.some((o) => o.id === value.id) ? [value, ...options] : options}
      filterOptions={(x) => x}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      getOptionLabel={(i) => `${i.key} ${i.title}`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, i) => onChange(i)}
      noOptionsText={input ? 'No matching issues' : 'Type a key or words'}
      renderOption={({ key, ...props }, i) => (
        <Box component="li" key={key} {...props} sx={{ gap: 1 }}>
          <TypeIcon type={typeById(i.type_id)} />
          <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0 }}>{i.key}</Typography>
          <Typography variant="body2" noWrap>{i.title}</Typography>
        </Box>
      )}
      renderInput={(params) => <TextField {...params} label={label} autoFocus={autoFocus} />}
    />
  )
}
