// An issue's Development: the pull requests, branches and commits on GitHub
// that name its key. Recorded by the `github` Edge Function from GitHub's
// webhook; here they are only read. Nothing is drawn until there is
// something to show, so an issue with no code stays as short as it was.
import { Box, Chip, Link as MuiLink, Stack, Typography } from '@mui/material'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import CommitIcon from '@mui/icons-material/Commit'
import MergeIcon from '@mui/icons-material/Merge'
import { timeAgo } from '../../lib/constants'
import { sortDevLinks } from '../../lib/devLinks'
import type { DevLink, PullRequestState } from '../../lib/types'
import { Section } from '../common'

const PR_STATE: Record<PullRequestState, { label: string; color: 'success' | 'default' | 'secondary' | 'error' }> = {
  open: { label: 'Open', color: 'success' },
  draft: { label: 'Draft', color: 'default' },
  merged: { label: 'Merged', color: 'secondary' },
  closed: { label: 'Closed', color: 'error' },
}

// A long history is summed up rather than listed: the pull request is the way in.
const MAX_COMMITS = 5

function Row({ link }: { link: DevLink }) {
  const icon =
    link.kind === 'pull_request' ? <MergeIcon fontSize="small" /> : link.kind === 'branch' ? <AccountTreeOutlinedIcon fontSize="small" /> : <CommitIcon fontSize="small" />
  const name = link.kind === 'pull_request' ? `#${link.ref}` : link.kind === 'commit' ? link.ref.slice(0, 7) : link.ref
  const what = link.kind === 'pull_request' ? 'Pull request' : link.kind === 'commit' ? 'Commit' : 'Branch'
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }} data-dev-link={link.kind}>
      <Box sx={{ color: 'text.secondary', display: 'flex' }} title={what}>{icon}</Box>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <MuiLink href={link.url} target="_blank" rel="noopener noreferrer" underline="hover" color="inherit" noWrap
          aria-label={`${what} ${name}${link.kind === 'branch' ? '' : `: ${link.title}`}, opens GitHub`}
          sx={{ display: 'block', fontSize: 14, fontWeight: link.kind === 'pull_request' ? 500 : 400 }}>
          <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 13, color: 'text.secondary', mr: 1 }}>{name}</Box>
          {link.kind !== 'branch' && link.title}
        </MuiLink>
        <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>
          {link.repo}
          {link.author && ` · ${link.author}`}
          {` · ${timeAgo(link.happened_at)}`}
        </Typography>
      </Box>
      {link.kind === 'pull_request' && link.state && (
        <Chip size="small" label={PR_STATE[link.state].label} color={PR_STATE[link.state].color} variant={link.state === 'draft' ? 'outlined' : 'filled'} />
      )}
    </Stack>
  )
}

export default function Development({ links }: { links: DevLink[] }) {
  if (!links.length) return null
  const sorted = sortDevLinks(links)
  const commits = sorted.filter((l) => l.kind === 'commit')
  const shown = [...sorted.filter((l) => l.kind !== 'commit'), ...commits.slice(0, MAX_COMMITS)]
  return (
    <Section title="Development">
      <Stack spacing={1.25}>
        {shown.map((l) => <Row key={l.id} link={l} />)}
        {commits.length > MAX_COMMITS && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            and {commits.length - MAX_COMMITS} earlier commit{commits.length - MAX_COMMITS === 1 ? '' : 's'}
          </Typography>
        )}
      </Stack>
    </Section>
  )
}
