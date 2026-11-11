// Posts to Google Chat: a project's space (project_integrations) for its
// issues, comments, sprints and releases; the workspace's space
// (workspace_settings) for releases.
//
// Called only by Postgres, through pg_net (`chat_notify` /
// `workspace_chat_notify` in the schema), with nothing but an id and the
// event; everything posted is read here with service_role, so the message and
// what it shows stay in one place. The webhook URLs are bearer secrets — they
// never leave the database and this function.
//
// Every message about an issue goes to the issue's own thread (threadKey =
// the issue key), so a space reads as one thread per issue.
//
// Deploy with:  supabase functions deploy notify-chat --no-verify-jwt
// Env: FUNCTIONS_SHARED_SECRET (= Vault `functions_secret`), APP_BASE_URL.
import { adminClient, appUrl, fromDatabase, json, type Admin } from "../_shared/google.ts";

/**
 * Text for a plain Chat message. Chat reads `<users/all>` and the like as a
 * mention, and asterisks would unbalance the bold around them.
 */
const plain = (value: unknown) => String(value ?? "").replace(/[<>*]/g, "").replace(/\s+/g, " ").trim();
/** Chat renders a little HTML in card text, so anything typed is escaped. */
const esc = (value: unknown) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const orDash = (value: unknown) => (esc(value).trim() || "—");
const stripHtml = (html: string) =>
  html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const snippet = (html: string, n = 280) => {
  const text = plain(stripHtml(html));
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};
const dayLabel = (date: string | null) =>
  date ? new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

async function post(webhookUrl: string, message: Record<string, unknown>, threadKey?: string) {
  const url = new URL(webhookUrl);
  if (threadKey) {
    url.searchParams.set("threadKey", threadKey);
    url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    // pg_net has long since returned; this log is the only record it failed.
    console.error(`Google Chat refused the message: ${res.status} ${await res.text()}`);
    return json({ error: "Chat refused the message" }, 502);
  }
  return json({ ok: true });
}

const button = (text: string, url: string) => ({ buttonList: { buttons: [{ text, onClick: { openLink: { url } } }] } });
const line = (topLabel: string, text: string, bottomLabel?: string) => ({
  decoratedText: { topLabel, text, wrapText: true, ...(bottomLabel ? { bottomLabel } : {}) },
});

async function projectWebhook(admin: Admin, projectId: string, event: string) {
  const { data } = await admin.from("project_integrations").select("chat_webhook_url, chat_events")
    .eq("project_id", projectId).maybeSingle();
  return data?.chat_webhook_url && (data.chat_events as string[]).includes(event) ? (data.chat_webhook_url as string) : null;
}

async function workspaceWebhook(admin: Admin, event: string) {
  const { data } = await admin.from("workspace_settings").select("chat_webhook_url, chat_events").maybeSingle();
  return data?.chat_webhook_url && (data.chat_events as string[]).includes(event) ? (data.chat_webhook_url as string) : null;
}

const nameOf = async (admin: Admin, id: string | null) => {
  if (!id) return null;
  const { data } = await admin.from("profiles").select("full_name").eq("id", id).maybeSingle();
  return (data?.full_name as string | undefined) ?? null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!fromDatabase(req)) return json({ error: "Unauthorized" }, 401);
  if (!Deno.env.get("APP_BASE_URL")) {
    console.error("notify-chat: APP_BASE_URL is not set; nothing was sent");
    return json({ error: "Not configured" }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request" }, 400);
  }
  const admin = adminClient();
  const event = String(body.event ?? "");
  try {
    switch (event) {
      case "issue_created":
        return await issueCreated(admin, String(body.issue_id));
      case "issue_assigned":
        return await issueAssigned(admin, String(body.issue_id));
      case "status_changed":
        return await statusChanged(admin, String(body.issue_event_id));
      case "comment_added":
        return await commentAdded(admin, String(body.comment_id));
      case "sprint_started":
      case "sprint_completed":
        return await sprintMoved(admin, event, String(body.sprint_id));
      case "release_released":
        return await released(admin, String(body.release_id), body.workspace === true);
      default:
        return json({ error: "Unknown event" }, 400);
    }
  } catch (e) {
    console.error(`notify-chat ${event}:`, e);
    return json({ error: "Lookup failed" }, 500);
  }
});

async function issueCreated(admin: Admin, issueId: string) {
  const { data: issue } = await admin.from("issues")
    .select("key, title, priority, project_id, assignee_id, reporter_id, issue_types!inner(name), projects!inner(name)")
    .eq("id", issueId).maybeSingle();
  if (!issue) return json({ error: "not_found" }, 404);
  const webhook = await projectWebhook(admin, issue.project_id, "issue_created");
  if (!webhook) return json({ ok: true, skipped: "not wanted" });
  const type = (issue.issue_types as unknown as { name: string }).name;
  const project = (issue.projects as unknown as { name: string }).name;
  const [assignee, reporter] = await Promise.all([nameOf(admin, issue.assignee_id), nameOf(admin, issue.reporter_id)]);

  return post(webhook, {
    // Card content doesn't reach mobile notification previews; this line does.
    text: `*${plain(issue.key)}* ${plain(type)} created — ${plain(issue.title)}`,
    cardsV2: [{
      cardId: `issue-${issueId}`,
      card: {
        header: { title: `${esc(issue.key)} · ${esc(issue.title)}`, subtitle: `${esc(type)} in ${esc(project)}` },
        sections: [
          { widgets: [line("Priority", orDash(issue.priority)), line("Assignee", orDash(assignee ?? "Unassigned")),
                      line("Reporter", orDash(reporter))] },
          { widgets: [button("Open issue", appUrl(`/browse/${issue.key}`))] },
        ],
      },
    }],
  }, issue.key);
}

async function issueAssigned(admin: Admin, issueId: string) {
  const { data: issue } = await admin.from("issues").select("key, project_id, assignee_id").eq("id", issueId).maybeSingle();
  if (!issue?.assignee_id) return json({ ok: true, skipped: "unassigned" });
  const webhook = await projectWebhook(admin, issue.project_id, "issue_assigned");
  if (!webhook) return json({ ok: true, skipped: "not wanted" });
  return post(webhook, { text: `*${plain(issue.key)}* assigned to *${plain(await nameOf(admin, issue.assignee_id))}*` },
    issue.key);
}

async function statusChanged(admin: Admin, eventId: string) {
  const { data: e } = await admin.from("issue_events")
    .select("to_value, actor_id, project_id, issues!inner(key)").eq("id", eventId).maybeSingle();
  if (!e) return json({ error: "not_found" }, 404);
  const webhook = await projectWebhook(admin, e.project_id, "status_changed");
  if (!webhook) return json({ ok: true, skipped: "not wanted" });
  const key = (e.issues as unknown as { key: string }).key;
  const actor = (await nameOf(admin, e.actor_id)) ?? "Someone";
  return post(webhook, { text: `*${plain(key)}* moved to *${plain(e.to_value)}* by ${plain(actor)}` }, key);
}

async function commentAdded(admin: Admin, commentId: string) {
  const { data: c } = await admin.from("comments")
    .select("body, author_id, issues!inner(key, project_id)").eq("id", commentId).maybeSingle();
  if (!c) return json({ error: "not_found" }, 404);
  const issue = c.issues as unknown as { key: string; project_id: string };
  const webhook = await projectWebhook(admin, issue.project_id, "comment_added");
  if (!webhook) return json({ ok: true, skipped: "not wanted" });
  const author = (await nameOf(admin, c.author_id)) ?? "Someone";
  return post(webhook, { text: `*${plain(author)}* commented on *${plain(issue.key)}*: ${snippet(c.body)}` }, issue.key);
}

async function sprintMoved(admin: Admin, event: string, sprintId: string) {
  const { data: s } = await admin.from("sprints")
    .select("name, goal, start_date, end_date, project_id, projects!inner(key, name)").eq("id", sprintId).maybeSingle();
  if (!s) return json({ error: "not_found" }, 404);
  const webhook = await projectWebhook(admin, s.project_id, event);
  if (!webhook) return json({ ok: true, skipped: "not wanted" });
  const project = s.projects as unknown as { key: string; name: string };
  const { data: lines } = await admin.from("sprint_issues").select("committed, completed, points_at_start, points_at_end")
    .eq("sprint_id", sprintId);
  const rows = lines ?? [];
  const started = event === "sprint_started";
  const points = (xs: typeof rows, f: "points_at_start" | "points_at_end") =>
    xs.reduce((sum, r) => sum + Number(r[f] ?? 0), 0);
  const summary = started
    ? `${rows.length} issues · ${points(rows, "points_at_start")} points`
    : `${rows.filter((r) => r.completed).length} of ${rows.length} issues done · ` +
      `${points(rows.filter((r) => r.completed), "points_at_end")} points completed`;

  return post(webhook, {
    text: `${started ? "Sprint started" : "Sprint completed"}: *${plain(s.name)}* (${plain(project.name)})`,
    cardsV2: [{
      cardId: `sprint-${sprintId}-${event}`,
      card: {
        header: { title: `${started ? "Sprint started" : "Sprint completed"} · ${esc(s.name)}`, subtitle: esc(project.name) },
        sections: [
          { widgets: [line("Dates", `${dayLabel(s.start_date)} – ${dayLabel(s.end_date)}`), line("Goal", orDash(s.goal)),
                      line(started ? "Committed" : "Result", esc(summary))] },
          { widgets: [button(started ? "Open board" : "Sprint report",
                             appUrl(`/projects/${project.key}/${started ? "board" : `reports?sprint=${sprintId}`}`))] },
        ],
      },
    }],
  });
}

async function released(admin: Admin, releaseId: string, workspace: boolean) {
  const { data: r } = await admin.from("releases")
    .select("name, description, project_id, projects!inner(key, name)").eq("id", releaseId).maybeSingle();
  if (!r) return json({ error: "not_found" }, 404);
  const webhook = workspace
    ? await workspaceWebhook(admin, "release_released")
    : await projectWebhook(admin, r.project_id, "release_released");
  if (!webhook) return json({ ok: true, skipped: "not wanted" });
  const project = r.projects as unknown as { key: string; name: string };
  const { count } = await admin.from("issues").select("id", { count: "exact", head: true }).eq("release_id", releaseId);
  return post(webhook, {
    text: `Released *${plain(project.name)} ${plain(r.name)}* — ${count ?? 0} issues`,
    cardsV2: [{
      cardId: `release-${releaseId}`,
      card: {
        header: { title: `Released · ${esc(project.name)} ${esc(r.name)}`, subtitle: `${count ?? 0} issues` },
        sections: [
          ...(r.description ? [{ widgets: [{ textParagraph: { text: esc(r.description) } }] }] : []),
          { widgets: [button("Release notes", appUrl(`/projects/${project.key}/releases/${releaseId}`))] },
        ],
      },
    }],
  });
}
