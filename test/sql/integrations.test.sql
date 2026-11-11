-- What the database asks of the Edge Functions (Google Chat and Calendar).
-- net.http_post is stubbed to record each call in net.calls.

-- Not configured: nothing is sent, and nothing fails.
select t.login('sara');
select t.new_issue('WEB', 'Before Vault');
select t.superuser();
select t.eq('without the Vault secrets nothing is called', (select count(*) from net.calls), 0::bigint);

insert into vault.decrypted_secrets values
  ('functions_url', 'https://ref.supabase.co/functions/v1/'), ('functions_secret', 's3cret');

select t.login('sara');
select t.new_issue('WEB', 'No webhook yet');
select t.superuser();
select t.eq('a project without a Chat webhook posts nothing', (select count(*) from net.calls), 0::bigint);

select t.login('amna');
insert into public.project_integrations (project_id, chat_webhook_url, chat_events)
values (t.project('WEB'), 'https://chat.googleapis.com/v1/spaces/X/messages?key=k',
        array['issue_created', 'status_changed', 'comment_added']);
select t.login('sara');
select t.new_issue('WEB', 'Announced');  -- WEB-3
select t.superuser();
select t.eq('a new issue is announced to the project''s space',
  (select url || ' ' || (body ->> 'event') from net.calls order by id desc limit 1),
  'https://ref.supabase.co/functions/v1/notify-chat issue_created');
select t.eq('…sending only its id',
  (select body ->> 'issue_id' from net.calls order by id desc limit 1), t.issue('WEB-3')::text);

select t.login('sara');
update public.issues set status_id = t.status('WEB', 'In Progress') where key = 'WEB-3';
select t.superuser();
select t.eq('a status change follows, as its history row',
  (select body ->> 'issue_event_id' from net.calls order by id desc limit 1),
  (select id::text from public.issue_events where issue_id = t.issue('WEB-3') and field = 'status'));

select t.login('sara');
update public.issues set assignee_id = t.pid('sara') where key = 'WEB-3';
select t.superuser();
select t.eq('an event the project didn''t pick isn''t sent',
  (select count(*) from net.calls where body ->> 'event' = 'issue_assigned'), 0::bigint);

-- ---------------- calendar ----------------
delete from net.calls;
select t.login('sara');
insert into public.releases (project_id, name, release_date) values (t.project('WEB'), 'v1.5', '2026-10-30');
select t.superuser();
select t.eq('a dated release is pushed to the shared Google Calendar',
  (select string_agg(url || ' ' || (body ->> 'kind'), ',') from net.calls),
  'https://ref.supabase.co/functions/v1/calendar-sync release');

delete from net.calls;
update public.releases set google_event_id = 'g-1' where name = 'v1.5';
select t.eq('calendar-sync writing back its id doesn''t sync again', (select count(*) from net.calls), 0::bigint);

select t.login('amna');
delete from public.releases where name = 'v1.5';
select t.superuser();
select t.eq('a deleted release is removed by its Google id',
  (select body ->> 'google_event_id' || ':' || (body ->> 'deleted') from net.calls), 'g-1:true');

delete from net.calls;
update public.workspace_settings set chat_webhook_url = 'https://chat.googleapis.com/v1/spaces/ALL/messages?key=k';
select t.throws('the workspace space announces releases only (there are no calendar events)',
  $$update public.workspace_settings set chat_events = '{event_created}'$$, '23514');
select t.eq('…which it does by default', (select chat_events from public.workspace_settings), '{release_released}'::text[]);

delete from net.calls;
select t.login('sara');
insert into public.releases (project_id, name, release_date) values (t.project('WEB'), 'v2', '2026-12-01');
update public.releases set status = 'released' where name = 'v2';
select t.superuser();
select t.eq('a release goes to the calendar, and its release to the workspace space',
  (select string_agg(c, ',' order by c) from (
     select regexp_replace(url, '.*/', '') || ':' || coalesce(body ->> 'event', '') as c from net.calls) calls),
  'calendar-sync:,calendar-sync:,notify-chat:release_released');

-- A failing pg_net never fails the write.
create or replace function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as
  $$ select 1 / 0 $$;
select t.login('sara');
select t.eq('a broken pg_net doesn''t stop an issue being created', t.new_issue('WEB', 'Still saved'), 'WEB-4');
