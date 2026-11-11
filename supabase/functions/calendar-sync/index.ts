// Keeps the shared Google Calendar in step with the app's release dates,
// pushed one way, app → Google. The app is the source of truth; edits made in
// Google Calendar are overwritten on the next change. (Meetings live only in
// Google; the app keeps none of its own.)
//
// Called only by Postgres through pg_net (releases_after_write) with
// { kind, id } — or, for a deletion, the Google event id as well, since the
// row is gone. { kind: "event", deleted: true } only removes a copy of one of
// the app's former calendar events (queued when they were dropped).
//
// Google event ids are derived from the row id ("rl" + the uuid's hex, which
// is valid base32hex), so a create and a quick edit arriving out of order
// can't make two copies: whichever lands first creates it, the other updates
// it.
//
// Deploy with:  supabase functions deploy calendar-sync --no-verify-jwt
// Env: GOOGLE_SERVICE_ACCOUNT, GOOGLE_CALENDAR_ID (the shared calendar, which
// the service account may "Make changes to events" on),
// FUNCTIONS_SHARED_SECRET, APP_BASE_URL.
import { adminClient, appUrl, fromDatabase, googleAccessToken, json, type Admin } from "../_shared/google.ts";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

const googleId = (prefix: "ev" | "rl", id: string) => prefix + id.replace(/-/g, "");

async function calendar(path: string, init: RequestInit = {}) {
  const token = await googleAccessToken(SCOPES);
  const calendarId = encodeURIComponent(Deno.env.get("GOOGLE_CALENDAR_ID") ?? "");
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Update the event, or create it with its derived id. A cancelled one is revived. */
async function upsert(id: string, body: Record<string, unknown>) {
  const payload = JSON.stringify({ ...body, id, status: "confirmed" });
  let res = await calendar(`/${id}`, { method: "PUT", body: payload });
  if (res.status === 404) res = await calendar("", { method: "POST", body: payload });
  if (!res.ok) throw new Error(`Calendar refused ${id}: ${res.status} ${await res.text()}`);
}

async function remove(id: string) {
  const res = await calendar(`/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Calendar refused to delete ${id}: ${res.status} ${await res.text()}`);
  }
}

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!fromDatabase(req)) return json({ error: "Unauthorized" }, 401);
  if (!Deno.env.get("GOOGLE_CALENDAR_ID")) return json({ ok: true, skipped: "no calendar configured" });

  let body: { kind?: string; id?: string; deleted?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request" }, 400);
  }
  const id = String(body.id ?? "");
  const admin = adminClient();
  try {
    if (body.kind === "event") {
      if (!body.deleted) return json({ ok: true, skipped: "the app has no calendar events" });
      await remove(googleId("ev", id));
      return json({ ok: true });
    }
    if (body.kind === "release") {
      return body.deleted ? (await remove(googleId("rl", id)), json({ ok: true })) : await syncRelease(admin, id);
    }
    return json({ error: "Unknown kind" }, 400);
  } catch (e) {
    console.error("calendar-sync:", e);
    return json({ error: "Calendar sync failed" }, 502);
  }
});

// A release is an all-day entry on its release date while it is planned or
// released; archived, or without a date, it comes off the calendar.
async function syncRelease(admin: Admin, id: string) {
  const { data: r } = await admin.from("releases")
    .select("name, description, release_date, status, google_event_id, projects!inner(key, name)").eq("id", id).maybeSingle();
  if (!r) return json({ ok: true, skipped: "gone" });
  const gid = googleId("rl", id);
  const project = r.projects as unknown as { key: string; name: string };

  if (!r.release_date || r.status === "archived") {
    await remove(gid);
    if (r.google_event_id) await admin.from("releases").update({ google_event_id: null }).eq("id", id);
    return json({ ok: true });
  }
  await upsert(gid, {
    summary: `${r.status === "released" ? "Released" : "Release"}: ${project.name} ${r.name}`,
    description: [r.description, appUrl(`/projects/${project.key}/releases/${id}`)].filter(Boolean).join("\n\n"),
    start: { date: r.release_date },
    end: { date: nextDay(r.release_date) },
    transparency: "transparent",
    extendedProperties: { private: { workReleaseId: id } },
  });
  if (r.google_event_id !== gid) await admin.from("releases").update({ google_event_id: gid }).eq("id", id);
  return json({ ok: true });
}
