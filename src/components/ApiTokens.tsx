// API tokens for qa-api: yours (account menu → API tokens; an AI tool or the
// Playwright reporter acts as you, with your role in each project), or a
// project's CI tokens (project settings → Tests; a member of that project,
// for no one). A token is shown once, when made; after that only its prefix.
import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
  useMediaQuery, useTheme,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { useMe } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { errorMessage, formatDate, timeAgo } from '../lib/constants'
import { EXPIRY_CHOICES, SCOPE_CHOICES, mcpConfig, qaApiUrl, tokenExport } from '../lib/qaApi'
import type { ApiToken } from '../lib/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { ConfirmDialog, Loading } from './common'

function Copyable({ label, text, multiline }: { label: string; text: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, flexGrow: 1 }}>{label}</Typography>
        <Tooltip title={copied ? 'Copied' : 'Copy'}>
          <IconButton size="small" aria-label={`Copy ${label.toLowerCase()}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              } catch {
                // Refused: it can still be selected and copied by hand.
              }
            }}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box component="pre" data-copyable={label} sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: 'background.muted', fontFamily: 'monospace',
        fontSize: 12.5, whiteSpace: multiline ? 'pre' : 'pre-wrap', overflowWrap: 'anywhere', overflowX: 'auto' }}>{text}</Box>
    </Box>
  )
}

/** A person's own tokens, or (with `projectId` and `ci`) a project's CI tokens. */
export function TokenManager({ projectId, ci = false }: { projectId?: string; ci?: boolean }) {
  const me = useMe()
  const { projects, projectById } = useWorkspace()
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [name, setName] = useState('')
  const [project, setProject] = useState(ci ? projectId ?? '' : '')
  const [scope, setScope] = useState<'write' | 'read'>('write')
  const [days, setDays] = useState<string>('90')
  const [made, setMade] = useState<{ token: string; name: string } | null>(null)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Expiry is judged against when this was opened.
  const [openedAt] = useState(() => Date.now())

  const load = useCallback(async () => {
    let q = supabase.from('api_tokens')
      .select('id, profile_id, project_id, name, prefix, scopes, created_by, created_at, expires_at, last_used_at, revoked_at')
    q = ci ? q.eq('project_id', projectId).is('profile_id', null) : q.eq('profile_id', me.id)
    const { data, error: e } = await q.order('created_at', { ascending: false })
    if (e) return setError(errorMessage(e))
    setTokens((data ?? []) as ApiToken[])
  }, [ci, projectId, me.id])

  useEffect(() => {
    load()
  }, [load])

  async function create() {
    if (!name.trim()) return setError('Name the token after where it will be used: "Sara laptop", "GitHub Actions".')
    setBusy(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('api_token_create', {
      p_name: name.trim(), p_project: project || null, p_ci: ci,
      p_scopes: SCOPE_CHOICES.find((s) => s.value === scope)!.scopes, p_days: days ? Number(days) : null,
    })
    setBusy(false)
    if (e || !data) return setError(errorMessage(e, "The token wasn't made."))
    setMade({ token: (data as { token: string }).token, name: name.trim() })
    setName('')
    load()
  }

  async function revoke() {
    if (!revoking) return
    setBusy(true)
    const { error: e } = await supabase.rpc('api_token_revoke', { p_id: revoking.id })
    setBusy(false)
    if (e) return setError(errorMessage(e))
    setRevoking(null)
    load()
  }

  const active = (t: ApiToken) => !t.revoked_at && (!t.expires_at || Date.parse(t.expires_at) > openedAt)

  return (
    <Stack spacing={2.5}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {ci
          ? 'A CI token lets a pipeline publish test runs to this project (as "Cloud"), with a member’s rights here and nowhere else.'
          : 'A token lets an AI tool (Claude Code, Cursor…) or the Playwright reporter read issues and write test cases and runs as you, with your role in each project. Keep it in your shell, never in a repository.'}
      </Typography>

      {made ? (
        <Alert severity="success" onClose={() => setMade(null)} sx={{ '& .MuiAlert-message': { width: '100%', minWidth: 0 } }}>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            <strong>{made.name}</strong> is ready. Copy it now: it won't be shown again.
          </Typography>
          <Stack spacing={1.5}>
            <Copyable label="Token" text={made.token} />
            <Copyable label="In your shell profile" text={tokenExport(made.token)} />
            {!ci && <Copyable label="Claude Code: .mcp.json in the repo" text={mcpConfig()} multiline />}
            {ci && <Copyable label="The reporter's address" text={qaApiUrl()} />}
          </Stack>
        </Alert>
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} sx={{ flexGrow: 1 }}
            placeholder={ci ? 'GitHub Actions' : 'My laptop'} slotProps={{ htmlInput: { maxLength: 80 } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create()
            }} />
          {!ci && (
            <TextField select label="Projects" value={project} onChange={(e) => setProject(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="">All of mine</MenuItem>
              {projects.filter((p) => !p.archived_at).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </TextField>
          )}
          <TextField select label="Access" value={scope} onChange={(e) => setScope(e.target.value as 'write' | 'read')} sx={{ minWidth: 150 }}>
            {SCOPE_CHOICES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </TextField>
          <TextField select label="Expires" value={days} onChange={(e) => setDays(e.target.value)} sx={{ minWidth: 130 }}>
            {EXPIRY_CHOICES.map((c) => <MenuItem key={c.label} value={c.days === null ? '' : String(c.days)}>{c.label}</MenuItem>)}
          </TextField>
          <Button variant="contained" onClick={create} loading={busy} sx={{ whiteSpace: 'nowrap', minHeight: 40 }}>Make token</Button>
        </Stack>
      )}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {!tokens ? <Loading minHeight={80} /> : tokens.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>No tokens yet.</Typography>
      ) : (
        <Stack spacing={1} role="list" aria-label={ci ? 'CI tokens' : 'Your tokens'}>
          {tokens.map((t) => (
            <Stack key={t.id} role="listitem" data-token={t.name} direction="row" spacing={1.5}
              sx={{ alignItems: 'center', p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1, opacity: active(t) ? 1 : 0.6 }}>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{t.prefix}…</Typography>
                  {!t.scopes.includes('tests:write') && <Chip size="small" label="Read only" sx={{ height: 20 }} />}
                  {!ci && t.project_id && <Chip size="small" label={projectById(t.project_id)?.name ?? 'One project'} sx={{ height: 20 }} />}
                  {t.revoked_at ? <Chip size="small" label="Revoked" sx={{ height: 20 }} />
                    : !active(t) ? <Chip size="small" label="Expired" sx={{ height: 20 }} /> : null}
                </Stack>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Made {timeAgo(t.created_at)} · {t.last_used_at ? `last used ${timeAgo(t.last_used_at)}` : 'never used'}
                  {t.expires_at && active(t) ? ` · expires ${formatDate(t.expires_at.slice(0, 10))}` : ''}
                </Typography>
              </Box>
              {active(t) && <Button size="small" color="error" onClick={() => setRevoking(t)}>Revoke</Button>}
            </Stack>
          ))}
        </Stack>
      )}

      <ConfirmDialog open={!!revoking} title={`Revoke ${revoking?.name}?`} destructive confirmLabel="Revoke" busy={busy}
        message="Whatever uses it stops at once. This can't be undone; make a new one if it's still needed."
        onConfirm={revoke} onClose={() => setRevoking(null)} />
    </Stack>
  )
}

/** Account menu → API tokens. */
export default function ApiTokensDialog({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth fullScreen={phone}>
      <DialogTitle sx={{ pr: 7 }}>API tokens</DialogTitle>
      <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', top: 12, right: 12 }}><CloseIcon /></IconButton>
      <DialogContent>
        <TokenManager />
      </DialogContent>
    </Dialog>
  )
}
