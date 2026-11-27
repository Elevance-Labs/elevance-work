// Where AI tools, test reporters and CI reach this workspace's test cases
// (the qa-api Edge Function), and what to paste to set one up with a token.

/** The qa-api function's address for this build's Supabase project. */
export function qaApiUrl(supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '') {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/qa-api`
}

/** Claude Code's project `.mcp.json`: the token comes from the environment, never the repo. */
export function mcpConfig(url = qaApiUrl()) {
  return JSON.stringify({
    mcpServers: {
      'el-work': { type: 'http', url: `${url}/mcp`, headers: { Authorization: 'Bearer ${EL_WORK_TOKEN}' } },
    },
  }, null, 2)
}

/** The shell line that puts a token where the reporter and `.mcp.json` look for it. */
export const tokenExport = (token: string) => `export EL_WORK_TOKEN=${token}`

export const SCOPE_CHOICES = [
  { value: 'write', label: 'Read and write', scopes: ['tests:read', 'tests:write'] },
  { value: 'read', label: 'Read only', scopes: ['tests:read'] },
] as const

export const EXPIRY_CHOICES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'A year' },
  { days: null, label: 'Until revoked' },
] as const
