-- AI-assisted QA: test cases and runs written from outside the app.
--
-- QA work in each development repo with Claude Code (or any tool that speaks
-- MCP or HTTP): they pull a ticket, have test cases drafted, review them,
-- save them here, have Playwright scripts written, run them, and publish the
-- results. All of that goes through the `qa-api` Edge Function, which knows
-- the caller by an API token, never by a shared key.
--
-- api_tokens: a person's own (acts as them, with their role in each project;
-- optionally limited to one project), or a project's CI token (made by the
-- project's admins; acts for no one, with a member's rights in that project
-- only). Only a SHA-256 of the token is kept; the token is shown once, by
-- api_token_create. Revoked, expired or a deactivated owner: it stops.
-- qa_token_use and qa_role are for the function alone (service role).
--
-- test_runs: one run of a project's tests (WEB-R7) on one environment, by a
-- person on their machine (`local`) or in the cloud (`cloud`), with its repo,
-- branch, commit and CI link; its counts kept by trigger. Written only by the
-- function; the app reads them, and managers delete them (and their results).
--
-- test_results: a result may belong to a run, with its duration, error,
-- artifact link, attempts and whether it was flaky (passed on retry). Results
-- recorded in the app have no run.
--
-- test_cases: who last edited one, the script that automates it (repo, path,
-- test title, when), and their history (test_case_events: each field's
-- change, by whom, from the app or the API, with a reason when one was given;
-- a change of expected result through the API needs one).
--
-- The rules stay in the triggers. When the function writes (service role,
-- no auth.uid()), they take the author it names (created_by, updated_by,
-- recorded_by, run_by) instead of the signed-in person; clients can't set
-- those columns at all.

-- ---------------------------------------------------------------------------
-- Tokens
-- ---------------------------------------------------------------------------
create table public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  -- A person's token acts as them; a CI token (no person) for its project.
  profile_id   uuid references public.profiles (id) on delete cascade,
  -- A person's token limited to one project, or a CI token's project.
  project_id   uuid references public.projects (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  -- The first characters, to tell tokens apart; never enough to use.
  prefix       text not null,
  token_hash   text not null unique,
  scopes       text[] not null default '{tests:read,tests:write}'
               check (cardinality(scopes) > 0 and scopes <@ array['tests:read', 'tests:write']),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  check (profile_id is not null or project_id is not null)
);
create index api_tokens_profile_idx on public.api_tokens (profile_id);
create index api_tokens_project_idx on public.api_tokens (project_id);

-- A new token, shown once: yours (optionally for one project you can see),
-- or a project's CI token (its admins). Returns its id, the token and prefix.
create function public.api_token_create(
  p_name text, p_project uuid default null, p_ci boolean default false,
  p_scopes text[] default '{tests:read,tests:write}', p_days integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_profile_id();
  v_token text;
  v_id    uuid;
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_ci then
    if p_project is null or not public.can_admin_project(p_project) then
      raise exception 'Only a project admin can make its CI tokens.' using errcode = '42501';
    end if;
  elsif p_project is not null and not public.can_view_project(p_project) then
    raise exception 'You can''t make a token for that project.' using errcode = '42501';
  end if;
  if p_days is not null and p_days not between 1 and 366 then
    raise exception 'A token lasts from 1 to 366 days, or until revoked.' using errcode = '22023';
  end if;
  -- 64 hex characters from two random UUIDs (244 random bits).
  v_token := 'elw_' || encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex');
  insert into public.api_tokens (profile_id, project_id, name, prefix, token_hash, scopes, created_by, expires_at)
  values (case when p_ci then null else v_me end, p_project, trim(p_name), left(v_token, 12),
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_scopes, v_me,
          case when p_days is not null then now() + make_interval(days => p_days) end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'prefix', left(v_token, 12));
end;
$$;

-- Revoked for good: your own, or a CI token of a project you administer.
create function public.api_token_revoke(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.api_tokens t set revoked_at = coalesce(t.revoked_at, now())
   where t.id = p_id
     and (t.profile_id = public.current_profile_id()
          or (t.profile_id is null and public.can_admin_project(t.project_id)));
  if not found then
    raise exception 'That token isn''t yours to revoke.' using errcode = '42501';
  end if;
end;
$$;

-- For qa-api (service role): the token, if it may be used now.
create function public.qa_token_use(p_token text)
returns table (id uuid, profile_id uuid, project_id uuid, scopes text[])
language plpgsql security definer set search_path = '' as $$
declare
  v public.api_tokens;
begin
  select * into v from public.api_tokens t
   where t.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and t.revoked_at is null and (t.expires_at is null or t.expires_at > now());
  if not found then
    return;
  end if;
  if v.profile_id is not null
     and not exists (select 1 from public.profiles p where p.id = v.profile_id and p.active) then
    return;
  end if;
  if v.last_used_at is null or v.last_used_at < now() - interval '1 minute' then
    update public.api_tokens t set last_used_at = now() where t.id = v.id;
  end if;
  return query select v.id, v.profile_id, v.project_id, v.scopes;
end;
$$;

-- For qa-api (service role): what a token may do in a project. A person's is
-- their own role there (role_in_project); a CI token is a member of its own
-- project (a viewer once it is archived) and nothing elsewhere.
create function public.qa_role(p_token uuid, p_project uuid)
returns public.project_role language sql stable security definer set search_path = '' as $$
  select case
    when t.project_id is not null and t.project_id <> p_project then null
    when t.profile_id is not null then public.role_in_project(t.profile_id, p_project)
    when p.archived_at is not null then 'viewer'::public.project_role
    else 'member'::public.project_role
  end
  from public.api_tokens t
  join public.projects p on p.id = p_project
  where t.id = p_token;
$$;

-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------
alter table public.projects add column test_run_counter integer not null default 0;

create table public.test_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  -- number and key (WEB-R7) are set by test_runs_guard from the project's counter.
  number      integer not null,
  key         text not null unique,
  -- One of the project's test_environments, spelt as the project does.
  environment text not null,
  -- Someone's run on their own machine, or the cloud's (CI).
  mode        text not null check (mode in ('local', 'cloud')),
  run_by      uuid references public.profiles (id) on delete set null,
  repo        text check (length(repo) between 1 and 200),
  branch      text check (length(branch) between 1 and 300),
  commit_sha  text check (commit_sha ~ '^[0-9a-f]{7,40}$'),
  ci_url      text check (ci_url ~ '^https://' and length(ci_url) <= 2000),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  -- Kept by test_results_after_write.
  total       integer not null default 0,
  passed      integer not null default 0,
  failed      integer not null default 0,
  blocked     integer not null default 0,
  skipped     integer not null default 0,
  flaky       integer not null default 0,
  unique (project_id, number)
);
create index test_runs_project_idx on public.test_runs (project_id, started_at desc);

create function public.test_runs_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
begin
  if tg_op = 'INSERT' then
    select * into v_project from public.projects where id = new.project_id for update;
    if not found then
      raise exception 'That project does not exist.' using errcode = '23503';
    end if;
    update public.projects set test_run_counter = test_run_counter + 1
     where id = new.project_id returning test_run_counter into new.number;
    new.key := v_project.key || '-R' || new.number;
    new.started_at := now();
    new.environment := public.test_list_value(new.environment, v_project.test_environments, 'environments');
    new.run_by := coalesce(public.current_profile_id(), case when auth.uid() is null then new.run_by end);
    if new.mode = 'local' and new.run_by is null then
      raise exception 'A local run is somebody''s.' using errcode = '23514';
    end if;
    new.total := 0;
    new.passed := 0;
    new.failed := 0;
    new.blocked := 0;
    new.skipped := 0;
    new.flaky := 0;
  elsif (new.project_id, new.number, new.key, new.environment, new.mode, new.started_at)
        is distinct from (old.project_id, old.number, old.key, old.environment, old.mode, old.started_at)
        or new.run_by is distinct from old.run_by then
    raise exception 'A run''s project, key, environment, mode and runner never change.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger test_runs_guard
  before insert or update on public.test_runs
  for each row execute function public.test_runs_guard();

-- ---------------------------------------------------------------------------
-- Results in runs
-- ---------------------------------------------------------------------------
alter table public.test_results
  add column run_id      uuid references public.test_runs (id) on delete cascade,
  add column duration_ms integer check (duration_ms >= 0),
  add column error       text check (length(error) <= 5000),
  add column artifact_url text check (artifact_url ~ '^https://' and length(artifact_url) <= 2000),
  add column attempts    integer not null default 1 check (attempts between 1 and 20),
  add column flaky       boolean not null default false;
create index test_results_run_idx on public.test_results (run_id);

create or replace function public.test_results_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_run     public.test_runs;
begin
  select project_id into v_project from public.test_cases where id = new.case_id;
  if not found then
    raise exception 'That test case does not exist.' using errcode = '23503';
  end if;
  new.project_id := v_project;
  -- The signed-in person; the qa-api function names its caller.
  new.recorded_by := coalesce(public.current_profile_id(), case when auth.uid() is null then new.recorded_by end);
  -- The clock, not the transaction's start: results recorded together keep their order.
  new.created_at := clock_timestamp();
  new.reason := btrim(coalesce(new.reason, ''), E' \t\r\n');
  if new.status in ('fail', 'blocked') and new.reason = '' then
    raise exception 'Say why it %.', case new.status when 'fail' then 'failed' else 'is blocked' end using errcode = '23514';
  end if;
  if new.run_id is not null then
    select * into v_run from public.test_runs where id = new.run_id;
    if not found or v_run.project_id <> v_project then
      raise exception 'That run is not in this test case''s project.' using errcode = '23514';
    end if;
    if v_run.finished_at is not null then
      raise exception 'Run % is finished.', v_run.key using errcode = '23514';
    end if;
    -- A run's results are on its environment.
    new.environment := v_run.environment;
  else
    new.environment := nullif(trim(new.environment), '');
    if new.environment is not null and auth.uid() is not null then
      new.environment := public.test_list_value(new.environment,
        (select test_environments from public.projects where id = v_project), 'environments');
    end if;
  end if;
  return new;
end;
$$;

-- The case shows its latest result; a run counts its own.
create or replace function public.test_results_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := coalesce(new.case_id, old.case_id);
  v_run  uuid := coalesce(new.run_id, old.run_id);
begin
  update public.test_cases c
     set (last_status, last_reason, last_environment, last_recorded_by, last_recorded_at) =
         (select r.status, r.reason, r.environment, r.recorded_by, r.created_at
            from public.test_results r where r.case_id = v_case
           order by r.created_at desc, r.id desc limit 1)
   where c.id = v_case;
  if v_run is not null then
    update public.test_runs u
       set (total, passed, failed, blocked, skipped, flaky) =
           (select count(*), count(*) filter (where r.status = 'pass'), count(*) filter (where r.status = 'fail'),
                   count(*) filter (where r.status = 'blocked'), count(*) filter (where r.status = 'skipped'),
                   count(*) filter (where r.flaky)
              from public.test_results r where r.run_id = v_run)
     where u.id = v_run;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cases: who edited them, their script, their history
-- ---------------------------------------------------------------------------
alter table public.test_cases
  add column updated_by   uuid references public.profiles (id) on delete set null,
  -- The Playwright test that automates it: a project spans several repos.
  add column script_repo  text check (length(script_repo) between 1 and 200),
  add column script_path  text check (length(script_path) between 1 and 500),
  add column script_title text check (length(script_title) <= 500),
  add column automated_at timestamptz,
  -- Why the latest change was made, when the API said (copied into the history).
  add column change_reason text check (length(change_reason) <= 1000);

create table public.test_case_events (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.test_cases (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  -- Changed in the app, or through qa-api (an AI tool, a reporter, CI).
  via        text not null check (via in ('app', 'api')),
  field      text not null,
  from_value text,
  to_value   text,
  reason     text,
  created_at timestamptz not null default clock_timestamp()
);
create index test_case_events_case_idx on public.test_case_events (case_id, created_at);

create or replace function public.test_cases_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
  v_api     boolean := auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    select * into v_project from public.projects where id = new.project_id for update;
    if not found then
      raise exception 'That project does not exist.' using errcode = '23503';
    end if;
    update public.projects set test_counter = test_counter + 1
     where id = new.project_id returning test_counter into new.number;
    new.key := v_project.key || '-T' || new.number;
    -- The signed-in person; the qa-api function names its caller.
    new.created_by := coalesce(public.current_profile_id(), case when v_api then new.created_by end);
    new.updated_by := new.created_by;
    new.created_at := now();
    new.updated_at := now();
    new.last_status := null;
    new.last_reason := null;
    new.last_environment := null;
    new.last_recorded_by := null;
    new.last_recorded_at := null;
    if new.rank is null then
      select coalesce(max(rank), 0) + 1024 into new.rank from public.test_cases where project_id = new.project_id;
    end if;
  else
    if new.project_id <> old.project_id or new.number <> old.number or new.key <> old.key
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'A test case''s project, key and creator never change.' using errcode = '42501';
    end if;
    select * into v_project from public.projects where id = new.project_id;
  end if;
  -- Only the API gives a reason; a change in the app has none.
  if not v_api then
    new.change_reason := null;
  end if;
  new.change_reason := nullif(trim(new.change_reason), '');

  new.title := regexp_replace(trim(new.title), '\s+', ' ', 'g');
  if new.title = '' then
    raise exception 'A test case needs a summary.' using errcode = '23514';
  end if;
  new.description := btrim(new.description, E' \t\r\n');
  new.expected := btrim(new.expected, E' \t\r\n');

  new.areas := public.clean_list(new.areas);
  if cardinality(new.areas) > 20 or exists (select 1 from unnest(new.areas) a where length(a) > 60) then
    raise exception 'A test case has at most 20 impacted areas, of up to 60 characters each.' using errcode = '23514';
  end if;

  -- Checked against the project's lists when set or changed: a value the
  -- lists have since dropped stays on the cases that have it.
  new.type := nullif(trim(new.type), '');
  if new.type is not null and (tg_op = 'INSERT' or new.type is distinct from old.type) then
    new.type := public.test_list_value(new.type, v_project.test_types, 'test types');
  end if;
  new.level := nullif(trim(new.level), '');
  if new.level is not null and (tg_op = 'INSERT' or new.level is distinct from old.level) then
    new.level := public.test_list_value(new.level, v_project.test_levels, 'test levels');
  end if;

  if new.issue_id is not null and (tg_op = 'INSERT' or new.issue_id is distinct from old.issue_id)
     and not exists (select 1 from public.issues where id = new.issue_id and project_id = new.project_id) then
    raise exception 'A test case''s issue must be in its project.' using errcode = '23514';
  end if;

  -- Reordering, a new result or a script link isn't an edit.
  if tg_op = 'UPDATE' then
    if (new.issue_id, new.title, new.description, new.expected, new.type, new.level, new.areas)
       is distinct from (old.issue_id, old.title, old.description, old.expected, old.type, old.level, old.areas) then
      new.updated_at := now();
      new.updated_by := coalesce(public.current_profile_id(), case when v_api then new.updated_by end);
    else
      new.updated_at := old.updated_at;
      -- qa-api names whoever linked a script; anything else keeps the last editor.
      new.updated_by := case when v_api and new.updated_by is not null then new.updated_by else old.updated_by end;
    end if;
  end if;
  return new;
end;
$$;

-- A case's history: made, then each field that changed.
create function public.test_cases_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_via   text := case when auth.uid() is null then 'api' else 'app' end;
  v_actor uuid := coalesce(public.current_profile_id(), new.updated_by);
  v_key   text;
begin
  if tg_op = 'INSERT' then
    insert into public.test_case_events (case_id, project_id, actor_id, via, field, to_value, reason)
    values (new.id, new.project_id, v_actor, v_via, 'created', new.title, new.change_reason);
    return null;
  end if;
  insert into public.test_case_events (case_id, project_id, actor_id, via, field, from_value, to_value, reason)
  select new.id, new.project_id, v_actor, v_via, f.field, f.from_value, f.to_value, new.change_reason
    from (values
      ('title', old.title, new.title),
      ('description', old.description, new.description),
      ('expected', old.expected, new.expected),
      ('type', old.type, new.type),
      ('level', old.level, new.level),
      ('areas', array_to_string(old.areas, ', '), array_to_string(new.areas, ', ')),
      ('issue', (select key from public.issues where id = old.issue_id), (select key from public.issues where id = new.issue_id)),
      ('script', concat_ws(' › ', old.script_repo, old.script_path, old.script_title),
                 concat_ws(' › ', new.script_repo, new.script_path, new.script_title))
    ) as f(field, from_value, to_value)
   where f.from_value is distinct from f.to_value;
  return null;
end;
$$;

create trigger test_cases_after_write
  after insert or update on public.test_cases
  for each row execute function public.test_cases_after_write();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------
revoke execute on function
  public.api_token_create(text, uuid, boolean, text[], integer), public.api_token_revoke(uuid),
  public.qa_token_use(text), public.qa_role(uuid, uuid), public.test_runs_guard(), public.test_cases_after_write()
  from public, anon, authenticated;
-- qa_token_use and qa_role stay the service role's (the qa-api function).
grant execute on function public.api_token_create(text, uuid, boolean, text[], integer), public.api_token_revoke(uuid)
  to authenticated;

revoke all on public.api_tokens, public.test_runs, public.test_case_events from anon, authenticated;
-- Made and revoked only through the RPCs; the hash is never read back.
grant select (id, profile_id, project_id, name, prefix, scopes, created_by, created_at, expires_at, last_used_at, revoked_at)
  on public.api_tokens to authenticated;
-- Written only by qa-api; a project's managers may delete a run (and its results).
grant select, delete on public.test_runs to authenticated;
-- Written only by the triggers.
grant select on public.test_case_events to authenticated;

alter table public.api_tokens enable row level security;
alter table public.test_runs enable row level security;
alter table public.test_case_events enable row level security;

-- Yours; a project's CI tokens to its admins.
create policy api_tokens_select on public.api_tokens for select to authenticated
  using (profile_id = (select public.current_profile_id())
         or (profile_id is null and public.can_admin_project(project_id)));

create policy test_runs_select on public.test_runs for select to authenticated
  using (public.can_view_project(project_id));
create policy test_runs_delete on public.test_runs for delete to authenticated
  using (public.can_manage_project(project_id));

create policy test_case_events_select on public.test_case_events for select to authenticated
  using (public.can_view_project(project_id));
