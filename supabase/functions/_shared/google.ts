// Shared by the Edge Functions: the Google service account's access token,
// the service-role client, and small HTTP helpers.
//
// GOOGLE_SERVICE_ACCOUNT is the service account's JSON key, pasted whole into
// the function secrets (`supabase secrets set GOOGLE_SERVICE_ACCOUNT="$(cat key.json)"`).
// The account needs no Workspace admin rights: it is a member (Content
// manager) of the shared drive that holds DRIVE_ROOT_FOLDER_ID, and has
// "Make changes to events" on the shared calendar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const cachedTokens = new Map<string, { token: string; expires: number }>();

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

function pemToPkcs8(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/**
 * An OAuth access token for the service account with these scopes, from a
 * self-signed JWT (RS256). Cached until a minute before it expires.
 */
export async function googleAccessToken(scopes: string[]) {
  const key = scopes.join(" ");
  const cached = cachedTokens.get(key);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT is not set");
  const account = JSON.parse(raw) as ServiceAccount;
  const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encodeJson({ alg: "RS256", typ: "JWT" })}.${encodeJson({
    iss: account.client_email,
    scope: key,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(unsigned)),
  );

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64url(signature)}`,
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
  const { access_token, expires_in } = await response.json();
  cachedTokens.set(key, { token: access_token, expires: Date.now() + expires_in * 1000 });
  return access_token as string;
}

/** The service_role client: RLS does not apply, so every caller checks access first. */
export const adminClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export type Admin = ReturnType<typeof adminClient>;

/** A client that acts as the signed-in caller, so the database's own rules decide. */
export const userClient = (authorization: string) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });

// The browser calls `drive` from the app's origin.
export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Compares in constant time, so a wrong secret can't be discovered a character
 * at a time by timing the response.
 */
export function secretMatches(given: string | null, expected: string) {
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * The functions Postgres calls (notify-chat, calendar-sync) are deployed with
 * --no-verify-jwt; this header, from Vault, is what authenticates the caller.
 */
export function fromDatabase(req: Request) {
  const secret = Deno.env.get("FUNCTIONS_SHARED_SECRET");
  return !!secret && secretMatches(req.headers.get("x-functions-secret"), secret);
}

/** The deployed app's address for an issue (the app uses a HashRouter). */
export const appUrl = (path: string) =>
  `${(Deno.env.get("APP_BASE_URL") ?? "").replace(/\/+$/, "")}/#${path}`;
