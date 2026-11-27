// qa-api as an MCP server (streamable HTTP, JSON responses): the tools an AI
// tool sees, and the JSON-RPC around them. The same tools are plain HTTP at
// /v1/<tool>. Pure: the browser tests read it too.

export const SERVER_INFO = { name: "el-work", version: "1.0.0" };
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCTIONS =
  "Elevance Work holds each project's issues and their end-to-end test cases (keys like WEB-T12) and test runs (WEB-R7). " +
  "Read an issue with get_issue before writing cases for it. Save cases only after the person has reviewed them. " +
  "Tag every Playwright test with its case key (@WEB-T12) and link it with set_automation. " +
  "Results come from real test runs: publish them with the Playwright reporter (or start_run / record_results / finish_run " +
  "with exactly what the run reported); never record a status you did not see a test produce.";

interface Schema {
  type: string
  description?: string
  properties?: Record<string, Schema>
  items?: Schema
  required?: string[]
  enum?: string[]
  additionalProperties?: boolean
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: Schema
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean }
  /** Needs the tests:write scope. */
  writes: boolean
}

const str = (description: string): Schema => ({ type: "string", description });
const caseShape: Schema = {
  type: "object",
  properties: {
    key: str("An existing case's key (WEB-T12) to update; leave out to create a new case."),
    title: str("The summary: what is tested, in one line. Required for a new case."),
    description: str("Plain text: preconditions and numbered steps."),
    expected: str("The expected result. Changing it on an existing case needs a reason."),
    type: str("One of the project's test types (get_issue / list_test_cases list them)."),
    level: str("One of the project's test levels, e.g. Smoke or Regression."),
    areas: { type: "array", items: { type: "string" }, description: "Impacted areas (the project's own names where they exist)." },
    issue: str("The issue key it is written for, if not the call's issue."),
    reason: str("Why this change: required when an existing case's expected result changes."),
  },
};

export const TOOLS: ToolDef[] = [
  {
    name: "get_issue",
    description: "An issue (ticket) to test: its title, type, status, epic, description as Markdown, custom fields, comments, " +
      "its existing test cases, and the project's allowed test types, levels, environments and impacted areas.",
    inputSchema: {
      type: "object",
      properties: { key: str("The issue key, e.g. WEB-12."), include_comments: { type: "boolean", description: "Default true." } },
      required: ["key"],
    },
    annotations: { readOnlyHint: true },
    writes: false,
  },
  {
    name: "list_test_cases",
    description: "A project's test cases, optionally only an issue's, a type's, a level's, an area's, or by latest status.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("The project key, e.g. WEB."),
        issue: str("Only the cases written for this issue key."),
        type: str("Only this test type."),
        level: str("Only this level, e.g. Regression."),
        area: str("Only cases with this impacted area."),
        status: { type: "string", enum: ["pass", "fail", "blocked", "skipped", "none"], description: "Latest result; none = never run." },
      },
      required: ["project"],
    },
    annotations: { readOnlyHint: true },
    writes: false,
  },
  {
    name: "save_test_cases",
    description: "Create or update test cases in one call (at most 100), after the person has reviewed them. Cases without a key are " +
      "created (for `issue`, if given); cases with a key are updated with only the fields given. Returns each case's key, " +
      "and per-case errors (a value not on the project's lists, a missing reason).",
    inputSchema: {
      type: "object",
      properties: {
        project: str("The project key; may be left out when `issue` is given."),
        issue: str("The issue key new cases are written for."),
        cases: { type: "array", items: caseShape, description: "The cases, in the order they should appear." },
      },
      required: ["cases"],
    },
    annotations: { idempotentHint: false },
    writes: true,
  },
  {
    name: "set_automation",
    description: "Link test cases to the Playwright tests that automate them (repo, file path, test title).",
    inputSchema: {
      type: "object",
      properties: {
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              case: str("The case key, e.g. WEB-T12."),
              repo: str("The repository, e.g. elevance/storefront."),
              path: str("The spec file's path in the repo, e.g. e2e/checkout/pay.spec.ts."),
              title: str("The test's title (including its @WEB-T12 tag)."),
            },
            required: ["case", "repo", "path"],
          },
        },
      },
      required: ["links"],
    },
    annotations: { idempotentHint: true },
    writes: true,
  },
  {
    name: "start_run",
    description: "Start a test run (returns its key, e.g. WEB-R7) on one of the project's environments. A person's token runs " +
      "`local`; a project's CI token runs `cloud`. Prefer the Playwright reporter, which does this itself.",
    inputSchema: {
      type: "object",
      properties: {
        project: str("The project key."),
        environment: str("One of the project's environments, e.g. Local, Dev, Staging, Prod."),
        repo: str("The repository the tests ran from."),
        branch: str("The branch."),
        commit: str("The commit SHA (7 to 40 hex characters)."),
        ci_url: str("A link to the CI job (https)."),
      },
      required: ["project", "environment"],
    },
    writes: true,
  },
  {
    name: "record_results",
    description: "Record what a run's tests produced, one result per case key. Only statuses a real test run reported: never guess.",
    inputSchema: {
      type: "object",
      properties: {
        run: str("The run key from start_run, e.g. WEB-R7."),
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              case: str("The case key."),
              status: { type: "string", enum: ["pass", "fail", "blocked", "skipped"] },
              reason: str("Why it failed or is blocked (the error's first line is used if left out)."),
              error: str("The failure's message and location."),
              duration_ms: { type: "number" },
              attempts: { type: "number", description: "How many times it ran (retries + 1)." },
              flaky: { type: "boolean", description: "Passed only after a retry." },
              artifact_url: str("A link (https) to its trace, screenshot or video."),
            },
            required: ["case", "status"],
          },
        },
      },
      required: ["run", "results"],
    },
    writes: true,
  },
  {
    name: "finish_run",
    description: "Close a run: it takes no more results. Returns its counts.",
    inputSchema: { type: "object", properties: { run: str("The run key.") }, required: ["run"] },
    annotations: { idempotentHint: true },
    writes: true,
  },
  {
    name: "get_run",
    description: "A run and each of its results.",
    inputSchema: { type: "object", properties: { run: str("The run key.") }, required: ["run"] },
    annotations: { readOnlyHint: true },
    writes: false,
  },
  {
    name: "list_runs",
    description: "A project's latest runs, newest first.",
    inputSchema: {
      type: "object",
      properties: { project: str("The project key."), limit: { type: "number", description: "At most 100; default 20." } },
      required: ["project"],
    },
    annotations: { readOnlyHint: true },
    writes: false,
  },
];

export const toolNamed = (name: string) => TOOLS.find((t) => t.name === name);

/** A refusal the caller should see as it is (a 4xx), not as a crash. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Call = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

interface RpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const reply = (id: RpcMessage["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const failure = (id: RpcMessage["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function one(message: RpcMessage, call: Call): Promise<object | null> {
  if (!message || typeof message !== "object" || typeof message.method !== "string") {
    return failure(message?.id, -32600, "Invalid request");
  }
  // A notification (no id) is acknowledged with nothing.
  if (message.id === undefined || message.method.startsWith("notifications/")) return null;
  const params = message.params ?? {};
  switch (message.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return reply(message.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply(message.id, {});
    case "tools/list":
      return reply(message.id, {
        tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })),
      });
    case "tools/call": {
      const name = String(params.name ?? "");
      if (!toolNamed(name)) return failure(message.id, -32602, `Unknown tool: ${name}`);
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
      try {
        const result = await call(name, args);
        return reply(message.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false });
      } catch (e) {
        // A refusal is the tool's answer, for the model to read and act on.
        if (e instanceof ApiError) return reply(message.id, { content: [{ type: "text", text: e.message }], isError: true });
        throw e;
      }
    }
    default:
      return failure(message.id, -32601, `Method not found: ${message.method}`);
  }
}

/** The response body for an MCP POST: a reply, a batch of replies, or null (202, nothing to say). */
export async function handleMcp(body: unknown, call: Call): Promise<object | object[] | null> {
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => one(m as RpcMessage, call)))).filter((r): r is object => r !== null);
    return replies.length ? replies : null;
  }
  return one(body as RpcMessage, call);
}
