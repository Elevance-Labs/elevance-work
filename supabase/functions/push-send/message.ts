// What a device shows for one notification, and where a tap leads. Pure: the
// browser tests (test/push.test.ts) read it, and check its wording against
// the bell's (src/lib/notifications.ts), which it mirrors.

export interface PushNotification {
  id: string;
  kind: string;
  detail: string | null;
  issue_id: string | null;
  actor: { full_name: string | null } | null;
  /** The comment's stored HTML, for a mention or a comment. */
  comment: { body: string | null } | null;
  issue: { key: string; title: string } | null;
}

export interface PushMessage {
  id: string;
  title: string;
  body: string;
  /** Inside the app (a HashRouter route), read against the worker's folder. */
  path: string;
  /** One notification per issue on a device: a newer one replaces it. */
  tag: string;
  /** What the app's icon counts once this arrives. */
  unread: number;
}

/** Mirrors notificationSentence() in src/lib/notifications.ts. */
export function sentence(kind: string, detail: string | null, actor: string | null) {
  const who = actor || "Someone";
  const moved = detail ? ` and moved it to ${detail}` : "";
  switch (kind) {
    case "assigned": return `${who} assigned you${moved}`;
    case "mentioned": return `${who} mentioned you${moved}`;
    case "commented": return `${who} commented`;
    case "status_changed": return `${who} moved it to ${detail || "a new status"}`;
    case "test": return "Notifications are working on this device.";
    default: return "Something changed";
  }
}

/** Mirrors excerpt() in src/lib/notifications.ts: a comment's words, flat and short. */
export function excerpt(html: string | null, max = 140) {
  const flat = String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function pushMessage(n: PushNotification, unread: number): PushMessage {
  const line = sentence(n.kind, n.detail, n.actor?.full_name?.trim() || null);
  // A comment's words come along for a mention or a comment: the payload is
  // encrypted to the device, so the push service never reads them.
  const said = n.kind === "mentioned" || n.kind === "commented" ? excerpt(n.comment?.body ?? null) : "";
  return {
    id: n.id,
    title: n.issue ? `${n.issue.key} · ${n.issue.title}` : "Elevance Work",
    body: said ? `${line}: “${said}”` : line,
    // ?issue= opens the issue over whatever page is showing (the dashboard,
    // when the app was closed).
    path: n.issue ? `#/dashboard?issue=${encodeURIComponent(n.issue.key)}` : "#/dashboard",
    tag: n.issue_id ?? `test-${n.id}`,
    unread,
  };
}
