-- Test cases and their results: the QA team's sheet, in the project.
--
-- QA write end-to-end test cases for an issue at grooming; developers test
-- against them before handing over, and QA test again, each run marked pass
-- or fail with a reason. Until now that lived in tables pasted into
-- comments. Now a project has its test cases (WEB-T12: a key of their own,
-- numbered per project, which a Playwright test can carry as its tag), each
-- usually written for one issue and kept after it is done (a regression
-- suite outlives its ticket). A case's type and level come from lists the
-- project's admins keep (Settings), as does the environment a result was
-- recorded on.
--
-- A result is one person's pass / fail / blocked / skipped of one case, on
-- one environment, at one time; a fail or a block says why. Results are
-- never edited, only added (or taken back by whoever recorded them). The
-- latest one is copied onto its case by a trigger (`last_*`), so the sheet
-- reads one table and can filter on it. `source` is 'manual' for everything
-- recorded in the app; an automated run will write its own later, through
-- an Edge Function.
--
-- Whoever edits a project (admins, managers, members: can_edit_project)
-- writes its cases and records results; viewers read them. Rules live in the triggers: numbering, the lists, the issue
-- being in the same project, a reason for a failure.

create type public.test_status as enum ('pass', 'fail', 'blocked', 'skipped');

-- The project's own vocabulary for its test cases.
alter table public.projects
  add column test_counter      integer not null default 0,
  add column test_types        text[] not null default '{Functional,UI,Negative,Edge case,Integration}'
                               check (cardinality(test_types) <= 30),
  add column test_levels       text[] not null default '{Smoke,Sanity,Regression}'
                               check (cardinality(test_levels) <= 30),
  add column test_environments text[] not null default '{Dev,QA,Staging}'
                               check (cardinality(test_environments) <= 30);

-- A list as people mean it: trimmed, inner spaces collapsed, empty entries
-- dropped, each once whatever its case (the first spelling wins), in order.
create function public.clean_list(p_items text[])
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(v order by n), '{}')
    from (select distinct on (lower(v)) v, n
            from (select regexp_replace(trim(x), '\s+', ' ', 'g') as v, n
                    from unnest(p_items) with ordinality as u(x, n)) s
           where v <> ''
           order by lower(v), n) d;
$$;

create or replace function public.projects_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.key is distinct from old.key then
    raise exception 'A project key never changes.' using errcode = '42501';
  end if;
  if new.kind = 'kanban' and old.kind = 'scrum'
     and exists (select 1 from public.sprints where project_id = new.id and state = 'active') then
    raise exception 'Complete the active sprint before switching to Kanban.' using errcode = '23514';
  end if;
  new.name := trim(new.name);
  new.test_types := public.clean_list(new.test_types);
  new.test_levels := public.clean_list(new.test_levels);
  new.test_environments := public.clean_list(new.test_environments);
  if exists (select 1 from unnest(new.test_types || new.test_levels || new.test_environments) x where length(x) > 40) then
    raise exception 'Keep each test type, level and environment to 40 characters.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create table public.test_cases (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  -- number and key (WEB-T12) are set by test_cases_guard from the project's counter.
  number           integer not null,
  key              text not null unique,
  -- The issue it was written for; the case stays when the issue goes.
  issue_id         uuid references public.issues (id) on delete set null,
  title            text not null check (length(title) between 1 and 500),
  -- Plain text, as typed or pasted from a sheet.
  description      text not null default '' check (length(description) <= 10000),
  expected         text not null default '' check (length(expected) <= 10000),
  -- One of the project's test_types / test_levels, spelt as the project does.
  type             text,
  level            text,
  -- Impacted areas.
  areas            text[] not null default '{}',
  -- Order in the sheet.
  rank             double precision not null,
  -- The latest result, kept by test_results_after_write.
  last_status      public.test_status,
  last_reason      text,
  last_environment text,
  last_recorded_by uuid references public.profiles (id) on delete set null,
  last_recorded_at timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, number)
);
create index test_cases_project_idx on public.test_cases (project_id, rank);
create index test_cases_issue_idx on public.test_cases (issue_id);

create table public.test_results (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.test_cases (id) on delete cascade,
  -- The case's project, copied in by test_results_guard (for RLS).
  project_id  uuid not null references public.projects (id) on delete cascade,
  status      public.test_status not null,
  reason      text not null default '' check (length(reason) <= 5000),
  environment text,
  -- 'manual': recorded in the app; 'automated': by a test run.
  source      text not null default 'manual' check (source in ('manual', 'automated')),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index test_results_case_idx on public.test_results (case_id, created_at desc);
create index test_results_project_idx on public.test_results (project_id, created_at desc);

-- The value as the project spells it in `p_list`, or an error naming `p_what`.
create function public.test_list_value(p_value text, p_list text[], p_what text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text;
begin
  select x into v from unnest(p_list) x where lower(x) = lower(trim(p_value)) limit 1;
  if v is null then
    raise exception '"%" isn''t one of this project''s %.', trim(p_value), p_what using errcode = '23514';
  end if;
  return v;
end;
$$;

create function public.test_cases_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
begin
  if tg_op = 'INSERT' then
    select * into v_project from public.projects where id = new.project_id for update;
    if not found then
      raise exception 'That project does not exist.' using errcode = '23503';
    end if;
    update public.projects set test_counter = test_counter + 1
     where id = new.project_id returning test_counter into new.number;
    new.key := v_project.key || '-T' || new.number;
    new.created_by := public.current_profile_id();
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

  -- Reordering, or a new result, isn't an edit.
  if tg_op = 'UPDATE' then
    if (new.issue_id, new.title, new.description, new.expected, new.type, new.level, new.areas)
       is distinct from (old.issue_id, old.title, old.description, old.expected, old.type, old.level, old.areas) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger test_cases_guard
  before insert or update on public.test_cases
  for each row execute function public.test_cases_guard();

create function public.test_results_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.test_cases where id = new.case_id;
  if not found then
    raise exception 'That test case does not exist.' using errcode = '23503';
  end if;
  new.project_id := v_project;
  new.recorded_by := public.current_profile_id();
  -- The clock, not the transaction's start: results recorded together keep their order.
  new.created_at := clock_timestamp();
  new.reason := btrim(coalesce(new.reason, ''), E' \t\r\n');
  if new.status in ('fail', 'blocked') and new.reason = '' then
    raise exception 'Say why it %.', case new.status when 'fail' then 'failed' else 'is blocked' end using errcode = '23514';
  end if;
  new.environment := nullif(trim(new.environment), '');
  if new.environment is not null and auth.uid() is not null then
    new.environment := public.test_list_value(new.environment,
      (select test_environments from public.projects where id = v_project), 'environments');
  end if;
  return new;
end;
$$;

create trigger test_results_guard
  before insert on public.test_results
  for each row execute function public.test_results_guard();

-- The case shows its latest result.
create function public.test_results_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_case uuid := coalesce(new.case_id, old.case_id);
begin
  update public.test_cases c
     set (last_status, last_reason, last_environment, last_recorded_by, last_recorded_at) =
         (select r.status, r.reason, r.environment, r.recorded_by, r.created_at
            from public.test_results r where r.case_id = v_case
           order by r.created_at desc, r.id desc limit 1)
   where c.id = v_case;
  return null;
end;
$$;

create trigger test_results_after_write
  after insert or delete on public.test_results
  for each row execute function public.test_results_after_write();

-- Renumber a project's test case order when two neighbours get too close.
create function public.test_cases_rerank(p_project uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_project(p_project) then
    raise exception 'You can''t reorder this project''s test cases.' using errcode = '42501';
  end if;
  update public.test_cases c
     set rank = o.n * 1024
    from (select id, row_number() over (order by rank, number) as n
            from public.test_cases where project_id = p_project) o
   where c.id = o.id;
end;
$$;

revoke execute on function
  public.clean_list(text[]), public.test_list_value(text, text[], text), public.test_cases_guard(),
  public.test_results_guard(), public.test_results_after_write(), public.test_cases_rerank(uuid)
  from public, anon, authenticated;
grant execute on function public.test_cases_rerank(uuid) to authenticated;

-- Project admins keep the lists (projects_update is theirs).
grant update (test_types, test_levels, test_environments) on public.projects to authenticated;

revoke all on public.test_cases, public.test_results from anon, authenticated;
-- key, number, created_by and the last_* columns are the triggers'.
grant select, delete on public.test_cases to authenticated;
grant insert (project_id, issue_id, title, description, expected, type, level, areas, rank) on public.test_cases to authenticated;
grant update (issue_id, title, description, expected, type, level, areas, rank) on public.test_cases to authenticated;
-- Results are added, never changed; project, author and source are the trigger's.
grant select, delete on public.test_results to authenticated;
grant insert (case_id, status, reason, environment) on public.test_results to authenticated;

alter table public.test_cases enable row level security;
alter table public.test_results enable row level security;

create policy test_cases_select on public.test_cases for select to authenticated
  using (public.can_view_project(project_id));
create policy test_cases_insert on public.test_cases for insert to authenticated
  with check (public.can_edit_project(project_id));
create policy test_cases_update on public.test_cases for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy test_cases_delete on public.test_cases for delete to authenticated
  using (public.can_edit_project(project_id));

create policy test_results_select on public.test_results for select to authenticated
  using (public.can_view_project(project_id));
create policy test_results_insert on public.test_results for insert to authenticated
  with check (public.can_edit_project(project_id));
-- Taking back a result you recorded (a slip): yours only.
create policy test_results_delete on public.test_results for delete to authenticated
  using (recorded_by = (select public.current_profile_id()) and public.can_edit_project(project_id));

-- The sheet updates live as others edit it.
alter publication supabase_realtime add table public.test_cases;
