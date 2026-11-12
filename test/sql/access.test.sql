-- Who signs in, who sees which project, and what each role may change.

-- ---------------- signing in ----------------
select t.login('sara');
select t.eq('bind_profile returns your profile', (select email from public.bind_profile()), 'sara@elevancelabs.com');
select t.eq('…and keeps your Google photo',
  (select avatar_url from public.profiles where email = 'sara@elevancelabs.com'), 'https://lh3.googleusercontent.com/sara');

select t.login('zara');
select t.eq('a deactivated person is refused', (select count(*) from public.bind_profile()), 0::bigint);
select t.eq('…and sees nobody', (select count(*) from public.profiles), 0::bigint);
select t.eq('…and no project', (select count(*) from public.projects), 0::bigint);

-- Bilal has a profile but has never signed in: his first sign-in binds it.
select t.superuser();
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000ff');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000ff', false);
select set_config('test.jwt', '{"email":"bilal@elevancelabs.com","app_metadata":{"provider":"google"}}', false);
set role authenticated;
select t.eq('a first sign-in binds the profile by email',
  (select full_name from public.bind_profile()), 'Bilal Shah');
reset role;
select set_config('test.jwt', '{"email":"bilal@elevancelabs.com","app_metadata":{"provider":"email"}}', false);
set role authenticated;
select t.eq('only a Google sign-in binds', (select count(*) from public.bind_profile()), 0::bigint);

select t.as_anon();
select t.throws('anon can''t read profiles', 'select * from public.profiles', '42501');
select t.throws('anon can''t read projects', 'select * from public.projects', '42501');
select t.throws('anon can''t read issues', 'select * from public.issues', '42501');

-- ---------------- people ----------------
select t.login('sara');
select t.eq('a member sees the whole directory', (select count(*) from public.profiles), 6::bigint);
select t.throws('a member can''t add people',
  $$insert into public.profiles (email, full_name) values ('new@elevancelabs.com', 'New')$$, '42501');
select t.throws('a member can''t make themselves admin',
  $$update public.profiles set app_role = 'admin' where email = 'sara@elevancelabs.com'$$, '42501');
select t.eq('a member can rename themselves',
  t.rows($$update public.profiles set title = 'Engineer' where email = 'sara@elevancelabs.com'$$), 1::bigint);
select t.eq('…but not someone else',
  t.rows($$update public.profiles set title = 'Boss' where email = 'omar@elevancelabs.com'$$), 0::bigint);
select t.throws('nobody can bind a profile by hand',
  $$update public.profiles set user_id = null where email = 'sara@elevancelabs.com'$$, '42501');

select t.login('amna');
select t.eq('an admin adds people',
  t.rows($$insert into public.profiles (email, full_name) values ('new@elevancelabs.com', 'New Person')$$), 1::bigint);
select t.throws('only company addresses',
  $$insert into public.profiles (email, full_name) values ('x@gmail.com', 'X')$$, '23514');
select t.throws('the last active admin can''t step down',
  $$update public.profiles set app_role = 'member' where email = 'amna@elevancelabs.com'$$, '23514');
select t.throws('people are never deleted',
  $$delete from public.profiles where email = 'new@elevancelabs.com'$$, '42501');

-- ---------------- projects ----------------
select t.login('hina');
select t.eq('someone in no project sees only the open one',
  (select string_agg(key, ',' order by key) from public.projects), 'OPS');
select t.eq('…as a viewer', public.project_role_of(t.project('OPS')), 'viewer'::public.project_role);
select t.eq('…and nothing of the private one',
  (select count(*) from public.project_statuses where project_id = t.project('WEB')), 0::bigint);
select t.throws('a member can''t create projects',
  $$select public.project_create('NEW', 'New', 'scrum')$$, '42501');

select t.login('sara');
select t.eq('a project member sees their private project too',
  (select string_agg(key, ',' order by key) from public.projects), 'OPS,WEB');
select t.eq('the role comes from the membership', public.project_role_of(t.project('WEB')), 'member'::public.project_role);
select t.eq('a member can''t rename the project',
  t.rows($$update public.projects set name = 'Site' where key = 'WEB'$$), 0::bigint);
select t.throws('…nor add members',
  $$insert into public.project_members (project_id, profile_id) values (t.project('WEB'), t.pid('hina'))$$, '42501');
select t.eq('a member doesn''t see the Chat webhook',
  (select count(*) from public.project_integrations), 0::bigint);

select t.login('amna');
select t.eq('an admin is admin of every project', public.project_role_of(t.project('OPS')), 'admin'::public.project_role);
select t.eq('a new project starts with the default workflow',
  (select string_agg(name || ':' || category, ',' order by position) from public.project_statuses
    where project_id = t.project('WEB')),
  'To Do:todo,In Progress:in_progress,In Review:in_progress,Done:done');
select t.eq('…and its creator as admin',
  (select role from public.project_members where project_id = t.project('WEB') and profile_id = t.pid('amna')),
  'admin'::public.project_role);
select t.throws('a project key never changes',
  $$update public.projects set key = 'SITE' where key = 'WEB'$$, '42501');
select t.throws('a key is 2–10 capitals and digits',
  $$select public.project_create('w', 'Lower', 'scrum')$$, '23514');
select t.eq('a project admin sets the Chat webhook',
  t.rows($$insert into public.project_integrations (project_id, chat_webhook_url)
           values (t.project('WEB'), 'https://chat.googleapis.com/v1/spaces/X/messages?key=k')$$), 1::bigint);
select t.throws('…which must be a Google Chat address',
  $$update public.project_integrations set chat_webhook_url = 'https://evil.example/hook'$$, '23514');

-- The workflow keeps a start and a finish.
select t.throws('the last To Do status can''t go',
  $$delete from public.project_statuses where id = t.status('WEB', 'To Do')$$, '23514');
select t.throws('…nor become something else',
  $$update public.project_statuses set category = 'in_progress' where id = t.status('WEB', 'Done')$$, '23514');
select public.project_statuses_reorder(t.project('WEB'), array[
  t.status('WEB', 'Done'), t.status('WEB', 'To Do'), t.status('WEB', 'In Progress'), t.status('WEB', 'In Review')]);
select t.eq('statuses reorder by giving every id, in the new order',
  (select string_agg(name, ',' order by position) from public.project_statuses where project_id = t.project('WEB')),
  'Done,To Do,In Progress,In Review');
select t.throws('…and not a partial list',
  $$select public.project_statuses_reorder(t.project('WEB'), array[t.status('WEB', 'Done')])$$, '22023');

-- ---------------- viewers ----------------
select t.login('omar');
select t.eq('a viewer sees the project', public.project_role_of(t.project('WEB')), 'viewer'::public.project_role);
select t.throws('a viewer can''t create issues',
  $$select t.new_issue('WEB', 'From a viewer')$$, '42501');

select t.login('sara');
select t.new_issue('WEB', 'Hero banner');
select t.login('omar');
select t.eq('a viewer can''t edit an issue',
  t.rows($$update public.issues set title = 'x' where key = 'WEB-1'$$), 0::bigint);
select t.eq('…but can comment',
  t.rows($$insert into public.comments (issue_id, body) values (t.issue('WEB-1'), '<p>Looks good</p>')$$), 1::bigint);
select t.eq('…which makes them a watcher',
  (select count(*) from public.issue_watchers where issue_id = t.issue('WEB-1') and profile_id = t.pid('omar')), 1::bigint);
select t.eq('…and can stop watching',
  t.rows($$delete from public.issue_watchers where issue_id = t.issue('WEB-1') and profile_id = t.pid('omar')$$), 1::bigint);
select t.eq('…and watch again',
  t.rows($$insert into public.issue_watchers (issue_id, profile_id) values (t.issue('WEB-1'), t.pid('omar'))$$), 1::bigint);
select t.throws('…but only themselves',
  $$insert into public.issue_watchers (issue_id, profile_id) values (t.issue('WEB-1'), t.pid('hina'))$$, '42501');

select t.login('hina');
select t.throws('someone outside a private project can''t comment on it',
  $$insert into public.comments (issue_id, body) values (t.issue('WEB-1'), '<p>Hi</p>')$$, '42501');

-- ---------------- deleting ----------------
select t.login('sara');
select t.eq('a member can''t delete issues',
  t.rows($$delete from public.issues where key = 'WEB-1'$$), 0::bigint);
select t.login('amna');
select t.eq('a project admin can',
  t.rows($$delete from public.issues where key = 'WEB-1'$$), 1::bigint);

-- ---------------- archived ----------------
update public.projects set archived_at = now() where key = 'WEB';
select t.login('sara');
select t.eq('an archived project is read-only for its members',
  public.project_role_of(t.project('WEB')), 'viewer'::public.project_role);
select t.throws('…so no new issues',
  $$select t.new_issue('WEB', 'Late')$$, '42501');

-- ---------------- the workspace's own settings ----------------
select t.eq('a member can''t read the workspace settings', (select count(*) from public.workspace_settings), 0::bigint);
select t.login('amna');
select t.eq('an admin can', (select count(*) from public.workspace_settings), 1::bigint);

-- ---------------- internal functions stay internal ----------------
select t.login('sara');
select t.throws('a client can''t queue calls to the Edge Functions (they carry the shared secret)',
  $$select public.call_function('notify-chat', '{"event":"issue_created"}')$$, '42501');
select t.throws('…nor send a project''s Chat messages',
  $$select public.chat_notify(t.project('OPS'), 'issue_created', '{}')$$, '42501');
select t.throws('…nor notify people',
  $$select public.notify_people(array[t.pid('amna')], array['assigned']::public.notification_kind[], null)$$, '42501');
select t.throws('…nor write history',
  $$select public.log_issue_event(gen_random_uuid(), t.project('OPS'), 'status', 'a', 'b')$$, '42501');
select t.throws('…nor ask anyone''s role in a project',
  $$select public.role_in_project(t.pid('amna'), t.project('WEB'))$$, '42501');
select t.as_anon();
select t.throws('anon can''t bind a profile', $$select public.bind_profile()$$, '42501');
select t.throws('…nor create a project', $$select public.project_create('X', 'X', 'scrum')$$, '42501');
