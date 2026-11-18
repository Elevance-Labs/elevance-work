// The quick filter by person a board and a backlog share: one avatar per
// assignee of the issues shown ('none' for unassigned), pressed to keep only
// theirs; several can be pressed at once.
import { Avatar, AvatarGroup, Tooltip } from '@mui/material'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { PersonAvatar } from './common'

export default function AssigneeFilter({
  assignees,
  value,
  onChange,
}: {
  assignees: string[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const { profileById } = useWorkspace()
  if (!assignees.length) return null
  return (
    <AvatarGroup max={8} sx={{ '& .MuiAvatar-root': { width: 30, height: 30, border: 2, borderColor: 'background.default' } }}>
      {assignees.map((id) => {
        const p = id === 'none' ? null : profileById(id)
        const on = value.includes(id)
        return (
          <Tooltip key={id} title={p?.full_name ?? 'Unassigned'}>
            <Avatar component="button" aria-pressed={on} aria-label={`Only ${p?.full_name ?? 'unassigned'}`}
              onClick={() => onChange(on ? value.filter((x) => x !== id) : [...value, id])}
              sx={{ p: 0, cursor: 'pointer', outline: on ? 2 : 0, outlineColor: 'primary.main', bgcolor: 'transparent' }}>
              <PersonAvatar person={p} size={30} />
            </Avatar>
          </Tooltip>
        )
      })}
    </AvatarGroup>
  )
}
