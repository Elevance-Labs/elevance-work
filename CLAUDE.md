# CLAUDE.md — Project Map for AI Agents

Orientation for an agent planning work in this repo. **Read this first; read code
second.** It is deliberately high-level: modules, roles, boundaries and rules —
never line-level detail. Anything granular belongs in the code or `README.md`
(the human-facing product and setup doc, which stays the source of truth for
behaviour).

---

## 1. What this is

- In-house **work tracker** for Elevance Labs (replaces Jira Software free tier).
  Sibling of `el-support` and `el-people`; same stack and conventions.
- Modules: **projects** (Scrum / Kanban), **issues** (types by level, custom
  fields, links, watchers, history), **board**, **backlog** and **sprints**,
  **timeline** (epics), **releases** (with notes), **summary**, **reports**, **docs** (Google Drive),
  **issue lists and saved filters**, **calendar** (meetings only from each
  person's own Google Calendar, read-only; beside them epics, issues,
  releases and todos; no app-made events; release dates pushed to the
  company Google Calendar; also a project tab), **todos** (yours plus the
  people you add; shown on their issue; optionally a project), **notes**
  (private; own labels; pinned to the dashboard; linked to a project and/or
  one Google meeting), **search** (Cmd/Ctrl+S) and **create** (Cmd/Ctrl+K),
  **dashboard** (the meeting now with its note; agenda, todos, issues,
  pinned notes), **notifications** (in-app, live; Google Chat), **admin**
  (people, issue types, workspace).
- Stack: **React 19 + Vite + MUI + TypeScript** on the front, **Supabase**
  (Postgres + RLS, Auth, Realtime, Edge Functions) behind it.
- Deployed as a static SPA to **GitHub Pages**; `HashRouter`.

## 2. Ground rules an agent must not break

- **Security is enforced in the database, not the UI.** `src/lib/permissions.ts`
  mirrors `role_in_project` and the policies; a UI change that grants access is
  not a feature until the SQL agrees, and `test/sql/` proves it.
- **The anon key is public.** Every table revokes `anon`; nothing is reachable
  without a bound, active profile.
- **Login is bound by company email.** `bind_profile` links an auth user to the
  active profile with that email (Google only). Role, email and access change
  only by a workspace admin (`profiles_guard`); the last active admin can't be
  removed.
- **Project access is one function.** `role_in_project` (workspace admin → admin
  everywhere; else membership; open project → viewer; archived → viewer at
  most). Policies use `can_view_project` / `can_edit_project` /
  `can_admin_project` / `can_view_issue` / `can_edit_issue`. Never inline a new
  rule in a policy.
- **Business rules live in triggers.** `issues_guard` numbers issues, fills
  defaults, enforces the hierarchy, sprint, release and assignee rules, checks
  custom values (`issue_custom_clean`) and stamps `resolved_at`.
  `issues_after_write` writes history, watchers, notifications and Chat calls.
  Client checks are a convenience.
- **Some state changes only through RPCs.** Projects are created only by
  `project_create`; a sprint's state only by `sprint_start` / `sprint_complete`
  (which also write `sprint_issues`); status / field order only by
  `project_statuses_reorder` / `fields_reorder`; leaving someone else's
  todo only by `todo_leave`; ranks renumber via
  `project_rerank`.
- **Some rows are written only by Edge Functions (service role).**
  `calendar_connections` (no client grants at all: encrypted Google refresh
  tokens, used only for their owner's own calendar), `attachments`,
  `projects.drive_folder_id`, `releases.google_event_id`, documents with a `drive_file_id`, and
  `issue_dev_links` (the `github` function; no client write grants). History
  (`issue_events`), `sprint_issues` and `notifications` only by triggers / RPCs.
- **Column grants are the write allow-list.** A new column is not writable from
  the app until added to the `grant insert / update (...)` list — and must not be
  if clients mustn't set it.
- **Internal functions are never callable by clients.** The init migration
  revokes execute on every function and grants back only the RLS helpers and
  RPCs. Supabase grants execute on new functions by default: every migration
  that adds one must revoke it (`call_function` carries the functions' shared
  secret).
- **Meetings are Google's, never the app's.** There is no events table and
  nothing in the app creates a calendar event; meetings are read per person
  through `google-calendar` and never stored (a note keeps the meeting's id,
  title and day). Don't reintroduce app-owned calendar events.
- **Google is never in the write path.** The database queues Chat / Calendar
  calls through pg_net (`call_function`, a no-op until the Vault secrets exist,
  and never raises). Webhook URLs are bearer secrets: only project / workspace
  admins read them; functions read them with service role.
- **Stored HTML is untrusted.** Descriptions and comments are sanitised on save
  and on render (`lib/richText.ts`); only mention spans keep data attributes.
  Chat text is escaped in `notify-chat`.
- **One shell, three apps.** The theme (indigo, Roboto, bold `h5` titles) and
  the layout (header: switcher, logo, account button with name and role;
  tinted current page; navigation that folds to a rail from **Collapse** at its
  foot, via `components/useNavCollapsed`, one localStorage key shared by the
  apps) match Work, Support and People. A change to either belongs in all three.
- **One of three apps.** `lib/suite.ts` lists the suite (Work, Support,
  People), where each lives (the sibling folder, or `VITE_SUITE_*_URL`) and the
  `?sso=<company email>` hand-over; `components/AppSwitcher` is the grid icon
  before the logo. `AuthProvider` takes the hint once at load, strips it from
  the address and, with no session, goes to Google with `login_hint` and no
  chooser. The hint is never trusted: binding decides who gets in.
- **Installable (PWA).** `vite.pwa.ts` (build plugin, no dependency) emits
  `manifest.webmanifest` and `sw.js`; `src/pwa.ts` registers it and
  `components/UpdatePrompt` offers a waiting build. The worker caches the
  app's own files only, **never a Supabase response**, and stays inside its
  own folder (sibling apps share the origin). Icons in `public/icons/`.
- **The built page locks itself down.** CSP is added at build time
  (`vite.config.ts`); the app refuses to run framed (`main.tsx`). New external
  hosts go in that policy; `script-src` is never widened. No `console` in `src/`.

## 3. Layout

| Path | Role |
|---|---|
| `src/pages/` | One file per route. Fetches its own data, owns page state. |
| `src/pages/home/` | Dashboard, Todos, Notes. |
| `src/pages/project/` | `ProjectLayout` (header, tabs, project context) and its tabs: Summary, Backlog, Board, Timeline, Calendar (`ProjectCalendar`), Issues, Releases, ReleaseDetail, Reports, Docs, Notes (yours), Settings. |
| `src/pages/admin/` | People, issue types, workspace settings (workspace admins). |
| `src/components/` | Shell, issue view, create dialog, pickers, cards, charts, docs list, rich text, `TodoList` (all, due, or one issue's; a todo's project picker), `SearchDialog` (Cmd/Ctrl+S), `CreateMenu` (the Create button and Cmd/Ctrl+K: 1 issue, 2 todo, 3 note). |
| `src/components/calendar/` | `CalendarView` (week / day / month, layers, period in the URL; the Calendar page and the project tab), `ItemDialogs` (a meeting with its guests and note, a release, a todo), `useItemDialog` (what a click opens: always a dialog; an issue via `?issue=`). |
| `src/components/issue/` | The issue view and its parts: comments (with their files), history, attachments (`AttachmentList`, shared with comments), relations (children, links), development (GitHub links, read-only). |
| `src/components/notes/` | `NotesBoard` (list, search, filters; pinned first; scoped to a project or to pinned ones: the notes page, the project tab, the dashboard), the note dialog (pin; unlink a meeting), `MeetingNote` (a meeting's one note, autosaved), the labels manager. |
| `src/auth/` | `AuthProvider` — session, profile binding, `isAdmin`. |
| `src/workspace/` | `WorkspaceProvider` (directory, types, projects, statuses, memberships, active sprints), `useProjectMeta` (per-project members, fields, sprints, releases; shared cache), `useGoogleCalendar` (your own Google Calendar for a range, optionally off; connect only, no disconnect), `issueEvents` (issue-changed bus), `itemEvents` (todo / note-changed bus). |
| `src/lib/` | Pure rules and the Supabase client (see §6). |
| `supabase/migrations/` | Ordered, timestamped changes, applied by `supabase db push`. |
| `supabase/schema.sql` | The **whole current database** in one file. Kept in step with the migrations. |
| `supabase/functions/` | Edge Functions: `drive`, `google-calendar`, `notify-chat`, `calendar-sync`, `github` (GitHub's webhook; its `parse.ts` is pure and read by the browser tests); `_shared/google.ts`. |
| `scripts/` | `check-schema.sh`, `test-sql.sh`, `pg-sandbox.sh` (throwaway Postgres). |
| `test/` | Browser tests (jsdom + in-memory Supabase mock) and `test/sql/` (database tests). |
| `.github/workflows/deploy.yml` | Lint, typecheck, tests, SQL tests, schema check, build, deploy. |

## 4. Routes and pages

- No session → `Login` (Google only). After binding, everything sits inside
  `WorkspaceProvider` and `Layout`.
- `/dashboard` (landing), `/issues` (filters in the URL), `/calendar`
  (`?view=day|week&date=`, or `?month=`; week by default), `/todos`, `/notes` (`?q=&label=&color=&project=`; `?note=ID` opens one), `/projects`,
  `/browse/:key` — everyone.
- `/projects/:key` → Summary; `/backlog` (Scrum only; Kanban redirects to
  board), `/board`, `/timeline`, `/calendar` (as `/calendar`), `/issues`, `/releases`, `/releases/:releaseId`,
  `/reports` (`?report=&sprint=`), `/docs`, `/notes` (your own), `/settings` (`?tab=`; project admins,
  others redirected). A project RLS hides reads as "no project you can see".
- `/admin/people`, `/admin/issue-types`, `/admin/workspace` — workspace admins;
  gated by not registering the routes in `src/App.tsx`, and hidden in the nav.
- `?issue=KEY` on any route opens the issue dialog (lazy, in `Layout`); the
  create dialog is opened through `useLayout().openCreate(defaults)`.
- `Layout` owns the shortcuts: Cmd/Ctrl+S opens search, Cmd/Ctrl+K (like the
  Create button) opens the Create chooser (both lazy); `openCreate` skips it
  for an issue with defaults. Search reads issues per keystroke and your todos, notes
  and the calendar once per opening.
- Unknown paths redirect to `/dashboard`.

## 5. Shared state

| Provider / module | Supplies | Scope |
|---|---|---|
| `AuthProvider` | `loading`, `profile`, `error`, `isAdmin`, `signIn`, `signOut`, `refreshProfile`; `useMe()` | Whole app |
| `WorkspaceProvider` | profiles, issue types, visible projects + statuses, my memberships, active sprints, lookups, `roleOf`, `reload` | Signed in |
| `useProjectMeta(projectId)` | members, fields, sprints, releases; `invalidateProjectMeta` after writes | Per project, cached |
| `issueEvents` | `emitIssueChange` / `useIssueChanges`: pages reload after the dialogs write | Signed in |
| `itemEvents` | `emitItemChange` / `useItemChanges` (todo, note): pages reload after Create, a meeting's note or a calendar todo writes | Signed in |
| `projectContext` | `useProject()` → project and your role | Project pages |
| `layoutContext` | `useLayout().openCreate` | Inside `Layout` |

- Other people's changes arrive by Supabase Realtime on the board
  (`issues`) and the bell (`notifications`).

## 6. Modules (`src/lib/`)

- `supabase.ts` — the shared client (PKCE, hash free for the router).
- `types.ts` — row shapes. Update with any column change.
- `constants.ts` — company, labels and colours for every enum, date and number
  formatting (plain dates as local `YYYY-MM-DD`), `errorMessage` (Postgres codes
  to words).
- `permissions.ts` — `roleIn` (mirror of `role_in_project`), `can.*`,
  `assignable`.
- `issues.ts` — select column lists, the client write shape, key parsing, ranks
  (`rankBetween` / `rankForIndex`; null → rerank), level and category helpers,
  label normalising.
- `filters.ts` — the filter model, URL / saved-filter forms, `applyFilter`
  (PostgREST query), `matchesFilter` (loaded rows), CSV.
- `fields.ts` — which custom fields apply to a type, required checks.
- `reports.ts` — history replay (`stateAt`), burndown, velocity, sprint report,
  created vs resolved, cumulative flow, breakdowns, workload, recent counts.
- `releases.ts` — progress and release notes (text and HTML).
- `timeline.ts` — the epic timeline: rows (an epic's own dates, or borrowed
  from its issues), the window of months drawn, placing a bar, dragging one.
- `devLinks.ts` — ordering an issue's GitHub links.
- `calendar.ts` — month grid, week days, the day timeline's blocks (`timedBlocks`), issues dated in a range
  (`datedWithin`), merging meetings / epics / issues / releases / todos (`calendarItems`), the meeting now
  (`currentMeeting`), a meeting's day and when.
- `drive.ts` — calls to the `drive` function (uploads, optionally for a comment); Google link kinds and preview URLs.
- `googleCalendar.ts` — connecting your Google Calendar (extra OAuth consent),
  handing the grant over after the redirect, calls to `google-calendar`.
- `richText.ts` — DOMPurify allow-list (mention spans, tables), mention ids, styles.
- `projects.ts` — project key format and suggestion.
- `search.ts` — search matching and order (todos, notes; a few per group),
  the Cmd/Ctrl shortcut test and label.
- `notes.ts` — note colours, the notes filter (URL form) and `matchesNote`
  (notes are filtered client-side: a person loads only their own), pinned-first order, meeting labels.

## 7. Data model (conceptual)

Full detail in `supabase/schema.sql`.

- `profiles` — who may sign in; `app_role` admin / member; `active`; bound by
  email. Everyone signed in reads all; admins write; you may rename yourself.
- `projects` (+ `project_members` with `project_role`) — key immutable,
  `issue_counter`, kind, visibility, lead, colour, Drive folder, archived.
- `project_statuses` — a project's workflow (position, category, WIP limit).
- `issue_types` — workspace-wide; `level` epic / standard / subtask.
- `fields` — a project's custom fields; values in `issues.custom` keyed by id.
- `project_integrations` / `workspace_settings` — Chat webhooks and wanted events.
- `sprints` — future → active → closed (one active per project); `sprint_issues`
  — committed / completed snapshot per sprint.
- `releases` — unreleased / released / archived; `released_at` stamped.
- `issues` — the issue; `key`, `rank`, `custom`, `search` (tsvector);
  `issue_events` — field-by-field history (names copied in);
  `issue_links`, `issue_watchers`, `comments`, `attachments` (a file added
  with a comment names it, on the same issue; kept if the comment goes),
  `documents`;
  `issue_dev_links` — GitHub branches, commits and pull requests naming the
  issue's key; read through `can_view_issue`, written only by `github`.
- `calendar_connections` — per person, service role only,
  dropped on deactivation; `todos` — the owner and `shared_with` people
  read and edit, only the owner deletes, leaving is `todo_leave`; `todos_guard`
  stamps the owner, keeps active people, ties only to visible issues / projects
  (an issue's todo takes the issue's project); `saved_filters` — private or shared;
  `notes` + `note_labels` — private to the owner even from admins; `notes_guard`
  stamps the owner, keeps only own labels and visible projects, and moves
  `updated_at` only on title / text; `pinned`; a meeting link is a Google event
  id (one note per person per meeting) with its title and day copied in;
  `notifications` — per recipient, only `read_at` writable.

## 8. How things connect

- Sign-in: Google OAuth (PKCE) → `bind_profile` → `WorkspaceProvider` loads.
- Issue write → `issues_guard` → row → `issues_after_write` → history, watchers,
  notifications, `chat_notify` → pg_net → `notify-chat` → project webhook
  (threadKey = issue key).
- Comment → `comments_after_write` → watchers, mentions, Chat.
- Your Google Calendar: Google sign-in asks the read-only calendar scope offline
  (`CALENDAR_SIGN_IN`; the calendar's and dashboard's Connect is the fallback) → back in `AuthProvider` (`takeCalendarGrant`) → next read
  hands the refresh token to `google-calendar` (`connect`: must be your own
  account, from Google's tokeninfo) → `events` reads your primary calendar (guests, organiser,
  plain-text description) → laid out by `calendarItems` (calendars, dashboard). Never stored, never
  shared. A meeting's dialog or the dashboard's Now panel → `MeetingNote` → a `notes` row keyed by
  the meeting's id.
- Release write → `releases_after_write` → pg_net → `calendar-sync` → the company
  Google Calendar (event ids derived from row ids) → writes back `google_event_id`
  (which doesn't re-trigger). `calendar-sync` also removes copies of the retired app events.
- GitHub: organisation webhook → `github` function (HMAC signature, no JWT)
  → keys found in branch names, commit messages, PR titles → upserts
  `issue_dev_links` for keys that are issues → issue view's Development.
- Attachment / new doc / project folder: browser → `drive` function (user JWT)
  → checks via user-scoped RPCs (`can_edit_issue`…; a comment's file also
  needs the comment to be yours) → Drive (service account, shared drive) →
  row written with service role. A comment's files upload after the
  comment is inserted.
- Pages talk to Supabase directly and turn Postgres errors into words via
  `errorMessage`.

## 9. Working in the repo

- **yarn** (v1) only. CI runs `yarn install --frozen-lockfile`.
- `yarn dev` · `yarn lint` (warnings fail) · `yarn typecheck` (app, tests,
  functions) · `yarn test` · `yarn test:sql` · `yarn check:schema` · `yarn build`.
- Browser tests (`test/`): scripts run by `vite-node` in jsdom with `TZ` pinned
  west of UTC; `test/mockSupabase.ts` replaces the client (fixtures, real
  filtering incl. `or` / `range` / `textSearch`, writes that stick, a few
  trigger mirrors, project visibility on select, recorded calls, `failNext`,
  `functions.invoke`, channels). It does **not** enforce RLS — `test/sql/` does.
  Router navigations are transitions: wait for the effect (`waitFor`), not a
  fixed delay.
- SQL tests (`test/sql/`): each file runs on a fresh copy of `_fixtures.sql`;
  `t.login(name)` acts as that person under `authenticated`; assertions in
  `_helpers.sql`. Vault and pg_net are stubbed (`net.calls` records calls).
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (`.env.example`); function
  secrets and Vault secrets in `README.md`.

## 10. Changing the database

Every schema change is **three edits in the same change**:

1. A **new migration** in `supabase/migrations/`, `YYYYMMDDHHMMSS_<what>.sql`,
   opening with a comment that says what changes and why. Never edit a shipped
   migration.
2. The **same end state folded into `supabase/schema.sql`**, as if it had always
   been that way. One-off data moves stay in the migration only.
3. `src/lib/types.ts` for any column change.

Then `yarn check:schema` and `yarn test:sql` must pass (say so if Postgres isn't
available). Add SQL tests for any new rule, and mock support plus browser tests
for anything the app calls.

Per migration: grants for new columns, RLS on new tables (`revoke all … from
anon, authenticated` first), `set search_path = ''` and schema-qualified names
in functions, `revoke execute … from public, anon, authenticated` on new
functions, then grant back only what clients call.

---

## 11. Keeping the docs current

**`CLAUDE.md`, `README.md`, `supabase/schema.sql` and the tests ship in the
same change as the code they describe.** Before calling a change done:
`yarn lint`, `yarn typecheck`, `yarn test`, and for a database change
`yarn test:sql` and `yarn check:schema`.

Update **`README.md`** when a change alters anything a person using, setting
up or deploying the app would notice.

Update **`CLAUDE.md`** when a change adds, removes or renames a route, page,
provider, lib module or shared component; changes the role matrix or where a
rule is enforced; reshapes a table, function or Edge Function; changes build,
check or deploy commands or env vars; or changes how modules connect. Keep it
pointers, not prose; never paste code, signatures or column lists here.
