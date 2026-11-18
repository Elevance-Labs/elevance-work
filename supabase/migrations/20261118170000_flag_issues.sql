-- Flagging an issue: marking it as held up, with a reason, as in Jira.
--
-- flag_reason: null when the issue isn't flagged; a flag always says why
-- (issues_guard refuses a blank one and trims it). flagged_by and
-- flagged_at are stamped by issues_guard on flagging, kept while the reason
-- is edited and cleared with the flag; clients can't write them.
--
-- Anyone who may edit the issue may flag it or remove the flag (the
-- existing update policy, can_edit_issue); a flag is part of the issue, so
-- it shows to everyone who can see the issue. Flagging, editing the reason
-- and removing the flag are kept in the issue's history (field 'flag') and
-- count as an update.
--
-- Safe to run again: the columns and the index are added only if missing.

alter table public.issues
  add column if not exists flag_reason text check (length(flag_reason) <= 2000),
  add column if not exists flagged_by  uuid references public.profiles (id) on delete set null,
  add column if not exists flagged_at  timestamptz;

create index if not exists issues_flagged_idx on public.issues (project_id) where flag_reason is not null;

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

  -- A flag always says why. Flagging stamps who and when; changing the
  -- reason keeps them; removing the flag clears them.
  new.flag_reason := trim(new.flag_reason);
  if new.flag_reason = '' then
    raise exception 'Say why this issue is flagged.' using errcode = '23514';
  end if;
  if new.flag_reason is null then
    new.flagged_by := null;
    new.flagged_at := null;
  elsif tg_op = 'INSERT' or old.flag_reason is null then
    new.flagged_by := public.current_profile_id();
    new.flagged_at := now();
  else
    new.flagged_by := old.flagged_by;
    new.flagged_at := old.flagged_at;
  end if;

  if v_category = 'done' then
    new.resolved_at := case when tg_op = 'UPDATE' and old.resolved_at is not null then old.resolved_at else now() end;
  else
    new.resolved_at := null;
  end if;

  -- Reordering alone isn't an update anyone needs to hear about.
  if tg_op = 'UPDATE' and (new.type_id, new.status_id, new.title, new.description, new.priority, new.assignee_id,
                           new.reporter_id, new.parent_id, new.sprint_id, new.release_id, new.story_points,
                           new.start_date, new.due_date, new.labels, new.custom, new.flag_reason)
      is distinct from (old.type_id, old.status_id, old.title, old.description, old.priority, old.assignee_id,
                        old.reporter_id, old.parent_id, old.sprint_id, old.release_id, old.story_points,
                        old.start_date, old.due_date, old.labels, old.custom, old.flag_reason) then
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create or replace function public.issues_after_write()
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
  if new.flag_reason is distinct from old.flag_reason then
    perform public.log_issue_event(new.id, new.project_id, 'flag', old.flag_reason, new.flag_reason);
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

grant update (flag_reason) on public.issues to authenticated;
