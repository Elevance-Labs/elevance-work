// What qa-api does for a token: read issues and test cases, save cases, link
// scripts, and record runs. Run with the service role, so every read and
// write first asks the database what this token may do in the project
// (qa_role: a person's own role there, or a CI token's member rights in its
// project). The database's triggers keep every other rule: numbering, the
// project's lists, a reason for a failure, the author named here.
//
// Written against the few PostgREST calls it makes (Db), so the browser
// tests run it on their in-memory database.
import { htmlToMarkdown } from "./markdown.ts";
import { ApiError } from "./mcp.ts";

interface DbError {
  message: string
  code?: string
}
interface Result {
  data: unknown
  error: DbError | null
}
interface Query extends PromiseLike<Result> {
  select(columns?: string): Query
  eq(column: string, value: unknown): Query
  in(column: string, values: readonly unknown[]): Query
  is(column: string, value: null): Query
  order(column: string, options?: { ascending?: boolean }): Query
  limit(n: number): Query
  maybeSingle(): PromiseLike<Result>
  single(): PromiseLike<Result>
}
export interface Db {
  from(table: string): { select(columns?: string): Query; insert(values: object | object[]): Query; update(values: object): Query }
  rpc(fn: string, args?: object): PromiseLike<Result>
}

/** Who is calling: a token's row, from qa_token_use. */
export interface Caller {
  tokenId: string
  /** null: a project's CI token. */
  profileId: string | null
  /** The one project the token is for, if it is limited to one. */
  projectId: string | null
  scopes: string[]
}

type Row = Record<string, unknown>
type Args = Record<string, unknown>

interface Project {
  id: string
  key: string
  name: string
  archived_at: string | null
  test_types: string[]
  test_levels: string[]
  test_environments: string[]
}

const STATUSES = ["pass", "fail", "blocked", "skipped"];
const CASE_COLUMNS = "id, key, issue_id, title, description, expected, type, level, areas, rank, last_status, last_reason, " +
  "last_environment, last_recorded_at, script_repo, script_path, script_title, automated_at, updated_at";

/** A database answer, or the error it gave (a rule's own words reach the caller). */
async function rows<T = Row>(q: PromiseLike<Result>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw refusal(error);
  return (data ?? []) as T[];
}
async function row<T = Row>(q: PromiseLike<Result>): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw refusal(error);
  return (data ?? null) as T | null;
}
const refusal = (e: DbError) =>
  ["23514", "22023", "42501", "23503", "23505", "P0001"].includes(e.code ?? "") ? new ApiError(400, e.message) : new Error(e.message);

const text = (v: unknown, field: string, max = 10000): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ApiError(400, `${field} must be text.`);
  if (v.length > max) throw new ApiError(400, `${field} is longer than ${max} characters.`);
  return v;
};
const need = (v: unknown, field: string) => {
  const s = text(v, field, 500)?.trim();
  if (!s) throw new ApiError(400, `${field} is required.`);
  return s;
};
const list = (v: unknown, field: string): unknown[] => {
  if (!Array.isArray(v)) throw new ApiError(400, `${field} must be a list.`);
  return v;
};

export class Ops {
  constructor(private db: Db, private caller: Caller) {}

  private needScope(scope: "tests:read" | "tests:write") {
    if (!this.caller.scopes.includes(scope)) throw new ApiError(403, `This token can't ${scope === "tests:write" ? "write" : "read"} tests.`);
  }

  /** What this token may do in the project: null when it may not see it. */
  private async role(projectId: string) {
    const { data, error } = await this.db.rpc("qa_role", { p_token: this.caller.tokenId, p_project: projectId });
    if (error) throw new Error(error.message);
    return (data as string | null) ?? null;
  }

  /** The project, if this token may see it (and write to it, when asked). */
  private async project(key: string, write = false): Promise<Project> {
    this.needScope(write ? "tests:write" : "tests:read");
    const p = await row<Project>(this.db.from("projects")
      .select("id, key, name, archived_at, test_types, test_levels, test_environments").eq("key", key.trim().toUpperCase()).maybeSingle());
    const role = p ? await this.role(p.id) : null;
    // A project you can't see doesn't exist here, as in the app.
    if (!p || !role) throw new ApiError(404, `There's no project ${key.toUpperCase()} this token can use.`);
    if (write && !["admin", "manager", "member"].includes(role)) throw new ApiError(403, `This token can only read ${p.key}.`);
    return p;
  }

  private async projectById(id: string, write = false) {
    const p = await row<{ key: string }>(this.db.from("projects").select("key").eq("id", id).maybeSingle());
    if (!p) throw new ApiError(404, "There's no such project.");
    return this.project(p.key, write);
  }

  /** The issue and its project, if this token may see it (and write to the project, when asked). */
  private async issue(key: string, write = false) {
    const missing = () => new ApiError(404, `There's no issue ${key.trim().toUpperCase()} this token can use.`);
    const issue = await row(this.db.from("issues").select("*").eq("key", key.trim().toUpperCase()).maybeSingle());
    if (!issue) throw missing();
    let project: Project;
    try {
      project = await this.projectById(issue.project_id as string, write);
    } catch (e) {
      // Not the project's name: an issue you can't see doesn't exist here.
      if (e instanceof ApiError && e.status === 404) throw missing();
      throw e;
    }
    return { issue, project };
  }

  private async knownAreas(projectId: string) {
    const cases = await rows<{ areas: string[] }>(this.db.from("test_cases").select("areas").eq("project_id", projectId));
    const seen = new Map<string, string>();
    for (const c of cases) for (const a of c.areas ?? []) if (!seen.has(a.toLowerCase())) seen.set(a.toLowerCase(), a);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  private async issueKeys(ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return new Map<string, string>();
    const found = await rows<{ id: string; key: string }>(this.db.from("issues").select("id, key").in("id", wanted));
    return new Map(found.map((i) => [i.id, i.key]));
  }

  private caseOut(c: Row, keys: Map<string, string>) {
    return {
      key: c.key,
      issue: c.issue_id ? keys.get(c.issue_id as string) ?? null : null,
      title: c.title,
      description: c.description,
      expected: c.expected,
      type: c.type,
      level: c.level,
      areas: c.areas,
      latest: c.last_status
        ? { status: c.last_status, reason: c.last_reason || null, environment: c.last_environment, at: c.last_recorded_at }
        : null,
      script: c.script_path ? { repo: c.script_repo, path: c.script_path, title: c.script_title, linked_at: c.automated_at } : null,
      // Edited since its script was linked: the script may need to follow.
      changed_since_automated: !!(c.automated_at && c.updated_at && String(c.updated_at) > String(c.automated_at)),
      updated_at: c.updated_at,
    };
  }

  private lists(p: Project, areas: string[]) {
    return { types: p.test_types, levels: p.test_levels, environments: p.test_environments, areas };
  }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  async get_issue(args: Args) {
    const { issue, project: p } = await this.issue(need(args.key, "key"));
    const [type, status, assignee, parent, fields, comments, cases, areas] = await Promise.all([
      row<{ name: string }>(this.db.from("issue_types").select("name").eq("id", issue.type_id).maybeSingle()),
      row<{ name: string }>(this.db.from("project_statuses").select("name").eq("id", issue.status_id).maybeSingle()),
      issue.assignee_id ? row<{ full_name: string }>(this.db.from("profiles").select("full_name").eq("id", issue.assignee_id).maybeSingle()) : null,
      issue.parent_id ? row<{ key: string; title: string }>(this.db.from("issues").select("key, title").eq("id", issue.parent_id).maybeSingle()) : null,
      rows<{ id: string; name: string }>(this.db.from("fields").select("id, name").eq("project_id", p.id)),
      args.include_comments === false
        ? Promise.resolve([] as Row[])
        : rows(this.db.from("comments").select("author_id, body, created_at").eq("issue_id", issue.id).order("created_at")),
      rows(this.db.from("test_cases").select(CASE_COLUMNS).eq("issue_id", issue.id).order("rank")),
      this.knownAreas(p.id),
    ]);
    const authorIds = [...new Set(comments.map((c) => c.author_id).filter(Boolean))];
    const authors = authorIds.length
      ? await rows<{ id: string; full_name: string }>(this.db.from("profiles").select("id, full_name").in("id", authorIds))
      : [];
    const custom = issue.custom as Record<string, unknown> | null;
    return {
      key: issue.key,
      project: { key: p.key, name: p.name },
      title: issue.title,
      type: type?.name ?? null,
      status: status?.name ?? null,
      priority: issue.priority,
      assignee: assignee?.full_name ?? null,
      epic: parent ? { key: parent.key, title: parent.title } : null,
      labels: issue.labels,
      fields: Object.fromEntries(fields.filter((f) => custom && f.id in custom).map((f) => [f.name, custom![f.id]])),
      description: htmlToMarkdown(String(issue.description ?? "")),
      comments: comments.map((c) => ({
        author: authors.find((a) => a.id === c.author_id)?.full_name ?? null,
        at: c.created_at,
        text: htmlToMarkdown(String(c.body ?? "")),
      })),
      test_cases: cases.map((c) => this.caseOut(c, new Map([[issue.id as string, issue.key as string]]))),
      project_lists: this.lists(p, areas),
    };
  }

  async list_test_cases(args: Args) {
    const p = await this.project(need(args.project, "project"));
    let cases = await rows(this.db.from("test_cases").select(CASE_COLUMNS).eq("project_id", p.id).order("rank"));
    if (args.issue) {
      const { issue } = await this.issue(String(args.issue));
      if (issue.project_id !== p.id) throw new ApiError(400, `${issue.key} is not in ${p.key}.`);
      cases = cases.filter((c) => c.issue_id === issue.id);
    }
    const lower = (v: unknown) => String(v ?? "").toLowerCase();
    if (args.type) cases = cases.filter((c) => lower(c.type) === lower(args.type));
    if (args.level) cases = cases.filter((c) => lower(c.level) === lower(args.level));
    if (args.area) cases = cases.filter((c) => (c.areas as string[]).some((a) => lower(a) === lower(args.area)));
    if (args.status) cases = cases.filter((c) => (c.last_status ?? "none") === args.status);
    const keys = await this.issueKeys(cases.map((c) => c.issue_id as string | null));
    return { project: p.key, count: cases.length, test_cases: cases.map((c) => this.caseOut(c, keys)), project_lists: this.lists(p, await this.knownAreas(p.id)) };
  }

  // ---------------------------------------------------------------------------
  // Writing cases
  // ---------------------------------------------------------------------------

  async save_test_cases(args: Args) {
    const items = list(args.cases, "cases");
    if (!items.length) throw new ApiError(400, "Give at least one case.");
    if (items.length > 100) throw new ApiError(400, "At most 100 cases a call.");
    const found = args.issue ? await this.issue(String(args.issue), true) : null;
    const issue = found?.issue ?? null;
    const p = found ? found.project : await this.project(need(args.project, "project (or issue)"), true);
    if (issue && args.project && String(args.project).toUpperCase() !== p.key) throw new ApiError(400, `${issue.key} is not in ${String(args.project)}.`);

    const keys = items.map((c) => (c as Row).key).filter(Boolean).map((k) => String(k).toUpperCase());
    const existing = keys.length
      ? await rows(this.db.from("test_cases").select("id, key, expected").eq("project_id", p.id).in("key", keys))
      : [];
    const issueIds = new Map<string, string>();
    const saved: { key: string; action: "created" | "updated" | "unchanged" }[] = [];
    const errors: { index: number; key?: string; error: string }[] = [];

    for (const [index, raw] of items.entries()) {
      const c = (raw ?? {}) as Row;
      const key = c.key ? String(c.key).toUpperCase() : undefined;
      try {
        const patch: Row = {};
        for (const f of ["title", "description", "expected", "type", "level"] as const) {
          const v = text(c[f], f, f === "title" ? 500 : 10000);
          if (v !== undefined) patch[f] = v;
        }
        if (c.areas !== undefined) {
          patch.areas = (typeof c.areas === "string" ? c.areas.split(/[,;]/) : list(c.areas, "areas").map(String))
            .map((a) => a.trim()).filter(Boolean);
        }
        if (c.issue !== undefined) {
          const k = String(c.issue).toUpperCase();
          if (!issueIds.has(k)) {
            const { issue: i } = await this.issue(k);
            if (i.project_id !== p.id) throw new ApiError(400, `${k} is not in ${p.key}.`);
            issueIds.set(k, i.id as string);
          }
          patch.issue_id = issueIds.get(k);
        }
        const reason = text(c.reason, "reason", 1000)?.trim() || null;
        if (key) {
          const before = existing.find((e) => e.key === key);
          if (!before) throw new ApiError(404, `There's no case ${key} in ${p.key}.`);
          if (patch.expected !== undefined && String(patch.expected).trim() !== String(before.expected ?? "").trim() && !reason) {
            throw new ApiError(400, `Changing ${key}'s expected result needs a reason.`);
          }
          if (!Object.keys(patch).length) {
            saved.push({ key, action: "unchanged" });
            continue;
          }
          await row(this.db.from("test_cases").update({ ...patch, change_reason: reason, updated_by: this.caller.profileId })
            .eq("id", before.id).select("key").single());
          saved.push({ key, action: "updated" });
        } else {
          if (!patch.title) throw new ApiError(400, "A new case needs a title.");
          const made = await row<{ key: string }>(this.db.from("test_cases").insert({
            project_id: p.id, issue_id: issue?.id ?? null, ...patch, change_reason: reason, created_by: this.caller.profileId,
          }).select("key").single());
          saved.push({ key: made!.key, action: "created" });
        }
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        errors.push({ index, ...(key ? { key } : {}), error: e.message });
      }
    }
    return { project: p.key, saved, errors };
  }

  async set_automation(args: Args) {
    const links = list(args.links, "links");
    if (!links.length || links.length > 200) throw new ApiError(400, "Give 1 to 200 links.");
    const keys = links.map((l) => need((l as Row).case, "case").toUpperCase());
    const projectKey = keys[0].replace(/-T\d+$/, "");
    if (keys.some((k) => k.replace(/-T\d+$/, "") !== projectKey)) throw new ApiError(400, "Link one project's cases a call.");
    const p = await this.project(projectKey, true);
    const cases = await rows(this.db.from("test_cases").select("id, key").eq("project_id", p.id).in("key", keys));
    const linked: string[] = [];
    const errors: { case: string; error: string }[] = [];
    const now = new Date().toISOString();
    for (const [i, raw] of links.entries()) {
      const l = raw as Row;
      const c = cases.find((x) => x.key === keys[i]);
      if (!c) {
        errors.push({ case: keys[i], error: `There's no case ${keys[i]} in ${p.key}.` });
        continue;
      }
      await row(this.db.from("test_cases").update({
        script_repo: need(l.repo, "repo"), script_path: need(l.path, "path"), script_title: text(l.title, "title", 500) ?? null,
        automated_at: now, change_reason: null, updated_by: this.caller.profileId,
      }).eq("id", c.id).select("key").single());
      linked.push(keys[i]);
    }
    return { linked, errors };
  }

  // ---------------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------------

  private async run(key: string, write = false) {
    const run = await row(this.db.from("test_runs").select("*").eq("key", key.trim().toUpperCase()).maybeSingle());
    if (!run) throw new ApiError(404, `There's no run ${key.toUpperCase()} this token can use.`);
    await this.projectById(run.project_id as string, write);
    return run;
  }

  private runOut(r: Row) {
    return {
      run: r.key, environment: r.environment, mode: r.mode, repo: r.repo, branch: r.branch, commit: r.commit_sha, ci_url: r.ci_url,
      started_at: r.started_at, finished_at: r.finished_at,
      counts: { total: r.total, pass: r.passed, fail: r.failed, blocked: r.blocked, skipped: r.skipped, flaky: r.flaky },
    };
  }

  async start_run(args: Args) {
    const p = await this.project(need(args.project, "project"), true);
    const commit = text(args.commit, "commit", 40)?.trim().toLowerCase();
    const ciUrl = text(args.ci_url, "ci_url", 2000)?.trim();
    const run = await row(this.db.from("test_runs").insert({
      project_id: p.id,
      environment: need(args.environment, "environment"),
      // A person's token runs on their machine; a project's CI token in the cloud.
      mode: this.caller.profileId ? "local" : "cloud",
      run_by: this.caller.profileId,
      repo: text(args.repo, "repo", 200)?.trim() || null,
      branch: text(args.branch, "branch", 300)?.trim() || null,
      commit_sha: commit || null,
      ci_url: ciUrl || null,
    }).select("*").single());
    return this.runOut(run!);
  }

  async record_results(args: Args) {
    const run = await this.run(need(args.run, "run"), true);
    if (run.finished_at) throw new ApiError(400, `Run ${run.key} is finished.`);
    const results = list(args.results, "results");
    if (!results.length || results.length > 1000) throw new ApiError(400, "Give 1 to 1000 results.");
    const keys = [...new Set(results.map((r) => need((r as Row).case, "case").toUpperCase()))];
    const cases = await rows<{ id: string; key: string }>(this.db.from("test_cases").select("id, key").eq("project_id", run.project_id).in("key", keys));
    const idOf = new Map(cases.map((c) => [c.key, c.id]));
    const unknown: string[] = [];
    const inserts: Row[] = [];
    for (const raw of results) {
      const r = raw as Row;
      const key = String(r.case).toUpperCase();
      const id = idOf.get(key);
      if (!id) {
        unknown.push(key);
        continue;
      }
      const status = String(r.status);
      if (!STATUSES.includes(status)) throw new ApiError(400, `${key}: "${status}" is not one of ${STATUSES.join(", ")}.`);
      const error = text(r.error, "error", 5000)?.trim() || null;
      const artifact = text(r.artifact_url, "artifact_url", 2000)?.trim() || null;
      if (artifact && !artifact.startsWith("https://")) throw new ApiError(400, `${key}: artifact_url must be an https link.`);
      let reason = text(r.reason, "reason", 5000)?.trim() || "";
      // A failure always says why: its error's first line, if nothing else.
      if (!reason && (status === "fail" || status === "blocked")) reason = error?.split("\n")[0].slice(0, 500) || `Failed in ${run.key}.`;
      const num = (v: unknown, field: string, max: number) => {
        if (v === undefined || v === null) return undefined;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > max) throw new ApiError(400, `${key}: ${field} is out of range.`);
        return Math.round(n);
      };
      inserts.push({
        case_id: id, run_id: run.id, status, reason, error, artifact_url: artifact, source: "automated", recorded_by: this.caller.profileId,
        duration_ms: num(r.duration_ms, "duration_ms", 86_400_000) ?? null,
        attempts: num(r.attempts, "attempts", 20) || 1,
        flaky: r.flaky === true,
      });
    }
    if (inserts.length) await rows(this.db.from("test_results").insert(inserts).select("id"));
    const after = await row(this.db.from("test_runs").select("*").eq("id", run.id).single());
    return { ...this.runOut(after!), recorded: inserts.length, unknown_cases: unknown };
  }

  async finish_run(args: Args) {
    const run = await this.run(need(args.run, "run"), true);
    if (!run.finished_at) {
      await row(this.db.from("test_runs").update({ finished_at: new Date().toISOString() }).eq("id", run.id).select("id").single());
    }
    const after = await row(this.db.from("test_runs").select("*").eq("id", run.id).single());
    return this.runOut(after!);
  }

  async get_run(args: Args) {
    const run = await this.run(need(args.run, "run"));
    const results = await rows(this.db.from("test_results")
      .select("case_id, status, reason, error, duration_ms, attempts, flaky, artifact_url, created_at").eq("run_id", run.id).order("created_at"));
    const cases = await rows<{ id: string; key: string; title: string }>(this.db.from("test_cases").select("id, key, title")
      .in("id", [...new Set(results.map((r) => r.case_id))]));
    return {
      ...this.runOut(run),
      results: results.map((r) => {
        const c = cases.find((x) => x.id === r.case_id);
        return { case: c?.key ?? null, title: c?.title ?? null, status: r.status, reason: r.reason || null, error: r.error,
          duration_ms: r.duration_ms, attempts: r.attempts, flaky: r.flaky, artifact_url: r.artifact_url };
      }),
    };
  }

  async list_runs(args: Args) {
    const p = await this.project(need(args.project, "project"));
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
    const runs = await rows(this.db.from("test_runs").select("*").eq("project_id", p.id).order("started_at", { ascending: false }).limit(limit));
    return { project: p.key, runs: runs.map((r) => this.runOut(r)) };
  }

  /** A tool by name (MCP's tools/call, or POST /v1/<tool>). */
  call(tool: string, args: Args): Promise<unknown> {
    switch (tool) {
      case "get_issue": return this.get_issue(args);
      case "list_test_cases": return this.list_test_cases(args);
      case "save_test_cases": return this.save_test_cases(args);
      case "set_automation": return this.set_automation(args);
      case "start_run": return this.start_run(args);
      case "record_results": return this.record_results(args);
      case "finish_run": return this.finish_run(args);
      case "get_run": return this.get_run(args);
      case "list_runs": return this.list_runs(args);
      default: throw new ApiError(404, `There's no tool ${tool}.`);
    }
  }
}
