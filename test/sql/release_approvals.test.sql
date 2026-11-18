-- The Manager role, release notes, and release approvals: who names
-- approvers, deciding once, the lock, and asking again when issues move.
select t.superuser();
insert into public.project_members (project_id, profile_id, role) values (t.project('WEB'), t.pid('hina'), 'manager');
create function t.rel(p_name text) returns uuid language sql stable security definer as
  $$ select id from public.releases where name = p_name $$;
create function t.decisions(p_name text) returns text language sql stable security definer as
  $$ select string_agg(split_part(p.email, '@', 1) || ':' || coalesce(a.decision::text, 'pending'), ',' order by p.email)
       from public.release_approvers a join public.profiles p on p.id = a.profile_id where a.release_id = t.rel(p_name) $$;
grant execute on all functions in schema t to authenticated;

-- ---------------- the manager role ----------------
select t.login('sara');
select t.new_issue('WEB', 'Hero banner');
select t.new_issue('WEB', 'Footer links');

select t.login('hina');
select t.ok('a manager edits like a member', public.can_edit_project(t.project('WEB')));
select t.ok('…manages releases', public.can_manage_project(t.project('WEB')));
select t.ok('…but isn''t an admin', not public.can_admin_project(t.project('WEB')));
select t.eq('a manager can be assigned',
  t.rows($$update public.issues set assignee_id = t.pid('hina') where key = 'WEB-1'$$), 1::bigint);
select t.eq('a manager doesn''t change settings',
  t.rows($$update public.projects set name = 'Site' where key = 'WEB'$$), 0::bigint);
select t.login('sara');
select t.ok('a member doesn''t manage', not public.can_manage_project(t.project('WEB')));

-- ---------------- notes and approvers ----------------
select t.login('hina');
insert into public.releases (project_id, name, release_date, notes) values (t.project('WEB'), 'v1', '2026-12-01', '<p>Hello</p>');
select t.eq('a manager plans a release with its notes', (select notes from public.releases where name = 'v1'), '<p>Hello</p>');

select t.login('sara');
select t.eq('a member can''t edit a release',
  t.rows($$update public.releases set notes = 'x' where name = 'v1'$$), 0::bigint);
select t.throws('…or name approvers',
  $$insert into public.release_approvers (release_id, profile_id) values (t.rel('v1'), t.pid('sara'))$$, '42501');

select t.login('hina');
select t.throws('an approver must be able to see the project',
  $$insert into public.release_approvers (release_id, profile_id) values (t.rel('v1'), t.pid('bilal'))$$, '23514');
insert into public.release_approvers (release_id, profile_id) values (t.rel('v1'), t.pid('sara')), (t.rel('v1'), t.pid('omar'));
select t.eq('approvers start pending, a viewer among them', t.decisions('v1'), 'omar:pending,sara:pending');
select t.ok('…named by the manager', (select bool_and(added_by = t.pid('hina')) from public.release_approvers));
select t.throws('a release waits for its approvers',
  $$update public.releases set status = 'released' where name = 'v1'$$, '23514', 'approve');
select t.eq('a pending approver can be removed',
  t.rows($$delete from public.release_approvers where profile_id = t.pid('omar')$$), 1::bigint);
insert into public.release_approvers (release_id, profile_id) values (t.rel('v1'), t.pid('omar'));

-- ---------------- deciding ----------------
select t.login('amna');
select t.throws('only an approver decides', $$select public.release_decide(t.rel('v1'), 'approved')$$, '42501');
select t.login('omar');
select t.throws('decisions are made only through release_decide',
  $$update public.release_approvers set decision = 'approved' where profile_id = t.pid('omar')$$, '42501');
select t.throws('a rejection says why', $$select public.release_decide(t.rel('v1'), 'rejected', '  ')$$, '23514');
select public.release_decide(t.rel('v1'), 'rejected', 'The notes miss the footer fix');
select t.throws('a decision stands', $$select public.release_decide(t.rel('v1'), 'approved')$$, '23514');
select t.eq('…with its reason', (select comment from public.release_approvers where profile_id = t.pid('omar')),
  'The notes miss the footer fix');

select t.login('hina');
select t.eq('someone who decided stays an approver',
  (select count(*) from public.release_approvers where profile_id = t.pid('omar')), 1::bigint);
select t.throws('…even for a manager',
  $$delete from public.release_approvers where profile_id = t.pid('omar')$$, '23514');
select t.login('sara');
select t.throws('a member doesn''t ask for approval', $$select public.release_request_approval(t.rel('v1'))$$, '42501');
select t.login('hina');
select public.release_request_approval(t.rel('v1'));
select t.eq('asking again sends every decision back to pending', t.decisions('v1'), 'omar:pending,sara:pending');

select t.login('omar');
select public.release_decide(t.rel('v1'), 'approved');
select t.login('sara');
select public.release_decide(t.rel('v1'), 'approved');

-- ---------------- the lock ----------------
select t.login('hina');
select t.throws('an approved release is locked',
  $$update public.releases set notes = '<p>Changed</p>' where name = 'v1'$$, '23514', 'locked');
select t.throws('…and takes no new approver',
  $$insert into public.release_approvers (release_id, profile_id) values (t.rel('v1'), t.pid('amna'))$$, '23514');

select t.login('sara');
update public.issues set release_id = t.rel('v1') where key = 'WEB-1';
select t.eq('adding an issue asks for approval again', t.decisions('v1'), 'omar:pending,sara:pending');
select t.login('hina');
select t.eq('…which unlocks it', t.rows($$update public.releases set notes = '<p>Changed</p>' where name = 'v1'$$), 1::bigint);

select t.login('omar');
select public.release_decide(t.rel('v1'), 'approved');
select t.login('sara');
select public.release_decide(t.rel('v1'), 'approved');
update public.issues set release_id = null where key = 'WEB-1';
select t.eq('removing an issue asks again too', t.decisions('v1'), 'omar:pending,sara:pending');
select t.login('sara');
select t.new_issue('WEB', 'Straight into the release');
update public.issues set release_id = t.rel('v1') where key = 'WEB-3';
select public.release_decide(t.rel('v1'), 'approved');
select t.login('omar');
select public.release_decide(t.rel('v1'), 'approved');
select t.login('hina');
delete from public.issues where key = 'WEB-3';
select t.eq('…as does deleting one', t.decisions('v1'), 'omar:pending,sara:pending');

select t.login('omar');
select public.release_decide(t.rel('v1'), 'approved');
select t.login('sara');
select public.release_decide(t.rel('v1'), 'approved');
update public.issues set title = 'Hero banner, bigger' where key = 'WEB-1';
select t.eq('other issue edits don''t', t.decisions('v1'), 'omar:approved,sara:approved');

-- ---------------- releasing ----------------
select t.login('hina');
update public.releases set status = 'released' where name = 'v1';
select t.ok('approved, it is released', (select status = 'released' from public.releases where name = 'v1'));
select t.login('sara');
update public.issues set release_id = t.rel('v1') where key = 'WEB-2';
select t.eq('once released, its approvals are a record', t.decisions('v1'), 'omar:approved,sara:approved');
select t.login('omar');
select t.throws('…and no one decides any more', $$select public.release_decide(t.rel('v1'), 'rejected', 'late')$$, '23514');

select t.login('hina');
insert into public.releases (project_id, name, release_date) values (t.project('WEB'), 'v2', '2026-12-15');
update public.releases set status = 'released' where name = 'v2';
select t.ok('a release without approvers needs none', (select status = 'released' from public.releases where name = 'v2'));

-- ---------------- archiving ----------------
update public.releases set status = 'archived' where name = 'v2';
select t.ok('a released release is archived, keeping when it went out',
  (select status = 'archived' and released_at is not null from public.releases where name = 'v2'));
insert into public.releases (project_id, name, release_date) values (t.project('WEB'), 'v3', '2026-12-20');
insert into public.release_approvers (release_id, profile_id) values (t.rel('v3'), t.pid('sara'));
update public.releases set status = 'archived' where name = 'v3';
select t.ok('an unreleased one too, approval pending or not',
  (select status = 'archived' and released_at is null from public.releases where name = 'v3'));
select t.throws('…but archiving doesn''t skip its approval on the way out',
  $$update public.releases set status = 'released' where name = 'v3'$$, '23514', 'approve');
update public.releases set status = 'unreleased' where name = 'v3';
select t.ok('…it comes back unreleased', (select status = 'unreleased' from public.releases where name = 'v3'));

select t.eq('a manager deletes a release, approvers and all',
  t.rows($$delete from public.releases where name = 'v1'$$), 1::bigint);
select t.superuser();
select t.eq('…leaving no approvers behind', (select count(*) from public.release_approvers a
  where not exists (select 1 from public.releases r where r.id = a.release_id)), 0::bigint);
select t.eq('…and others'' untouched', (select count(*) from public.release_approvers), 1::bigint);
select t.login('hina');
select t.eq('a manager removes others'' issues', t.rows($$delete from public.issues where key = 'WEB-2'$$), 1::bigint);
