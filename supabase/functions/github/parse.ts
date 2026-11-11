// What a GitHub webhook delivery says about our issues: pure, no Deno and no
// network, so the browser test suite reads it too (test/github.test.tsx).
//
// An issue is named by its key (WEB-12) in a branch name, a commit message or
// a pull request's title. Branch names are usually lower case, so keys are
// matched whatever their case and stored upper case.

export type DevLinkKind = "branch" | "commit" | "pull_request";

export interface FoundLink {
  key: string;
  kind: DevLinkKind;
  repo: string;
  ref: string;
  title: string;
  url: string;
  state: "open" | "draft" | "merged" | "closed" | null;
  author: string | null;
  happened_at: string | null;
}

export interface Parsed {
  links: FoundLink[];
  // Branches that no longer exist: their links go.
  removed: { repo: string; ref: string }[];
}

const KEY = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})(?![A-Za-z0-9])/g;
const MAX_KEYS = 20;
const MAX_COMMITS = 50;

/** The issue keys a piece of text names: upper case, each once, in the order met. */
export function issueKeys(text: unknown): string[] {
  const found: string[] = [];
  for (const m of String(text ?? "").matchAll(KEY)) {
    const key = `${m[1].toUpperCase()}-${Number(m[2])}`;
    if (!found.includes(key)) found.push(key);
    if (found.length === MAX_KEYS) break;
  }
  return found;
}

const clip = (value: unknown, n: number) => String(value ?? "").slice(0, n);
const firstLine = (message: unknown) => clip(String(message ?? "").split("\n")[0].trim(), 200);
const https = (url: unknown) => (typeof url === "string" && url.startsWith("https://") ? url : null);
const branchOf = (ref: unknown) => (typeof ref === "string" && ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null);
const branchUrl = (repoUrl: string, branch: string) => `${repoUrl}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;

// deno-lint-ignore no-explicit-any
type Payload = any;

function branchLinks(repo: string, repoUrl: string, branch: string, author: string | null, at: string | null): FoundLink[] {
  return issueKeys(branch).map((key) => ({
    key, kind: "branch", repo, ref: clip(branch, 300), title: clip(branch, 200), url: branchUrl(repoUrl, branch),
    state: null, author, happened_at: at,
  }));
}

/** The links a delivery adds, and the branches it says are gone. Anything unrecognised is nothing. */
export function parse(event: string, payload: Payload): Parsed {
  const none: Parsed = { links: [], removed: [] };
  const repo = clip(payload?.repository?.full_name, 200);
  const repoUrl = https(payload?.repository?.html_url);
  if (!repo || !repoUrl) return none;
  const sender = typeof payload?.sender?.login === "string" ? payload.sender.login : null;

  if (event === "push") {
    const branch = branchOf(payload.ref);
    if (!branch) return none;
    if (payload.deleted) return { links: [], removed: [{ repo, ref: branch }] };
    const links = branchLinks(repo, repoUrl, branch, sender, payload.head_commit?.timestamp ?? null);
    for (const commit of (Array.isArray(payload.commits) ? payload.commits : []).slice(0, MAX_COMMITS)) {
      const url = https(commit?.url);
      if (!url || typeof commit?.id !== "string") continue;
      for (const key of issueKeys(commit.message)) {
        links.push({
          key, kind: "commit", repo, ref: clip(commit.id, 300), title: firstLine(commit.message), url, state: null,
          author: commit.author?.username ?? commit.author?.name ?? null, happened_at: commit.timestamp ?? null,
        });
      }
    }
    return { links, removed: [] };
  }

  if (event === "create" && payload.ref_type === "branch" && typeof payload.ref === "string") {
    return { links: branchLinks(repo, repoUrl, payload.ref, sender, null), removed: [] };
  }
  if (event === "delete" && payload.ref_type === "branch" && typeof payload.ref === "string") {
    return { links: [], removed: [{ repo, ref: payload.ref }] };
  }

  if (event === "pull_request") {
    const pr = payload.pull_request;
    const url = https(pr?.html_url);
    if (!pr || !url || typeof pr.number !== "number") return none;
    const state = pr.merged ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open";
    const keys = [...new Set([...issueKeys(pr.title), ...issueKeys(pr.head?.ref)])].slice(0, MAX_KEYS);
    return {
      links: keys.map((key) => ({
        key, kind: "pull_request", repo, ref: String(pr.number), title: clip(pr.title, 200), url, state,
        author: pr.user?.login ?? null, happened_at: pr.updated_at ?? null,
      })),
      removed: [],
    };
  }
  return none;
}
