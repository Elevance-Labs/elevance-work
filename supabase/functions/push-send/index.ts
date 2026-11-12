// Delivers notifications to people's devices (Web Push).
//
// Called only by Postgres, through pg_net (`notifications_push` in the
// schema), once per write that causes notifications (`notify_people` writes
// them in one statement), with every new row's id. Everything else is read here with service_role (the notification, its
// issue, who caused it, the comment it is about, and the devices of the person
// it is for), so the database sends ids, not content.
//
// Each device gets one encrypted message (webpush.ts): only that browser can
// read it, not the push service carrying it. A device the push service says is
// gone (404/410: the app uninstalled, permission withdrawn, the subscription
// expired) is deleted, so it is never tried again.
//
// Deploy with:  supabase functions deploy push-send --no-verify-jwt
// Env: FUNCTIONS_SHARED_SECRET (= Vault `functions_secret`), and
//   VAPID_PUBLIC_KEY   base64url, 65 bytes: the same value as the app's VITE_VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY  base64url, 32 bytes
//   VAPID_SUBJECT      mailto: or https:, who the push services contact
// `yarn vapid-keys` prints a fresh pair.
import { adminClient, fromDatabase, json } from "../_shared/google.ts";
import { pushMessage, type PushNotification } from "./message.ts";
import { sendPush } from "./webpush.ts";

interface Row extends PushNotification { recipient_id: string }
interface Device { id: string; profile_id: string; endpoint: string; p256dh: string; auth: string }

/** At most `limit` at once: a push service throttles a sender that floods it. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!fromDatabase(req)) return json({ error: "Unauthorized" }, 401);

  const vapid = {
    publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
    privateKey: Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
    subject: Deno.env.get("VAPID_SUBJECT") ?? "",
  };
  // Not configured: the notifications are in the app; nothing goes to devices.
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) return json({ sent: 0, skipped: "vapid_not_configured" });

  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.notification_ids)
      ? body.notification_ids.filter((x: unknown): x is string => typeof x === "string")
      : [];
  } catch {
    return json({ error: "Malformed request" }, 400);
  }
  if (!ids.length) return json({ sent: 0 });

  const admin = adminClient();
  const { data: rows, error } = await admin.from("notifications")
    .select(`id, recipient_id, kind, detail, issue_id,
      actor:profiles!notifications_actor_id_fkey(full_name),
      comment:comments(body),
      issue:issues(key, title)`)
    .in("id", ids.slice(0, 500));
  if (error) return json({ error: error.message }, 500);
  const notifications = (rows ?? []) as unknown as Row[];
  const recipients = [...new Set(notifications.map((n) => n.recipient_id))];
  if (!recipients.length) return json({ sent: 0 });

  const [{ data: devices }, { data: unreadRows }] = await Promise.all([
    admin.from("push_subscriptions").select("id, profile_id, endpoint, p256dh, auth").in("profile_id", recipients),
    // What each person's app icon counts once this arrives.
    admin.from("notifications").select("recipient_id").in("recipient_id", recipients).is("read_at", null).limit(20000),
  ]);
  const unread = new Map<string, number>();
  for (const r of unreadRows ?? []) unread.set(r.recipient_id, (unread.get(r.recipient_id) ?? 0) + 1);

  const jobs = notifications.flatMap((n) =>
    ((devices ?? []) as Device[]).filter((d) => d.profile_id === n.recipient_id).map((d) => ({ n, d })));

  const gone: string[] = [];
  const used: string[] = [];
  let sent = 0;
  await eachLimited(jobs, 8, async ({ n, d }) => {
    try {
      const status = await sendPush(d, pushMessage(n, unread.get(n.recipient_id) ?? 0), vapid, {
        // A mention or an assignment is somebody waiting on you.
        urgency: n.kind === "mentioned" || n.kind === "assigned" ? "high" : "normal",
        topic: n.issue_id?.replace(/-/g, ""),
      });
      if (status === 404 || status === 410) gone.push(d.id);
      else if (status >= 200 && status < 300) { sent++; used.push(d.id); }
      // pg_net has long since returned; this log is the only record it failed.
      else console.error(`push-send: ${status} from ${new URL(d.endpoint).host}`);
    } catch (err) {
      console.error(`push-send: ${(err as Error).message}`);
    }
  });

  if (gone.length) await admin.from("push_subscriptions").delete().in("id", [...new Set(gone)]);
  if (used.length) {
    await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", [...new Set(used)]);
  }
  return json({ sent, removed: gone.length });
});
