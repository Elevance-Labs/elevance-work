// Google Drive for the app: issue attachments, Google Docs/Sheets/Slides made
// from a project, and the project's folder.
//
// Called by the browser with the user's session (JWT verified), so every
// action first asks the database — as that user — whether they may do it
// (`can_view_issue`, `can_edit_issue`, `can_edit_project`…); only then does it
// touch Drive and write with service_role. Attachments rows are written only
// here.
//
// Layout in the shared drive:
//   DRIVE_ROOT_FOLDER_ID / "<KEY> · <project name>" / "<ISSUE-KEY>" / files
//   DRIVE_ROOT_FOLDER_ID / "<KEY> · <project name>" / docs made from the app
//
// Deploy with:  supabase functions deploy drive
// Env: GOOGLE_SERVICE_ACCOUNT, DRIVE_ROOT_FOLDER_ID, optional DRIVE_SHARE_DOMAIN
// (e.g. elevancelabs.com: new files are also shared with the whole domain, for
// people who aren't members of the shared drive), optional APP_ORIGIN (CORS).
import { adminClient, corsHeaders, googleAccessToken, json, userClient, type Admin } from "../_shared/google.ts";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const SCOPES = ["https://www.googleapis.com/auth/drive"];
const FOLDER = "application/vnd.google-apps.folder";
// Mirrored by ATTACHMENT_MAX_BYTES in src/lib/drive.ts.
const MAX_BYTES = 25 * 1024 * 1024;

const DOC_MIME: Record<string, string> = {
  document: "application/vnd.google-apps.document",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  presentation: "application/vnd.google-apps.presentation",
};

type User = ReturnType<typeof userClient>;

async function drive(path: string, init: RequestInit = {}, base = DRIVE) {
  const token = await googleAccessToken(SCOPES);
  const url = `${base}${path}${path.includes("?") ? "&" : "?"}supportsAllDrives=true`;
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Drive ${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  return response;
}

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

async function createFolder(name: string, parent: string) {
  const res = await drive("/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
  });
  return (await res.json()).id as string;
}

async function shareWithDomain(fileId: string, role: "reader" | "writer") {
  const domain = Deno.env.get("DRIVE_SHARE_DOMAIN");
  if (!domain) return;
  await drive(`/files/${fileId}/permissions?sendNotificationEmail=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "domain", domain, role }),
  });
}

/**
 * The project's folder, made on first use. Two first uploads at once may both
 * make one; the conditional update keeps the first and the loser is trashed.
 */
async function projectFolder(admin: Admin, projectId: string) {
  const { data: project, error } = await admin
    .from("projects").select("key, name, drive_folder_id").eq("id", projectId).single();
  if (error || !project) throw new Error("Project not found");
  if (project.drive_folder_id) return project.drive_folder_id as string;

  const root = Deno.env.get("DRIVE_ROOT_FOLDER_ID");
  if (!root) throw new Error("DRIVE_ROOT_FOLDER_ID is not set");
  const id = await createFolder(`${project.key} · ${project.name}`, root);
  const { data: won } = await admin
    .from("projects").update({ drive_folder_id: id }).eq("id", projectId).is("drive_folder_id", null).select("id");
  if (won?.length) return id;
  await drive(`/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"trashed":true}' });
  const { data: again } = await admin.from("projects").select("drive_folder_id").eq("id", projectId).single();
  return again!.drive_folder_id as string;
}

/** The issue's folder inside its project's folder, found by name or made. */
async function issueFolder(admin: Admin, projectId: string, issueKey: string) {
  const parent = await projectFolder(admin, projectId);
  const q = `name = ${quote(issueKey)} and ${quote(parent)} in parents and mimeType = '${FOLDER}' and trashed = false`;
  const res = await drive(`/files?q=${encodeURIComponent(q)}&fields=files(id)&includeItemsFromAllDrives=true`);
  const found = (await res.json()).files?.[0]?.id as string | undefined;
  return found ?? createFolder(issueKey, parent);
}

async function allowed(user: User, fn: string, args: Record<string, string>) {
  const { data, error } = await user.rpc(fn, args);
  return !error && data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Sign in first" }, 401);
  const user = userClient(authorization);
  const { data: me } = await user.rpc("current_profile_id");
  if (!me) return json({ error: "Sign in first" }, 401);
  const admin = adminClient();

  try {
    if ((req.headers.get("Content-Type") ?? "").startsWith("multipart/form-data")) {
      return await upload(admin, user, me as string, await req.formData());
    }
    const body = await req.json();
    switch (body?.action) {
      case "download":
        return await download(admin, user, String(body.attachment_id));
      case "delete_attachment":
        return await deleteAttachment(admin, user, me as string, String(body.attachment_id));
      case "create_doc":
        return await createDoc(admin, user, me as string, body);
      case "project_folder":
        return await openProjectFolder(admin, user, String(body.project_id));
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("drive:", e);
    return json({ error: "Google Drive didn't accept that. Try again, or ask an admin to check the set-up." }, 502);
  }
});

async function upload(admin: Admin, user: User, me: string, form: FormData) {
  const issueId = String(form.get("issue_id") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "Files can be at most 25 MB." }, 413);
  if (!(await allowed(user, "can_edit_issue", { p_issue: issueId }))) {
    return json({ error: "You can't add files to this issue." }, 403);
  }
  const { data: issue } = await admin.from("issues").select("key, project_id").eq("id", issueId).single();
  if (!issue) return json({ error: "Issue not found" }, 404);
  // A file added with a comment: only to your own comment, on this issue.
  const commentId = String(form.get("comment_id") ?? "") || null;
  if (commentId) {
    const { data: comment } = await admin.from("comments").select("author_id")
      .eq("id", commentId).eq("issue_id", issueId).maybeSingle();
    if (!comment || comment.author_id !== me) return json({ error: "You can only add files to your own comments." }, 403);
  }

  const folder = await issueFolder(admin, issue.project_id, issue.key);
  const boundary = `work-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [folder] });
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const res = await drive("/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Blob([head, await file.arrayBuffer(), tail]),
  }, UPLOAD);
  const created = await res.json();
  await shareWithDomain(created.id, "reader");

  const { data: row, error } = await admin.from("attachments").insert({
    issue_id: issueId,
    drive_file_id: created.id,
    file_name: created.name,
    mime_type: created.mimeType,
    size_bytes: Number(created.size ?? file.size),
    web_view_link: created.webViewLink,
    uploaded_by: me,
    comment_id: commentId,
  }).select().single();
  if (error) throw error;
  return json(row);
}

// The file's bytes, so the app can preview images without Drive cookies.
async function download(admin: Admin, user: User, attachmentId: string) {
  const { data: a } = await admin.from("attachments").select("issue_id, drive_file_id, mime_type")
    .eq("id", attachmentId).single();
  if (!a || !(await allowed(user, "can_view_issue", { p_issue: a.issue_id }))) {
    return json({ error: "Not found" }, 404);
  }
  const res = await drive(`/files/${a.drive_file_id}?alt=media`);
  return new Response(res.body, {
    headers: { ...corsHeaders, "Content-Type": a.mime_type, "Cache-Control": "private, max-age=300" },
  });
}

// The uploader, or a project admin. The file goes to the Drive trash, so it
// can still be recovered there.
async function deleteAttachment(admin: Admin, user: User, me: string, attachmentId: string) {
  const { data: a } = await admin.from("attachments")
    .select("id, issue_id, drive_file_id, uploaded_by, issues!inner(project_id)").eq("id", attachmentId).single();
  if (!a) return json({ error: "Not found" }, 404);
  const projectId = (a.issues as unknown as { project_id: string }).project_id;
  const mayDelete = a.uploaded_by === me || (await allowed(user, "can_admin_project", { p_project: projectId }));
  if (!mayDelete || !(await allowed(user, "can_view_issue", { p_issue: a.issue_id }))) {
    return json({ error: "Only the person who added it, or a project admin, can remove this file." }, 403);
  }
  await drive(`/files/${a.drive_file_id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: '{"trashed":true}',
  });
  await admin.from("attachments").delete().eq("id", attachmentId);
  return json({ ok: true });
}

async function createDoc(
  admin: Admin, user: User, me: string,
  body: { project_id?: string; issue_id?: string | null; title?: string; doc_type?: string; html?: string },
) {
  const projectId = String(body.project_id ?? "");
  const title = String(body.title ?? "").trim().slice(0, 200);
  const mimeType = DOC_MIME[String(body.doc_type)];
  if (!title || !mimeType) return json({ error: "A title and a document type are needed." }, 400);
  if (!(await allowed(user, "can_edit_project", { p_project: projectId }))) {
    return json({ error: "You can't add documents to this project." }, 403);
  }
  if (body.issue_id) {
    const { data: issue } = await admin.from("issues").select("id").eq("id", body.issue_id).eq("project_id", projectId)
      .maybeSingle();
    if (!issue) return json({ error: "That issue is not in this project." }, 400);
  }
  const folder = await projectFolder(admin, projectId);
  const metadata = JSON.stringify({ name: title, mimeType, parents: [folder] });
  // With HTML (release notes), Drive converts it into the new Doc's content.
  const html = body.doc_type === "document" && typeof body.html === "string" ? body.html.slice(0, 1_000_000) : null;
  const boundary = `work-${crypto.randomUUID()}`;
  const res = html
    ? await drive("/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`,
    }, UPLOAD)
    : await drive("/files?fields=id,webViewLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: metadata,
    });
  const created = await res.json();
  await shareWithDomain(created.id, "writer");

  const { data: row, error } = await admin.from("documents").insert({
    project_id: projectId,
    issue_id: body.issue_id || null,
    title,
    url: created.webViewLink,
    doc_type: body.doc_type,
    drive_file_id: created.id,
    created_by: me,
  }).select().single();
  if (error) throw error;
  return json(row);
}

async function openProjectFolder(admin: Admin, user: User, projectId: string) {
  if (!(await allowed(user, "can_view_project", { p_project: projectId }))) return json({ error: "Not found" }, 404);
  const id = await projectFolder(admin, projectId);
  return json({ url: `https://drive.google.com/drive/folders/${id}` });
}
