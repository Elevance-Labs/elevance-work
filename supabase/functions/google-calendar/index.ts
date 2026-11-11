// Your own Google Calendar, read-only, in the app: where meetings come from.
//
// Called by the browser with the user's session (JWT verified). Each person
// connects once: the app re-runs Google sign-in asking for read-only Calendar
// access offline, and hands the Google refresh token to `connect`. It is kept
// in calendar_connections (service role only), AES-GCM encrypted with
// GOOGLE_TOKEN_KEY, and only ever used to read that person's own primary
// calendar. Nothing about anyone's calendar is stored.
//
// Actions:
//   connect     { refresh_token }  check it's the caller's own Google account, keep it
//   events      { time_min, time_max } (ISO instants)  the caller's events, or { connected: false }
//
// There is deliberately no disconnect: once connected, a calendar stays
// connected. The row goes only when Google stops accepting the grant (revoked
// at Google, or expired) or the person is deactivated.
//
// Deploy with:  supabase functions deploy google-calendar
// Env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (the OAuth client
// Supabase Auth's Google provider uses), GOOGLE_TOKEN_KEY (a long random
// string), optional APP_ORIGIN (CORS).
import { adminClient, corsHeaders, json, userClient, type Admin } from "../_shared/google.ts";

const CALENDAR = "https://www.googleapis.com/calendar/v3";
// Mirrored by MAX_RANGE_DAYS in src/lib/googleCalendar.ts.
const MAX_RANGE_DAYS = 100;

// ---------------------------------------------------------------------------
// The refresh token at rest
// ---------------------------------------------------------------------------

let cryptoKey: CryptoKey | null = null;
async function tokenKey() {
  if (cryptoKey) return cryptoKey;
  const secret = Deno.env.get("GOOGLE_TOKEN_KEY");
  if (!secret || secret.length < 32) throw new Error("GOOGLE_TOKEN_KEY is not set (at least 32 characters)");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  cryptoKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return cryptoKey;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function seal(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(), new TextEncoder().encode(plain)));
  return `${toBase64(iv)}.${toBase64(sealed)}`;
}

async function open(stored: string) {
  const [iv, sealed] = stored.split(".").map(fromBase64);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await tokenKey(), sealed));
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

class RevokedError extends Error {}
// Google refused for a reason the person can't fix by connecting again.
class SetupError extends Error {}

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

// Access tokens, per person, until a minute before they expire.
const accessTokens = new Map<string, { token: string; expires: number }>();

async function accessToken(profileId: string, refreshToken: string) {
  const cached = accessTokens.get(profileId);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "",
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    // The person revoked access in their Google account, or it lapsed.
    if (response.status === 400 && text.includes("invalid_grant")) throw new RevokedError();
    throw new Error(`Google token refresh failed: ${response.status} ${text}`);
  }
  const { access_token, expires_in } = await response.json();
  accessTokens.set(profileId, { token: access_token, expires: Date.now() + expires_in * 1000 });
  return access_token as string;
}

async function google(token: string, path: string) {
  const response = await fetch(`${CALENDAR}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.ok) return response.json();
  const text = await response.text();
  console.error(`google-calendar: GET ${path}: ${response.status} ${text}`);
  // The Calendar API isn't switched on in the OAuth client's Google Cloud project.
  if (response.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used/.test(text))
    throw new SetupError("The Google Calendar API isn't enabled for the app's Google sign-in. Ask an admin to enable it in Google Cloud.");
  if (response.status === 401 || response.status === 403) throw new RevokedError();
  throw new Error(`Calendar GET ${path}: ${response.status} ${text}`);
}

/** Whose grant this is, and whether it covers the calendar (from Google itself, over TLS). */
async function grantInfo(token: string) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new RevokedError();
  const info = await response.json();
  return {
    email: typeof info.email === "string" ? info.email : "",
    calendar: String(info.scope ?? "").split(" ").includes(CALENDAR_SCOPE),
  };
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  eventType?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  htmlLink?: string;
  hangoutLink?: string;
  location?: string;
  description?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string; resource?: boolean }[];
}

// Enough of the guest list for the meeting's dialog.
const MAX_ATTENDEES = 50;

/** Google's description is a little HTML; the app shows it as plain text. */
function plainText(html: string | undefined) {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
  return text ? text.slice(0, 5000) : null;
}

/** Google's all-day end date is exclusive; the app's are inclusive. */
function dayBefore(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** What the app shows of an event; cancelled, declined and working-location entries are left out. */
function shape(e: GoogleEvent) {
  if (e.status === "cancelled" || !e.start || !e.end) return null;
  if (e.eventType === "workingLocation") return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) return null;
  const allDay = !!e.start.date;
  return {
    id: e.id,
    title: e.summary?.trim() || "(No title)",
    all_day: allDay,
    start_date: allDay ? e.start.date! : null,
    end_date: allDay ? dayBefore(e.end.date ?? e.start.date!) : null,
    starts_at: allDay ? null : e.start.dateTime!,
    ends_at: allDay ? null : e.end.dateTime!,
    url: e.htmlLink?.startsWith("https://") ? e.htmlLink : null,
    meeting_url: e.hangoutLink?.startsWith("https://") ? e.hangoutLink : null,
    location: e.location ?? null,
    description: plainText(e.description),
    organizer: e.organizer?.email ? { email: e.organizer.email, name: e.organizer.displayName ?? null } : null,
    attendees: (e.attendees ?? []).filter((a) => a.email && !a.resource).slice(0, MAX_ATTENDEES).map((a) => ({
      email: a.email!,
      name: a.displayName ?? null,
      response: a.responseStatus ?? "needsAction",
    })),
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function connect(admin: Admin, me: string, body: Record<string, unknown>) {
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!refreshToken) return json({ error: "Google didn't grant calendar access. Try connecting again." }, 400);

  const { data: profile } = await admin.from("profiles").select("email").eq("id", me).single();
  accessTokens.delete(me);
  let calendarId: string;
  try {
    const token = await accessToken(me, refreshToken);
    const grant = await grantInfo(token);
    if (!grant.calendar) {
      accessTokens.delete(me);
      return json({ error: "Google didn't grant calendar access. Connect again, and leave “See events on all your calendars” ticked." }, 400);
    }
    calendarId = grant.email;
    // Reading one event proves the grant works before it is kept.
    await google(token, "/calendars/primary/events?maxResults=1&fields=kind");
  } catch (e) {
    accessTokens.delete(me);
    if (e instanceof SetupError) return json({ error: e.message }, 502);
    if (e instanceof RevokedError) return json({ error: "Google didn't grant calendar access. Try connecting again." }, 400);
    throw e;
  }
  if (!profile || !calendarId || calendarId.toLowerCase() !== String(profile.email).toLowerCase()) {
    accessTokens.delete(me);
    return json({ error: `Connect the Google account you sign in with (${profile?.email ?? "your company account"}).` }, 400);
  }

  const { error } = await admin.from("calendar_connections").upsert({
    profile_id: me,
    google_email: calendarId,
    refresh_token: await seal(refreshToken),
    connected_at: new Date().toISOString(),
  });
  if (error) throw error;
  return json({ connected: true, email: calendarId });
}

async function forget(admin: Admin, me: string) {
  accessTokens.delete(me);
  await admin.from("calendar_connections").delete().eq("profile_id", me);
}

async function events(admin: Admin, me: string, body: Record<string, unknown>) {
  const min = new Date(String(body.time_min ?? ""));
  const max = new Date(String(body.time_max ?? ""));
  if (isNaN(min.getTime()) || isNaN(max.getTime()) || max <= min || max.getTime() - min.getTime() > MAX_RANGE_DAYS * 86_400_000)
    return json({ error: "That date range isn't one the calendar can show." }, 400);

  const { data: row } = await admin.from("calendar_connections").select("google_email, refresh_token").eq("profile_id", me).maybeSingle();
  if (!row) return json({ connected: false });

  try {
    const token = await accessToken(me, await open(row.refresh_token));
    const params = new URLSearchParams({
      timeMin: min.toISOString(),
      timeMax: max.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "500",
      fields: "items(id,status,summary,eventType,start,end,htmlLink,hangoutLink,location,description,organizer(email,displayName)," +
        "attendees(email,displayName,self,responseStatus,resource))",
    });
    const data = await google(token, `/calendars/primary/events?${params}`);
    const items = ((data.items ?? []) as GoogleEvent[]).map(shape).filter((e) => e !== null);
    return json({ connected: true, email: row.google_email, events: items });
  } catch (e) {
    if (e instanceof SetupError) return json({ error: e.message }, 502);
    if (!(e instanceof RevokedError)) throw e;
    await forget(admin, me);
    return json({ connected: false, lapsed: true });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Sign in first" }, 401);
  const { data: me } = await userClient(authorization).rpc("current_profile_id");
  if (!me) return json({ error: "Sign in first" }, 401);
  const admin = adminClient();

  try {
    const body = await req.json();
    switch (body?.action) {
      case "connect":
        return await connect(admin, me as string, body);
      case "events":
        return await events(admin, me as string, body);
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("google-calendar:", e);
    return json({ error: "Google Calendar isn't reachable right now. Try again, or ask an admin to check the set-up." }, 502);
  }
});
