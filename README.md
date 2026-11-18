# Elevance Work

The in-house work tracker for Elevance Labs: projects, issues, sprints and
boards, releases, reports, a calendar, and personal todos and notes, connected
to our Google Workspace (Drive for files and docs, Calendar for your meetings
and the company's release dates, Chat for notifications). It replaces our Jira Software (free
tier) and sits beside **Elevance Support** (`el-support`) and **Elevance
People** (`el-people`), on the same stack.

- **Front end**: React 19, Vite, MUI, TypeScript. A static single-page app,
  deployed to GitHub Pages.
- **Back end**: Supabase: Postgres with row-level security, Auth (Google
  sign-in), Realtime, and three Edge Functions that talk to Google.

---

## What's in it

| Area | What it does |
|---|---|
| **Projects** | Scrum (backlog and sprints) or Kanban (continuous flow). Each has a key (`WEB`), so issues are `WEB-1`, `WEB-2`… Private (members only) or open (everyone can read and comment). |
| **Issues** | Types by level: **epic** › **standard** (story, task, bug…) › **sub-task**. Status, assignee, reporter, priority, story points, labels, start and due dates, sprint, release, parent, and the project's **custom fields** (text, number, date, choice, multi-choice, person, link, checkbox; optionally required, optionally per type). **Flag** an issue that is held up, with a reason (the flag beside the issue's title, or a board or backlog card's menu), as in Jira: it is tinted amber and marked with a red flag wherever it is listed (board, backlog, Issues list, Home, Work, timeline, calendar, search), the flag beside its title lights up (click it for the reason, who flagged it and when, to edit the reason or remove the flag), each change is posted as a comment by whoever made it, and it leads the Summary's *Needs attention*. |
| **Issue view** | Opens over any page (`?issue=WEB-12`, shareable) or as its own page (`/browse/WEB-12`). Edit any field in place (the type from its icon and the epic or parent from the breadcrumb, as in Jira), rich-text description (with tables), sub-tasks, an epic's issues, links (blocks / relates / duplicates / clones), **Development** (the GitHub pull requests, branches and commits that name the issue), attachments, Google Docs, **todos** (yours and the ones you're on, tied to the issue; add one there), comments with **@mentions**, tables and files, full history, watch / unwatch. Sections with nothing in them stay out of the way: a row of buttons under the title (**Add sub-task** or **Add issue**, **Link issue**, **Attach**, **Add doc**, **Add todo**) opens one ready to add to, as in Jira. A description you were typing but didn't save is kept in your browser: open the description again and it's there, until you **Save** or **Cancel**. The **Release** field says how many days the release has left (or how late it is). On a computer, the window icon in the issue's header chooses whether issues open as a **dialog** or a **side panel** on the right that leaves the page usable (open another issue and it takes its place; click anywhere else or press Esc to close it, as with the dialog); the choice is saved on your profile. On a phone an issue is always full screen, one column in reading order (key and actions in a bar that stays put, then the title, those buttons, status, description, what's attached and the other fields), with **Comments** and **History** as tabs pinned to the foot: tap one to slide it up over the issue, tap it again or the floating button to fold it away. On a desktop the dialog and the side panel both show the issue with its fields beside it; on a tablet they are one column too (the side panel with the pinned tabs). |
| **Board** | A column per status in workflow order, WIP limits, drag and drop (mouse, touch, keyboard) or each card's *Move to* menu, quick filters (incl. *Flagged*), swimlanes by assignee or epic, live updates as others move cards. Scrum: the active sprint. Kanban: everything open, plus the last two weeks' done. |
| **Timeline** | A project's epics against the calendar: a bar from each epic's start to its due date, shaded by how much of it is done, with its issues underneath on request and the project's sprints and releases marked along the top (each release by name, from its start to its date, with a line down the timeline on its day; click one to open it). A project with releases but no epics still gets a timeline. Weeks, months or quarters. People who can edit **drag a bar to move it, or an end to change one date** (or use the arrow keys: Shift for the due date, Alt for the start). An epic with no dates of its own borrows the stretch its issues cover, drawn dashed, until it is dragged. On a phone it is a read-only list, releases first. |
| **Backlog** (Scrum) | The active sprint, planned sprints, then unplanned work, in rank order. Drag between them, create inline, create / edit / delete sprints, **start** (dates, goal) and **complete** (unfinished work goes to the backlog, a planned sprint, or a new one). **Quick filters** narrow every list: words, assignees' avatars, *Only my issues*, *Recently updated* (the last day), *Flagged*. The **Epics** panel (the Epics button, or press **E**; remembered per browser) lists the open epics with their progress (done epics on request), *Issues without epic* and *Create epic*: click one to filter the backlog to it, or drop a row on it to move the row there. Each row shows its epic as a chip: click it (or use the row's menu) to change the epic, open it or remove it; each epic in the panel has an icon that opens it. **Select** rows to move them together: click a row (Cmd/Ctrl-click to add or drop one, Shift-click for a range; on a touch screen tap, or use the checkboxes), then use the selection's bar (*Move to* a sprint or the backlog, *Epic*), a selected row's menu, or drag one of them: the rest follow. Esc clears the selection. |
| **Issues list** | Every issue you can see, filtered by project, type, status, assignee, priority, reporter, sprint, release, labels, text, resolution, created / updated / due, flagged. The filter lives in the URL; **save** it by name, for yourself or shared, and **pin** any saved filter (yours or a shared one) to the navigation, under *Issues*: one click from anywhere. Pins are your own. CSV download. |
| **Releases** | Plan versions (a release date is required, a start date optional), track progress, release (moving unfinished work on), **archive** any release (unarchiving puts it back as released or unreleased, as it was; archiving never skips its approval) or delete it. A release's page leads with its internal **description**, then its **release notes**, rich text written for people outside the team (public one day), started from a **draft of what is done** grouped by type; copy them as text or save them as a **Google Doc**. Its issues follow. Down the right: its status and dates, its **approval**, and its **outlook**: the Summary's release judgement (progress, time gone against work done, the forecast, what is unassigned, unestimated or blocked). On a phone the status and approval come first. **Approvals**: a project's managers name approvers (anyone who can see the project). Each approves or rejects once, a rejection saying why; the decision stands until approval is asked for again. Approved by everyone, the release is **locked**: its details, notes and approvers don't change until a manager asks for approval again. A release with approvers goes out only once all of them approved. **Adding an issue to the release or taking one out asks them all again.** The releases list shows where each one's approval stands. |
| **Summary** | Per project, what to act on rather than counts. Each widget loads by itself (only once it scrolls into view) and says so if it can't, without holding up the rest. **Next release** (most prominent): how much is done by issues and points, days left, the time gone against the work done, and a **forecast**: the team's weekly finished counts over the last eight weeks replayed 2,000 times against what is left, giving the date it is 50% and 85% likely to be done and the chance of making the release date. *On track* at 80% or more, *At risk* from 50%, *Off track* below, *Overdue* past the date; with less than three weeks of finished work it is *At risk* when more than 20 points more of its time than of its work has gone. Also what is unassigned, unestimated or blocked. **Sprint health** (Scrum): the burndown, and the pace so far carried to the end date: *On track* if nothing would be left, *At risk* if up to 15% of the starting scope would, else *Will spill ~N*; a finished sprint says what *spilled*; plus work added since it started and what the last sprint spilled. **Cycle time & throughput**: issues finished each week and the median time from first in progress to done, over 12 weeks. **Needs attention**: open work that is flagged (with its reason), blocked by an open issue, overdue, in progress longer than 85% of recent work took (two weeks until five things have finished), or in the sprint or next release with nobody on it or no estimate. **Time in status**: per status, how many sit there now, how many passed through and how long they stayed (median and total), for the sprint or a period; the slowest in-progress status is flagged as the bottleneck. **People**: per person, what they finished (issues, points), their **on-time** rate and cycle time, all time or a period. On time means done by the due date; with no due date, done within its sprint without ever spilling; issues with neither aren't judged. **Leaderboard**: this sprint (Kanban: the last 30 days), by points, then on-time rate. **Epics in progress**: progress against their dates (*Overdue*, *At risk* when time runs more than 20 points ahead of work, *On track*). **Recent activity**. Only *standard* issues count as work (epics and sub-tasks don't). Project admins **Customize** the summary for everyone: which widgets, in what order, or back to the default; the classic reports are widgets to add: **velocity** and the **sprint report** (Scrum), **created vs resolved** and **cumulative flow**. |
| **Project features** | A project's admins can turn off what it doesn't use (*Settings → Features*): **Timeline**, **Calendar**, **Issues**, **Board**, **Releases**, **Docs**; one of Issues and Board stays on. Off hides the tab for everyone (its address opens the summary) and changes no data. With **Releases** off the release field is hidden on issues (each keeps its value, back when it is turned on), and the release widget and release dates on the calendars go too. |
| **Docs** | A project's Google Docs, Sheets and Slides: make new ones in the project's shared-drive folder, link existing ones, preview them in the app. Also per issue. |
| **Calendar** | Your **meetings**, from your own **Google Calendar** (read-only, visible only to you, connected by signing in), with what the app itself dates alongside: **epics** across their start to due dates, the **issues assigned to you** with a start or due date, **releases** and **your todos**. No sprints. Each is a layer you can turn off (remembered on this device), and the view can be narrowed to one project. A **week** by default (a day on phones) as a timeline of one-hour slots, like Google Calendar; or a **day** or **month**. **Clicking anything opens it in a dialog**: a meeting shows its details, guests and a Join button, with **your notes on it**; a release its dates and progress; a todo lets you tick it off or move it; an issue opens over the page. Nothing is created on the calendar: meetings are made in Google Calendar. |
| **Project calendar** | Each project's **Calendar** tab: its releases and epics and your todos on it; its other dated issues and your meetings on request. |
| **Todos** | Your **Inbox** and your own **lists** (make, rename, recolour, delete; a deleted list's todos go back to the Inbox), with **Today**, **Tomorrow** and **This week** beside them across every list (show the ones you want, remembered on this device). One line to add a todo, with icons for its **due day**, **issue**, **project**, **people** and **list** that turn into chips once set; it shows a spinner while saving and adds once however often Enter is pressed. A todo has a due day and an optional issue or project (an issue's todo is in its project). **Add people** to a todo: everyone on it sees it, edits it and ticks it off, and can add others, just like whoever made it; each of them files it in their own list (it starts in their Inbox). Only whoever made it can delete it; anyone else on it can **leave** it. |
| **Notes** | Your own sticky notes, private to you: a colour (yellow unless you pick one), your own labels, optionally a project, and **pinned** to Home if you like (pinned ones come first). **Every meeting has a note**: write it in the meeting's dialog, or on Home while the meeting is on; it saves as you type, titled after the meeting, and is one of your notes from then on (each occurrence of a repeating meeting has its own). Search and filter by label, colour and project; the filter lives in the URL. To see your notes on a project, filter by it. A note **saves itself** as you write (a moment after you stop, and when you close it); there is no Save button. A note is **archived** before it can be deleted: **Archived** on the notes page lists archived notes, to restore or delete for good. |
| **Search** | **Cmd/Ctrl+S** (or the search box in the header): one box, results grouped as **Issues**, **Todos** and **Notes**, at most five of each. Your todos and notes stay yours: search only finds your own notes and the todos you're on. A key like `WEB-12` opens that issue; arrow keys and Enter pick a result; *Search all issues* opens the Issues list with the words. |
| **Create** | The **Create** button or **Cmd/Ctrl+K** asks what to make: **1** an issue, **2** a todo, **3** a note. Press the number, or click or use the arrow keys, to open that form. (Meetings are made in Google Calendar.) |
| **Work** | Your projects as cards (all of them for a workspace admin; **All projects** adds the open ones, **Archived** the archived), each with its active sprint's progress; side by side, to scroll, on a phone. Under them, **My issues** (your open issues) and **Recent activity**: the issues you watch (you watch what you report, are assigned or comment on), most recently active first, each saying who last did what. Admins create projects here. |
| **Home** | Up front, **the meeting you're in** (or the next one today, or the one that just ended), from your Google Calendar: how long it has left, a Join button, its guests, what's later today, and **your notes on it, open to type into**. Then four panels: an **agenda** for **Today** or **This week** (by day: your meetings, releases, your issues due and your todos, each marked differently, meetings you've taken notes on flagged, anything overdue pinned on top in red; click a meeting or release to open it); your **todos**; the **issues assigned to you**; your **pinned notes**. **On a phone** Home is one compact view: the date (with what's overdue), the meeting now as one card with **Join** and **Note** (your note on it opens in a sheet), a strip of the next seven days (a dot where something's on), and the day you pick; the full calendar is one tap away. |
| **Notifications** | In the app (live): assigned, mentioned, a comment or status change on something you watch. **On your devices** (push), even with the app closed, once you turn them on. Opening an issue marks its notifications read. In **Google Chat**: per project, the events it picks, each issue in its own thread; plus a company space for releases. |
| **Admin** | People (add by company email, roles, deactivate), issue types, the company Chat space. Workspace admins reach it from the **Admin** button in the header, beside their avatar. |

Everything works on desktop, tablet and phone: boards scroll sideways,
dialogs go full screen, lists become cards, the calendar opens on a single day.

**Getting around.** The navigation is **Home**, **Calendar**, **Work**,
**Todos** and **Notes**, then **Issues** (the whole list) with your pinned
views under it. On a phone, a bar at the foot of the screen holds **Home**,
**Work**, **Todos** and **Notes** (the calendar is reached from Home); the
menu button still opens the full navigation.

## One look across the Elevance apps

Work, Support and People wear the same shell, so switching between them does not feel like changing product:

- **Header**: the app switcher, the app's logo and name on the left; your avatar with your name and role on the right, opening a menu that starts with who you are.
- **Navigation** on the left, with the current page tinted. (Work alone, for now, also has a bar of four tabs at the foot of a phone's screen, and an Admin button in the header.) **Collapse**, at its foot, folds it to a rail of icons (hover one for its name) and expands it again. The choice is remembered and shared by the three apps, so the screen keeps its shape as you switch.
- **Type and colour**: Roboto, bold page titles, the same indigo, corners, buttons and table headings.
- **Light or dark**: **account menu → Theme** picks *Light*, *Dark* or *System* (follow the device; the default). The choice is remembered in the browser and shared by the three apps.

The look is set in `src/theme` and the shell in the layout component of each app. They are kept the same by hand: a change to one belongs in all three.

## Switching between the Elevance apps

The grid icon at the top left opens the **app switcher**: Work, Support and People. Picking one opens that app; the one you are in is marked *You are here*. It is not shown when an app runs installed (from its own icon): each installed app stays in its own window.

**You are not asked to sign in again.** Each app has its own database and its own session, so the switcher is a link that carries your company email (`?sso=you@…`). An app that opens with no session hands that email to Google as a hint and skips the account chooser; Google already knows you, so you land signed in without seeing a screen. If you are not signed in to Google with that account, Google asks as usual.

- The email is only a hint. Who gets in is still decided by Google and by the receiving app's own rules, so being sent to an app you have no account in ends on its login page, saying so.
- Only an `@elevancelabs.com` address is ever sent or accepted.
- The hint is used once and removed from the address, so a reload or a bookmark never carries it.
- By default each app is the sibling folder beside this one (`…/elevance-work/`, `…/elevance-support/`, `…/elevance-people/`). To place one elsewhere (a custom domain, or another port in development), set `VITE_SUITE_WORK_URL`, `VITE_SUITE_SUPPORT_URL` or `VITE_SUITE_PEOPLE_URL` at build time.

## Installing it as an app

Elevance Work can be **installed** (a PWA). It then opens in its own window (or full screen from the home screen) with its own icon.

- **The Install button.** On a computer it sits at the foot of the navigation, beside *Collapse* (an icon above it when the navigation is folded). On a phone or narrow window it leads the navigation as *Get the app*, with an **×** that hides it for good in that browser.
- **What it does depends on the browser.** Where the browser lets a page ask (Chrome, Edge and Samsung Internet on a computer or Android), it opens the browser's own install dialog. Everywhere else, including every iPhone and iPad and Safari on a Mac, it shows the steps for that device and browser: the share sheet's *Add to Home Screen* on an iPhone, *File → Add to Dock* in Safari on a Mac, the menu path in Chrome or Edge, and "open this in Safari / Chrome first" inside another app's built-in browser. Firefox on a computer cannot install web apps, and says so.
- **Nothing is offered once you are in the app.** The button is hidden when the page is running installed, and disappears as soon as an install finishes.
- You can still install by hand: *Install app* in Chrome or Edge's address bar, or *Add to Home Screen* from Safari's share menu.
- **iPhones open links in Safari, not the app.** iOS has no way for a home-screen app to take over its links, so a link shared in Google Chat opens in Safari (or in Chat's own browser).

- **What is kept on the device** is the app itself (scripts, styles, fonts, icons), so it opens at once. **Nothing from Supabase is ever cached**: every record is fetched each time, and none of it is readable offline. Without a connection the app opens and shows nothing.
- **A new version waits to be asked.** After a deploy the app says *"A new version is available"* with a **Reload** button. Until you press it, or close every window of the app, you keep the build you started with.
- **Opening the app always asks for the latest page.** The copy kept on the device is used only with no connection, so a deploy shows the next time the app is opened; the prompt above is for an app that is already open.
- No working offline.

It is built by [`vite.pwa.ts`](vite.pwa.ts), a small build plugin with no dependency, which writes `manifest.webmanifest` and `sw.js` at build time. The icons are in `public/icons/`; replace those files to change the artwork, keeping it inside the middle 80% of the square (phones crop it to a circle). `badge-96.png` is the small white silhouette Android shows in the status bar. Our apps are served from one origin, so the service worker only answers for, and only clears caches belonging to, its own folder.

## Notifications on your devices

Everything in the bell can also arrive on your phone or computer as a
notification, even with the app closed.

- **Turning them on is per device.** The bell offers it (*Turn on*, or *Not now* for a week), and so does **account menu → Notifications**, which also sends a test and lists every device you've turned them on for, to remove.
- **Where it works:** Chrome, Edge, Firefox and Samsung Internet on a computer or Android, in a tab or installed; Safari on a Mac. **On an iPhone or iPad only once the app is on the Home Screen** (iOS 16.4+): Safari in a tab cannot have them, and the bell says to install first.
- **"Stopped" is said, not hidden.** If a device that had them stops (you blocked them, removed it from another device, or the browser dropped it), the bell gets a dot and says so until it's turned back on.
- **A notification shows the issue, who did what, and for a comment or mention its words.** One per issue: a newer one replaces the older. Tapping it opens the issue, in the open app window if there is one. An installed app's icon shows the unread count.
- **A shared computer hands over.** Signing out turns them off on that device; whoever turns them on there next gets their own, never the last person's.
- **Private in transit.** Each one is encrypted to the device, so the push service carrying it (Google, Apple, Mozilla) can't read it. Deactivating someone removes their devices.

## Who can do what

Two layers: a **workspace role**, and a **project role** per project.

| | Workspace admin | Project admin | Project manager | Project member | Project viewer | Not in the project |
|---|---|---|---|---|---|---|
| See the project and its issues | ✓ (all) | ✓ | ✓ | ✓ | ✓ | only if the project is **open** (then as a viewer) |
| Comment, watch; approve a release you're named on | ✓ | ✓ | ✓ | ✓ | ✓ | open projects only |
| Create and edit issues (incl. their release; flag them), attach files, add docs, plan and run sprints | ✓ | ✓ | ✓ | ✓ | | |
| Manage releases (plan, notes, approvers, release, delete); delete issues; remove others' comments, files and docs | ✓ | ✓ | ✓ | | | |
| Project settings, people, workflow, fields, features, Chat, the Summary's widgets | ✓ | ✓ | | | | |
| Create and delete projects; people; issue types; workspace settings | ✓ | | | | | |

- An **archived** project is read-only for everyone but workspace admins.
- The **calendar** shows only what you can see: epics, issues and releases
  of projects you can see, and your own todos and meetings.
- **Your Google Calendar** is shown only to you. Nobody else, admins
  included, can see it through the app; deactivating someone drops their
  connection. Once connected it stays connected: there is no *Disconnect*
  in the app.
- **Notes** (with their labels) and **todo lists** are private, even from admins. A **todo**
  is seen only by whoever made it and the people they (or anyone on it)
  add: admins included, nobody else. Saved filters are private unless
  shared.
- A deactivated person can't sign in, drops off pickers, and keeps their
  name on what they wrote.

All of this is enforced in the database (row-level security, column grants,
triggers), not just hidden in the UI.

---

## Setting it up

### 1. Supabase

1. Create a project. In **Database → Extensions**, enable **pg_net**
   (Vault is on by default).
2. Apply the schema: `supabase link --project-ref <ref>` then
   `supabase db push` (runs `supabase/migrations/`).
3. **Auth → Providers → Google**: enable it with an OAuth client from
   Google Cloud (Web application; authorised redirect URI
   `https://<ref>.supabase.co/auth/v1/callback`). Turn email sign-ups off.
   For *your own Google Calendar* in the app, the client's Google Cloud
   project needs the **Google Calendar API** enabled, and its OAuth consent
   screen (*Internal*) the scope `…/auth/calendar.events.readonly`. Keep the
   client ID and secret: the `google-calendar` function needs them too.
4. **Auth → URL configuration**: set the site URL and add the deployed
   app's address (and `http://localhost:5173` for development) to the
   redirect URLs.
5. Optional hardening: **Auth → Hooks → Before User Created** →
   `public.hook_before_user_created`, so nobody without a profile even gets
   an auth user.
6. Add the first admin in the SQL editor (everyone else is added in the app,
   under *Admin → People*):

   ```sql
   insert into public.profiles (email, full_name, app_role)
   values ('you@elevancelabs.com', 'Your Name', 'admin');
   ```

### 2. The app

```bash
cp .env.example .env      # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
yarn install
yarn dev                  # http://localhost:5173
```

### 3. Google Workspace

The three Edge Functions act as one **service account**. It needs no
Workspace admin rights and no domain-wide delegation.

1. In Google Cloud, enable the **Google Drive API** and **Google Calendar
   API**, create a service account, and download a JSON key.
2. **Drive**: make a shared drive (e.g. *Elevance Work*), add the service
   account's email as **Content manager**, and make a folder in it for the
   app. Its ID (the last part of its URL) is `DRIVE_ROOT_FOLDER_ID`. Each
   project gets a subfolder on first use; each issue's files go in a
   folder named by its key. Add the team to the shared drive (or set
   `DRIVE_SHARE_DOMAIN`, below) so they can open what's there.
3. **Calendar**: make a calendar for release dates (e.g. *Elevance Work*),
   share it with everyone in the organisation (*See all event details*) so
   they can add it, and with the service account (*Make changes to events*).
   Its ID (Settings → Integrate calendar) is `GOOGLE_CALENDAR_ID`.
4. Set the function secrets:

   ```bash
   supabase secrets set \
     GOOGLE_SERVICE_ACCOUNT="$(cat service-account.json)" \
     DRIVE_ROOT_FOLDER_ID=<folder id> \
     DRIVE_SHARE_DOMAIN=elevancelabs.com \
     GOOGLE_CALENDAR_ID=<calendar id> \
     FUNCTIONS_SHARED_SECRET=<a long random string> \
     GOOGLE_OAUTH_CLIENT_ID=<the Supabase Google provider's client id> \
     GOOGLE_OAUTH_CLIENT_SECRET=<its secret> \
     GOOGLE_TOKEN_KEY=<another long random string, 32+ characters> \
     APP_BASE_URL=https://<where the app is deployed> \
     APP_ORIGIN=https://<its origin, for CORS>
   ```

   `DRIVE_SHARE_DOMAIN` is optional: when set, new attachments are shared
   with the domain as readers and new docs as writers, for people who
   aren't members of the shared drive.
   `GOOGLE_TOKEN_KEY` encrypts the Google Calendar grants people give;
   changing it disconnects everyone (they connect again).
5. Deploy the functions:

   ```bash
   supabase functions deploy drive
   supabase functions deploy google-calendar
   supabase functions deploy notify-chat --no-verify-jwt
   supabase functions deploy calendar-sync --no-verify-jwt
   ```

   `drive` and `google-calendar` are called by signed-in people. The other two are called only by
   the database, which authenticates with the shared secret instead of a
   user's token.
6. Tell the database where the functions are (SQL editor). Until both
   secrets exist, the database simply doesn't call out: right for local
   and preview databases.

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_url');
   select vault.create_secret('<the same FUNCTIONS_SHARED_SECRET>', 'functions_secret');
   ```

   The same two secrets let the database call `push-send` (device
   notifications), below.

7. **Chat**: in a Google Chat space, *Apps & integrations → Webhooks → Add
   webhook*, and paste its address into a project's *Settings → Google
   Chat* (or, for the company space, *Admin → Workspace*).

### 4. Notifications on devices (optional)

Needs the two Vault secrets from *Google Workspace*, step 6. Without this the bell still works;
the app just never offers device notifications.

1. Make a key pair: `yarn vapid-keys`. It prints both halves and the commands below.
2. Give both to the function, with an address the push services can contact, and deploy it:

   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> \
     VAPID_SUBJECT=mailto:<a team address>
   supabase functions deploy push-send --no-verify-jwt
   ```

3. Give the public half to the app at build time: `VITE_VAPID_PUBLIC_KEY` in
   `.env`, and as a repository **Variable** for the deploy.

Changing the pair later is allowed, but everyone has to turn notifications
back on.

### 5. GitHub (optional)

An issue lists the pull requests, branches and commits that name its key
(`WEB-12`) in a **branch name, a commit message or a pull request title**.
Case doesn't matter in a branch name (`feature/web-12-footer`). Nothing in
GitHub changes an issue; the links are only shown, under *Development*.

1. Pick a long random string and set it as the function's secret, then deploy
   the function. It is called by GitHub, not by a signed-in person, so it
   checks GitHub's signature instead of a token:

   ```bash
   supabase secrets set GITHUB_WEBHOOK_SECRET=<a long random string>
   supabase functions deploy github --no-verify-jwt
   ```

2. In GitHub, add a webhook on the **organisation** (Settings → Webhooks), or
   on single repositories:
   - Payload URL: `https://<ref>.supabase.co/functions/v1/github`
   - Content type: `application/json`
   - Secret: the same string
   - Events: *Pushes*, *Branch or tag creation*, *Branch or tag deletion*,
     *Pull requests*

GitHub shows each delivery and its answer under the webhook's *Recent
deliveries*, and can redeliver one. Links start from the day the webhook is
added: earlier branches and pull requests appear the next time they change.
Deleting a branch removes its link; pull requests and commits stay.

### 6. Deploying

Pushes to `main` run `.github/workflows/deploy.yml`: lint, typecheck,
browser tests, database tests, schema check, build, then deploy to GitHub
Pages. Set the repository **Variables** `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` (and `VITE_VAPID_PUBLIC_KEY` for device
notifications), and enable Pages with *GitHub Actions* as the
source. The app uses a hash router, so no rewrites are needed.

---

## Developing

| Command | |
|---|---|
| `yarn dev` | The app on :5173 against the project in `.env`. |
| `yarn lint` | oxlint; warnings fail. |
| `yarn typecheck` | The app, the tests, and the Edge Functions. |
| `yarn test` | Browser tests (`test/*.test.ts(x)`): the real app in jsdom against an in-memory Supabase. |
| `yarn test:sql` | Database tests (`test/sql/*.test.sql`): RLS, grants, triggers and RPCs, as real signed-in people, on a throwaway Postgres. |
| `yarn check:schema` | Proves `supabase/schema.sql` equals the migrations. |
| `yarn build` | Typecheck, then the production bundle in `dist/`. |
| `yarn vapid-keys` | A fresh key pair for device notifications. |

`test:sql` and `check:schema` need the Postgres server binaries on `PATH`
(`brew install postgresql@16`, then
`export PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH`).

A database change is a new migration **and** the same end state in
`supabase/schema.sql`, plus `src/lib/types.ts` for column changes; see
`CLAUDE.md`.

---

## How things behave

- **Issue keys never change.** A project's key is fixed at creation, and
  an issue can't move to another project. Numbers are never reused.
- **Workflow.** Any status can move to any other. Each status has a
  category (to do / in progress / done); moving into a done one stamps the
  issue resolved, moving out reopens it. A project always keeps at least
  one to-do and one done status, and a status still in use can't be
  deleted.
- **Hierarchy.** An epic has no parent; a standard issue may sit under an
  epic; a sub-task always sits under a standard issue and follows it into
  and out of sprints. Deleting a standard issue deletes its sub-tasks;
  deleting an epic keeps its issues. Epics aren't planned into sprints.
- **Sprints.** One active sprint per project. Starting one records what was
  committed; completing it records what was done, then moves the rest on.
  A completed sprint can't be changed, and reopening one of its issues
  puts it back on the backlog. Only a sprint that never started can be
  deleted (its issues return to the backlog).
- **Flags.** A flag always has a reason; whoever can edit the issue
  flags it, changes the reason or removes it. Who flagged it and when are
  stamped by the database (a new reason keeps them). Flagging, changing the
  reason and removing the flag are in the issue's history and are posted
  as a comment by whoever did it, which tells the watchers as any comment
  does. A flag doesn't change the issue's status.
- **Assignees** must be able to edit the project (admins, managers and
  members, not viewers).
- **Release approvals** are kept by the database: only an approver
  decides, once, through `release_decide`; someone who has decided stays an
  approver until a manager asks again (`release_request_approval`); an
  approved release can't be edited or given new approvers; it can't be
  released until every approver approved; and an issue moving in or out of
  it (or deleted from it) sends every decision back to pending. Once
  released, its approvals are a record.
- **Custom field values** are checked by the database against the field's
  kind and options. Removing an option doesn't break issues that use it;
  deleting a field drops its values the next time each issue is saved.
- **Notifications** never go to the person who caused them, or to someone
  who can't see the issue. One save tells each person one thing, the most
  direct: assigned, then mentioned, then a status change, then a comment.
  An assignment made with a status change says both (*"Amna assigned you
  and moved it to In Progress"*). Device notifications are sent by the database after the
  write (like Chat), so a push service being down never fails a save; one
  save makes one call to send them, however many people it reaches.
- **Google is never in the way.** Chat and Calendar calls are queued by
  the database (pg_net) after the write succeeds; if Google is down, the
  issue is still saved. Files and docs live in the shared drive: removing
  an attachment moves it to the Drive trash, and unlinking a doc leaves the
  file in place.
- **Meetings live in Google Calendar.** The app keeps no calendar events of
  its own (it used to; a migration removed them, and their copies in the
  company calendar). It reads each person's own calendar, and pushes one
  thing the other way: **release dates**, one way into the company's Google
  Calendar (`calendar-sync`). Edit releases in the app; changes made to
  them in Google Calendar are overwritten on the next edit.
- **Your own Google Calendar** comes with signing in: Google sign-in also
  asks for read-only access to your events. Google only hands that grant
  over when it shows its consent screen, so on a browser that hasn't kept a
  grant yet, sign-in shows the consent screen; after that, signing in is
  one click again. *Calendar → Connect Google Calendar* remains only for
  someone who unticked calendar access, or is still in a session from
  before this existed. The
  `google-calendar` function keeps the grant (encrypted; no one can read it
  through the app) and reads your primary calendar when you open the
  calendar or Home; meetings themselves are never stored (a note on one
  keeps its id, title and day, to say which). Declined, cancelled and
  working-location entries are left out; clicking one opens it in a dialog
  in the app, with a link to Google Calendar there. The app offers no way to disconnect; removing the
  app under your Google account's *Third-party access* revokes the grant,
  after which the app asks you to connect again.
- **Notes** are plain text. Labels are each person's own: create them in
  *Notes → Labels* or by typing a new one on a note; removing a label
  takes it off your notes, which stay. A note can only be linked to a
  project you can see; if the project is deleted, the note stays,
  unlinked. A meeting has at most one note of yours; it can be unlinked
  from the note's dialog (and is linked only from the meeting). Notes are
  listed pinned first, then by when their text last changed (recolouring,
  relabelling or pinning doesn't move them). Only an archived note can be
  deleted (the database refuses otherwise); archiving unpins it, and an
  archived note is left out of search, Home and project tabs.
  Writing in a meeting's archived note brings it back.
- **Attachments** are up to 25 MB each; bigger files belong in the
  project's Drive folder, linked as a doc. Files added with a comment are
  ordinary attachments: they go to the same Drive folder, show under the
  comment and in the issue's Attachments, and need the same rights (a
  project admin, manager or member; viewers can comment but not attach). You can add files
  only to your own comments; they upload once the comment is saved.
  Deleting the comment leaves its files on the issue.
- **Rich text** (descriptions, comments) is sanitised when saved and again
  when shown. Tables are simple: a header row, add or delete rows and
  columns from the table button; no merged cells or column widths.
- **GitHub links** are written only by the `github` function: nobody can add,
  change or remove one in the app, and only text that is a real issue key
  links anything. Whoever can see the issue sees its links.
- **Shared links.** `?issue=KEY` on any page opens that issue over it;
  `/browse/KEY` is its own page. Filtered lists and report choices are in
  the URL too.
