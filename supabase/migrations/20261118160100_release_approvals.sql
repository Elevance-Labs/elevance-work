-- Managers, release notes and release approvals.
--
-- Roles: the new Manager role (previous migration) edits like a member, and
-- with admins manages releases and removes what others made (issues,
-- comments, files, docs): can_manage_project. Members no longer create,
-- edit, release or delete releases; they still set an issue's Release.
-- Settings stay with admins (can_admin_project). Anyone who could edit a
-- project still can; managers can be assigned like members.
--
-- Releases: a release date is now required (the start date stays optional);
-- releases without one get the day they were released, else the later of
-- their start and the day they were made. `notes` is the release's notes,
-- rich text, meant to be public one day; `description` stays internal.
--
-- Approvals: a manager names approvers, anyone who can see the project.
-- Each approves or rejects once (release_decide; a rejection says why); the
-- decision stands until approval is asked for again. With every approver
-- approved the release is locked: its name, dates, description and notes
-- don't change and no approver is added. A release with approvers is
-- released only once all of them approved. Adding an issue to the release
-- or removing one asks for approval again (decisions go back to pending), as
-- does a manager (release_request_approval). Only unreleased releases take
-- part: once released, approvals are a record.

-- ---------------------------------------------------------------- roles
create or replace function public.can_edit_project(p_project uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.project_role_of(p_project) in ('admin', 'manager', 'member'), false);
$$;

-- Releases, and removing what others made: admins and managers.
create function public.can_manage_project(p_project uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.project_role_of(p_project) in ('admin', 'manager'), false);
$$;

-- Managers may be assigned, like members.
create or replace function public.issues_guard()
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
     and coalesce(public.role_in_project(new.assignee_id, new.project_id) in ('admin', 'manager', 'member'), false) = false then
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

drop policy releases_insert on public.releases;
drop policy releases_update on public.releases;
drop policy releases_delete on public.releases;
create policy releases_insert on public.releases for insert to authenticated
  with check (public.can_manage_project(project_id));
create policy releases_update on public.releases for update to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
create policy releases_delete on public.releases for delete to authenticated
  using (public.can_manage_project(project_id));

drop policy issues_delete on public.issues;
create policy issues_delete on public.issues for delete to authenticated
  using (public.can_manage_project(project_id));

drop policy comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = (select public.current_profile_id())
         or public.can_manage_project((select i.project_id from public.issues i where i.id = issue_id)));

drop policy documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (created_by = (select public.current_profile_id()) or public.can_manage_project(project_id));

-- ---------------------------------------------------------------- releases
update public.releases
   set release_date = greatest(start_date, (coalesce(released_at, created_at) at time zone 'Asia/Karachi')::date)
 where release_date is null;
alter table public.releases alter column release_date set not null;

alter table public.releases
  add column notes text not null default '' check (length(notes) <= 100000);

grant insert (notes) on public.releases to authenticated;
grant update (notes) on public.releases to authenticated;

-- ---------------------------------------------------------------- approvals
create type public.release_decision as enum ('approved', 'rejected');

-- Who approves a release, and what they decided (null: not yet). Managers
-- add and remove approvers; a decision is made only through release_decide
-- and stands until approval is asked for again.
create table public.release_approvers (
  release_id uuid not null references public.releases (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  decision   public.release_decision,
  comment    text not null default '' check (length(comment) <= 1000),
  decided_at timestamptz,
  added_by   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (release_id, profile_id)
);
create index release_approvers_profile_idx on public.release_approvers (profile_id);

-- Nothing stands in the way of releasing: every approver approved (or there are none).
create function public.release_cleared(p_release uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.release_approvers
                      where release_id = p_release and decision is distinct from 'approved');
$$;

-- Approved, and so locked: it has approvers and they all approved.
create function public.release_approved(p_release uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.release_approvers where release_id = p_release)
     and public.release_cleared(p_release);
$$;

-- Asking for approval again: every decision on an unreleased release goes back to pending.
create function public.release_approvals_reset(p_release uuid)
returns void language sql security definer set search_path = '' as $$
  update public.release_approvers a
     set decision = null, comment = '', decided_at = null
   where a.release_id = p_release and a.decision is not null
     and exists (select 1 from public.releases r where r.id = p_release and r.status = 'unreleased');
$$;

create function public.release_approvers_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_release public.releases;
begin
  -- Going with its release or its person: nothing to check.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  select * into v_release from public.releases
   where id = case when tg_op = 'DELETE' then old.release_id else new.release_id end;
  if found and v_release.status <> 'unreleased' then
    raise exception 'Approvers change only until the release is released.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if public.release_approved(new.release_id) then
      raise exception 'This release is approved, so it''s locked. Ask for approval again first.' using errcode = '23514';
    end if;
    if public.role_in_project(new.profile_id, v_release.project_id) is null then
      raise exception 'An approver must be an active person who can see this project.' using errcode = '23514';
    end if;
    new.decision := null;
    new.comment := '';
    new.decided_at := null;
    new.added_by := public.current_profile_id();
    new.created_at := now();
    return new;
  end if;
  if old.decision is not null then
    raise exception 'Someone who has decided stays an approver until approval is asked for again.' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger release_approvers_guard
  before insert or delete on public.release_approvers
  for each row execute function public.release_approvers_guard();

-- An approver approves or rejects (saying why), once until approval is asked for again.
create function public.release_decide(p_release uuid, p_decision public.release_decision, p_comment text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_release public.releases;
  v_me      uuid := public.current_profile_id();
begin
  select * into v_release from public.releases where id = p_release;
  if not found or not public.can_view_project(v_release.project_id) then
    raise exception 'That release doesn''t exist.' using errcode = '42501';
  end if;
  if v_release.status <> 'unreleased' then
    raise exception 'This release is already released.' using errcode = '23514';
  end if;
  if p_decision is null then
    raise exception 'Approve or reject.' using errcode = '23514';
  end if;
  if p_decision = 'rejected' and trim(coalesce(p_comment, '')) = '' then
    raise exception 'Say why you''re rejecting it.' using errcode = '23514';
  end if;
  update public.release_approvers
     set decision = p_decision, comment = left(trim(coalesce(p_comment, '')), 1000), decided_at = now()
   where release_id = p_release and profile_id = v_me and decision is null;
  if not found then
    if exists (select 1 from public.release_approvers where release_id = p_release and profile_id = v_me) then
      raise exception 'You''ve decided already. It stands until approval is asked for again.' using errcode = '23514';
    end if;
    raise exception 'You aren''t an approver of this release.' using errcode = '42501';
  end if;
end;
$$;

-- A manager asks every approver again (after a rejection, or to change an approved release).
create function public.release_request_approval(p_release uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_release public.releases;
begin
  select * into v_release from public.releases where id = p_release;
  if not found or not public.can_manage_project(v_release.project_id) then
    raise exception 'Only the project''s admins and managers ask for approval.' using errcode = '42501';
  end if;
  if v_release.status <> 'unreleased' then
    raise exception 'This release is already released.' using errcode = '23514';
  end if;
  perform public.release_approvals_reset(p_release);
end;
$$;

create or replace function public.releases_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := public.current_profile_id();
    new.released_at := case when new.status = 'released' then now() end;
  else
    if new.project_id <> old.project_id then
      raise exception 'A release belongs to one project.' using errcode = '42501';
    end if;
    -- Approved by everyone: locked until approval is asked for again.
    if old.status = 'unreleased' and public.release_approved(old.id)
       and (new.name, new.description, new.notes, new.start_date, new.release_date)
           is distinct from (old.name, old.description, old.notes, old.start_date, old.release_date) then
      raise exception 'This release is approved, so it''s locked. Ask for approval again to change it.' using errcode = '23514';
    end if;
    if new.status = 'released' and old.status <> 'released' and not public.release_cleared(old.id) then
      raise exception 'Every approver must approve this release before it''s released.' using errcode = '23514';
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

-- An approval covers the issues a release had: adding one or taking one
-- away asks for it again.
create function public.issues_release_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.release_id is not null then
    perform public.release_approvals_reset(old.release_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.release_id is not null then
    perform public.release_approvals_reset(new.release_id);
  end if;
  return null;
end;
$$;

create trigger issues_release_added_or_removed
  after insert or delete on public.issues
  for each row execute function public.issues_release_changed();

create trigger issues_release_moved
  after update of release_id on public.issues
  for each row when (old.release_id is distinct from new.release_id)
  execute function public.issues_release_changed();

alter table public.release_approvers enable row level security;
revoke all on public.release_approvers from anon, authenticated;
grant select, delete on public.release_approvers to authenticated;
grant insert (release_id, profile_id) on public.release_approvers to authenticated;

create policy release_approvers_select on public.release_approvers for select to authenticated
  using (public.can_view_project((select r.project_id from public.releases r where r.id = release_id)));
create policy release_approvers_insert on public.release_approvers for insert to authenticated
  with check (public.can_manage_project((select r.project_id from public.releases r where r.id = release_id)));
create policy release_approvers_delete on public.release_approvers for delete to authenticated
  using (public.can_manage_project((select r.project_id from public.releases r where r.id = release_id)));

revoke execute on function public.can_manage_project(uuid), public.release_cleared(uuid), public.release_approved(uuid),
  public.release_approvals_reset(uuid), public.release_approvers_guard(), public.issues_release_changed(),
  public.release_decide(uuid, public.release_decision, text), public.release_request_approval(uuid)
  from public, anon, authenticated;
grant execute on function public.can_manage_project(uuid),
  public.release_decide(uuid, public.release_decision, text), public.release_request_approval(uuid)
  to authenticated;
