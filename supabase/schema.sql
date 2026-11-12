-- Elevance Work: people, projects, issues, sprints, releases, comments,
-- attachments and docs (Google Drive), notifications, the shared calendar,
-- todos, notes, saved filters, and the hooks that reach Google Chat and Calendar.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'member');
-- A workspace admin is admin of every project; everyone else has the role
-- their membership gives, or viewer on an open project.
create type public.project_role as enum ('admin', 'member', 'viewer');
create type public.project_kind as enum ('scrum', 'kanban');
create type public.project_visibility as enum ('private', 'open');
create type public.status_category as enum ('todo', 'in_progress', 'done');
create type public.issue_level as enum ('epic', 'standard', 'subtask');
create type public.issue_priority as enum ('highest', 'high', 'medium', 'low', 'lowest');
create type public.field_kind as enum
  ('text', 'number', 'date', 'select', 'multi_select', 'user', 'url', 'checkbox');
create type public.sprint_state as enum ('future', 'active', 'closed');
create type public.release_status as enum ('unreleased', 'released', 'archived');
create type public.link_kind as enum ('blocks', 'relates', 'duplicates', 'clones');
create type public.doc_type as enum
  ('document', 'spreadsheet', 'presentation', 'form', 'drawing', 'folder', 'file');
create type public.notification_kind as enum
  ('assigned', 'mentioned', 'commented', 'status_changed', 'test');
create type public.note_color as enum
  ('yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'gray', 'white');
create type public.dev_link_kind as enum ('branch', 'commit', 'pull_request');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- Everyone who may sign in. Added by a workspace admin; bound to a Google
-- account by email on first sign-in. Never deleted, only deactivated, so the
-- history they wrote keeps its names.
create table public.profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references auth.users (id) on delete set null,
  email      text not null unique
             check (email = lower(email) and email like '%@elevancelabs.com'),
  full_name  text not null check (length(trim(full_name)) between 1 and 120),
  title      text check (length(title) <= 120),
  avatar_url text check (avatar_url like 'https://%'),
  app_role   public.app_role not null default 'member',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.current_profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.profiles where user_id = (select auth.uid()) and active;
$$;

create function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select app_role = 'admin' from public.profiles where user_id = (select auth.uid()) and active),
    false);
$$;

-- Called by the app right after Google sign-in. Binds the auth user to the
-- profile with the same email, if it is active, and keeps the Google photo.
-- Returns the profile, or nothing when sign-in must be refused.
create function public.bind_profile()
returns setof public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text := lower(auth.jwt() ->> 'email');
  v_avatar text := auth.jwt() -> 'user_metadata' ->> 'avatar_url';
begin
  if v_uid is null or v_email is null
     or v_email not like '%@elevancelabs.com'
     or coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google' then
    return;
  end if;

  update public.profiles p
     set user_id = v_uid
   where p.email = v_email and p.user_id is null and p.active;

  if v_avatar like 'https://%' then
    update public.profiles p
       set avatar_url = v_avatar
     where p.user_id = v_uid and p.avatar_url is distinct from v_avatar;
  end if;

  return query
    select * from public.profiles p
     where p.user_id = v_uid and p.email = v_email and p.active;
end;
$$;

-- Optional hardening: enable as the "Before User Created" auth hook so that
-- people without an active profile never get an auth user at all.
create function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  if v_email is null or v_email not like '%@elevancelabs.com' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Only @elevancelabs.com accounts can sign in.'));
  end if;
  if not exists (select 1 from public.profiles where email = v_email and active) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'No active Elevance Work account for this address.'));
  end if;
  return '{}'::jsonb;
end;
$$;

create function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() is null for the SQL editor / service role: no restrictions.
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      raise exception 'Only a workspace admin can add people.' using errcode = '42501';
    end if;
    if new.app_role is distinct from old.app_role
       or new.email is distinct from old.email
       or new.active is distinct from old.active then
      raise exception 'Only a workspace admin can change a role, an email or access.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- Never leave the workspace without an admin who can sign in.
    if old.app_role = 'admin' and old.active
       and (new.app_role <> 'admin' or not new.active)
       and not exists (select 1 from public.profiles
                        where app_role = 'admin' and active and id <> old.id) then
      raise exception 'The workspace needs at least one active admin.' using errcode = '23514';
    end if;
    if new.email is distinct from old.email then
      new.user_id := null; -- rebinds on next sign-in with the new email
    end if;
    new.updated_at := now();
  end if;
  new.full_name := trim(new.full_name);
  new.title := nullif(trim(new.title), '');
  return new;
end;
$$;

create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------------
-- Projects and their configuration
-- ---------------------------------------------------------------------------
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  -- Immutable: it is in every issue key and every link people have shared.
  key             text not null unique check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name            text not null check (length(trim(name)) between 1 and 80),
  description     text not null default '' check (length(description) <= 2000),
  kind            public.project_kind not null default 'scrum',
  visibility      public.project_visibility not null default 'private',
  lead_id         uuid references public.profiles (id) on delete set null,
  color           text not null default '#3f51b5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  issue_counter   integer not null default 0,
  -- The project's folder in the shared drive, made by the drive function.
  drive_folder_id text,
  archived_at     timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role       public.project_role not null default 'member',
  added_at   timestamptz not null default now(),
  primary key (project_id, profile_id)
);
create index project_members_profile_idx on public.project_members (profile_id);

-- A project's workflow: its statuses, in board order. Any status can move to
-- any other (a simplified workflow); the category is what reports and
-- "resolved" go by.
create table public.project_statuses (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 40),
  category   public.status_category not null,
  position   integer not null,
  wip_limit  integer check (wip_limit > 0)
);
create unique index project_statuses_name_key on public.project_statuses (project_id, lower(name));

-- Workspace-wide issue types. The level decides the hierarchy:
-- epic > standard (story, task, bug…) > subtask.
create table public.issue_types (
  id       uuid primary key default gen_random_uuid(),
  name     text not null check (length(trim(name)) between 1 and 40),
  level    public.issue_level not null default 'standard',
  icon     text not null default 'task'
           check (icon in ('epic', 'story', 'task', 'bug', 'subtask', 'spike', 'improvement', 'feature')),
  color    text not null default '#4bade8' check (color ~ '^#[0-9a-fA-F]{6}$'),
  archived boolean not null default false
);
create unique index issue_types_name_key on public.issue_types (lower(name));

-- A project's custom fields. Values live in issues.custom, keyed by field id,
-- and are checked by issue_custom_clean.
create table public.fields (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 60),
  kind           public.field_kind not null,
  options        text[] not null default '{}' check (cardinality(options) <= 100),
  -- null = every issue type.
  issue_type_ids uuid[],
  required       boolean not null default false,
  position       integer not null,
  created_at     timestamptz not null default now()
);
create unique index fields_name_key on public.fields (project_id, lower(name));

-- Where a project's Google Chat messages go. The webhook URL lets anyone
-- holding it post into the space, so only project admins read it.
create table public.project_integrations (
  project_id       uuid primary key references public.projects (id) on delete cascade,
  chat_webhook_url text check (chat_webhook_url ~ '^https://chat\.googleapis\.com/'),
  chat_events      text[] not null
                   default '{issue_created,status_changed,comment_added,sprint_started,sprint_completed,release_released}'
                   check (chat_events <@ array['issue_created', 'status_changed', 'issue_assigned', 'comment_added',
                                               'sprint_started', 'sprint_completed', 'release_released']),
  updated_at       timestamptz not null default now()
);

-- One row: the company-wide Chat space for releases.
create table public.workspace_settings (
  id               boolean primary key default true check (id),
  chat_webhook_url text check (chat_webhook_url ~ '^https://chat\.googleapis\.com/'),
  chat_events      text[] not null default '{release_released}'
                   check (chat_events <@ array['release_released']),
  updated_at       timestamptz not null default now()
);
insert into public.workspace_settings default values;

-- ---------------------------------------------------------------------------
-- Project access (used by RLS)
-- ---------------------------------------------------------------------------

-- A profile's role in a project, or null if they may not see it. An archived
-- project is read-only for everyone but workspace admins.
create function public.role_in_project(p_profile uuid, p_project uuid)
returns public.project_role language sql stable security definer set search_path = '' as $$
  select case
    when pr.app_role = 'admin' then 'admin'::public.project_role
    when p.archived_at is not null and (m.role is not null or p.visibility = 'open') then 'viewer'::public.project_role
    else coalesce(m.role, case when p.visibility = 'open' then 'viewer'::public.project_role end)
  end
  from public.profiles pr
  cross join public.projects p
  left join public.project_members m on m.project_id = p.id and m.profile_id = pr.id
  where pr.id = p_profile and pr.active and p.id = p_project;
$$;

create function public.project_role_of(p_project uuid)
returns public.project_role language sql stable security definer set search_path = '' as $$
  select public.role_in_project(public.current_profile_id(), p_project);
$$;

create function public.can_view_project(p_project uuid)
returns boolean language sql stable set search_path = '' as $$
  select public.project_role_of(p_project) is not null;
$$;

create function public.can_edit_project(p_project uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.project_role_of(p_project) in ('admin', 'member'), false);
$$;

create function public.can_admin_project(p_project uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.project_role_of(p_project) = 'admin', false);
$$;

create function public.projects_guard()
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
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_guard
  before update on public.projects
  for each row execute function public.projects_guard();

-- The only way a project is made: a workspace admin, with the default
-- workflow, and the creator as its admin.
create function public.project_create(
  p_key text, p_name text, p_kind public.project_kind,
  p_visibility public.project_visibility default 'private', p_description text default '')
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := public.current_profile_id();
  v_project public.projects;
begin
  if not public.is_admin() then
    raise exception 'Only a workspace admin can create projects.' using errcode = '42501';
  end if;
  insert into public.projects (key, name, kind, visibility, description, lead_id, created_by)
  values (upper(trim(p_key)), trim(p_name), p_kind, p_visibility, coalesce(p_description, ''), v_me, v_me)
  returning * into v_project;

  insert into public.project_members (project_id, profile_id, role) values (v_project.id, v_me, 'admin');
  insert into public.project_statuses (project_id, name, category, position) values
    (v_project.id, 'To Do', 'todo', 0),
    (v_project.id, 'In Progress', 'in_progress', 1),
    (v_project.id, 'In Review', 'in_progress', 2),
    (v_project.id, 'Done', 'done', 3);
  return v_project;
end;
$$;

create function public.project_statuses_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid := coalesce(new.project_id, old.project_id);
begin
  if tg_op = 'INSERT' then
    select coalesce(max(position), -1) + 1 into new.position
      from public.project_statuses where project_id = new.project_id;
  elsif tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'A status belongs to one project.' using errcode = '42501';
  end if;
  -- A workflow always has somewhere to start and somewhere to finish.
  if tg_op in ('UPDATE', 'DELETE') and old.category in ('todo', 'done')
     and (tg_op = 'DELETE' or new.category <> old.category)
     and exists (select 1 from public.projects where id = v_project)
     and not exists (select 1 from public.project_statuses
                      where project_id = v_project and category = old.category and id <> old.id) then
    raise exception 'A project needs at least one % status.',
      case old.category when 'todo' then 'To Do' else 'Done' end using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.name := trim(new.name);
  return new;
end;
$$;

create trigger project_statuses_guard
  before insert or update or delete on public.project_statuses
  for each row execute function public.project_statuses_guard();

-- Board order. Takes every status of the project, in the new order.
create function public.project_statuses_reorder(p_project uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_admin_project(p_project) then
    raise exception 'Only a project admin can change the workflow.' using errcode = '42501';
  end if;
  if (select array_agg(id order by id) from public.project_statuses where project_id = p_project)
     is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'Give every status of the project exactly once.' using errcode = '22023';
  end if;
  update public.project_statuses s
     set position = o.n - 1
    from unnest(p_ids) with ordinality as o(id, n)
   where s.id = o.id;
end;
$$;

create function public.fields_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(position), -1) + 1 into new.position
      from public.fields where project_id = new.project_id;
  elsif new.project_id <> old.project_id or new.kind <> old.kind then
    raise exception 'A field''s project and kind never change.' using errcode = '42501';
  end if;
  new.name := trim(new.name);
  select coalesce(array_agg(distinct trim(o)) filter (where trim(o) <> ''), '{}')
    into new.options from unnest(new.options) o;
  if new.kind in ('select', 'multi_select') and cardinality(new.options) = 0 then
    raise exception 'A choice field needs at least one option.' using errcode = '23514';
  end if;
  if new.kind not in ('select', 'multi_select') then
    new.options := '{}';
  end if;
  return new;
end;
$$;

create trigger fields_guard
  before insert or update on public.fields
  for each row execute function public.fields_guard();

create function public.fields_reorder(p_project uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_admin_project(p_project) then
    raise exception 'Only a project admin can change fields.' using errcode = '42501';
  end if;
  if (select array_agg(id order by id) from public.fields where project_id = p_project)
     is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'Give every field of the project exactly once.' using errcode = '22023';
  end if;
  update public.fields f
     set position = o.n - 1
    from unnest(p_ids) with ordinality as o(id, n)
   where f.id = o.id;
end;
$$;

create function public.issue_types_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.level <> old.level and exists (select 1 from public.issues where type_id = new.id) then
    raise exception 'This type is in use, so its level can''t change.' using errcode = '23514';
  end if;
  new.name := trim(new.name);
  return new;
end;
$$;

create function public.integrations_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger project_integrations_stamp
  before insert or update on public.project_integrations
  for each row execute function public.integrations_stamp();

create trigger workspace_settings_stamp
  before update on public.workspace_settings
  for each row execute function public.integrations_stamp();

-- ---------------------------------------------------------------------------
-- Sprints and releases
-- ---------------------------------------------------------------------------
create table public.sprints (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  goal         text not null default '' check (length(goal) <= 1000),
  -- Moves only through sprint_start / sprint_complete.
  state        public.sprint_state not null default 'future',
  start_date   date,
  end_date     date,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  check (end_date >= start_date)
);
create index sprints_project_idx on public.sprints (project_id);
create unique index sprints_one_active on public.sprints (project_id) where state = 'active';

create table public.releases (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 80),
  description     text not null default '' check (length(description) <= 2000),
  start_date      date,
  release_date    date,
  status          public.release_status not null default 'unreleased',
  released_at     timestamptz,
  -- Its entry in the shared Google Calendar, kept by calendar-sync.
  google_event_id text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (release_date >= start_date)
);
create unique index releases_name_key on public.releases (project_id, lower(name));

create function public.sprints_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select kind from public.projects where id = new.project_id) = 'kanban' then
      raise exception 'Kanban projects have no sprints.' using errcode = '23514';
    end if;
  elsif new.project_id <> old.project_id then
    raise exception 'A sprint belongs to one project.' using errcode = '42501';
  elsif old.state = 'closed' then
    raise exception 'A completed sprint can''t be changed.' using errcode = '23514';
  end if;
  new.name := trim(new.name);
  return new;
end;
$$;

create trigger sprints_guard
  before insert or update on public.sprints
  for each row execute function public.sprints_guard();

create function public.releases_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := public.current_profile_id();
    new.released_at := case when new.status = 'released' then now() end;
  else
    if new.project_id <> old.project_id then
      raise exception 'A release belongs to one project.' using errcode = '42501';
    end if;
    if new.status = 'released' and old.status <> 'released' then
      new.released_at := now();
    elsif new.status = 'unreleased' then
      new.released_at := null;
    end if;
  end if;
  new.name := trim(new.name);
  return new;
end;
$$;

create trigger releases_guard
  before insert or update on public.releases
  for each row execute function public.releases_guard();

-- ---------------------------------------------------------------------------
-- Issues
-- ---------------------------------------------------------------------------
create table public.issues (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  -- number and key are set by issues_guard from the project's counter.
  number       integer not null,
  key          text not null unique,
  type_id      uuid not null references public.issue_types (id),
  status_id    uuid not null references public.project_statuses (id),
  title        text not null check (length(title) between 1 and 255),
  -- Rich text (HTML from the editor); sanitised on save and on render.
  description  text not null default '' check (length(description) <= 200000),
  priority     public.issue_priority not null default 'medium',
  assignee_id  uuid references public.profiles (id) on delete set null,
  reporter_id  uuid references public.profiles (id) on delete set null,
  parent_id    uuid references public.issues (id) on delete set null,
  sprint_id    uuid references public.sprints (id) on delete set null,
  release_id   uuid references public.releases (id) on delete set null,
  story_points numeric(6, 1) check (story_points between 0 and 1000),
  start_date   date,
  due_date     date,
  labels       text[] not null default '{}',
  -- Order on the backlog and within a board column.
  rank         double precision not null,
  custom       jsonb not null default '{}',
  resolved_at  timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  search       tsvector generated always as (
                 to_tsvector('simple', key || ' ' || title || ' ' ||
                   left(regexp_replace(description, '<[^>]*>', ' ', 'g'), 20000))) stored,
  unique (project_id, number),
  check (due_date >= start_date)
);
create index issues_project_idx on public.issues (project_id, rank);
create index issues_sprint_idx on public.issues (sprint_id);
create index issues_assignee_idx on public.issues (assignee_id);
create index issues_parent_idx on public.issues (parent_id);
create index issues_status_idx on public.issues (status_id);
create index issues_release_idx on public.issues (release_id);
create index issues_labels_idx on public.issues using gin (labels);
create index issues_search_idx on public.issues using gin (search);

create function public.can_view_issue(p_issue uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.can_view_project(project_id) from public.issues where id = p_issue), false);
$$;

create function public.can_edit_issue(p_issue uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public.can_edit_project(project_id) from public.issues where id = p_issue), false);
$$;

-- Keeps only the custom values for the project's fields, checked against
-- each field's kind and options. Unchanged values are kept as they are, so
-- removing an option doesn't make old issues uneditable.
create function public.issue_custom_clean(p_project uuid, p_type uuid, p_new jsonb, p_old jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f      record;
  k      text;
  v      jsonb;
  s      text;
  ok     boolean;
  result jsonb := '{}';
begin
  for f in select * from public.fields where project_id = p_project order by position loop
    k := f.id::text;
    v := p_new -> k;
    if f.issue_type_ids is not null and not (p_type = any (f.issue_type_ids)) then
      continue;
    end if;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb then
      if f.required and (p_old is null or (p_old ? k)) then
        raise exception '% is required.', f.name using errcode = '23514';
      end if;
      continue;
    end if;
    if p_old is not null and p_old -> k = v then
      result := result || jsonb_build_object(k, v);
      continue;
    end if;
    s := case when jsonb_typeof(v) = 'string' then v #>> '{}' end;
    ok := case f.kind
      when 'text' then s is not null and length(s) <= 5000
      when 'number' then jsonb_typeof(v) = 'number'
      when 'date' then s ~ '^\d{4}-\d{2}-\d{2}$'
      when 'select' then s = any (f.options)
      when 'multi_select' then jsonb_typeof(v) = 'array' and not exists (
        select 1 from jsonb_array_elements(v) e
         where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (f.options)))
      when 'user' then s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       and exists (select 1 from public.profiles where id = s::uuid)
      when 'url' then s ~ '^https?://' and length(s) <= 2000
      when 'checkbox' then jsonb_typeof(v) = 'boolean'
    end;
    if f.kind = 'date' and ok then
      begin
        perform s::date;
      exception when others then
        ok := false;
      end;
    end if;
    if not ok then
      raise exception 'That is not a valid value for %.', f.name using errcode = '22023';
    end if;
    result := result || jsonb_build_object(k, v);
  end loop;
  return result;
end;
$$;

create function public.issues_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_project      public.projects;
  v_level        public.issue_level;
  v_parent       public.issues;
  v_parent_level public.issue_level;
  v_category     public.status_category;
  v_old_category public.status_category;
begin
  if tg_op = 'INSERT' then
    select * into v_project from public.projects where id = new.project_id for update;
    if not found then
      raise exception 'That project does not exist.' using errcode = '23503';
    end if;
    update public.projects set issue_counter = issue_counter + 1
     where id = new.project_id returning issue_counter into new.number;
    new.key := v_project.key || '-' || new.number;
    new.created_by := public.current_profile_id();
    new.reporter_id := coalesce(new.reporter_id, new.created_by);
    new.created_at := now();
    new.updated_at := now();
    if new.status_id is null then
      select id into new.status_id from public.project_statuses
       where project_id = new.project_id and category = 'todo' order by position limit 1;
    end if;
    if new.rank is null then
      select coalesce(max(rank), 0) + 1024 into new.rank
        from public.issues where project_id = new.project_id;
    end if;
  else
    if new.project_id <> old.project_id or new.number <> old.number or new.key <> old.key
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'An issue''s project, key and creator never change.' using errcode = '42501';
    end if;
    select * into v_project from public.projects where id = new.project_id;
    select category into v_old_category from public.project_statuses where id = old.status_id;
  end if;

  new.title := trim(new.title);
  select coalesce(array_agg(distinct l) filter (where l <> ''), '{}') into new.labels
    from (select left(regexp_replace(lower(trim(x)), '\s+', '-', 'g'), 50) as l from unnest(new.labels) x) t;
  if cardinality(new.labels) > 20 then
    raise exception 'An issue can have at most 20 labels.' using errcode = '23514';
  end if;

  select category into v_category from public.project_statuses
   where id = new.status_id and project_id = new.project_id;
  if not found then
    raise exception 'That status is not part of this project.' using errcode = '23514';
  end if;

  select level into v_level from public.issue_types
   where id = new.type_id
     and (not archived or (tg_op = 'UPDATE' and new.type_id = old.type_id));
  if not found then
    raise exception 'That issue type is not available.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.type_id <> old.type_id
     and v_level <> (select level from public.issue_types where id = old.type_id)
     and exists (select 1 from public.issues where parent_id = new.id) then
    raise exception 'Move this issue''s child issues first.' using errcode = '23514';
  end if;

  -- The hierarchy: an epic has no parent, a standard issue may sit under an
  -- epic, a sub-task always sits under a standard issue.
  if new.parent_id is not null then
    select * into v_parent from public.issues where id = new.parent_id;
    if not found or v_parent.project_id <> new.project_id or v_parent.id = new.id then
      raise exception 'The parent must be another issue in this project.' using errcode = '23514';
    end if;
    select level into v_parent_level from public.issue_types where id = v_parent.type_id;
    if v_level = 'epic' then
      raise exception 'An epic can''t have a parent.' using errcode = '23514';
    elsif v_level = 'standard' and v_parent_level <> 'epic' then
      raise exception 'Only an epic can be the parent of this issue.' using errcode = '23514';
    elsif v_level = 'subtask' and v_parent_level <> 'standard' then
      raise exception 'A sub-task''s parent must be a story, task or bug.' using errcode = '23514';
    end if;
  elsif v_level = 'subtask' then
    raise exception 'A sub-task needs a parent.' using errcode = '23514';
  end if;

  -- Sprints: a sub-task goes where its parent goes; an epic spans sprints;
  -- reopening an issue from a completed sprint puts it back on the backlog.
  if v_level = 'subtask' then
    new.sprint_id := v_parent.sprint_id;
  elsif v_level = 'epic' then
    if new.sprint_id is not null then
      raise exception 'An epic isn''t planned into a sprint; plan its issues instead.' using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' and v_old_category = 'done' and v_category <> 'done'
        and new.sprint_id is not distinct from old.sprint_id
        and exists (select 1 from public.sprints where id = new.sprint_id and state = 'closed') then
    new.sprint_id := null;
  end if;
  if new.sprint_id is not null and (tg_op = 'INSERT' or new.sprint_id is distinct from old.sprint_id)
     and v_level <> 'subtask' then
    if v_project.kind = 'kanban' then
      raise exception 'Kanban projects have no sprints.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.sprints
                    where id = new.sprint_id and project_id = new.project_id and state <> 'closed') then
      raise exception 'That sprint is completed or not in this project.' using errcode = '23514';
    end if;
  end if;

  if new.release_id is not null and (tg_op = 'INSERT' or new.release_id is distinct from old.release_id)
     and not exists (select 1 from public.releases where id = new.release_id and project_id = new.project_id) then
    raise exception 'That release is not in this project.' using errcode = '23514';
  end if;

  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and coalesce(public.role_in_project(new.assignee_id, new.project_id) in ('admin', 'member'), false) = false then
    raise exception 'Only a member of this project can be assigned.' using errcode = '23514';
  end if;

  new.custom := public.issue_custom_clean(new.project_id, new.type_id, coalesce(new.custom, '{}'),
                                          case when tg_op = 'UPDATE' then old.custom end);

  if v_category = 'done' then
    new.resolved_at := case when tg_op = 'UPDATE' and old.resolved_at is not null then old.resolved_at else now() end;
  else
    new.resolved_at := null;
  end if;

  -- Reordering alone isn't an update anyone needs to hear about.
  if tg_op = 'UPDATE' and (new.type_id, new.status_id, new.title, new.description, new.priority, new.assignee_id,
                           new.reporter_id, new.parent_id, new.sprint_id, new.release_id, new.story_points,
                           new.start_date, new.due_date, new.labels, new.custom)
      is distinct from (old.type_id, old.status_id, old.title, old.description, old.priority, old.assignee_id,
                        old.reporter_id, old.parent_id, old.sprint_id, old.release_id, old.story_points,
                        old.start_date, old.due_date, old.labels, old.custom) then
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger issues_guard
  before insert or update on public.issues
  for each row execute function public.issues_guard();

-- Deleting a standard issue deletes its sub-tasks; children of an epic stay
-- (their parent is cleared by the foreign key).
create function public.issues_delete_subtasks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.issues c
   using public.issue_types t
   where c.parent_id = old.id and t.id = c.type_id and t.level = 'subtask';
  return old;
end;
$$;

create trigger issues_delete_subtasks
  before delete on public.issues
  for each row execute function public.issues_delete_subtasks();

create trigger issue_types_guard
  before update on public.issue_types
  for each row execute function public.issue_types_guard();

-- Recompute resolved_at when a status changes category.
create function public.project_statuses_recategorise()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.category <> old.category then
    update public.issues set resolved_at = null where status_id = new.id;
  end if;
  return null;
end;
$$;

create trigger project_statuses_recategorise
  after update on public.project_statuses
  for each row execute function public.project_statuses_recategorise();

-- Renumber a project's ranks when two neighbours get too close to fit
-- another issue between them.
create function public.project_rerank(p_project uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_project(p_project) then
    raise exception 'You can''t reorder this project.' using errcode = '42501';
  end if;
  update public.issues i
     set rank = o.n * 1024
    from (select id, row_number() over (order by rank, number) as n
            from public.issues where project_id = p_project) o
   where i.id = o.id;
end;
$$;

-- What happened to an issue, field by field. Written only by triggers; the
-- names are copied in so the activity reads the same after a rename.
create table public.issue_events (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.issues (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  field      text not null,
  from_value text,
  to_value   text,
  from_id    uuid,
  to_id      uuid,
  created_at timestamptz not null default now()
);
create index issue_events_issue_idx on public.issue_events (issue_id, created_at);
create index issue_events_project_idx on public.issue_events (project_id, created_at);

-- Committed and completed work per sprint, written by sprint_start and
-- sprint_complete: what the velocity chart and sprint report read.
create table public.sprint_issues (
  sprint_id       uuid not null references public.sprints (id) on delete cascade,
  issue_id        uuid not null references public.issues (id) on delete cascade,
  committed       boolean not null default false,
  points_at_start numeric(6, 1),
  points_at_end   numeric(6, 1),
  completed       boolean,
  primary key (sprint_id, issue_id)
);

create table public.issue_links (
  id         uuid primary key default gen_random_uuid(),
  -- source <kind> target, e.g. ABC-1 blocks ABC-2.
  source_id  uuid not null references public.issues (id) on delete cascade,
  target_id  uuid not null references public.issues (id) on delete cascade,
  kind       public.link_kind not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_id, target_id, kind),
  check (source_id <> target_id)
);
create index issue_links_target_idx on public.issue_links (target_id);

-- The branches, commits and pull requests on GitHub that name an issue's key,
-- one row per thing, per issue. Written only by the `github` Edge Function
-- (service role) from the organisation's webhook; clients only read.
create table public.issue_dev_links (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references public.issues (id) on delete cascade,
  kind        public.dev_link_kind not null,
  -- owner/name, as GitHub writes it.
  repo        text not null check (length(repo) between 1 and 200),
  -- What it is within the repo: the branch's name, the commit's sha, the pull request's number.
  ref         text not null check (length(ref) between 1 and 300),
  -- The pull request's title, or the first line of the commit message.
  title       text not null default '',
  url         text not null check (url like 'https://%'),
  -- Pull requests only.
  state       text check (state in ('open', 'draft', 'merged', 'closed')),
  -- A GitHub login or commit author: not one of our people.
  author      text,
  happened_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (issue_id, kind, repo, ref)
);

create table public.issue_watchers (
  issue_id   uuid not null references public.issues (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (issue_id, profile_id)
);
create index issue_watchers_profile_idx on public.issue_watchers (profile_id);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.issues (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  -- Rich text (HTML from the editor); sanitised on save and on render.
  body       text not null check (length(body) between 1 and 100000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  -- For attachments.comment_id: a file names a comment on its own issue.
  constraint comments_id_issue_key unique (id, issue_id)
);
create index comments_issue_idx on public.comments (issue_id, created_at);

-- Files in the project's Drive folder. Written only by the drive function.
-- A file added with a comment names it; deleting the comment leaves the file
-- on the issue (and in Drive), just no longer with the comment.
create table public.attachments (
  id             uuid primary key default gen_random_uuid(),
  issue_id       uuid not null references public.issues (id) on delete cascade,
  drive_file_id  text not null unique,
  file_name      text not null,
  mime_type      text not null,
  size_bytes     bigint not null,
  web_view_link  text not null,
  uploaded_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  comment_id     uuid,
  constraint attachments_comment_fkey foreign key (comment_id, issue_id)
    references public.comments (id, issue_id) on delete set null (comment_id)
);
create index attachments_issue_idx on public.attachments (issue_id);
create index attachments_comment_idx on public.attachments (comment_id) where comment_id is not null;

-- Google Docs, Sheets, Slides… made in the project's folder by the drive
-- function, or linked by anyone who can edit the project.
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  issue_id      uuid references public.issues (id) on delete set null,
  title         text not null check (length(trim(title)) between 1 and 200),
  url           text not null check (url ~ '^https://(docs|drive|sheets|slides|forms)\.google\.com/'),
  doc_type      public.doc_type not null default 'file',
  drive_file_id text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index documents_project_idx on public.documents (project_id);
create index documents_issue_idx on public.documents (issue_id);

create table public.saved_filters (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 80),
  -- The filter bar's state, read by lib/filters.ts.
  query      jsonb not null check (jsonb_typeof(query) = 'object'),
  shared     boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Todos and calendars
-- ---------------------------------------------------------------------------

-- Seen and changed by its creator and the people they (or anyone on it)
-- add; deleted only by the creator. Tied to an issue, or just to a project
-- (an issue's todo is in the issue's project: todos_guard).
create table public.todos (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 300),
  notes       text not null default '' check (length(notes) <= 5000),
  due_on      date,
  done_at     timestamptz,
  issue_id    uuid references public.issues (id) on delete set null,
  position    double precision not null default extract(epoch from now()),
  created_at  timestamptz not null default now(),
  -- Everyone else on it: active people, each once, never the creator
  -- (todos_guard). They leave through todo_leave.
  shared_with uuid[] not null default '{}',
  project_id  uuid references public.projects (id) on delete set null
);
create index todos_owner_idx on public.todos (owner_id);
create index todos_shared_with_idx on public.todos using gin (shared_with);
create index todos_project_idx on public.todos (project_id);

-- Your own Google Calendar: the google-calendar function's encrypted refresh
-- token per person. No client reads or writes it (service role only).
create table public.calendar_connections (
  profile_id    uuid primary key references public.profiles (id) on delete cascade,
  -- The Google account (its primary calendar id), which matches the profile's email.
  google_email  text not null,
  -- AES-GCM ciphertext, keyed by the function secret GOOGLE_TOKEN_KEY.
  refresh_token text not null,
  connected_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

-- Each person's own labels; names unique per person, ignoring case.
create table public.note_labels (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index note_labels_owner_name_key on public.note_labels (owner_id, lower(name));

-- Sticky notes, private to their owner (even from admins). A project's page
-- shows your notes on it; pinned ones are on your dashboard. A meeting (from
-- your own Google Calendar, which the app never stores) has at most one note
-- of yours: its Google event id, with its title and day copied in to show.
-- A note is archived before it can be deleted.
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  title      text not null default '' check (length(title) <= 200),
  body       text not null default '' check (length(body) <= 20000),
  color      public.note_color not null default 'yellow',
  -- The owner's note_labels (notes_guard keeps only theirs).
  label_ids  uuid[] not null default '{}',
  project_id uuid references public.projects (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Last time its title or text changed.
  updated_at timestamptz not null default now(),
  pinned        boolean not null default false,
  -- A Google Calendar event (one occurrence of a repeating one has its own id).
  meeting_id    text check (length(meeting_id) between 1 and 1024),
  meeting_title text check (length(meeting_title) <= 300),
  meeting_on    date,
  -- Put away: off every list but the archive, never pinned; only an
  -- archived note can be deleted (notes_delete).
  archived_at   timestamptz,
  check (length(trim(title)) > 0 or length(trim(body)) > 0),
  constraint notes_meeting_check check (meeting_id is not null or (meeting_title is null and meeting_on is null))
);
create index notes_owner_idx on public.notes (owner_id, updated_at desc);
create index notes_project_idx on public.notes (project_id);
create unique index notes_meeting_key on public.notes (owner_id, meeting_id);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  kind         public.notification_kind not null,
  issue_id     uuid references public.issues (id) on delete cascade,
  comment_id   uuid references public.comments (id) on delete cascade,
  -- e.g. the new status's name.
  detail       text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- The devices someone turned notifications on for (Web Push). Written only
-- through save_push_subscription(); the owner reads and removes their own,
-- never the keys. Dropped when they are deactivated.
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  -- The push service's address for this browser on this device. Unique: one
  -- device, one owner.
  endpoint     text not null unique check (endpoint ~ '^https://' and length(endpoint) < 2048),
  -- The browser's public key and auth secret (base64url) that each payload is
  -- encrypted to (RFC 8291). Only push-send reads them.
  p256dh       text not null check (length(p256dh) between 80 and 100),
  auth         text not null check (length(auth) between 16 and 32),
  -- "Chrome on Android": how a person tells their devices apart.
  device       text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id);

-- The notifications one save causes: one per person, in a single statement,
-- so notifications_push makes one call to push-send for the save however many
-- people it reaches. Someone with several reasons gets the first of: assigned,
-- mentioned, status changed, commented. `p_detail` is the status the save moved
-- the issue to, if it did, on every row, so "assigned" can also say where it
-- went. Skipped: nobody, whoever caused it, someone inactive, someone who
-- can't see the issue.
create function public.notify_people(
  p_recipients uuid[], p_kinds public.notification_kind[], p_issue uuid,
  p_comment uuid default null, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_project uuid := (select project_id from public.issues where id = p_issue);
begin
  if coalesce(cardinality(p_recipients), 0) = 0 then
    return;
  end if;
  insert into public.notifications (recipient_id, actor_id, kind, issue_id, comment_id, detail)
  select distinct on (t.r) t.r, v_actor, t.k, p_issue, p_comment, p_detail
    from unnest(p_recipients, p_kinds) as t(r, k)
    join public.profiles p on p.id = t.r and p.active
   where t.r is distinct from v_actor
     and t.k is not null
     and public.role_in_project(t.r, v_project) is not null
   order by t.r, case t.k when 'assigned' then 1 when 'mentioned' then 2 when 'status_changed' then 3 else 4 end;
end;
$$;

-- The people @mentioned in editor HTML (TipTap mention spans).
create function public.mentioned_ids(p_html text)
returns uuid[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct m[1]::uuid), '{}')
    from regexp_matches(coalesce(p_html, ''),
      '<span[^>]*\sdata-id="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"', 'g') as m;
$$;

-- ---------------------------------------------------------------------------
-- Google: Chat and Calendar, through Edge Functions
-- ---------------------------------------------------------------------------

-- Queues one call to an Edge Function through pg_net. The base URL and the
-- shared secret are read from Vault (see README, "Google Workspace"); until
-- both exist this is a no-op, which is right for a local or preview
-- database. Never raises: a Chat line is never worth a failed write.
create function public.call_function(p_name text, p_body jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_base   text;
  v_secret text;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name = 'functions_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'functions_secret' limit 1;
  if v_base is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url     := rtrim(v_base, '/') || '/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-functions-secret', v_secret),
    body    := p_body);
exception when others then
  return;
end;
$$;

-- A project event for its Chat space, if it has one and wants this event.
create function public.chat_notify(p_project uuid, p_event text, p_body jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.project_integrations
              where project_id = p_project and chat_webhook_url is not null and p_event = any (chat_events)) then
    perform public.call_function('notify-chat', p_body || jsonb_build_object('event', p_event));
  end if;
end;
$$;

-- A company-wide event for the workspace's Chat space.
create function public.workspace_chat_notify(p_event text, p_body jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.workspace_settings
              where chat_webhook_url is not null and p_event = any (chat_events)) then
    perform public.call_function('notify-chat', p_body || jsonb_build_object('event', p_event, 'workspace', true));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications on devices (Web Push), through the push-send function
-- ---------------------------------------------------------------------------

-- Turning this device on (`p_refresh_only` false) makes it the caller's, even
-- if somebody else turned it on before: a shared machine must not carry the
-- last person's notifications to the next.
--
-- Checking it (`p_refresh_only` true, whenever the app looks) never registers
-- anything. If the device is the caller's its keys are refreshed; if it is
-- somebody else's, that registration ends (they are no longer the one using
-- this browser); if there is none (removed on another device, or dropped by
-- push-send as gone) it stays gone.
--
-- Returns whether this device now gets the caller's notifications: what the
-- app shows as on or off.
create function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_device text default null,
  p_refresh_only boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_profile_id();
  v_owner uuid;
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  if p_refresh_only then
    select profile_id into v_owner from public.push_subscriptions where endpoint = p_endpoint;
    if v_owner is null then
      return false;
    end if;
    if v_owner <> v_me then
      delete from public.push_subscriptions where endpoint = p_endpoint;
      return false;
    end if;
    update public.push_subscriptions
       set p256dh = p_p256dh, auth = p_auth, device = coalesce(left(p_device, 80), device)
     where endpoint = p_endpoint;
    return true;
  end if;

  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, device)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(p_device, 80))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
        device = excluded.device, created_at = now(), last_used_at = null;
  return true;
end;
$$;

-- The one notification a person can cause directly, to themselves: proves the
-- whole path (row, trigger, push-send, the device).
create function public.send_test_notification()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  insert into public.notifications (recipient_id, kind) values (v_me, 'test');
end;
$$;

-- One call to push-send per statement that writes notifications, with the
-- new rows' ids; push-send reads everything else itself.
create function public.notifications_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from inserted;
  if v_ids is not null then
    perform public.call_function('push-send', jsonb_build_object('notification_ids', to_jsonb(v_ids)));
  end if;
  return null;
end;
$$;

create trigger notifications_push
  after insert on public.notifications
  referencing new table as inserted
  for each statement execute function public.notifications_push();

-- ---------------------------------------------------------------------------
-- After-write triggers: history, watchers, notifications, Chat, Calendar
-- ---------------------------------------------------------------------------
create function public.log_issue_event(
  p_issue uuid, p_project uuid, p_field text, p_from text, p_to text,
  p_from_id uuid default null, p_to_id uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.issue_events (issue_id, project_id, actor_id, field, from_value, to_value, from_id, to_id)
  values (p_issue, p_project, public.current_profile_id(), p_field, p_from, p_to, p_from_id, p_to_id);
$$;

create function public.issues_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name   text;
  v_status text;
  w        uuid;
  v_event  uuid;
  -- Who this save notifies, gathered and written at the end in one go.
  v_to     uuid[] := '{}';
  v_kinds  public.notification_kind[] := '{}';
begin
  -- Rows touched while their project is being deleted: nothing to record.
  if not exists (select 1 from public.projects where id = new.project_id) then
    return null;
  end if;

  if new.reporter_id is not null then
    insert into public.issue_watchers values (new.id, new.reporter_id) on conflict do nothing;
  end if;
  if new.assignee_id is not null then
    insert into public.issue_watchers values (new.id, new.assignee_id) on conflict do nothing;
  end if;

  if tg_op = 'INSERT' then
    perform public.log_issue_event(new.id, new.project_id, 'created', null, new.key);
    if new.assignee_id is not null then
      v_to := v_to || new.assignee_id; v_kinds := v_kinds || 'assigned'::public.notification_kind;
    end if;
    foreach w in array public.mentioned_ids(new.description) loop
      v_to := v_to || w; v_kinds := v_kinds || 'mentioned'::public.notification_kind;
    end loop;
    perform public.notify_people(v_to, v_kinds, new.id);
    perform public.chat_notify(new.project_id, 'issue_created', jsonb_build_object('issue_id', new.id));
    return null;
  end if;

  if new.status_id <> old.status_id then
    select name into v_status from public.project_statuses where id = new.status_id;
    insert into public.issue_events (issue_id, project_id, actor_id, field, from_value, to_value, from_id, to_id)
    values (new.id, new.project_id, public.current_profile_id(), 'status',
            (select name from public.project_statuses where id = old.status_id), v_status,
            old.status_id, new.status_id)
    returning id into v_event;
    for w in select profile_id from public.issue_watchers where issue_id = new.id loop
      v_to := v_to || w; v_kinds := v_kinds || 'status_changed'::public.notification_kind;
    end loop;
    perform public.chat_notify(new.project_id, 'status_changed', jsonb_build_object('issue_event_id', v_event));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform public.log_issue_event(new.id, new.project_id, 'assignee',
      (select full_name from public.profiles where id = old.assignee_id),
      (select full_name from public.profiles where id = new.assignee_id), old.assignee_id, new.assignee_id);
    if new.assignee_id is not null then
      v_to := v_to || new.assignee_id; v_kinds := v_kinds || 'assigned'::public.notification_kind;
      perform public.chat_notify(new.project_id, 'issue_assigned', jsonb_build_object('issue_id', new.id));
    end if;
  end if;
  if new.sprint_id is distinct from old.sprint_id then
    perform public.log_issue_event(new.id, new.project_id, 'sprint',
      (select name from public.sprints where id = old.sprint_id),
      (select name from public.sprints where id = new.sprint_id), old.sprint_id, new.sprint_id);
    -- Sub-tasks follow their parent (issues_guard reads the parent's sprint).
    update public.issues c set sprint_id = new.sprint_id
      from public.issue_types t
     where c.parent_id = new.id and t.id = c.type_id and t.level = 'subtask'
       and c.sprint_id is distinct from new.sprint_id;
  end if;
  if new.priority <> old.priority then
    perform public.log_issue_event(new.id, new.project_id, 'priority', old.priority::text, new.priority::text);
  end if;
  if new.type_id <> old.type_id then
    perform public.log_issue_event(new.id, new.project_id, 'type',
      (select name from public.issue_types where id = old.type_id),
      (select name from public.issue_types where id = new.type_id), old.type_id, new.type_id);
  end if;
  if new.release_id is distinct from old.release_id then
    perform public.log_issue_event(new.id, new.project_id, 'release',
      (select name from public.releases where id = old.release_id),
      (select name from public.releases where id = new.release_id), old.release_id, new.release_id);
  end if;
  if new.parent_id is distinct from old.parent_id then
    perform public.log_issue_event(new.id, new.project_id, 'parent',
      (select key from public.issues where id = old.parent_id),
      (select key from public.issues where id = new.parent_id), old.parent_id, new.parent_id);
  end if;
  if new.story_points is distinct from old.story_points then
    perform public.log_issue_event(new.id, new.project_id, 'story_points',
      old.story_points::text, new.story_points::text);
  end if;
  if new.title <> old.title then
    perform public.log_issue_event(new.id, new.project_id, 'title', old.title, new.title);
  end if;
  if new.due_date is distinct from old.due_date then
    perform public.log_issue_event(new.id, new.project_id, 'due_date', old.due_date::text, new.due_date::text);
  end if;
  if new.labels <> old.labels then
    perform public.log_issue_event(new.id, new.project_id, 'labels',
      array_to_string(old.labels, ', '), array_to_string(new.labels, ', '));
  end if;
  if new.description <> old.description then
    perform public.log_issue_event(new.id, new.project_id, 'description', null, null);
    foreach w in array public.mentioned_ids(new.description) loop
      if not (w = any (public.mentioned_ids(old.description))) then
        v_to := v_to || w; v_kinds := v_kinds || 'mentioned'::public.notification_kind;
      end if;
    end loop;
  end if;
  perform public.notify_people(v_to, v_kinds, new.id, null, v_status);
  return null;
end;
$$;

create trigger issues_after_write
  after insert or update on public.issues
  for each row execute function public.issues_after_write();

create function public.comments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := public.current_profile_id();
    new.created_at := now();
    new.edited_at := null;
  else
    if new.issue_id <> old.issue_id or new.author_id is distinct from old.author_id then
      raise exception 'A comment stays on its issue and with its author.' using errcode = '42501';
    end if;
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger comments_guard
  before insert or update on public.comments
  for each row execute function public.comments_guard();

create function public.comments_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_mentioned uuid[] := public.mentioned_ids(new.body);
  v_new       uuid[];
  v_watchers  uuid[];
begin
  if tg_op = 'UPDATE' then
    -- Only the people newly mentioned by the edit.
    select coalesce(array_agg(m), '{}') into v_new
      from unnest(v_mentioned) m where not (m = any (public.mentioned_ids(old.body)));
    perform public.notify_people(v_new, array_fill('mentioned'::public.notification_kind, array[cardinality(v_new)]),
                                 new.issue_id, new.id);
    return null;
  end if;

  if new.author_id is not null then
    insert into public.issue_watchers values (new.issue_id, new.author_id) on conflict do nothing;
  end if;
  -- A watcher who is also mentioned is told once, as mentioned.
  select coalesce(array_agg(profile_id), '{}') into v_watchers
    from public.issue_watchers where issue_id = new.issue_id and not (profile_id = any (v_mentioned));
  perform public.notify_people(
    v_mentioned || v_watchers,
    array_fill('mentioned'::public.notification_kind, array[cardinality(v_mentioned)])
      || array_fill('commented'::public.notification_kind, array[cardinality(v_watchers)]),
    new.issue_id, new.id);
  perform public.chat_notify((select project_id from public.issues where id = new.issue_id),
                             'comment_added', jsonb_build_object('comment_id', new.id));
  return null;
end;
$$;
create trigger comments_after_write
  after insert or update on public.comments
  for each row execute function public.comments_after_write();

create function public.issue_links_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := public.current_profile_id();
  return new;
end;
$$;

create trigger issue_links_stamp
  before insert on public.issue_links
  for each row execute function public.issue_links_stamp();

create function public.documents_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.created_by := public.current_profile_id();
    -- Only the drive function records a file it made.
    new.drive_file_id := null;
  end if;
  if new.issue_id is not null
     and not exists (select 1 from public.issues where id = new.issue_id and project_id = new.project_id) then
    raise exception 'That issue is not in this project.' using errcode = '23514';
  end if;
  new.title := trim(new.title);
  return new;
end;
$$;

create trigger documents_stamp
  before insert on public.documents
  for each row execute function public.documents_stamp();

create function public.saved_filters_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := public.current_profile_id();
  elsif new.owner_id <> old.owner_id then
    raise exception 'A filter keeps its owner.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger saved_filters_stamp
  before insert or update on public.saved_filters
  for each row execute function public.saved_filters_stamp();

-- Stamps the owner, ties a todo only to an issue or project you can see (an
-- issue's todo takes the issue's project), and keeps its people to active
-- ones, each once, never the creator.
create function public.todos_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := public.current_profile_id();
  elsif new.owner_id <> old.owner_id then
    raise exception 'A todo keeps its owner.' using errcode = '42501';
  end if;
  if new.issue_id is not null and (tg_op = 'INSERT' or new.issue_id is distinct from old.issue_id)
     and auth.uid() is not null and not public.can_view_issue(new.issue_id) then
    raise exception 'You can''t tie a todo to that issue.' using errcode = '42501';
  end if;
  if new.issue_id is not null then
    new.project_id := (select project_id from public.issues where id = new.issue_id);
  elsif new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and auth.uid() is not null and not public.can_view_project(new.project_id) then
    raise exception 'You can''t tie a todo to that project.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct a), '{}') into new.shared_with
    from unnest(new.shared_with) a
   where a <> new.owner_id
     and exists (select 1 from public.profiles p where p.id = a and p.active);
  return new;
end;
$$;

create trigger todos_guard
  before insert or update on public.todos
  for each row execute function public.todos_guard();

-- Taking yourself off a todo someone else made (after which you can't see
-- it, so a plain update can't do it).
create function public.todo_leave(p_todo uuid)
returns void language sql security definer set search_path = '' as $$
  update public.todos set shared_with = array_remove(shared_with, public.current_profile_id())
   where id = p_todo and shared_with @> array[public.current_profile_id()];
$$;

create function public.note_labels_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := public.current_profile_id();
  elsif new.owner_id <> old.owner_id then
    raise exception 'A label keeps its owner.' using errcode = '42501';
  end if;
  new.name := trim(new.name);
  return new;
end;
$$;

create trigger note_labels_stamp
  before insert or update on public.note_labels
  for each row execute function public.note_labels_stamp();

-- A removed label comes off its owner's notes; the notes stay.
create function public.note_labels_after_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.notes set label_ids = array_remove(label_ids, old.id)
   where owner_id = old.owner_id and old.id = any (label_ids);
  return old;
end;
$$;

create trigger note_labels_after_delete
  after delete on public.note_labels
  for each row execute function public.note_labels_after_delete();

-- Stamps the owner, keeps only their own labels and projects they can see,
-- moves updated_at only when the title or text changes, and stamps
-- archived_at (unpinning the note).
create function public.notes_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := public.current_profile_id();
    new.archived_at := null;
  elsif new.owner_id <> old.owner_id then
    raise exception 'A note keeps its owner.' using errcode = '42501';
  elsif new.title is distinct from old.title or new.body is distinct from old.body then
    new.updated_at := now();
  end if;
  -- Archived now, whatever time the client sent; an archived note stays as
  -- it was archived, and is off the dashboard.
  if new.archived_at is not null then
    new.archived_at := case when tg_op = 'UPDATE' and old.archived_at is not null then old.archived_at else now() end;
    new.pinned := false;
  end if;
  if new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and auth.uid() is not null and not public.can_view_project(new.project_id) then
    raise exception 'You can''t link a note to that project.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct l), '{}') into new.label_ids
    from unnest(new.label_ids) l
   where exists (select 1 from public.note_labels nl where nl.id = l and nl.owner_id = new.owner_id);
  if new.meeting_id is null then
    new.meeting_title := null;
    new.meeting_on := null;
  end if;
  new.meeting_title := nullif(trim(new.meeting_title), '');
  new.title := trim(new.title);
  return new;
end;
$$;

create trigger notes_guard
  before insert or update on public.notes
  for each row execute function public.notes_guard();

-- Deactivating someone drops their Google Calendar connection.
create function public.profiles_drop_calendar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.calendar_connections where profile_id = new.id;
  return new;
end;
$$;

create trigger profiles_drop_calendar
  after update of active on public.profiles
  for each row when (old.active and not new.active)
  execute function public.profiles_drop_calendar();

-- Deactivating someone drops their devices.
create function public.profiles_drop_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions where profile_id = new.id;
  return new;
end;
$$;

create trigger profiles_drop_push
  after update of active on public.profiles
  for each row when (old.active and not new.active)
  execute function public.profiles_drop_push();

-- Sprints: start and complete are the only state changes.
create function public.sprint_start(
  p_sprint uuid, p_start date, p_end date, p_name text default null, p_goal text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_sprint public.sprints;
begin
  select * into v_sprint from public.sprints where id = p_sprint for update;
  if not found or not public.can_edit_project(v_sprint.project_id) then
    raise exception 'You can''t start this sprint.' using errcode = '42501';
  end if;
  if v_sprint.state <> 'future' then
    raise exception 'This sprint has already started.' using errcode = '23514';
  end if;
  if exists (select 1 from public.sprints where project_id = v_sprint.project_id and state = 'active') then
    raise exception 'Complete the active sprint first.' using errcode = '23514';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'A sprint needs a start and an end on or after it.' using errcode = '23514';
  end if;
  update public.sprints
     set state = 'active', start_date = p_start, end_date = p_end, started_at = now(),
         name = coalesce(nullif(trim(p_name), ''), name), goal = coalesce(p_goal, goal)
   where id = p_sprint;
  insert into public.sprint_issues (sprint_id, issue_id, committed, points_at_start)
  select p_sprint, i.id, true, i.story_points from public.issues i where i.sprint_id = p_sprint;
  perform public.chat_notify(v_sprint.project_id, 'sprint_started', jsonb_build_object('sprint_id', p_sprint));
end;
$$;

-- Unfinished issues go to the backlog, or to a future sprint.
create function public.sprint_complete(p_sprint uuid, p_move_to uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_sprint public.sprints;
begin
  select * into v_sprint from public.sprints where id = p_sprint for update;
  if not found or not public.can_edit_project(v_sprint.project_id) then
    raise exception 'You can''t complete this sprint.' using errcode = '42501';
  end if;
  if v_sprint.state <> 'active' then
    raise exception 'Only the active sprint can be completed.' using errcode = '23514';
  end if;
  if p_move_to is not null and not exists (
       select 1 from public.sprints where id = p_move_to and project_id = v_sprint.project_id and state = 'future') then
    raise exception 'Unfinished issues can only move to a future sprint of this project.' using errcode = '23514';
  end if;

  insert into public.sprint_issues (sprint_id, issue_id, points_at_end, completed)
  select p_sprint, i.id, i.story_points, s.category = 'done'
    from public.issues i join public.project_statuses s on s.id = i.status_id
   where i.sprint_id = p_sprint
  on conflict (sprint_id, issue_id) do update
    set points_at_end = excluded.points_at_end, completed = excluded.completed;

  update public.issues i set sprint_id = p_move_to
    from public.project_statuses s, public.issue_types t
   where i.sprint_id = p_sprint and s.id = i.status_id and s.category <> 'done'
     and t.id = i.type_id and t.level <> 'subtask';

  update public.sprints set state = 'closed', completed_at = now() where id = p_sprint;
  perform public.chat_notify(v_sprint.project_id, 'sprint_completed', jsonb_build_object('sprint_id', p_sprint));
end;
$$;

create function public.releases_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.google_event_id is not null then
      perform public.call_function('calendar-sync', jsonb_build_object(
        'kind', 'release', 'id', old.id, 'google_event_id', old.google_event_id, 'deleted', true));
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status = 'released' and old.status <> 'released' then
    perform public.chat_notify(new.project_id, 'release_released', jsonb_build_object('release_id', new.id));
    perform public.workspace_chat_notify('release_released', jsonb_build_object('release_id', new.id));
  end if;
  if tg_op = 'INSERT' and new.release_date is not null
     or tg_op = 'UPDATE' and (new.name, new.release_date, new.status, new.description)
                             is distinct from (old.name, old.release_date, old.status, old.description) then
    perform public.call_function('calendar-sync', jsonb_build_object('kind', 'release', 'id', new.id));
  end if;
  return null;
end;
$$;

create trigger releases_after_write
  after insert or update or delete on public.releases
  for each row execute function public.releases_after_write();

-- ---------------------------------------------------------------------------
-- Seed: the standard issue types
-- ---------------------------------------------------------------------------
insert into public.issue_types (name, level, icon, color) values
  ('Epic', 'epic', 'epic', '#904ee2'),
  ('Story', 'standard', 'story', '#63ba3c'),
  ('Task', 'standard', 'task', '#4bade8'),
  ('Bug', 'standard', 'bug', '#e5493a'),
  ('Sub-task', 'subtask', 'subtask', '#4bade8');

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Everything below needs a bound, active profile; anon gets nothing.
grant select on public.profiles to authenticated;
grant insert (email, full_name, title, app_role, active) on public.profiles to authenticated;
grant update (email, full_name, title, app_role, active) on public.profiles to authenticated;

-- Projects are created only by project_create; key, counter and Drive folder
-- are never client-writable.
grant select, delete on public.projects to authenticated;
grant update (name, description, kind, visibility, lead_id, color, archived_at) on public.projects to authenticated;

grant select, delete on public.project_members to authenticated;
grant insert (project_id, profile_id, role) on public.project_members to authenticated;
grant update (role) on public.project_members to authenticated;

grant select, delete on public.project_statuses to authenticated;
grant insert (project_id, name, category, wip_limit) on public.project_statuses to authenticated;
grant update (name, category, wip_limit) on public.project_statuses to authenticated;

grant select, delete on public.issue_types to authenticated;
grant insert (name, level, icon, color, archived) on public.issue_types to authenticated;
grant update (name, level, icon, color, archived) on public.issue_types to authenticated;

grant select, delete on public.fields to authenticated;
grant insert (project_id, name, kind, options, issue_type_ids, required) on public.fields to authenticated;
grant update (name, options, issue_type_ids, required) on public.fields to authenticated;

grant select on public.project_integrations to authenticated;
grant insert (project_id, chat_webhook_url, chat_events) on public.project_integrations to authenticated;
grant update (chat_webhook_url, chat_events) on public.project_integrations to authenticated;

grant select on public.workspace_settings to authenticated;
grant update (chat_webhook_url, chat_events) on public.workspace_settings to authenticated;

grant select, delete on public.sprints to authenticated;
grant insert (project_id, name, goal, start_date, end_date) on public.sprints to authenticated;
grant update (name, goal, start_date, end_date) on public.sprints to authenticated;

grant select, delete on public.releases to authenticated;
grant insert (project_id, name, description, start_date, release_date, status) on public.releases to authenticated;
grant update (name, description, start_date, release_date, status) on public.releases to authenticated;

-- number, key, resolved_at, created_by are set by issues_guard.
grant select, delete on public.issues to authenticated;
grant insert (project_id, type_id, status_id, title, description, priority, assignee_id, reporter_id, parent_id,
              sprint_id, release_id, story_points, start_date, due_date, labels, rank, custom)
  on public.issues to authenticated;
grant update (type_id, status_id, title, description, priority, assignee_id, reporter_id, parent_id,
              sprint_id, release_id, story_points, start_date, due_date, labels, rank, custom)
  on public.issues to authenticated;

grant select on public.issue_events, public.sprint_issues to authenticated;

grant select, delete on public.issue_links to authenticated;
grant insert (source_id, target_id, kind) on public.issue_links to authenticated;
grant select on public.issue_dev_links to authenticated;

grant select, delete on public.issue_watchers to authenticated;
grant insert (issue_id, profile_id) on public.issue_watchers to authenticated;

grant select, delete on public.comments to authenticated;
grant insert (issue_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;

-- Written and removed only by the drive function (service role).
grant select on public.attachments to authenticated;

grant select, delete on public.documents to authenticated;
grant insert (project_id, issue_id, title, url, doc_type) on public.documents to authenticated;
grant update (title, issue_id) on public.documents to authenticated;

grant select, delete on public.saved_filters to authenticated;
grant insert (name, query, shared) on public.saved_filters to authenticated;
grant update (name, query, shared) on public.saved_filters to authenticated;

grant select, delete on public.todos to authenticated;
grant insert (title, notes, due_on, done_at, issue_id, project_id, position, shared_with) on public.todos to authenticated;
grant update (title, notes, due_on, done_at, issue_id, project_id, position, shared_with) on public.todos to authenticated;

grant select, delete on public.note_labels to authenticated;
grant insert (name) on public.note_labels to authenticated;
grant update (name) on public.note_labels to authenticated;

grant select, delete on public.notes to authenticated;
grant insert (title, body, color, label_ids, project_id, pinned, meeting_id, meeting_title, meeting_on) on public.notes to authenticated;
grant update (title, body, color, label_ids, project_id, pinned, meeting_id, meeting_title, meeting_on, archived_at) on public.notes to authenticated;

grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Written only by save_push_subscription(); the keys are never read back.
grant select (id, profile_id, endpoint, device, created_at, last_used_at), delete
  on public.push_subscriptions to authenticated;

-- RLS helpers (evaluated as the caller) and the RPCs the app calls.
grant execute on function
  public.current_profile_id(), public.is_admin(), public.project_role_of(uuid),
  public.can_view_project(uuid), public.can_edit_project(uuid), public.can_admin_project(uuid),
  public.can_view_issue(uuid), public.can_edit_issue(uuid),
  public.bind_profile(), public.project_create(text, text, public.project_kind, public.project_visibility, text),
  public.project_statuses_reorder(uuid, uuid[]), public.fields_reorder(uuid, uuid[]),
  public.project_rerank(uuid), public.sprint_start(uuid, date, date, text, text),
  public.sprint_complete(uuid, uuid), public.todo_leave(uuid),
  public.save_push_subscription(text, text, text, text, boolean), public.send_test_notification()
  to authenticated;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_statuses enable row level security;
alter table public.issue_types enable row level security;
alter table public.fields enable row level security;
alter table public.project_integrations enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.sprints enable row level security;
alter table public.releases enable row level security;
alter table public.issues enable row level security;
alter table public.issue_events enable row level security;
alter table public.sprint_issues enable row level security;
alter table public.issue_links enable row level security;
alter table public.issue_dev_links enable row level security;
alter table public.issue_watchers enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.documents enable row level security;
alter table public.saved_filters enable row level security;
alter table public.todos enable row level security;
alter table public.note_labels enable row level security;
alter table public.notes enable row level security;
-- No policies: only the google-calendar function (service role) touches it.
alter table public.calendar_connections enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

-- People: everyone signed in sees the directory; admins manage it; you may
-- rename yourself (the guard keeps role, email and access admin-only).
create policy profiles_select on public.profiles for select to authenticated
  using ((select public.current_profile_id()) is not null);
create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select public.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using ((select public.is_admin()) or id = (select public.current_profile_id()))
  with check ((select public.is_admin()) or id = (select public.current_profile_id()));

create policy projects_select on public.projects for select to authenticated
  using (public.can_view_project(id));
create policy projects_update on public.projects for update to authenticated
  using (public.can_admin_project(id)) with check (public.can_admin_project(id));
create policy projects_delete on public.projects for delete to authenticated
  using ((select public.is_admin()));

create policy project_members_select on public.project_members for select to authenticated
  using (public.can_view_project(project_id));
create policy project_members_insert on public.project_members for insert to authenticated
  with check (public.can_admin_project(project_id));
create policy project_members_update on public.project_members for update to authenticated
  using (public.can_admin_project(project_id)) with check (public.can_admin_project(project_id));
create policy project_members_delete on public.project_members for delete to authenticated
  using (public.can_admin_project(project_id));

create policy project_statuses_select on public.project_statuses for select to authenticated
  using (public.can_view_project(project_id));
create policy project_statuses_insert on public.project_statuses for insert to authenticated
  with check (public.can_admin_project(project_id));
create policy project_statuses_update on public.project_statuses for update to authenticated
  using (public.can_admin_project(project_id)) with check (public.can_admin_project(project_id));
create policy project_statuses_delete on public.project_statuses for delete to authenticated
  using (public.can_admin_project(project_id));

create policy issue_types_select on public.issue_types for select to authenticated
  using ((select public.current_profile_id()) is not null);
create policy issue_types_insert on public.issue_types for insert to authenticated
  with check ((select public.is_admin()));
create policy issue_types_update on public.issue_types for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy issue_types_delete on public.issue_types for delete to authenticated
  using ((select public.is_admin()));

create policy fields_select on public.fields for select to authenticated
  using (public.can_view_project(project_id));
create policy fields_insert on public.fields for insert to authenticated
  with check (public.can_admin_project(project_id));
create policy fields_update on public.fields for update to authenticated
  using (public.can_admin_project(project_id)) with check (public.can_admin_project(project_id));
create policy fields_delete on public.fields for delete to authenticated
  using (public.can_admin_project(project_id));

create policy project_integrations_select on public.project_integrations for select to authenticated
  using (public.can_admin_project(project_id));
create policy project_integrations_insert on public.project_integrations for insert to authenticated
  with check (public.can_admin_project(project_id));
create policy project_integrations_update on public.project_integrations for update to authenticated
  using (public.can_admin_project(project_id)) with check (public.can_admin_project(project_id));

create policy workspace_settings_select on public.workspace_settings for select to authenticated
  using ((select public.is_admin()));
create policy workspace_settings_update on public.workspace_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy sprints_select on public.sprints for select to authenticated
  using (public.can_view_project(project_id));
create policy sprints_insert on public.sprints for insert to authenticated
  with check (public.can_edit_project(project_id));
create policy sprints_update on public.sprints for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
-- Only a sprint that never started; its issues go back to the backlog.
create policy sprints_delete on public.sprints for delete to authenticated
  using (state = 'future' and public.can_edit_project(project_id));

create policy releases_select on public.releases for select to authenticated
  using (public.can_view_project(project_id));
create policy releases_insert on public.releases for insert to authenticated
  with check (public.can_edit_project(project_id));
create policy releases_update on public.releases for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy releases_delete on public.releases for delete to authenticated
  using (public.can_admin_project(project_id));

create policy issues_select on public.issues for select to authenticated
  using (public.can_view_project(project_id));
create policy issues_insert on public.issues for insert to authenticated
  with check (public.can_edit_project(project_id));
create policy issues_update on public.issues for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy issues_delete on public.issues for delete to authenticated
  using (public.can_admin_project(project_id));

create policy issue_events_select on public.issue_events for select to authenticated
  using (public.can_view_project(project_id));

create policy sprint_issues_select on public.sprint_issues for select to authenticated
  using (exists (select 1 from public.sprints s where s.id = sprint_id));

create policy issue_links_select on public.issue_links for select to authenticated
  using (public.can_view_issue(source_id) or public.can_view_issue(target_id));
create policy issue_links_insert on public.issue_links for insert to authenticated
  with check (public.can_edit_issue(source_id) and public.can_view_issue(target_id));
create policy issue_links_delete on public.issue_links for delete to authenticated
  using (public.can_edit_issue(source_id) or public.can_edit_issue(target_id));

create policy issue_dev_links_select on public.issue_dev_links for select to authenticated
  using (public.can_view_issue(issue_id));

-- Viewers may watch and comment; only you add or remove yourself.
create policy issue_watchers_select on public.issue_watchers for select to authenticated
  using (public.can_view_issue(issue_id));
create policy issue_watchers_insert on public.issue_watchers for insert to authenticated
  with check (profile_id = (select public.current_profile_id()) and public.can_view_issue(issue_id));
create policy issue_watchers_delete on public.issue_watchers for delete to authenticated
  using (profile_id = (select public.current_profile_id()));

create policy comments_select on public.comments for select to authenticated
  using (public.can_view_issue(issue_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (public.can_view_issue(issue_id));
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select public.current_profile_id()))
  with check (author_id = (select public.current_profile_id()));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = (select public.current_profile_id())
         or public.can_admin_project((select i.project_id from public.issues i where i.id = issue_id)));

create policy attachments_select on public.attachments for select to authenticated
  using (public.can_view_issue(issue_id));

create policy documents_select on public.documents for select to authenticated
  using (public.can_view_project(project_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.can_edit_project(project_id));
create policy documents_update on public.documents for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy documents_delete on public.documents for delete to authenticated
  using (created_by = (select public.current_profile_id()) or public.can_admin_project(project_id));

create policy saved_filters_select on public.saved_filters for select to authenticated
  using (owner_id = (select public.current_profile_id())
         or (shared and (select public.current_profile_id()) is not null));
create policy saved_filters_insert on public.saved_filters for insert to authenticated
  with check ((select public.current_profile_id()) is not null);
create policy saved_filters_update on public.saved_filters for update to authenticated
  using (owner_id = (select public.current_profile_id()))
  with check (owner_id = (select public.current_profile_id()));
create policy saved_filters_delete on public.saved_filters for delete to authenticated
  using (owner_id = (select public.current_profile_id()));

-- Todos: the creator and everyone on one see and change it (todos_guard
-- keeps the owner); only the creator deletes it.
create policy todos_select on public.todos for select to authenticated
  using (owner_id = (select public.current_profile_id())
         or shared_with @> array[(select public.current_profile_id())]);
create policy todos_insert on public.todos for insert to authenticated
  with check ((select public.current_profile_id()) is not null);
create policy todos_update on public.todos for update to authenticated
  using (owner_id = (select public.current_profile_id())
         or shared_with @> array[(select public.current_profile_id())])
  with check (owner_id = (select public.current_profile_id())
              or shared_with @> array[(select public.current_profile_id())]);
create policy todos_delete on public.todos for delete to authenticated
  using (owner_id = (select public.current_profile_id()));

-- Notes and their labels: private to their owner, even from admins.
create policy note_labels_select on public.note_labels for select to authenticated
  using (owner_id = (select public.current_profile_id()));
create policy note_labels_insert on public.note_labels for insert to authenticated
  with check (owner_id = (select public.current_profile_id()));
create policy note_labels_update on public.note_labels for update to authenticated
  using (owner_id = (select public.current_profile_id()))
  with check (owner_id = (select public.current_profile_id()));
create policy note_labels_delete on public.note_labels for delete to authenticated
  using (owner_id = (select public.current_profile_id()));

create policy notes_select on public.notes for select to authenticated
  using (owner_id = (select public.current_profile_id()));
create policy notes_insert on public.notes for insert to authenticated
  with check (owner_id = (select public.current_profile_id()));
create policy notes_update on public.notes for update to authenticated
  using (owner_id = (select public.current_profile_id()))
  with check (owner_id = (select public.current_profile_id()));
create policy notes_delete on public.notes for delete to authenticated
  using (owner_id = (select public.current_profile_id()) and archived_at is not null);

create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select public.current_profile_id()));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = (select public.current_profile_id()))
  with check (recipient_id = (select public.current_profile_id()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (recipient_id = (select public.current_profile_id()));

create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (profile_id = (select public.current_profile_id()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (profile_id = (select public.current_profile_id()));

-- ---------------------------------------------------------------------------
-- Realtime: the bell and the boards update live (RLS still applies).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.notifications, public.issues;
