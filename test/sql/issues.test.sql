-- Issues: keys, defaults, hierarchy, custom fields, history, watchers and
-- notifications, and what deleting takes with it.

select t.login('sara');

-- ---------------- keys and defaults ----------------
select t.eq('the first issue is KEY-1', t.new_issue('WEB', '  Hero banner  '), 'WEB-1');
select t.eq('…the next KEY-2', t.new_issue('WEB', 'Footer'), 'WEB-2');
select t.eq('each project counts on its own', t.new_issue('OPS', 'Laptop for Hina'), 'OPS-1');
select t.eq('the title is trimmed', (select title from public.issues where key = 'WEB-1'), 'Hero banner');
select t.eq('a new issue starts in the first To Do status',
  (select status_id from public.issues where key = 'WEB-1'), t.status('WEB', 'To Do'));
select t.eq('the reporter is whoever created it',
  (select reporter_id from public.issues where key = 'WEB-1'), t.pid('sara'));
select t.ok('a new issue goes to the bottom of the backlog',
  (select rank from public.issues where key = 'WEB-2') > (select rank from public.issues where key = 'WEB-1'));
select t.throws('the key can''t be set by hand',
  $$update public.issues set key = 'WEB-99' where key = 'WEB-1'$$, '42501');
select t.throws('an issue can''t move project',
  $$update public.issues set project_id = t.project('OPS') where key = 'WEB-1'$$, '42501');
select t.throws('the status must be one of the project''s',
  $$update public.issues set status_id = t.status('OPS', 'Done') where key = 'WEB-1'$$, '23514');

update public.issues set labels = array[' Front End ', 'front-end', 'SEO', ''] where key = 'WEB-1';
select t.eq('labels are lower-cased, hyphenated and de-duplicated',
  (select labels from public.issues where key = 'WEB-1'), array['front-end', 'seo']);

-- ---------------- resolution ----------------
update public.issues set status_id = t.status('WEB', 'Done') where key = 'WEB-2';
select t.ok('moving to a Done status resolves it', (select resolved_at is not null from public.issues where key = 'WEB-2'));
update public.issues set status_id = t.status('WEB', 'In Progress') where key = 'WEB-2';
select t.ok('…and moving out reopens it', (select resolved_at is null from public.issues where key = 'WEB-2'));

-- ---------------- hierarchy ----------------
select t.new_issue('WEB', 'Launch', 'Epic');                                         -- WEB-3
select t.new_issue('WEB', 'Copy', 'Story', jsonb_build_object('parent_id', t.issue('WEB-3')));  -- WEB-4
select t.eq('a story can sit under an epic', (select parent_id from public.issues where key = 'WEB-4'), t.issue('WEB-3'));
select t.throws('a sub-task needs a parent', $$select t.new_issue('WEB', 'Orphan', 'Sub-task')$$, '23514', 'needs a parent');
select t.throws('a sub-task can''t sit under an epic',
  $$select t.new_issue('WEB', 'x', 'Sub-task', jsonb_build_object('parent_id', t.issue('WEB-3')))$$, '23514');
select t.throws('an epic can''t have a parent',
  $$select t.new_issue('WEB', 'x', 'Epic', jsonb_build_object('parent_id', t.issue('WEB-3')))$$, '23514');
select t.throws('a story can only sit under an epic',
  $$select t.new_issue('WEB', 'x', 'Story', jsonb_build_object('parent_id', t.issue('WEB-1')))$$, '23514');
select t.throws('the parent must be in the same project',
  $$select t.new_issue('WEB', 'x', 'Sub-task', jsonb_build_object('parent_id', t.issue('OPS-1')))$$, '23514');
select t.new_issue('WEB', 'Headline', 'Sub-task', jsonb_build_object('parent_id', t.issue('WEB-4')));  -- WEB-5
select t.throws('a type with children can''t change level',
  $$update public.issues set type_id = t.type('Task') where key = 'WEB-3'$$, '23514');

-- ---------------- sprints follow the parent ----------------
insert into public.sprints (project_id, name) values (t.project('WEB'), 'WEB Sprint 1');
update public.issues set sprint_id = t.sprint('WEB', 'WEB Sprint 1') where key = 'WEB-4';
select t.eq('a sub-task moves with its parent into a sprint',
  (select sprint_id from public.issues where key = 'WEB-5'), t.sprint('WEB', 'WEB Sprint 1'));
update public.issues set sprint_id = null where key = 'WEB-5';
select t.eq('…and can''t be planned on its own',
  (select sprint_id from public.issues where key = 'WEB-5'), t.sprint('WEB', 'WEB Sprint 1'));
select t.throws('an epic isn''t planned into a sprint',
  $$update public.issues set sprint_id = t.sprint('WEB', 'WEB Sprint 1') where key = 'WEB-3'$$, '23514');
select t.throws('Kanban projects have no sprints',
  $$insert into public.sprints (project_id, name) values (t.project('OPS'), 'Nope')$$, '23514');

-- ---------------- assignees ----------------
select t.throws('only a project member can be assigned',
  $$update public.issues set assignee_id = t.pid('hina') where key = 'WEB-1'$$, '23514');
select t.throws('…not a viewer',
  $$update public.issues set assignee_id = t.pid('omar') where key = 'WEB-1'$$, '23514');
select t.throws('…nor someone deactivated',
  $$update public.issues set assignee_id = t.pid('zara') where key = 'WEB-1'$$, '23514');
select t.eq('a workspace admin can always be assigned',
  t.rows($$update public.issues set assignee_id = t.pid('amna') where key = 'WEB-1'$$), 1::bigint);

-- ---------------- custom fields ----------------
select t.login('amna');
insert into public.fields (project_id, name, kind, options) values
  (t.project('WEB'), 'Browser', 'select', array['Chrome', 'Safari', ' Chrome ']),
  (t.project('WEB'), 'Customer', 'text', '{}');
insert into public.fields (project_id, name, kind, required, issue_type_ids)
values (t.project('WEB'), 'Severity score', 'number', true, array[t.type('Bug')]);
select t.eq('options are trimmed and de-duplicated',
  (select options from public.fields where name = 'Browser'), array['Chrome', 'Safari']);
select t.throws('a choice field needs options',
  $$insert into public.fields (project_id, name, kind) values (t.project('WEB'), 'Empty', 'multi_select')$$, '23514');

select t.login('sara');
update public.issues
   set custom = jsonb_build_object(
     (select id from public.fields where name = 'Browser')::text, 'Safari',
     (select id from public.fields where name = 'Customer')::text, 'Acme',
     'not-a-field', 'dropped')
 where key = 'WEB-1';
select t.eq('valid custom values are kept and unknown keys dropped',
  (select custom from public.issues where key = 'WEB-1'),
  jsonb_build_object((select id from public.fields where name = 'Browser')::text, 'Safari',
                     (select id from public.fields where name = 'Customer')::text, 'Acme'));
select t.throws('a select takes only its options',
  format($$update public.issues set custom = '{"%s": "Edge"}' where key = 'WEB-1'$$,
         (select id from public.fields where name = 'Browser')), '22023');
select t.throws('a required field must be filled for the types it applies to',
  $$select t.new_issue('WEB', 'Crash', 'Bug')$$, '23514', 'Severity score is required');
select t.eq('…and doesn''t apply to other types', t.new_issue('WEB', 'Not a bug'), 'WEB-6');

select t.login('amna');
update public.fields set options = array['Chrome'] where name = 'Browser';
select t.login('sara');
select t.eq('removing an option leaves old values editable',
  t.rows($$update public.issues set title = 'Hero banner v2' where key = 'WEB-1'$$), 1::bigint);
select t.login('amna');
delete from public.fields where name = 'Customer';
select t.login('sara');
update public.issues set title = 'Hero banner v3' where key = 'WEB-1';
select t.eq('a deleted field''s value is dropped on the next save',
  (select count(*) from jsonb_object_keys((select custom from public.issues where key = 'WEB-1'))), 1::bigint);

-- ---------------- history ----------------
select t.login('sara');
select t.eq('creating, renaming and moving are in the history',
  (select string_agg(field, ',' order by created_at, field) from public.issue_events
    where issue_id = t.issue('WEB-2')),
  'created,status,status');
select t.eq('…with the names copied in',
  (select from_value || ' → ' || to_value from public.issue_events
    where issue_id = t.issue('WEB-2') and field = 'status' order by created_at limit 1),
  'To Do → Done');

select t.superuser();
set session_replication_role = replica; -- past the guard, to backdate it
update public.issues set updated_at = '2026-01-01' where key = 'WEB-6';
set session_replication_role = origin;
select t.login('sara');
update public.issues set rank = rank + 0.5 where key = 'WEB-6';
select t.eq('reordering alone doesn''t count as an update',
  (select updated_at from public.issues where key = 'WEB-6'), '2026-01-01'::timestamptz);

-- ---------------- watchers and notifications ----------------
select t.superuser();
delete from public.notifications;
select t.login('sara');
select t.new_issue('WEB', 'For Amna', 'Task', jsonb_build_object('assignee_id', t.pid('amna')));  -- WEB-7
select t.eq('the assignee hears about it',
  (select string_agg(kind::text, ',') from t.notifications('amna')), 'assigned');
select t.eq('…and the reporter and assignee both watch it',
  (select count(*) from public.issue_watchers where issue_id = t.issue('WEB-7')), 2::bigint);

select t.login('amna');
update public.issues set status_id = t.status('WEB', 'In Progress') where key = 'WEB-7';
select t.eq('watchers hear about a status change, with the new status',
  (select kind || ':' || detail from t.notifications('sara')), 'status_changed:In Progress');
select t.eq('…but not the person who made it', (select count(*) from t.notifications('amna')), 1::bigint);

select t.superuser();
delete from public.notifications;
select t.login('omar');
insert into public.comments (issue_id, body)
values (t.issue('WEB-7'), format('<p>Ask <span data-type="mention" data-id="%s">@Sara</span></p>', t.pid('sara')));
select t.eq('a mention notifies as a mention, not also as a comment',
  (select string_agg(kind::text, ',') from t.notifications('sara')), 'mentioned');
select t.eq('other watchers hear about the comment',
  (select string_agg(kind::text, ',') from t.notifications('amna')), 'commented');
select t.eq('the commenter now watches the issue',
  (select count(*) from public.issue_watchers where issue_id = t.issue('WEB-7') and profile_id = t.pid('omar')), 1::bigint);

select t.superuser();
delete from public.notifications;
select t.login('sara');
update public.issues
   set description = format('<p><span data-type="mention" data-id="%s">@Hina</span></p>', t.pid('hina'))
 where key = 'WEB-7';
select t.eq('nobody is told about an issue they can''t see', (select count(*) from t.notifications('hina')), 0::bigint);

select t.login('amna');
select t.eq('you read only your own notifications', (select count(*) from public.notifications where recipient_id <> t.pid('amna')), 0::bigint);
select t.throws('…and can only mark them read',
  $$update public.notifications set kind = 'assigned'$$, '42501');

-- ---------------- comments ----------------
select t.login('sara');
insert into public.comments (issue_id, body) values (t.issue('WEB-7'), '<p>Mine</p>');
select t.eq('you edit your own comment',
  t.rows($$update public.comments set body = '<p>Mine, edited</p>' where body = '<p>Mine</p>'$$), 1::bigint);
select t.ok('…which marks it edited', (select edited_at is not null from public.comments where body = '<p>Mine, edited</p>'));
select t.eq('…but not someone else''s',
  t.rows($$update public.comments set body = 'x' where author_id = t.pid('omar')$$), 0::bigint);
select t.login('amna');
select t.eq('a project admin may remove any comment',
  t.rows($$delete from public.comments where author_id = t.pid('omar')$$), 1::bigint);

-- ---------------- links and documents ----------------
select t.login('sara');
select t.eq('an issue links to another',
  t.rows($$insert into public.issue_links (source_id, target_id, kind) values (t.issue('WEB-1'), t.issue('WEB-2'), 'blocks')$$),
  1::bigint);
select t.throws('…but not to itself',
  $$insert into public.issue_links (source_id, target_id, kind) values (t.issue('WEB-1'), t.issue('WEB-1'), 'relates')$$, '23514');
select t.eq('a member links a Google Doc',
  t.rows($$insert into public.documents (project_id, title, url, doc_type)
           values (t.project('WEB'), 'Spec', 'https://docs.google.com/document/d/abc/edit', 'document')$$), 1::bigint);
select t.throws('…only Google addresses',
  $$insert into public.documents (project_id, title, url) values (t.project('WEB'), 'x', 'https://evil.example/doc')$$, '23514');
select t.throws('attachments are written only by the drive function',
  $$insert into public.attachments (issue_id, drive_file_id, file_name, mime_type, size_bytes, web_view_link)
    values (t.issue('WEB-1'), 'f', 'a.png', 'image/png', 1, 'https://drive.google.com/x')$$, '42501');

-- ---------------- deleting ----------------
select t.login('amna');
delete from public.issues where key = 'WEB-4';
select t.eq('deleting a story deletes its sub-tasks', (select count(*) from public.issues where key = 'WEB-5'), 0::bigint);
select t.new_issue('WEB', 'Under the epic', 'Story', jsonb_build_object('parent_id', t.issue('WEB-3')));  -- WEB-8
delete from public.issues where key = 'WEB-3';
select t.eq('deleting an epic keeps its stories, without a parent',
  (select parent_id is null from public.issues where key = 'WEB-8'), true);

select public.project_rerank(t.project('WEB'));
select t.eq('rerank renumbers a project''s backlog 1024 apart',
  (select array_agg(rank order by rank) from public.issues where project_id = t.project('WEB'))
    = (select array_agg((n * 1024)::double precision order by n) from generate_series(1, (select count(*) from public.issues
        where project_id = t.project('WEB'))::int) n),
  true);

delete from public.projects where key = 'WEB';
select t.eq('deleting a project takes its issues with it',
  (select count(*) from public.issues where key like 'WEB-%'), 0::bigint);
