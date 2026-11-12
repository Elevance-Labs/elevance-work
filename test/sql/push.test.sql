-- Notifications on devices (Web Push): who may register a device, who sees
-- it, the hand-over of a shared browser, the test notification, and the call
-- to push-send. net.http_post is stubbed to record each call in net.calls.

-- A plausible subscription's keys (lengths as browsers hand them over).
create function t.p256dh() returns text language sql immutable as $$ select repeat('P', 87) $$;
create function t.auth() returns text language sql immutable as $$ select repeat('A', 22) $$;
grant execute on function t.p256dh(), t.auth() to authenticated, anon;

-- ---------------- registering ----------------
select t.login('sara');
select t.eq('turning a device on registers it',
  public.save_push_subscription('https://push.example/d1', t.p256dh(), t.auth(), 'Chrome on Android'), true);
select t.eq('…as the caller''s, with its label',
  (select profile_id::text || ' ' || device from public.push_subscriptions), t.pid('sara')::text || ' Chrome on Android');
select t.eq('a check confirms it is still yours',
  public.save_push_subscription('https://push.example/d1', t.p256dh(), t.auth(), null, true), true);
select t.eq('a check never registers a device the server does not have',
  public.save_push_subscription('https://push.example/unknown', t.p256dh(), t.auth(), null, true), false);
select t.superuser();
select t.eq('…so nothing was added', (select count(*) from public.push_subscriptions), 1::bigint);

select t.login('sara');
select t.throws('the browser cannot write a device directly',
  $$insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth)
    values (t.pid('sara'), 'https://push.example/x', t.p256dh(), t.auth())$$, '42501');
select t.throws('nor change one',
  $$update public.push_subscriptions set device = 'x'$$, '42501');
select t.throws('nor read back its keys',
  $$select p256dh from public.push_subscriptions$$, '42501');
select t.throws('an endpoint must be https',
  $$select public.save_push_subscription('http://push.example/d2', t.p256dh(), t.auth())$$, '23514');

select t.login('omar');
select t.eq('nobody else sees your devices', (select count(*) from public.push_subscriptions), 0::bigint);
select t.eq('nor removes them', t.rows($$delete from public.push_subscriptions$$), 0::bigint);

-- ---------------- a shared browser ----------------
select t.login('omar');
select t.eq('someone else turning the same browser on takes it over',
  public.save_push_subscription('https://push.example/d1', t.p256dh(), t.auth(), 'Chrome on Mac'), true);
select t.superuser();
select t.eq('…it is now theirs alone',
  (select string_agg(profile_id::text, ',') from public.push_subscriptions), t.pid('omar')::text);

-- Sara signs in on that browser again: it is hers now, so Omar's
-- registration there ends, and it stays off until she turns it on.
select t.login('sara');
select t.eq('the last owner''s check says off',
  public.save_push_subscription('https://push.example/d1', t.p256dh(), t.auth(), null, true), false);
select t.superuser();
select t.eq('…and ends the registration of whoever used the browser before',
  (select count(*) from public.push_subscriptions), 0::bigint);

-- ---------------- removing ----------------
select t.login('sara');
select public.save_push_subscription('https://push.example/d3', t.p256dh(), t.auth());
select t.eq('you remove your own device', t.rows($$delete from public.push_subscriptions$$), 1::bigint);

select public.save_push_subscription('https://push.example/d4', t.p256dh(), t.auth());
select t.login('omar');
select public.save_push_subscription('https://push.example/d5', t.p256dh(), t.auth());
select t.login('amna');
select t.throws('the trigger behind deactivation isn''t callable', $$select public.profiles_drop_push()$$, '42501');
update public.profiles set active = false where id = t.pid('sara');
select t.superuser();
select t.eq('deactivating someone drops their devices, and only theirs',
  (select string_agg(endpoint, ',') from public.push_subscriptions), 'https://push.example/d5');
select t.login('amna');
update public.profiles set active = true where id = t.pid('sara');

-- ---------------- the test notification ----------------
select t.as_anon();
select t.throws('nobody signed out sends a test',
  $$select public.send_test_notification()$$, '42501');
select t.login('bilal');
select t.throws('nor anyone not yet bound to a profile',
  $$select public.send_test_notification()$$, '42501');

select t.login('sara');
select public.send_test_notification();
select t.eq('a test notification goes to you',
  (select string_agg(kind::text, ',') from t.notifications('sara')), 'test');
select t.eq('…and only you', (select count(*) from public.notifications), 1::bigint);

-- ---------------- pushing ----------------
select t.superuser();
select t.eq('without the Vault secrets nothing is called', (select count(*) from net.calls), 0::bigint);

insert into vault.decrypted_secrets values
  ('functions_url', 'https://ref.supabase.co/functions/v1/'), ('functions_secret', 's3cret');

select t.login('sara');
select public.send_test_notification();
select t.superuser();
select t.eq('a new notification calls push-send',
  (select url from net.calls order by id desc limit 1), 'https://ref.supabase.co/functions/v1/push-send');
select t.eq('…with only its id',
  (select body from net.calls order by id desc limit 1),
  jsonb_build_object('notification_ids',
    jsonb_build_array((select id from public.notifications where recipient_id = t.pid('sara') order by created_at desc limit 1))));

delete from net.calls;
select t.login('sara');
select t.new_issue('WEB', 'Pushed', 'Task', jsonb_build_object('assignee_id', t.pid('amna')));
select t.superuser();
select t.eq('an assignment pushes to its assignee',
  (select (body -> 'notification_ids' ->> 0)::uuid from net.calls where url like '%push-send' order by id desc limit 1),
  (select id from public.notifications where recipient_id = t.pid('amna') and kind = 'assigned'));

-- ---------------- one call per write, however many it reaches ----------------
-- WEB-? "Pushed": Sara reported it, Amna is assigned; Omar watches it too.
select t.superuser();
insert into public.issue_watchers values ((select id from public.issues where title = 'Pushed'), t.pid('omar'));
delete from net.calls;
delete from public.notifications;

select t.login('sara');
insert into public.comments (issue_id, body)
values ((select id from public.issues where title = 'Pushed'), '<p>Ready for review</p>');
select t.superuser();
select t.eq('a comment reaching two watchers makes one push-send call',
  (select count(*) from net.calls where url like '%push-send'), 1::bigint);
select t.eq('…carrying both notifications',
  (select (select array_agg(x::uuid order by x) from jsonb_array_elements_text(body -> 'notification_ids') x)
     from net.calls where url like '%push-send'),
  (select array_agg(id order by id) from public.notifications));
select t.eq('…one to each watcher, none to the author',
  (select string_agg(kind::text, ',' order by recipient_id) from public.notifications
    where recipient_id in (t.pid('amna'), t.pid('omar'))), 'commented,commented');

delete from net.calls;
delete from public.notifications;
select t.login('sara');
insert into public.comments (issue_id, body)
values ((select id from public.issues where title = 'Pushed'),
        format('<p><span data-type="mention" data-id="%s">@Omar</span> look</p>', t.pid('omar')));
select t.superuser();
select t.eq('a comment mentioning one watcher: still one call',
  (select count(*) from net.calls where url like '%push-send'), 1::bigint);
select t.eq('…a mention for them, a comment for the other',
  (select string_agg(kind::text, ',' order by kind::text) from public.notifications), 'commented,mentioned');

delete from net.calls;
delete from public.notifications;
select t.login('amna');
update public.issues set status_id = t.status('WEB', 'In Progress'), assignee_id = t.pid('sara')
 where title = 'Pushed';
select t.superuser();
select t.eq('a status change and a new assignee in one save: one call',
  (select count(*) from net.calls where url like '%push-send'), 1::bigint);
select t.eq('…with everything that save caused',
  (select jsonb_array_length(body -> 'notification_ids') from net.calls where url like '%push-send'),
  (select count(*)::int from public.notifications));
select t.eq('…one each: the new assignee as assigned, with the new status; the other watcher the status',
  (select string_agg(p.full_name || ':' || n.kind::text || ':' || n.detail, ',' order by p.full_name)
     from public.notifications n join public.profiles p on p.id = n.recipient_id),
  'Omar Farooq:status_changed:In Progress,Sara Iqbal:assigned:In Progress');

delete from net.calls;
delete from public.notifications;
select t.login('sara');
insert into public.issues (project_id, type_id, title, assignee_id, description)
values (t.project('WEB'), t.type('Task'), 'Assigned and mentioned', t.pid('amna'),
        format('<p><span data-type="mention" data-id="%s">@Amna</span> yours</p>', t.pid('amna')));
select t.superuser();
select t.eq('assigned and mentioned in one new issue: told once, as assigned',
  (select string_agg(kind::text, ',') from public.notifications), 'assigned');
select t.eq('…with no status, since it didn''t move',
  (select detail from public.notifications), null::text);

delete from net.calls;
select t.login('amna');
update public.issues set priority = 'high' where title = 'Pushed';
select t.superuser();
select t.eq('a save that tells nobody calls nothing', (select count(*) from net.calls where url like '%push-send'), 0::bigint);

delete from net.calls;
update public.notifications set read_at = now();
select t.eq('marking read pushes nothing',
  (select count(*) from net.calls where url like '%push-send'), 0::bigint);

select t.login('sara');
select t.throws('the trigger function is not callable', $$select public.notifications_push()$$, '42501');
