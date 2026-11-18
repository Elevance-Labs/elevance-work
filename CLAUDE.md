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
  fields, links, watchers, history, flags: held up, with a reason, tinted
  everywhere listed), **board**, **backlog** (quick filters; an Epics panel, E; rows selected and moved together) and **sprints**,
  **timeline** (epics), **releases** (rich-text notes on top, approvers
  who approve or reject, locked once approved; the Summary's outlook beside), **summary** (project intelligence: widgets a
  project's admins choose, incl. the classic reports; no Reports tab), **docs** (Google Drive),
  **project features** (admins turn off Timeline, Calendar, Issues, Board, Releases, Docs),
  **issue lists and saved filters** (pinned to the navigation per person), **calendar** (meetings only from each
  person's own Google Calendar, read-only; beside them epics, issues,
  releases and todos; no app-made events; release dates pushed to the
  company Google Calendar; also a project tab), **todos** (yours plus the
  people you add; shown on their issue; optionally a project; filed per
  person in an Inbox or private lists; Today / Tomorrow / This week views), **notes**
  (private; own labels; pinned to Home; linked to a project and/or
  one Google meeting), **search** (Cmd/Ctrl+S) and **create** (Cmd/Ctrl+K),
  **Home** (the meeting now with its note; agenda, todos, issues,
  pinned notes; on a phone a compact day view), **Work** (your project
  cards; My issues and Recent activity on what you watch), **notifications** (in-app, live; pushed to devices; Google
  Chat), **admin**
  (people, issue types, workspace; a header button, admins only).
- Navigation: the sidebar is Home, Calendar, Work, Todos, Notes, then
  Issues with your pinned views. Below `md` a bottom bar (`BottomNav`) holds
  Home, Work, Todos, Notes; the drawer keeps the full sidebar.
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
  most). Roles: admin (settings) › manager (releases; removing others' work)
  › member (edits) › viewer (reads, comments). Policies use `can_view_project` /
  `can_edit_project` / `can_manage_project` / `can_admin_project` /
  `can_view_issue` / `can_edit_issue`. Never inline a new rule in a policy.
- **Business rules live in triggers.** `issues_guard` numbers issues, fills
  defaults, enforces the hierarchy, sprint, release and assignee rules, checks
  custom values (`issue_custom_clean`), stamps `resolved_at` and a flag's
  who / when (a flag always has a reason).
  `issues_after_write` writes history, watchers, notifications and Chat calls,
  and posts a flag's change as a comment by the actor (whose own trigger
  notifies).
  A save's notifications go through `notify_people`: one statement (one
  `push-send` call per save), one per person (assigned > mentioned > status
  changed > commented; the save's new status in `detail`), as in Support.
  Don't add per-person inserts.
  Client checks are a convenience.
- **A project feature turned off only hides it.** `disabled_features` hides
  a tab and its UI (Releases off: the issue's Release field, release widgets,
  release dates on calendars); no data changes and nobody's access does. Check
  `featureOn` where a feature shows; never delete or null data for it.
- **Some state changes only through RPCs.** Projects are created only by
  `project_create`; a sprint's state only by `sprint_start` / `sprint_complete`
  (which also write `sprint_issues`); status / field order only by
  `project_statuses_reorder` / `fields_reorder`; leaving someone else's
  todo only by `todo_leave`; where a todo sits in your lists only by
  `todo_move` (`todo_places` has no client writes); ranks renumber via
  `project_rerank`; a release approver's decision only by `release_decide`,
  and back to pending by `release_request_approval` or an issue moving in or
  out of the release (`issues_release_changed`). `release_approvers_guard` and
  `releases_guard` keep an approved release locked and unreleasable until
  every approver approved.
- **Some rows are written only by Edge Functions (service role).**
  `calendar_connections` (no client grants at all: encrypted Google refresh
  tokens, used only for their owner's own calendar), `attachments`,
  `projects.drive_folder_id`, `releases.google_event_id`, documents with a `drive_file_id`, and
  `issue_dev_links` (the `github` function; no client write grants). History
  (`issue_events`), `sprint_issues` and `notifications` only by triggers / RPCs
  (`send_test_notification` is the one a person causes, to themselves).
  `push_subscriptions` only through `save_push_subscription` (which also hands
  a shared browser to whoever turned it on last); clients never read the keys.
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
  apps; the first load is the app's icon over a running bar, `Splash` in `components/common`)
  match Work, Support and People. A change to either belongs in all three.
  One exception for now: the phone bottom bar (`components/BottomNav`) and
  the Admin header button are Work's alone, to move to the siblings once
  settled.
- **Light, dark or system.** `theme.ts` has both colour schemes (no CSS
  variables, so `theme.palette` is the mode in use); `ThemeProvider` takes
  `themeSettings` (one localStorage key, `elevance.theme`, shared by the
  apps); `components/ThemeModeSwitch` is its control in the account menu.
  Colours come from the palette (`background.subtle` / `muted` for tints,
  `divider`, `text.*`); a fixed hex is for brand or data only, and a tint that
  must differ by mode uses `applyStyles('dark', …)` or `palette.mode`
  (note colours carry a dark shade in `lib/notes.ts`).
- **One of three apps.** `lib/suite.ts` lists the suite (Work, Support,
  People), where each lives (the sibling folder, or `VITE_SUITE_*_URL`) and the
  `?sso=<company email>` hand-over; `components/AppSwitcher` is the grid icon
  before the logo, hidden when running installed (`components/useStandalone`). `AuthProvider` takes the hint once at load, strips it from
  the address and, with no session, goes to Google with `login_hint` and no
  chooser. The hint is never trusted: binding decides who gets in.
- **Installable (PWA).** `vite.pwa.ts` (build plugin, no dependency) emits
  `manifest.webmanifest` and `sw.js`; `src/pwa.ts` registers it, keeps the
  browser's install offer, and `components/UpdatePrompt` offers a waiting build.
  `components/InstallApp` is the Install button (nav foot beside Collapse;
  a dismissible banner atop the phone navigation): the browser's dialog where
  it has one, else steps from `lib/install.ts`; hidden when running installed. The worker caches the
  app's own files only, **never a Supabase response**, and stays inside its
  own folder (sibling apps share the origin). It also shows pushes (always a
  notification: Safari revokes silent ones), sets the icon badge, and a tap
  only ever opens a page of this app. Icons in `public/icons/` (incl.
  `badge-96.png`, the status-bar silhouette). `index.html`'s viewport keeps
  `viewport-fit=cover` (without it iOS reports every safe-area inset as 0);
  fixed bars and sheets pad with `env(safe-area-inset-*)`.
- **The built page locks itself down.** CSP is added at build time
  (`vite.config.ts`); the app refuses to run framed (`main.tsx`). New external
  hosts go in that policy; `script-src` is never widened. No `console` in `src/`.

## 3. Layout

| Path | Role |
|---|---|
| `src/pages/` | One file per route. Fetches its own data, owns page state. |
| `src/pages/` (top) | `Work` (project cards, My issues / Recent activity, `?tab=`), Issues, Calendar, BrowseIssue, Login. |
| `src/pages/home/` | Dashboard (Home: wide panels, or `PhoneHome` below `md`), Todos, Notes. |
| `src/pages/project/` | `ProjectLayout` (header, tabs, project context) and its tabs: Summary, Backlog, Board, Timeline, Calendar (`ProjectCalendar`), Issues, Releases, ReleaseDetail, Docs, Settings (incl. Features); a tab whose feature is off is hidden. `NotesRedirect` (old `/notes` links). |
| `src/pages/admin/` | `AdminLayout` (tabs) over People, issue types, workspace settings (workspace admins). |
| `src/components/` | Shell (`Layout`; `BottomNav`, the phone's four tabs), `IssueRow` (one issue on a line, optional second line), `AssigneeFilter` (the avatar quick filter, board and backlog), `CreateProject`, `NotificationsBell` (feed; offers device notifications, says when they stopped), `NotificationSettings` (account menu: this device on / off / test, your devices), `usePushDevice` (this device's real state, checked with the server; `forgetPushDevice` on sign-out), `InstallApp` (install button, phone banner, steps), issue view, create dialog, pickers, cards, charts, docs list, rich text, `TodoList` (one view of a todo store: a list or smart view, what's due, or one issue's; the project and list pickers), `ThemeModeSwitch` (account menu: light / dark / system), `SearchDialog` (Cmd/Ctrl+S), `CreateMenu` (the Create button and Cmd/Ctrl+K: 1 issue, 2 todo, 3 note). |
| `src/components/home/` | Home's parts: `useAgenda` (meetings, releases, issues and todos due, overdue, noted meetings, ticking), `AgendaRow`, `NowPanel` / `NowCard` (the meeting now, wide / phone), `PhoneHome` (date line, meeting card with its note in a sheet, seven-day strip `?date=`, the day's agenda). |
| `src/components/calendar/` | `CalendarView` (week / day / month, layers, period in the URL; the Calendar page and the project tab), `ItemDialogs` (a meeting with its guests and note, a release, a todo), `useItemDialog` (what a click opens: always a dialog; an issue via `?issue=`). |
| `src/components/issue/` | `Flag` (the reason dialog, the flag button beside the issue's title: lit when flagged, opens why, edit, remove) and `flagging` (saving a flag, a card menu's Flag group, `flaggedSx`: the tint every list gives a flagged issue; `FlagMark` in `IssueBits` is its icon). The issue view (empty sections fold into quick-add buttons under the title; two columns from `lg` in the dialog and side panel alike, else one column in reading order; on a phone or in the side panel then a fixed top bar and comments / history as a sheet pinned to the foot; an unsaved description is kept as a draft, `lib/drafts`) and its parts: comments (with their files and thumbs up / down), history, attachments (`AttachmentList`, shared with comments), relations (children, links), development (GitHub links, read-only). |
| `src/components/todos/` | `TodoComposer` (the one-line add bar: icons for due day, issue, project, people, list that become chips; busy while saving, so Enter adds once), `TodoBits` (due-day and list menus), `useTodos` (load and write; filing through `todo_move`), `useTodoLists` (your lists). |
| `src/components/backlog/` | `Epics`: the backlog's Epics panel (filter by epic, open one, drop rows to move them there, create an epic), a row's epic chip, the menu that sets or removes it (one issue or a selection). |
| `src/components/releases/` | The release page's parts: `ReleaseNotesCard` (the notes on top: view, write with a draft from done issues, copy, Google Doc), `ApprovalPanel` (approvers, approve / reject, ask again). |
| `src/components/insights/` | The Summary's widgets, one file each (`registry` lazy-loads them; `lib/widgets` lists them), `useReleaseHealth` / `ReleaseOutlook` (one release's judgement, shared by the release widget and the release page), `WidgetFrame` (card, loads only near the screen, skeleton, error boundary), `useWidgetQuery` (per-widget load and error; a session cache keyed by project and parameters, shared requests deduped; `invalidateWidgets` after issue changes), `data` (shared narrow queries: recent finished work, status moves, open blockers, finished work for people), `parts` / `helpers` (verdict chip, period picker, links), `CustomizeDialog` (project admins). |
| `src/components/notes/` | `NotesBoard` (list, search, filters; pinned first; an Archived view; scoped to pinned ones or not: the notes page, the dashboard), the note dialog (saves itself after a pause and on close; pin; unlink a meeting; archive, then restore or delete), `MeetingNote` (a meeting's one note, autosaved), the labels manager. |
| `src/auth/` | `AuthProvider` — session, profile binding, `isAdmin`. |
| `src/workspace/` | `WorkspaceProvider` (directory, types, projects, statuses, memberships, active sprints), `notifications` (`NotificationsProvider`), `useProjectMeta` (per-project members, fields, sprints, releases; shared cache), `useGoogleCalendar` (your own Google Calendar for a range, optionally off; connect only, no disconnect), `issueEvents` (issue-changed bus), `itemEvents` (todo / note / view-changed bus), `usePinnedViews` (your pinned saved filters; `setPinned`). |
| `src/lib/` | Pure rules and the Supabase client (see §6). |
| `supabase/migrations/` | Ordered, timestamped changes, applied by `supabase db push`. |
| `supabase/schema.sql` | The **whole current database** in one file. Kept in step with the migrations. |
| `supabase/functions/` | Edge Functions: `drive`, `google-calendar`, `notify-chat`, `calendar-sync`, `github` (GitHub's webhook; its `parse.ts` is pure and read by the browser tests), `push-send` (Web Push; `webpush.ts` and `message.ts` are pure and read by the browser tests); `_shared/google.ts`. |
| `scripts/` | `check-schema.sh`, `test-sql.sh`, `pg-sandbox.sh` (throwaway Postgres), `vapid-keys.mjs`. |
| `test/` | Browser tests (jsdom + in-memory Supabase mock) and `test/sql/` (database tests). |
| `.github/workflows/deploy.yml` | Lint, typecheck, tests, SQL tests, schema check, build, deploy. |

## 4. Routes and pages

- No session → `Login` (Google only). After binding, everything sits inside
  `WorkspaceProvider` and `Layout`.
- `/dashboard` (Home, landing; on a phone `?date=`), `/work` (`?tab=activity`), `/issues` (filters in the URL), `/calendar`
  (`?view=day|week&date=`, or `?month=`; week by default), `/todos` (`?list=inbox|today|tomorrow|week|<list id>`), `/notes` (`?q=&label=&color=&project=&archived=1`; `?note=ID` opens one),
  `/browse/:key` — everyone. `/projects` redirects to `/work`.
- `/projects/:key` → Summary; `/backlog` (Scrum only; Kanban redirects to
  board), `/board`, `/timeline`, `/calendar` (as `/calendar`), `/issues`, `/releases`, `/releases/:releaseId`,
  `/docs`, `/settings` (`?tab=`; project admins,
  others redirected). A tab whose feature is off redirects to Summary (`lib/projectFeatures`).
  `/reports` redirects to Summary, `/notes` to `/notes?project=<id>`. A project RLS hides reads as "no project you can see".
- `/admin` (→ `/admin/people`), `/admin/issue-types`, `/admin/workspace` — workspace admins,
  under `AdminLayout`; gated by not registering the routes in `src/App.tsx`;
  reached from the header's Admin button (admins only).
- `?issue=KEY` on any route opens the issue (`IssueDialog`, lazy, in
  `Layout`): a dialog or a non-modal right-hand side panel, as the person
  chose from the issue (`profiles.issue_view`); a phone is always full
  screen. The create dialog is opened through `useLayout().openCreate(defaults)`.
- The account menu opens **Notifications** (`NotificationSettings`, lazy).
  `Layout` also follows a tapped device notification (the worker's `open`
  message): an issue opens over the current page, as from the bell.
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
| `itemEvents` | `emitItemChange` / `useItemChanges` (todo, note, view): pages reload after Create, a meeting's note or a calendar todo writes; the navigation after a pin | Signed in |
| `usePinnedViews` | your pinned saved filters (unreadable ones dropped); `setPinned` | Layout, Issues page |
| `NotificationsProvider` | `useNotifications()`: your latest notifications (Realtime, a push arriving, back to the front), unread count + app-icon badge, `markRead` / `markIssueRead` (the issue view, on open) / `markAllRead`; no-ops outside a provider | Signed in |
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
  `assignable`, `canApprove`.
- `issues.ts` — select column lists, the client write shape, key parsing, ranks
  (`rankBetween` / `rankForIndex`; null → rerank), level and category helpers,
  label normalising, history in words (`HISTORY_FIELD_LABELS`,
  `historyValue`, `activityLine`).
- `filters.ts` — the filter model, URL / saved-filter forms, `viewSearch`
  (a pinned view's normalised address), `applyFilter` (PostgREST query),
  `matchesFilter` (loaded rows), CSV.
- `fields.ts` — which custom fields apply to a type, required checks.
- `reports.ts` — history replay (`stateAt`), burndown, velocity, sprint report,
  created vs resolved, cumulative flow.
- `insights.ts` — the Summary's judgements and every threshold they use:
  work items, cycle time, throughput, Monte Carlo release forecast (seeded),
  release / sprint / epic verdicts, time in status, on time, people and
  leaderboard, needs attention.
- `widgets.ts` — the Summary's widgets (kinds, features needed, width), the
  defaults per kind, a project's layout and saving it.
- `projectFeatures.ts` — the features a project can turn off, `featureOn`,
  `canDisable` (one of Issues / Board stays), tab paths and links.
- `paging.ts` — `fetchAll` / `fetchByIds`: every row past PostgREST's
  1000-row cap, ids chunked for `in` filters.
- `releases.ts` — progress, days left (`releaseCountdown`, on the issue's
  Release field), the notes' draft from done issues and the written notes as
  text and HTML, approval state (`releaseApproval`: cleared, locked; mirrors
  `release_cleared` / `release_approved`).
- `drafts.ts` — unsaved text kept in the browser per person (an issue's
  description until saved or cancelled).
- `backlog.ts` — the backlog's quick filters (`matchesBacklog`, `NO_EPIC`),
  an epic's progress, the Epics panel's drop ids, selecting rows
  (`nextSelection`) and ranks for moving several together (`blockRanks`).
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
  the Cmd/Ctrl shortcut test and label, a page's one-letter shortcut
  (`isPlainKey`: not while typing or in a dialog or menu).
- `notifications.ts` — what a notification says (`notificationSentence`, a
  comment's `excerpt`), unread and badge counts. Wording mirrored in
  `push-send/message.ts`.
- `push.ts` — whether this device can have device notifications
  (`pushStatus`: on / off / blocked / install-first on iOS tabs / unsupported /
  unconfigured; "on" needs the server's confirmation), what the bell offers
  (`pushPrompt`, incl. *stopped*), VAPID key and subscription shapes, device
  labels. The browser calls are in `src/pwa.ts`.
- `install.ts` — the device and browser (`detectDevice`), running installed
  or in a tab (`isStandalone`), the install steps for each (`installGuide`).
- `todos.ts` — the todo views (Inbox, a list, Today / Tomorrow / This week:
  `inView`, `groupOpen`, `weekEnd`), the select with your own place, due-day
  words and quick picks, list colours, which smart views show (localStorage).
- `notes.ts` — note colours, the notes filter (URL form) and `matchesNote`
  (notes are filtered client-side: a person loads only their own), pinned-first order, meeting labels.

## 7. Data model (conceptual)

Full detail in `supabase/schema.sql`.

- `profiles` — who may sign in; `app_role` admin / member; `active`; bound by
  email. Everyone signed in reads all; admins write; you may rename yourself;
  `issue_view` (dialog or side panel) only its owner sets (`profiles_guard`).
- `projects` (+ `project_members` with `project_role`) — key immutable,
  `issue_counter`, kind, visibility, lead, colour, Drive folder, archived;
  `disabled_features` (checked: known names, not both Issues and Board) and
  `summary_widgets` (keys' shape only; null = the kind's default), both
  project admins'. Off only hides: data and access are unchanged.
- `project_statuses` — a project's workflow (position, category, WIP limit).
- `issue_types` — workspace-wide; `level` epic / standard / subtask.
- `fields` — a project's custom fields; values in `issues.custom` keyed by id.
- `project_integrations` / `workspace_settings` — Chat webhooks and wanted events.
- `sprints` — future → active → closed (one active per project); `sprint_issues`
  — committed / completed snapshot per sprint.
- `releases` — unreleased / released / archived; `released_at` stamped;
  `release_date` required; `notes` (rich text, public one day) beside the
  internal `description`; managers and admins write them.
  `release_approvers` — per release, who approves and their decision
  (pending / approved / rejected, with a comment); managers add and remove
  (not once decided), decisions only via RPC.
- `issues` — the issue; `key`, `rank`, `custom`, `search` (tsvector);
  `flag_reason` (null: not flagged; `flagged_by` / `flagged_at` stamped);
  `issue_events` — field-by-field history (names copied in);
  `issue_links`, `issue_watchers`, `comments`, `comment_reactions` (thumbs
  up / down, one per person per comment; anyone who reads the issue; only
  yours changed or removed; `comment_reactions_guard` stamps who and the
  issue; notifies nobody; goes with the comment), `attachments` (a file added
  with a comment names it, on the same issue; kept if the comment goes),
  `documents`;
  `issue_dev_links` — GitHub branches, commits and pull requests naming the
  issue's key; read through `can_view_issue`, written only by `github`.
- `calendar_connections` — per person, service role only,
  dropped on deactivation; `todos` — the owner and `shared_with` people
  read and edit, only the owner deletes, leaving is `todo_leave`; `todos_guard`
  stamps the owner, keeps active people, ties only to visible issues / projects
  (an issue's todo takes the issue's project); `todo_lists` — each person's
  own, private even from admins (the Inbox is no row: unfiled todos);
  `todo_places` — per person, which of their lists a todo they're on sits
  in (a composite key keeps it to their own lists; deleting a list sends
  its todos back to the Inbox); `saved_filters` — private or shared;
  `saved_filter_pins` — per person, a filter they can read pinned to the
  navigation (stamped to the caller; private; goes with the filter);
  `watched_activity()` — RPC, security invoker: per watched issue its
  latest change or comment (Work's Recent activity);
  `notes` + `note_labels` — private to the owner even from admins; `notes_guard`
  stamps the owner, keeps only own labels and visible projects, and moves
  `updated_at` only on title / text, stamps `archived_at` (and unpins);
  `pinned`; deleted only once archived (the delete policy); a meeting link is a Google event
  id (one note per person per meeting) with its title and day copied in;
  `notifications` — per recipient, only `read_at` writable; kinds include
  `test`; `push_subscriptions` — a person's devices (endpoint, keys, label),
  read and removed by their owner (never the keys), dropped on deactivation.

## 8. How things connect

- Sign-in: Google OAuth (PKCE) → `bind_profile` → `WorkspaceProvider` loads.
- Issue write → `issues_guard` → row → `issues_after_write` → history, watchers,
  notifications, `chat_notify` → pg_net → `notify-chat` → project webhook
  (threadKey = issue key).
- Comment → `comments_after_write` → watchers, mentions, Chat.
- Notification row → `notifications_push` (statement trigger) → pg_net →
  `push-send` (ids only; reads the rest, encrypts per device, VAPID; deletes
  devices the push service reports gone) → the worker shows it, badges the
  icon, tells open windows (the bell reloads) → a tap focuses the app and
  opens the issue, or opens a window. Opening an issue marks its
  notifications read.
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
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional
  `VITE_VAPID_PUBLIC_KEY` (device notifications; `yarn vapid-keys` makes the
  pair) (`.env.example`); function secrets and Vault secrets in `README.md`.
  The browser tests build with a VAPID key; jsdom has no Web Push, so only
  `test/push.test.tsx`, which installs a fake one, sees device notifications.

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
