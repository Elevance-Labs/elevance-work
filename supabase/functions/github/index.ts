// GitHub → issues: records the branches, commits and pull requests that name
// an issue's key, so the issue can show its Development.
//
// Called only by GitHub, as an organisation (or repository) webhook for the
// events: Pushes, Branch or tag creation, Branch or tag deletion, Pull
// requests. There is no user and no JWT; what authenticates the caller is
// GitHub's signature over the body (X-Hub-Signature-256), made with the
// secret typed into the webhook. A delivery with a missing or wrong signature
// is refused before its body is read as anything.
//
// It only ever writes `issue_dev_links` (which clients can read, not write),
// only for keys that are real issues, and nothing a delivery says changes an
// issue itself.
//
// Deploy with:  supabase functions deploy github --no-verify-jwt
// Env: GITHUB_WEBHOOK_SECRET (the webhook's secret; a long random string).
import { adminClient, json, secretMatches } from "../_shared/google.ts";
import { parse } from "./parse.ts";

const MAX_BODY = 5_000_000;

async function signatureOf(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  if (!secret) return json({ error: "GitHub links are not set up" }, 503);

  const body = await req.text();
  if (body.length > MAX_BODY) return json({ error: "Too large" }, 413);
  if (!secretMatches(req.headers.get("x-hub-signature-256"), await signatureOf(secret, body))) {
    return json({ error: "Bad signature" }, 401);
  }

  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return json({ ok: true });

  try {
    const { links, removed } = parse(event, JSON.parse(body));
    const admin = adminClient();

    for (const gone of removed) {
      const { error } = await admin.from("issue_dev_links").delete().eq("kind", "branch").eq("repo", gone.repo).eq("ref", gone.ref);
      if (error) throw error;
    }
    if (!links.length) return json({ linked: 0, removed: removed.length });

    // Only keys that are issues: text that merely looks like one (UTF-8, SHA-256) links nothing.
    const keys = [...new Set(links.map((l) => l.key))];
    const { data: issues, error: readError } = await admin.from("issues").select("id, key").in("key", keys);
    if (readError) throw readError;
    const idOf = new Map((issues ?? []).map((i) => [i.key as string, i.id as string]));

    const now = new Date().toISOString();
    const rows = links.flatMap((l) => {
      const issue_id = idOf.get(l.key);
      if (!issue_id) return [];
      return [{
        issue_id, kind: l.kind, repo: l.repo, ref: l.ref, title: l.title, url: l.url, state: l.state, author: l.author,
        happened_at: l.happened_at ?? now, updated_at: now,
      }];
    });
    if (rows.length) {
      const { error } = await admin.from("issue_dev_links").upsert(rows, { onConflict: "issue_id,kind,repo,ref" });
      if (error) throw error;
    }
    return json({ linked: rows.length, removed: removed.length });
  } catch (e) {
    console.error("github:", e);
    // GitHub retries nothing on its own, but shows the failure against the delivery, where it can be redelivered.
    return json({ error: "Could not record that delivery" }, 500);
  }
});
