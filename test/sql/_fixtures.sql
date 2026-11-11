-- The people and projects every SQL test starts from.
--
--   amna   workspace admin
--   sara   member; member of WEB
--   omar   member; viewer of WEB
--   hina   member; in no project (sees only open ones)
--   zara   deactivated; was a member of WEB
--   bilal  never signed in (no auth user)
--
--   WEB  scrum, private
--   OPS  kanban, open
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'),
  ('00000000-0000-0000-0000-00000000000d'),
  ('00000000-0000-0000-0000-00000000000e');

insert into public.profiles (user_id, email, full_name, app_role, active) values
  ('00000000-0000-0000-0000-00000000000a', 'amna@elevancelabs.com', 'Amna Khan', 'admin', true),
  ('00000000-0000-0000-0000-00000000000b', 'sara@elevancelabs.com', 'Sara Iqbal', 'member', true),
  ('00000000-0000-0000-0000-00000000000c', 'omar@elevancelabs.com', 'Omar Farooq', 'member', true),
  ('00000000-0000-0000-0000-00000000000d', 'hina@elevancelabs.com', 'Hina Raza', 'member', true),
  ('00000000-0000-0000-0000-00000000000e', 'zara@elevancelabs.com', 'Zara Ali', 'member', false),
  (null, 'bilal@elevancelabs.com', 'Bilal Shah', 'member', true);

-- As Amna, without dropping to `authenticated` (fixtures ignore RLS).
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select public.project_create('WEB', 'Website', 'scrum', 'private', 'The marketing site');
select public.project_create('OPS', 'Operations', 'kanban', 'open', '');
insert into public.project_members (project_id, profile_id, role) values
  (t.project('WEB'), t.pid('sara'), 'member'),
  (t.project('WEB'), t.pid('omar'), 'viewer'),
  (t.project('WEB'), t.pid('zara'), 'member'),
  (t.project('OPS'), t.pid('sara'), 'member');
select set_config('test.uid', '', false);
