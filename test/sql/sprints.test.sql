-- Sprints from planning to completion, and releases.
select t.login('sara');
insert into public.sprints (project_id, name) values (t.project('WEB'), 'WEB Sprint 1'), (t.project('WEB'), 'WEB Sprint 2');
select t.new_issue('WEB', 'Done in time', 'Task',
  jsonb_build_object('sprint_id', t.sprint('WEB', 'WEB Sprint 1'), 'story_points', 3));      -- WEB-1
select t.new_issue('WEB', 'Not finished', 'Story',
  jsonb_build_object('sprint_id', t.sprint('WEB', 'WEB Sprint 1'), 'story_points', 5));      -- WEB-2
select t.new_issue('WEB', 'Its sub-task', 'Sub-task', jsonb_build_object('parent_id', t.issue('WEB-2')));  -- WEB-3
select t.new_issue('WEB', 'Backlog item');                                                 -- WEB-4

select t.throws('a sprint needs dates to start',
  $$select public.sprint_start(t.sprint('WEB', 'WEB Sprint 1'), null, null)$$, '23514');
select t.throws('…an end on or after its start',
  $$select public.sprint_start(t.sprint('WEB', 'WEB Sprint 1'), '2026-10-20', '2026-10-10')$$, '23514');

select t.login('omar');
select t.throws('a viewer can''t start a sprint',
  $$select public.sprint_start(t.sprint('WEB', 'WEB Sprint 1'), '2026-10-20', '2026-11-03')$$, '42501');

select t.login('sara');
select public.sprint_start(t.sprint('WEB', 'WEB Sprint 1'), '2026-10-20', '2026-11-03', null, 'Ship the hero');
select t.eq('starting makes it active with its goal',
  (select state || ':' || goal from public.sprints where name = 'WEB Sprint 1'), 'active:Ship the hero');
select t.eq('…and records what was committed, with points',
  (select string_agg(i.key || '=' || coalesce(si.points_at_start::text, '-'), ',' order by i.key)
     from public.sprint_issues si join public.issues i on i.id = si.issue_id),
  'WEB-1=3.0,WEB-2=5.0,WEB-3=-');
select t.throws('only one sprint is active at a time',
  $$select public.sprint_start(t.sprint('WEB', 'WEB Sprint 2'), '2026-10-20', '2026-11-03')$$, '23514');
select t.eq('a started sprint can''t be deleted',
  t.rows($$delete from public.sprints where name = 'WEB Sprint 1'$$), 0::bigint);

-- Mid-sprint: one issue done, one added.
update public.issues set status_id = t.status('WEB', 'Done') where key = 'WEB-1';
update public.issues set sprint_id = t.sprint('WEB', 'WEB Sprint 1'), story_points = 2 where key = 'WEB-4';

select t.throws('unfinished work only moves to a future sprint',
  $$select public.sprint_complete(t.sprint('WEB', 'WEB Sprint 1'), t.sprint('WEB', 'WEB Sprint 1'))$$, '23514');
select public.sprint_complete(t.sprint('WEB', 'WEB Sprint 1'), t.sprint('WEB', 'WEB Sprint 2'));
select t.eq('completing closes the sprint', (select state from public.sprints where name = 'WEB Sprint 1'),
  'closed'::public.sprint_state);
select t.eq('done work stays in it',
  (select sprint_id from public.issues where key = 'WEB-1'), t.sprint('WEB', 'WEB Sprint 1'));
select t.eq('unfinished work moves to the chosen sprint, sub-tasks with their parent',
  (select string_agg(key, ',' order by key) from public.issues where sprint_id = t.sprint('WEB', 'WEB Sprint 2')),
  'WEB-2,WEB-3,WEB-4');
select t.eq('the sprint report knows what was committed, added and completed',
  (select string_agg(i.key || ':' || si.committed || ':' || coalesce(si.completed::text, '-'), ',' order by i.key)
     from public.sprint_issues si join public.issues i on i.id = si.issue_id
    where si.sprint_id = t.sprint('WEB', 'WEB Sprint 1')),
  'WEB-1:true:true,WEB-2:true:false,WEB-3:true:false,WEB-4:false:false');
select t.throws('a completed sprint can''t be changed',
  $$update public.sprints set name = 'Renamed' where name = 'WEB Sprint 1'$$, '23514');
select t.throws('…nor take new issues',
  $$update public.issues set sprint_id = t.sprint('WEB', 'WEB Sprint 1') where key = 'WEB-4'$$, '23514');

update public.issues set status_id = t.status('WEB', 'To Do') where key = 'WEB-1';
select t.eq('reopening an issue from a completed sprint puts it back on the backlog',
  (select sprint_id from public.issues where key = 'WEB-1'), null::uuid);

insert into public.sprints (project_id, name) values (t.project('WEB'), 'WEB Sprint 3');
update public.issues set sprint_id = t.sprint('WEB', 'WEB Sprint 3') where key = 'WEB-1';
delete from public.sprints where name = 'WEB Sprint 3';
select t.eq('deleting a future sprint returns its issues to the backlog',
  (select sprint_id from public.issues where key = 'WEB-1'), null::uuid);

select t.login('amna');
update public.projects set kind = 'kanban' where key = 'WEB';
select t.ok('switching to Kanban works with no active sprint', (select kind = 'kanban' from public.projects where key = 'WEB'));
update public.projects set kind = 'scrum' where key = 'WEB';
select public.sprint_start(t.sprint('WEB', 'WEB Sprint 2'), '2026-11-03', '2026-11-17');
select t.throws('…but not while a sprint is active',
  $$update public.projects set kind = 'kanban' where key = 'WEB'$$, '23514');

-- ---------------- releases ----------------
select t.login('sara');
insert into public.releases (project_id, name, release_date) values (t.project('WEB'), 'v1.0', '2026-11-20');
select t.throws('release names are unique in a project, ignoring case',
  $$insert into public.releases (project_id, name) values (t.project('WEB'), 'V1.0')$$, '23505');
update public.issues set release_id = (select id from public.releases where name = 'v1.0') where key = 'WEB-2';
update public.releases set status = 'released' where name = 'v1.0';
select t.ok('releasing stamps the time', (select released_at is not null from public.releases where name = 'v1.0'));
update public.releases set status = 'unreleased' where name = 'v1.0';
select t.ok('…and unreleasing clears it', (select released_at is null from public.releases where name = 'v1.0'));
select t.throws('a release must be in the issue''s project',
  $$insert into public.releases (project_id, name) values (t.project('OPS'), 'ops-1');
    update public.issues set release_id = (select id from public.releases where name = 'ops-1') where key = 'WEB-2'$$,
  '23514');
select t.eq('a member can''t delete a release',
  t.rows($$delete from public.releases where name = 'v1.0'$$), 0::bigint);
