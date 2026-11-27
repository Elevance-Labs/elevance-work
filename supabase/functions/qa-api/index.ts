// qa-api: test cases and runs for AI tools, test reporters and CI.
//
//   POST /qa-api/mcp         an MCP server (streamable HTTP, JSON replies): Claude Code, Cursor…
//   POST /qa-api/v1/<tool>   the same tools as plain HTTP (JSON body = the tool's arguments)
//   GET  /qa-api/v1/tools    what the tools are
//
// Every call carries an API token (Authorization: Bearer elw_…) made in the
// app: a person's own (account menu → API tokens; acts as them, with their
// role in each project) or a project's CI token (project settings → Tests;
// a member's rights in that project only). There is no JWT, so it is deployed
// with --no-verify-jwt; the token is what authenticates, checked by its hash
// (qa_token_use), and qa_role decides each project. The work is in ops.ts.
//
// Deploy with:  supabase functions deploy qa-api --no-verify-jwt
import { adminClient, corsHeaders } from "../_shared/google.ts";
import { ApiError, handleMcp, TOOLS, toolNamed } from "./mcp.ts";
import { Ops, type Caller, type Db } from "./ops.ts";

const MAX_BODY = 2_000_000;
const headers = {
  ...corsHeaders,
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const send = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...headers, ...(body === null ? {} : { "Content-Type": "application/json" }) },
  });

async function callerFor(req: Request, db: Db): Promise<Caller | null> {
  const token = /^Bearer\s+(elw_[0-9a-f]{64})$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const { data, error } = await db.rpc("qa_token_use", { p_token: token });
  if (error) throw new Error(error.message);
  const found = (data as { id: string; profile_id: string | null; project_id: string | null; scopes: string[] }[] | null)?.[0];
  return found ? { tokenId: found.id, profileId: found.profile_id, projectId: found.project_id, scopes: found.scopes } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const route = path.slice(path.indexOf("/qa-api") + "/qa-api".length) || "/";

  if (route === "/v1/tools" && req.method === "GET") {
    return send({ tools: TOOLS.map(({ name, description, inputSchema, writes }) => ({ name, description, inputSchema, writes })) });
  }
  // No server-to-client stream: every reply is a JSON response.
  if (route === "/mcp" && req.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
  if (req.method !== "POST") return send({ error: "Method not allowed" }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return send({ error: "Too large" }, 413);
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return route === "/mcp"
      ? send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
      : send({ error: "The body must be JSON." }, 400);
  }

  const db = adminClient() as unknown as Db;
  let caller: Caller | null;
  try {
    caller = await callerFor(req, db);
  } catch (e) {
    console.error("qa-api token:", e);
    return send({ error: "Could not check the token" }, 500);
  }
  if (!caller) {
    return new Response(JSON.stringify({ error: "A valid el-work API token is required (Authorization: Bearer elw_…)." }), {
      status: 401,
      headers: { ...headers, "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="el-work"' },
    });
  }
  const ops = new Ops(db, caller);

  try {
    if (route === "/mcp") {
      const reply = await handleMcp(body, (tool, args) => ops.call(tool, args));
      return reply === null ? send(null, 202) : send(reply);
    }
    const tool = /^\/v1\/([a-z_]+)$/.exec(route)?.[1];
    if (!tool || !toolNamed(tool)) return send({ error: `There's no ${route}. See GET /qa-api/v1/tools.` }, 404);
    return send(await ops.call(tool, (body ?? {}) as Record<string, unknown>));
  } catch (e) {
    if (e instanceof ApiError) return send({ error: e.message }, e.status);
    console.error("qa-api:", e);
    return send({ error: "Something went wrong" }, 500);
  }
});
