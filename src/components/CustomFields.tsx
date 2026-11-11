// A project's custom fields: the input for each kind, and how a value reads.
// The database checks every value again (issue_custom_clean).
import { Autocomplete, Checkbox, Chip, FormControlLabel, Link as MuiLink, MenuItem, TextField, Typography } from '@mui/material'
import { formatDate } from '../lib/constants'
import type { CustomValues, Field, Profile } from '../lib/types'
import { isEmptyValue } from '../lib/fields'
import { PersonName } from './common'
import { PersonPicker } from './pickers'

type Value = CustomValues[string] | undefined

export function CustomFieldInput({
  field,
  value,
  onChange,
  people,
  disabled,
}: {
  field: Field
  value: Value
  onChange: (v: Value) => void
  people: Profile[]
  disabled?: boolean
}) {
  const label = field.name
  switch (field.kind) {
    case 'text':
      return (
        <TextField label={label} required={field.required} value={(value as string) ?? ''} disabled={disabled} fullWidth multiline maxRows={4}
          onChange={(e) => onChange(e.target.value || undefined)} />
      )
    case 'url':
      return (
        <TextField label={label} required={field.required} type="url" value={(value as string) ?? ''} disabled={disabled} fullWidth
          placeholder="https://" onChange={(e) => onChange(e.target.value || undefined)} />
      )
    case 'number':
      return (
        <TextField label={label} required={field.required} type="number" value={value ?? ''} disabled={disabled} fullWidth
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      )
    case 'date':
      return (
        <TextField label={label} required={field.required} type="date" value={(value as string) ?? ''} disabled={disabled} fullWidth
          slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => onChange(e.target.value || undefined)} />
      )
    case 'select':
      return (
        <TextField select label={label} required={field.required} value={(value as string) ?? ''} disabled={disabled} fullWidth
          onChange={(e) => onChange(e.target.value || undefined)}>
          <MenuItem value=""><em>None</em></MenuItem>
          {field.options.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
        </TextField>
      )
    case 'multi_select':
      return (
        <Autocomplete
          multiple
          value={(value as string[]) ?? []}
          options={field.options}
          disabled={disabled}
          onChange={(_, v) => onChange(v.length ? v : undefined)}
          renderInput={(params) => <TextField {...params} label={label} required={field.required && !(value as string[])?.length} />}
        />
      )
    case 'user':
      return <PersonPicker label={label} value={(value as string) ?? null} options={people} disabled={disabled}
        noneLabel="Nobody" onChange={(id) => onChange(id ?? undefined)} />
    case 'checkbox':
      return (
        <FormControlLabel label={label} disabled={disabled}
          control={<Checkbox checked={value === true} onChange={(e) => onChange(e.target.checked || undefined)} />} />
      )
  }
}

export function CustomFieldValue({ field, value, person }: { field: Field; value: Value; person?: Profile }) {
  if (isEmptyValue(value)) return <Typography variant="body2" sx={{ color: 'text.secondary' }}>None</Typography>
  switch (field.kind) {
    case 'date':
      return <Typography variant="body2">{formatDate(value as string)}</Typography>
    case 'url':
      return (
        <MuiLink href={value as string} target="_blank" rel="noopener noreferrer" variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {value as string}
        </MuiLink>
      )
    case 'multi_select':
      return <>{(value as string[]).map((v) => <Chip key={v} label={v} size="small" sx={{ mr: 0.5, mb: 0.5 }} />)}</>
    case 'user':
      return <PersonName person={person} />
    case 'checkbox':
      return <Typography variant="body2">Yes</Typography>
    default:
      return <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(value)}</Typography>
  }
}
