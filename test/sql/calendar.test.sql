-- Private todos, saved filters and Google Calendar connections. (Meetings
-- live in Google; the app keeps no calendar events of its own.)
select t.superuser();
select t.eq('there is no events table', to_regclass('public.events'), null::regclass);

-- ---------------- todos ----------------
select t.login('sara');
insert into public.todos (title, due_on) values ('Write the brief', '2026-10-23');
select t.eq('a todo belongs to whoever wrote it', (select owner_id from public.todos), t.pid('sara'));
select t.login('amna');
select t.eq('todos are private, even from admins', (select count(*) from public.todos), 0::bigint);

-- ---------------- saved filters ----------------
select t.login('sara');
insert into public.saved_filters (name, query, shared) values ('Mine', '{"assignee":["me"]}', false),
                                                             ('Open bugs', '{"type":["Bug"]}', true);
select t.login('omar');
select t.eq('others see only shared filters', (select string_agg(name, ',') from public.saved_filters), 'Open bugs');
select t.eq('…and can''t change them', t.rows($$update public.saved_filters set name = 'x'$$), 0::bigint);

-- ---------------- Google Calendar connections ----------------
-- Kept only by the google-calendar function (service role); no client sees them.
select t.superuser();
insert into public.calendar_connections (profile_id, google_email, refresh_token)
values (t.pid('sara'), 'sara@elevancelabs.com', 'sealed-sara'), (t.pid('omar'), 'omar@elevancelabs.com', 'sealed-omar');

select t.login('sara');
select t.throws('you can''t read even your own calendar connection',
  $$select count(*) from public.calendar_connections$$, '42501');
select t.throws('…nor add one',
  $$insert into public.calendar_connections (profile_id, google_email, refresh_token)
    values (t.pid('sara'), 'sara@elevancelabs.com', 'x')$$, '42501');
select t.login('amna');
select t.throws('…not even an admin', $$select refresh_token from public.calendar_connections$$, '42501');
select t.throws('…and the trigger behind it isn''t callable',
  $$select public.profiles_drop_calendar()$$, '42501');

update public.profiles set active = false where id = t.pid('omar');
select t.superuser();
select t.eq('deactivating someone drops their calendar connection',
  (select string_agg(google_email, ',') from public.calendar_connections), 'sara@elevancelabs.com');
