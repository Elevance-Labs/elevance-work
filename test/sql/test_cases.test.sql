-- Test cases and results: who reads and writes them, numbering, the
-- project's lists, a reason for a failure, and the latest result on its case.

select t.login('sara');
select t.eq('an issue to write cases for', t.new_issue('WEB', 'Checkout'), 'WEB-1');

-- ---------------- writing cases ----------------
insert into public.test_cases (project_id, issue_id, title, description, expected, type, level, areas)
values (t.project('WEB'), t.issue('WEB-1'), '  Pay   with a saved card ', E'Open the cart\nPay\n', ' Order placed ',
        'functional', 'regression', array[' Checkout ', 'checkout', 'Payments  page', '']);
insert into public.test_cases (project_id, title) values (t.project('WEB'), 'Pay with a new card');

select t.eq('a case is numbered in its project, with a key of its own',
  (select string_agg(key, ',' order by number) from public.test_cases), 'WEB-T1,WEB-T2');
select t.eq('…which leaves the issue numbers alone', (select issue_counter from public.projects where key = 'WEB'), 1);
select t.eq('the summary is tidied', (select title from public.test_cases where key = 'WEB-T1'), 'Pay with a saved card');
select t.eq('…and the text trimmed at its ends only',
  (select description || '|' || expected from public.test_cases where key = 'WEB-T1'), E'Open the cart\nPay|Order placed');
select t.eq('type and level are spelt as the project spells them',
  (select type || '/' || level from public.test_cases where key = 'WEB-T1'), 'Functional/Regression');
select t.eq('areas are trimmed, each once',
  (select areas from public.test_cases where key = 'WEB-T1'), array['Checkout', 'Payments page']);
select t.eq('the creator is stamped', (select created_by from public.test_cases where key = 'WEB-T1'), t.pid('sara'));
select t.ok('a new case goes to the end',
  (select rank from public.test_cases where key = 'WEB-T2') > (select rank from public.test_cases where key = 'WEB-T1'));

select t.throws('a type has to be one of the project''s',
  $$insert into public.test_cases (project_id, title, type) values (t.project('WEB'), 'x', 'Vibes')$$, '23514', 'test types');
select t.throws('…and so does a level',
  $$insert into public.test_cases (project_id, title, level) values (t.project('WEB'), 'x', 'Critical')$$, '23514', 'test levels');
select t.throws('a case needs a summary',
  $$insert into public.test_cases (project_id, title) values (t.project('WEB'), '   ')$$, '23514', 'summary');
select t.throws('a case''s issue is in its project',
  $$insert into public.test_cases (project_id, title, issue_id) values (t.project('OPS'), 'x', t.issue('WEB-1'))$$, '23514');
select t.throws('the key is not the client''s to choose',
  $$insert into public.test_cases (project_id, title, key) values (t.project('WEB'), 'x', 'WEB-T99')$$, '42501');
select t.throws('…nor the latest result',
  $$update public.test_cases set last_status = 'pass'$$, '42501');

update public.test_cases set title = 'Pay with a new debit card', type = 'UI' where key = 'WEB-T2';
select t.eq('a member edits a case', (select title || '/' || type from public.test_cases where key = 'WEB-T2'),
  'Pay with a new debit card/UI');

-- Reordering isn't an edit.
select t.superuser();
-- Past the guard, which would keep the old time.
set session_replication_role = replica;
update public.test_cases set updated_at = '2026-01-01' where key = 'WEB-T1';
set session_replication_role = default;
select t.login('sara');
update public.test_cases set rank = 1 where key = 'WEB-T1';
select t.eq('moving a case doesn''t change when it was edited',
  (select updated_at from public.test_cases where key = 'WEB-T1'), '2026-01-01'::timestamptz);

-- ---------------- who sees and writes them ----------------
select t.login('omar');
select t.eq('a viewer reads the cases', (select count(*) from public.test_cases), 2::bigint);
select t.throws('…but can''t write one',
  $$insert into public.test_cases (project_id, title) values (t.project('WEB'), 'x')$$, '42501');
select t.eq('…or change one', t.rows($$update public.test_cases set title = 'x'$$), 0::bigint);
select t.eq('…or delete one', t.rows('delete from public.test_cases'), 0::bigint);

select t.login('hina');
select t.eq('someone outside a private project sees none', (select count(*) from public.test_cases), 0::bigint);

select t.superuser();
insert into public.project_members (project_id, profile_id, role) values (t.project('WEB'), t.pid('hina'), 'manager');
select t.login('hina');
select t.eq('a project manager writes them too', t.rows($$update public.test_cases set title = title$$), 2::bigint);
select t.superuser();
delete from public.project_members where project_id = t.project('WEB') and profile_id = t.pid('hina');

select t.as_anon();
select t.throws('anon can''t read them', 'select * from public.test_cases', '42501');
select t.throws('…or the results', 'select * from public.test_results', '42501');

-- ---------------- results ----------------
select t.login('sara');
insert into public.test_results (case_id, status, environment)
select id, 'pass', 'dev' from public.test_cases where key = 'WEB-T1';
select t.eq('a pass is recorded on the environment as the project spells it',
  (select environment from public.test_results), 'Dev');
select t.eq('…by whoever recorded it', (select recorded_by from public.test_results), t.pid('sara'));
select t.eq('…by hand', (select source from public.test_results), 'manual');
select t.eq('the case shows it as its latest',
  (select last_status::text || '/' || last_environment from public.test_cases where key = 'WEB-T1'), 'pass/Dev');
select t.eq('…without counting as an edit',
  (select updated_at from public.test_cases where key = 'WEB-T1'), '2026-01-01'::timestamptz);

select t.throws('a failure says why',
  $$insert into public.test_results (case_id, status) select id, 'fail' from public.test_cases where key = 'WEB-T1'$$,
  '23514', 'Say why it failed');
select t.throws('…and so does a block',
  $$insert into public.test_results (case_id, status, reason) select id, 'blocked', '  ' from public.test_cases where key = 'WEB-T1'$$,
  '23514', 'blocked');
select t.throws('an environment is one of the project''s',
  $$insert into public.test_results (case_id, status, environment) select id, 'pass', 'Mars' from public.test_cases where key = 'WEB-T1'$$,
  '23514', 'environments');
select t.throws('the project and author are the database''s to fill',
  $$insert into public.test_results (case_id, status, recorded_by) select id, 'pass', t.pid('amna') from public.test_cases where key = 'WEB-T1'$$,
  '42501');

insert into public.test_results (case_id, status, reason, environment)
select id, 'fail', ' Card declined ', 'staging' from public.test_cases where key = 'WEB-T1';
select t.eq('the latest result is the one shown',
  (select last_status::text || '/' || last_reason || '/' || last_environment from public.test_cases where key = 'WEB-T1'),
  'fail/Card declined/Staging');
select t.throws('a result is never changed', $$update public.test_results set status = 'pass'$$, '42501');

select t.login('omar');
select t.eq('a viewer reads the results', (select count(*) from public.test_results), 2::bigint);
select t.throws('…but can''t record one',
  $$insert into public.test_results (case_id, status) select id, 'pass' from public.test_cases where key = 'WEB-T1'$$, '42501');

select t.login('amna');
select t.eq('nobody takes back someone else''s result, not even an admin',
  t.rows($$delete from public.test_results where status = 'fail'$$), 0::bigint);

select t.login('sara');
select t.eq('whoever recorded a result can take it back', t.rows($$delete from public.test_results where status = 'fail'$$), 1::bigint);
select t.eq('…and the case shows the one before',
  (select last_status::text || '/' || last_environment from public.test_cases where key = 'WEB-T1'), 'pass/Dev');
delete from public.test_results;
select t.eq('with none left, the case has no result',
  (select last_status from public.test_cases where key = 'WEB-T1'), null::public.test_status);

-- ---------------- the project's lists ----------------
select t.eq('a member doesn''t change the lists',
  t.rows($$update public.projects set test_types = '{A}' where key = 'WEB'$$), 0::bigint);

select t.login('amna');
update public.projects set test_types = array[' Functional ', 'functional', 'Accessibility', ''],
                           test_environments = array['Dev', 'QA', 'UAT']
 where key = 'WEB';
select t.eq('a project admin keeps the lists, tidied',
  (select test_types from public.projects where key = 'WEB'), array['Functional', 'Accessibility']);
select t.throws('each entry is short',
  $$update public.projects set test_levels = array[repeat('x', 41)] where key = 'WEB'$$, '23514');

select t.login('sara');
update public.test_cases set title = 'Pay with a new credit card' where key = 'WEB-T2';
select t.eq('a type the list has dropped stays on the case that has it',
  (select type from public.test_cases where key = 'WEB-T2'), 'UI');
select t.throws('…but can''t be chosen again',
  $$update public.test_cases set type = 'UI' where key = 'WEB-T1'$$, '23514');
insert into public.test_results (case_id, status, environment) select id, 'pass', 'uat' from public.test_cases where key = 'WEB-T2';
select t.eq('a new environment can be recorded on', (select last_environment from public.test_cases where key = 'WEB-T2'), 'UAT');

-- ---------------- order ----------------
select t.login('omar');
select t.throws('a viewer can''t renumber the order', $$select public.test_cases_rerank(t.project('WEB'))$$, '42501');
select t.login('sara');
select public.test_cases_rerank(t.project('WEB'));
select t.eq('renumbering keeps the order', (select string_agg(key || '=' || rank, ',' order by rank) from public.test_cases),
  'WEB-T1=1024,WEB-T2=2048');

-- ---------------- they outlive their issue ----------------
select t.superuser();
delete from public.issues where key = 'WEB-1';
select t.eq('deleting the issue keeps its cases, without it',
  (select count(*) from public.test_cases where key = 'WEB-T1' and issue_id is null), 1::bigint);
delete from public.test_cases where key = 'WEB-T2';
select t.eq('deleting a case deletes its results', (select count(*) from public.test_results), 0::bigint);

-- ---------------- an archived project is read-only ----------------
update public.projects set archived_at = now() where key = 'WEB';
select t.login('sara');
select t.throws('nothing is added to an archived project',
  $$insert into public.test_cases (project_id, title) values (t.project('WEB'), 'x')$$, '42501');
select t.eq('…but its cases are still read', (select count(*) from public.test_cases), 1::bigint);
