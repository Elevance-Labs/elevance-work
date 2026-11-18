-- Flags: an issue marked as held up, with its reason. Who may flag, what
-- issues_guard stamps, what the history keeps, and the comment each change
-- posts as whoever made it.

select t.login('sara');
select t.new_issue('WEB', 'Payment page');   -- WEB-1
select t.new_issue('WEB', 'Receipts');       -- WEB-2

select t.ok('a new issue isn''t flagged',
  (select flag_reason is null and flagged_by is null and flagged_at is null from public.issues where key = 'WEB-1'));

-- ---------------- flagging ----------------
update public.issues set flag_reason = '  Waiting on the bank''s API keys  ' where key = 'WEB-1';
select t.eq('the reason is kept, trimmed',
  (select flag_reason from public.issues where key = 'WEB-1'), 'Waiting on the bank''s API keys');
select t.eq('who flagged it is stamped', (select flagged_by from public.issues where key = 'WEB-1'), t.pid('sara'));
select t.ok('…and when', (select flagged_at is not null from public.issues where key = 'WEB-1'));
select t.eq('the history keeps the flag',
  (select to_value from public.issue_events where issue_id = t.issue('WEB-1') and field = 'flag'), 'Waiting on the bank''s API keys');

select t.throws('a flag says why',
  $$update public.issues set flag_reason = '   ' where key = 'WEB-2'$$, '23514', 'Say why');
select t.throws('…in at most 2000 characters',
  $$update public.issues set flag_reason = repeat('x', 2001) where key = 'WEB-2'$$, '23514');
select t.throws('who flagged it can''t be set by hand',
  $$update public.issues set flagged_by = t.pid('omar') where key = 'WEB-1'$$, '42501');
select t.throws('…nor when',
  $$update public.issues set flagged_at = now() - interval '1 day' where key = 'WEB-1'$$, '42501');
select t.throws('a new issue can''t be created flagged',
  $$insert into public.issues (project_id, type_id, title, flag_reason) values (t.project('WEB'), t.type('Task'), 'x', 'y')$$, '42501');

-- ---------------- changing the reason ----------------
-- Back-dated past issues_guard, which would keep the stamp.
select t.superuser();
set session_replication_role = replica;
update public.issues set flagged_at = now() - interval '2 days' where key = 'WEB-1';
set session_replication_role = origin;
select t.login('amna');
update public.issues set flag_reason = 'Keys promised for Friday' where key = 'WEB-1';
select t.eq('a new reason keeps who flagged it',
  (select flagged_by from public.issues where key = 'WEB-1'), t.pid('sara'));
select t.ok('…and when', (select flagged_at < now() - interval '1 day' from public.issues where key = 'WEB-1'));
select t.eq('…and is in the history',
  (select count(*) from public.issue_events where issue_id = t.issue('WEB-1') and field = 'flag'), 2::bigint);

-- ---------------- who may flag ----------------
select t.login('omar');
select t.eq('a viewer can see the flag',
  (select flag_reason from public.issues where key = 'WEB-1'), 'Keys promised for Friday');
select t.eq('…but not flag an issue',
  t.rows($$update public.issues set flag_reason = 'Blocked' where key = 'WEB-2'$$), 0::bigint);
select t.eq('…nor remove a flag',
  t.rows($$update public.issues set flag_reason = null where key = 'WEB-1'$$), 0::bigint);
select t.login('hina');
select t.eq('someone outside a private project doesn''t see its flags',
  (select count(*) from public.issues where key = 'WEB-1'), 0::bigint);

-- ---------------- removing the flag ----------------
select t.superuser();
set session_replication_role = replica;
update public.issues set updated_at = now() - interval '1 day' where key = 'WEB-1';
set session_replication_role = origin;
select t.login('sara');
update public.issues set flag_reason = null where key = 'WEB-1';
select t.ok('removing the flag clears who and when',
  (select flagged_by is null and flagged_at is null from public.issues where key = 'WEB-1'));
select t.ok('…counts as an update', (select updated_at > now() - interval '1 hour' from public.issues where key = 'WEB-1'));
select t.ok('…and is in the history',
  exists (select 1 from public.issue_events where issue_id = t.issue('WEB-1') and field = 'flag'
           and from_value = 'Keys promised for Friday' and to_value is null));
update public.issues set flag_reason = 'Again' where key = 'WEB-1';
select t.ok('flagging again stamps a new time',
  (select flagged_at > now() - interval '1 hour' from public.issues where key = 'WEB-1'));

-- ---------------- the comments ----------------
select t.eq('each flag change is posted as a comment: added, changed, removed, added',
  (select string_agg(substring(body from '<strong>([^<]*)</strong>'), ', ' order by created_at, id)
     from public.comments where issue_id = t.issue('WEB-1')),
  'Flag added, Flag reason changed, Flag removed, Flag added');
select t.eq('…each by whoever made the change',
  (select string_agg(p.full_name, ', ' order by c.created_at, c.id)
     from public.comments c join public.profiles p on p.id = c.author_id where c.issue_id = t.issue('WEB-1')),
  'Sara Iqbal, Amna Khan, Sara Iqbal, Sara Iqbal');
select t.ok('…with the reason',
  (select body like '%Keys promised for Friday%' from public.comments
    where issue_id = t.issue('WEB-1') and author_id = t.pid('amna')));

select t.superuser();
insert into public.issue_watchers values (t.issue('WEB-2'), t.pid('omar'));
select t.login('sara');
update public.issues set flag_reason = E'Needs <b>legal</b> & "finance"\nsign-off' where key = 'WEB-2';
select t.eq('the reason is escaped in the comment, its lines kept',
  (select body from public.comments where issue_id = t.issue('WEB-2')),
  '<p>🚩 <strong>Flag added</strong></p><p>Needs &lt;b&gt;legal&lt;/b&gt; &amp; &quot;finance&quot;<br>sign-off</p>');
select t.eq('the watchers hear of it as a comment',
  (select kind::text from t.notifications('omar') where issue_id = t.issue('WEB-2')), 'commented');
select t.eq('…but not whoever flagged it',
  (select count(*) from t.notifications('sara') where issue_id = t.issue('WEB-2')), 0::bigint);
select t.ok('a flag''s comment is the author''s own, to edit or remove',
  t.rows($$delete from public.comments where issue_id = t.issue('WEB-2')$$) = 1);
