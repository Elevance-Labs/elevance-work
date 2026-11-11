-- Assertion and identity helpers for test/sql/*.test.sql (see
-- scripts/test-sql.sh). They live in schema `t`, which exists only in the
-- test database.
create schema t;
grant usage on schema t to authenticated, anon;

create table t.results (id serial primary key, name text not null, ok boolean not null, detail text);
grant insert, select on t.results to authenticated, anon;
grant usage on sequence t.results_id_seq to authenticated, anon;

create function t.ok(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into t.results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

create function t.eq(p_name text, p_got anyelement, p_want anyelement)
returns void language sql as $$
  insert into t.results (name, ok, detail)
  values (p_name, p_got is not distinct from p_want, format('got %s, want %s', p_got, p_want));
$$;

-- Passes when p_sql raises, with this SQLSTATE and/or message fragment if given.
create function t.throws(p_name text, p_sql text, p_code text default null, p_message text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    insert into t.results (name, ok, detail) values (p_name,
      (p_code is null or sqlstate = p_code) and (p_message is null or sqlerrm ilike '%' || p_message || '%'),
      format('%s: %s', sqlstate, sqlerrm));
    return;
  end;
  insert into t.results (name, ok, detail) values (p_name, false, 'no error was raised');
end;
$$;

-- How many rows a statement touched (RLS refuses an update or delete by
-- matching nothing, not by raising).
create function t.rows(p_sql text)
returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Act as this person from now on: their auth user, the `authenticated` role.
create function t.login(p_name text)
returns void language plpgsql as $$
declare
  v_uid   uuid;
  v_email text := p_name || '@elevancelabs.com';
begin
  execute 'reset role';
  select user_id into v_uid from public.profiles where email = v_email;
  perform set_config('test.uid', coalesce(v_uid::text, gen_random_uuid()::text), false);
  perform set_config('test.jwt', jsonb_build_object(
    'email', v_email, 'app_metadata', jsonb_build_object('provider', 'google'),
    'user_metadata', jsonb_build_object('avatar_url', 'https://lh3.googleusercontent.com/' || p_name))::text, false);
  execute 'set role authenticated';
end;
$$;

create function t.as_anon()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('test.uid', '', false);
  perform set_config('test.jwt', '', false);
  execute 'set role anon';
end;
$$;

-- Back to postgres (no RLS), still "signed in" as whoever was last.
create function t.superuser()
returns void language plpgsql as $$
begin
  execute 'reset role';
end;
$$;

-- Lookups that ignore RLS, so a test can name rows it can't see.
create function t.pid(p_name text) returns uuid language sql stable security definer as
  $$ select id from public.profiles where email = p_name || '@elevancelabs.com' $$;
create function t.project(p_key text) returns uuid language sql stable security definer as
  $$ select id from public.projects where key = p_key $$;
create function t.issue(p_key text) returns uuid language sql stable security definer as
  $$ select id from public.issues where key = p_key $$;
create function t.status(p_key text, p_name text) returns uuid language sql stable security definer as
  $$ select s.id from public.project_statuses s join public.projects p on p.id = s.project_id
      where p.key = p_key and s.name = p_name $$;
create function t.type(p_name text) returns uuid language sql stable security definer as
  $$ select id from public.issue_types where name = p_name $$;
create function t.sprint(p_key text, p_name text) returns uuid language sql stable security definer as
  $$ select s.id from public.sprints s join public.projects p on p.id = s.project_id
      where p.key = p_key and s.name = p_name $$;
create function t.notifications(p_name text) returns setof public.notifications
  language sql stable security definer as
  $$ select * from public.notifications where recipient_id = t.pid(p_name) order by created_at, id $$;

-- Insert an issue as whoever is signed in; returns its key.
create function t.new_issue(p_project text, p_title text, p_type text default 'Task', p_extra jsonb default '{}')
returns text language plpgsql as $$
declare
  v_key text;
begin
  insert into public.issues (project_id, type_id, title, parent_id, sprint_id, assignee_id, story_points, description)
  values (t.project(p_project), t.type(p_type), p_title,
          (p_extra ->> 'parent_id')::uuid, (p_extra ->> 'sprint_id')::uuid, (p_extra ->> 'assignee_id')::uuid,
          (p_extra ->> 'story_points')::numeric, coalesce(p_extra ->> 'description', ''))
  returning key into v_key;
  return v_key;
end;
$$;

grant execute on all functions in schema t to authenticated, anon;
