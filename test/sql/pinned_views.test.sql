-- Pinned views (saved filters pinned to the navigation) and the Work page's
-- Recent activity (watched_activity).

-- ---------------- pins ----------------
select t.login('sara');
insert into public.saved_filters (name, query) values ('Mine', '{"assignees": ["me"]}');
insert into public.saved_filters (name, query, shared) values ('Team', '{"projects": []}', true);
insert into public.saved_filter_pins (filter_id) select id from public.saved_filters;
select t.eq('you pin your own and shared filters', (select count(*) from public.saved_filter_pins), 2::bigint);
select t.eq('…and a pin is stamped as yours',
  (select count(*) from public.saved_filter_pins where profile_id = t.pid('sara')), 2::bigint);
select t.throws('a pin can''t be handed to someone else',
  $$update public.saved_filter_pins set profile_id = t.pid('omar')$$, '42501');

select t.login('omar');
select t.eq('someone else''s pins are private', (select count(*) from public.saved_filter_pins), 0::bigint);
select t.eq('…and can''t be removed by them', t.rows($$delete from public.saved_filter_pins$$), 0::bigint);
insert into public.saved_filter_pins (filter_id) select id from public.saved_filters where name = 'Team';
select t.eq('a shared filter can be pinned by anyone', (select count(*) from public.saved_filter_pins), 1::bigint);
select t.superuser();
select set_config('test.mine', (select id::text from public.saved_filters where name = 'Mine'), false);
select t.login('omar');
select t.throws('…but not someone''s private one',
  $$insert into public.saved_filter_pins (filter_id) values (current_setting('test.mine')::uuid)$$, '42501');

select t.login('sara');
update public.saved_filters set shared = false where name = 'Team';
select t.login('omar');
select t.eq('an unshared filter''s pin no longer leads to a filter',
  (select count(*) from public.saved_filter_pins p join public.saved_filters f on f.id = p.filter_id), 0::bigint);

select t.login('sara');
delete from public.saved_filters where name = 'Mine';
select t.eq('deleting a filter takes its pins with it', (select count(*) from public.saved_filter_pins), 1::bigint);

select t.as_anon();
select t.throws('nothing for the anonymous key', $$select count(*) from public.saved_filter_pins$$, '42501');

-- ---------------- recent activity ----------------
select t.login('sara');
select t.new_issue('WEB', 'Hero image');
select t.new_issue('OPS', 'Rotate keys');
select t.eq('your issues are your activity (you watch what you report)',
  (select count(*) from public.watched_activity()), 2::bigint);

select t.login('omar');
insert into public.comments (issue_id, body) values (t.issue('WEB-1'), '<p>Looks good</p>');
select t.eq('a commenter watches the issue',
  (select count(*) from public.watched_activity()), 1::bigint);

select t.superuser();
update public.issue_events set created_at = now() - interval '1 day';
update public.comments set created_at = now() - interval '1 hour';
select t.login('sara');
select t.eq('each issue once, with its latest change or comment',
  (select string_agg(kind || ':' || coalesce(field, '-'), ',' order by at desc) from public.watched_activity()),
  'comment:-,change:created');
select t.eq('…naming who did it',
  (select actor_id from public.watched_activity() where kind = 'comment'), t.pid('omar'));
select t.eq('…newest first', (select issue_id from public.watched_activity() limit 1), t.issue('WEB-1'));
select t.eq('…up to the limit asked for', (select count(*) from public.watched_activity(1)), 1::bigint);

select t.login('hina');
select t.eq('nothing watched, no activity', (select count(*) from public.watched_activity()), 0::bigint);

select t.superuser();
delete from public.project_members where project_id = t.project('WEB') and profile_id = t.pid('omar');
select t.login('omar');
select t.eq('an issue you can no longer see drops out', (select count(*) from public.watched_activity()), 0::bigint);

select t.as_anon();
select t.throws('the anonymous key can''t call it', $$select * from public.watched_activity()$$, '42501');
