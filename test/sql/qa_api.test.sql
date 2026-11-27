-- qa-api's side of the database: API tokens (made, seen, used, revoked),
-- what a token may do in a project, runs and their results written by the
-- function (service role: postgres with nobody signed in, here), the author
-- it names, and a test case's history.

-- As the qa-api function: the service role, nobody signed in.
create function pg_temp.as_function() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('test.uid', '', false);
  perform set_config('test.jwt', '', false);
end;
$$;

-- ---------------- tokens ----------------
select t.login('sara');
select (public.api_token_create('Sara laptop')) ->> 'token' as sara_token \gset
select t.ok('a token is made and shown once', :'sara_token' ~ '^elw_[0-9a-f]{64}$');
select t.eq('…kept as hers, by its prefix', (select prefix from public.api_tokens where name = 'Sara laptop'), left(:'sara_token', 12));
select t.throws('…never by its hash', 'select token_hash from public.api_tokens', '42501');
select (public.api_token_create('Sara WEB only', t.project('WEB'))) ->> 'token' as sara_web_token \gset
select t.throws('a member doesn''t make a project''s CI token',
  $$select public.api_token_create('CI', t.project('WEB'), true)$$, '42501');
select t.throws('a token lasts a year at most', $$select public.api_token_create('Long', null, false, '{tests:read}', 400)$$, '22023');
select t.throws('scopes are tests:read and tests:write', $$select public.api_token_create('Odd', null, false, '{admin}')$$, '23514');

select t.login('omar');
select (public.api_token_create('Omar')) ->> 'token' as omar_token \gset
select t.eq('a viewer has a token too (to read)', (select count(*) from public.api_tokens), 1::bigint);

select t.login('hina');
select t.eq('nobody sees someone else''s tokens', (select count(*) from public.api_tokens), 0::bigint);
select t.throws('…or revokes them', format('select public.api_token_revoke(%L)', (select id from public.api_tokens where name = 'Sara laptop')), '42501');
select t.throws('a token for a project you can''t see is refused',
  $$select public.api_token_create('Peek', t.project('WEB'))$$, '42501');

select t.login('amna');
select (public.api_token_create('WEB CI', t.project('WEB'), true)) ->> 'token' as ci_token \gset
select t.eq('a project admin makes its CI token, belonging to nobody',
  (select profile_id is null and project_id = t.project('WEB') from public.api_tokens where name = 'WEB CI'), true);
select t.login('sara');
select t.eq('…which members don''t see', (select count(*) from public.api_tokens where name = 'WEB CI'), 0::bigint);
select t.throws('clients don''t write tokens directly',
  $$insert into public.api_tokens (name, prefix, token_hash) values ('x', 'x', 'x')$$, '42501');

-- ---------------- using them (the function) ----------------
select t.login('sara');
select t.throws('the token lookup is the function''s alone', format('select * from public.qa_token_use(%L)', :'sara_token'), '42501');
select pg_temp.as_function();
select t.eq('a token is known by its hash', (select profile_id from public.qa_token_use(:'sara_token')), t.pid('sara'));
select t.eq('…and its use noted', (select last_used_at is not null from public.api_tokens where name = 'Sara laptop'), true);
select t.eq('a wrong token is nobody', (select count(*) from public.qa_token_use('elw_' || repeat('0', 64))), 0::bigint);

select t.eq('a person''s token has their own role', public.qa_role((select id from public.api_tokens where name = 'Sara laptop'), t.project('WEB')), 'member'::public.project_role);
select t.eq('…in every project', public.qa_role((select id from public.api_tokens where name = 'Sara laptop'), t.project('OPS')), 'member'::public.project_role);
select t.eq('…a viewer''s stays a viewer''s', public.qa_role((select id from public.api_tokens where name = 'Omar'), t.project('WEB')), 'viewer'::public.project_role);
select t.eq('…a token for one project works only there', public.qa_role((select id from public.api_tokens where name = 'Sara WEB only'), t.project('OPS')), null::public.project_role);
select t.eq('a CI token is a member of its project', public.qa_role((select id from public.api_tokens where name = 'WEB CI'), t.project('WEB')), 'member'::public.project_role);
select t.eq('…and nothing elsewhere', public.qa_role((select id from public.api_tokens where name = 'WEB CI'), t.project('OPS')), null::public.project_role);

update public.api_tokens set expires_at = now() - interval '1 day' where name = 'Sara WEB only';
select t.eq('an expired token stops', (select count(*) from public.qa_token_use(:'sara_web_token')), 0::bigint);
select t.login('amna');
update public.profiles set active = false where email = 'omar@elevancelabs.com';
select pg_temp.as_function();
select t.eq('so does a deactivated person''s', (select count(*) from public.qa_token_use(:'omar_token')), 0::bigint);
select t.login('amna');
update public.profiles set active = true where email = 'omar@elevancelabs.com';

-- ---------------- cases and runs written by the function ----------------
select t.login('sara');
select t.eq('an issue to test', t.new_issue('WEB', 'Checkout'), 'WEB-1');

select pg_temp.as_function();
insert into public.test_cases (project_id, issue_id, title, expected, level, created_by)
values (t.project('WEB'), t.issue('WEB-1'), 'Pay by card', 'Order placed', 'regression', t.pid('sara'));
insert into public.test_cases (project_id, title, created_by) values (t.project('WEB'), 'Pay by wallet', t.pid('sara'));
select t.eq('a case the function writes is by the person it names', (select created_by from public.test_cases where key = 'WEB-T1'), t.pid('sara'));
select t.eq('…who edited it last', (select updated_by from public.test_cases where key = 'WEB-T1'), t.pid('sara'));
select t.eq('…and its history says it came through the API',
  (select field || '/' || via || '/' || to_value from public.test_case_events where case_id = (select id from public.test_cases where key = 'WEB-T1')),
  'created/api/Pay by card');

insert into public.test_runs (project_id, environment, mode, run_by, branch, commit_sha)
values (t.project('WEB'), 'staging', 'local', t.pid('sara'), 'feature/checkout', 'abc1234');
select t.eq('a run has its own key, its environment spelt as the project''s',
  (select key || '/' || environment || '/' || mode from public.test_runs), 'WEB-R1/Staging/local');
select t.eq('…and is someone''s', (select run_by from public.test_runs), t.pid('sara'));
select t.throws('a local run is somebody''s',
  $$insert into public.test_runs (project_id, environment, mode) values (t.project('WEB'), 'Dev', 'local')$$, '23514');
select t.throws('an environment is one of the project''s',
  $$insert into public.test_runs (project_id, environment, mode) values (t.project('WEB'), 'Mars', 'cloud')$$, '23514');
insert into public.test_runs (project_id, environment, mode) values (t.project('WEB'), 'Dev', 'cloud');
select t.eq('a cloud run belongs to nobody', (select run_by from public.test_runs where key = 'WEB-R2'), null::uuid);

insert into public.test_results (case_id, run_id, status, duration_ms, source, recorded_by)
select c.id, r.id, 'pass', 1200, 'automated', t.pid('sara') from public.test_cases c, public.test_runs r where c.key = 'WEB-T1' and r.key = 'WEB-R1';
insert into public.test_results (case_id, run_id, status, reason, error, attempts, flaky, source, recorded_by)
select c.id, r.id, 'fail', 'Wallet button missing', 'locator.click: Timeout 5000ms', 2, false, 'automated', t.pid('sara')
  from public.test_cases c, public.test_runs r where c.key = 'WEB-T2' and r.key = 'WEB-R1';
select t.eq('a run''s results are on its environment, by its person',
  (select string_agg(environment || '/' || source || '/' || (recorded_by = t.pid('sara'))::text, ',') from public.test_results), 'Staging/automated/true,Staging/automated/true');
select t.eq('…and counted on the run',
  (select format('%s %s %s', total, passed, failed) from public.test_runs where key = 'WEB-R1'), '2 1 1');
select t.eq('…and the case shows its latest', (select last_status::text || '/' || last_environment from public.test_cases where key = 'WEB-T1'), 'pass/Staging');

select t.login('sara');
select t.eq('an issue in OPS', t.new_issue('OPS', 'Renewals'), 'OPS-1');
insert into public.test_cases (project_id, title) values (t.project('OPS'), 'Renew');
select pg_temp.as_function();
select t.throws('a run takes only its own project''s cases',
  $$insert into public.test_results (case_id, run_id, status) select c.id, r.id, 'pass' from public.test_cases c, public.test_runs r where c.key = 'OPS-T1' and r.key = 'WEB-R1'$$,
  '23514');
update public.test_runs set finished_at = now() where key = 'WEB-R1';
select t.throws('a finished run takes no more',
  $$insert into public.test_results (case_id, run_id, status) select c.id, r.id, 'pass' from public.test_cases c, public.test_runs r where c.key = 'WEB-T1' and r.key = 'WEB-R1'$$,
  '23514');
select t.throws('a run''s environment never changes', $$update public.test_runs set environment = 'Dev' where key = 'WEB-R1'$$, '42501');

-- ---------------- edits and their history ----------------
update public.test_cases set expected = 'Order placed and emailed', change_reason = 'The email is part of the story', updated_by = t.pid('amna')
 where key = 'WEB-T1';
select t.eq('a change through the API keeps its reason and its author',
  (select format('%s|%s|%s|%s|%s', field, from_value, to_value, reason, actor_id = t.pid('amna')) from public.test_case_events
    where field = 'expected'), 'expected|Order placed|Order placed and emailed|The email is part of the story|t');
select t.eq('…who edited it last', (select updated_by from public.test_cases where key = 'WEB-T1'), t.pid('amna'));
update public.test_cases set script_repo = 'elevance/site', script_path = 'e2e/checkout.spec.ts', script_title = 'pays by card @WEB-T1',
  automated_at = now(), change_reason = null, updated_by = t.pid('sara') where key = 'WEB-T1';
select t.eq('linking a script is in the history too',
  (select to_value from public.test_case_events where field = 'script'), 'elevance/site › e2e/checkout.spec.ts › pays by card @WEB-T1');
select t.eq('…by whoever linked it', (select updated_by from public.test_cases where key = 'WEB-T1'), t.pid('sara'));

select t.login('sara');
update public.test_cases set title = 'Pay by debit card' where key = 'WEB-T1';
select t.eq('a change in the app is the signed-in person''s, with no reason',
  (select format('%s|%s|%s', via, actor_id = t.pid('sara'), reason is null) from public.test_case_events where field = 'title'), 'app|t|t');
select t.eq('…and clears the last API reason', (select change_reason from public.test_cases where key = 'WEB-T1'), null::text);
select t.throws('clients never name an author', $$update public.test_cases set updated_by = t.pid('amna')$$, '42501');
select t.throws('…or a script', $$update public.test_cases set script_path = 'x'$$, '42501');
select t.throws('…or record into a run',
  $$insert into public.test_results (case_id, status, run_id) select c.id, 'pass', r.id from public.test_cases c, public.test_runs r where c.key = 'WEB-T1' and r.key = 'WEB-R2'$$,
  '42501');
select t.throws('…or start one', $$insert into public.test_runs (project_id, environment, mode) values (t.project('WEB'), 'Dev', 'cloud')$$, '42501');
select t.throws('…or write history', $$insert into public.test_case_events (case_id, project_id, via, field) select id, project_id, 'app', 'x' from public.test_cases limit 1$$, '42501');

-- ---------------- who reads and removes runs ----------------
select t.login('omar');
select t.eq('a viewer reads the runs', (select count(*) from public.test_runs), 2::bigint);
select t.eq('…and a case''s history', (select count(*) > 0 from public.test_case_events), true);
select t.login('hina');
select t.eq('someone outside the project reads neither',
  (select count(*) from public.test_runs) + (select count(*) from public.test_case_events where project_id = t.project('WEB')), 0::bigint);
select t.login('sara');
select t.eq('a member doesn''t delete a run', t.rows($$delete from public.test_runs where key = 'WEB-R1'$$), 0::bigint);
select t.login('amna');
select t.eq('a project admin (or manager) does', t.rows($$delete from public.test_runs where key = 'WEB-R1'$$), 1::bigint);
select t.eq('…its results with it', (select count(*) from public.test_results), 0::bigint);
select t.eq('…and its cases show what they had before', (select last_status from public.test_cases where key = 'WEB-T1'), null::public.test_status);

-- ---------------- revoking ----------------
select t.login('sara');
select public.api_token_revoke((select id from public.api_tokens where name = 'Sara laptop'));
select pg_temp.as_function();
select t.eq('a revoked token stops for good', (select count(*) from public.qa_token_use(:'sara_token')), 0::bigint);
