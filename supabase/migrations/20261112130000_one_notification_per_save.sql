-- One push-send call per save, and one notification per person per save.
--
-- notify_person wrote one notification per call, and the triggers called it
-- once per person, so a comment reaching five watchers was five INSERT
-- statements: five calls to push-send (notifications_push fires per
-- statement). And one save could tell the same person twice: a status change
-- and an assignment together gave the new assignee "assigned" and "status
-- changed".
--
-- notify_people writes a save's notifications in one statement (one push-send
-- call, carrying every id), one per person: assigned, then mentioned, then
-- status changed, then commented. The status the save moved the issue to rides
-- along as `detail` on every row, so "assigned" can say "and moved it to In
-- Progress". The same checks as before decide who is told (not whoever caused
-- it, active, can see the issue). Elevance Support does the same.

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


create or replace function public.comments_after_write()
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


drop function public.notify_person(uuid, public.notification_kind, uuid, uuid, text);

revoke execute on function
  public.notify_people(uuid[], public.notification_kind[], uuid, uuid, text)
  from public, anon, authenticated;
