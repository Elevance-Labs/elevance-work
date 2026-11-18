-- A flag's change is posted as a comment, by whoever made it: "Flag added"
-- with the reason, "Flag reason changed" with the new one, "Flag removed".
-- comments_guard stamps the author; the comment's own trigger
-- (comments_after_write) tells the watchers and Chat, as any comment does.
-- The reason is plain text, so it is HTML-escaped, its line breaks kept.
--
-- Only issues_after_write changes (create or replace: safe to run again).

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
    -- Said in the conversation too, as whoever did it (comments_guard
    -- stamps the author; the comment's own trigger tells the watchers).
    -- The reason is plain text: escaped, its lines kept.
    insert into public.comments (issue_id, body)
    values (new.id,
      case
        when new.flag_reason is null then '<p>🚩 <strong>Flag removed</strong></p>'
        else '<p>🚩 <strong>' || case when old.flag_reason is null then 'Flag added' else 'Flag reason changed' end
             || '</strong></p><p>'
             || replace(replace(replace(replace(replace(new.flag_reason,
                  '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), E'\n', '<br>')
             || '</p>'
      end);
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
