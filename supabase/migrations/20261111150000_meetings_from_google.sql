-- Meetings come from Google Calendar; the app's own events go.
--
-- Having two kinds of meeting side by side, the app's own calendar events
-- and the ones in people's Google Calendars, was confusing. Meetings now
-- live only in Google: each person's own calendar, read through the
-- google-calendar function as before, never stored. The app's calendar shows
-- what the app itself owns: epics and issues with dates, releases and your
-- todos.
--
-- So:
--  * events goes, with its guard, its after-write trigger, its kinds and
--    repeat rules. Deleting the rows first lets events_after_write queue the
--    removal of their copies from the shared Google Calendar (releases are
--    still pushed there). Their invitations go too, and with them the
--    'event_invited' notification, notifications.event_id and
--    notify_person's p_event; the workspace Chat space keeps only releases.
--  * A note may be about one meeting: its Google event id (an occurrence of
--    a repeating meeting has its own), with the title and day copied in so
--    the note can say which without asking Google. One note per meeting per
--    person. Notes linked to an app event lose the link and keep their text.
--  * A note can be pinned to the dashboard (pinning doesn't count as an edit).
--  * A todo can be tied to a project, not only to an issue. An issue's todo
--    is in the issue's project (todos_guard).

-- ---------------- events, and everything that pointed at them ----------------
delete from public.events;

alter table public.notes drop column event_id, drop column event_date;
alter table public.notifications drop column event_id;
delete from public.notifications where kind = 'event_invited';

drop table public.events;
drop function public.events_guard(), public.events_after_write();
drop type public.event_kind, public.recurrence;

drop function public.notify_person(uuid, public.notification_kind, uuid, uuid, uuid, text);
alter type public.notification_kind rename to notification_kind_old;
create type public.notification_kind as enum ('assigned', 'mentioned', 'commented', 'status_changed');
alter table public.notifications alter column kind type public.notification_kind using kind::text::public.notification_kind;
drop type public.notification_kind_old;

create function public.notify_person(
  p_recipient uuid, p_kind public.notification_kind, p_issue uuid,
  p_comment uuid default null, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if p_recipient is null or p_recipient is not distinct from v_actor
     or not exists (select 1 from public.profiles where id = p_recipient and active) then
    return;
  end if;
  if p_issue is not null and public.role_in_project(
       p_recipient, (select project_id from public.issues where id = p_issue)) is null then
    return;
  end if;
  insert into public.notifications (recipient_id, actor_id, kind, issue_id, comment_id, detail)
  values (p_recipient, v_actor, p_kind, p_issue, p_comment, p_detail);
end;
$$;

-- status_changed no longer passes an event.
create or replace function public.issues_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name   text;
  v_status text;
  w        uuid;
  v_event  uuid;
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
      perform public.notify_person(new.assignee_id, 'assigned', new.id);
    end if;
    foreach w in array public.mentioned_ids(new.description) loop
      perform public.notify_person(w, 'mentioned', new.id);
    end loop;
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
      perform public.notify_person(w, 'status_changed', new.id, null, v_status);
    end loop;
    perform public.chat_notify(new.project_id, 'status_changed', jsonb_build_object('issue_event_id', v_event));
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform public.log_issue_event(new.id, new.project_id, 'assignee',
      (select full_name from public.profiles where id = old.assignee_id),
      (select full_name from public.profiles where id = new.assignee_id), old.assignee_id, new.assignee_id);
    if new.assignee_id is not null then
      perform public.notify_person(new.assignee_id, 'assigned', new.id);
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
        perform public.notify_person(w, 'mentioned', new.id);
      end if;
    end loop;
  end if;
  return null;
end;
$$;

revoke execute on function public.notify_person(uuid, public.notification_kind, uuid, uuid, text)
  from public, anon, authenticated;

alter table public.workspace_settings drop constraint workspace_settings_chat_events_check;
update public.workspace_settings set chat_events = array_remove(chat_events, 'event_created');
alter table public.workspace_settings
  alter column chat_events set default '{release_released}',
  add constraint workspace_settings_chat_events_check check (chat_events <@ array['release_released']);

-- ---------------- notes: pinned, and the meeting they're about ----------------
alter table public.notes
  add column pinned boolean not null default false,
  add column meeting_id text check (length(meeting_id) between 1 and 1024),
  add column meeting_title text check (length(meeting_title) <= 300),
  add column meeting_on date,
  add constraint notes_meeting_check check (meeting_id is not null or (meeting_title is null and meeting_on is null));
create unique index notes_meeting_key on public.notes (owner_id, meeting_id);

create or replace function public.notes_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := public.current_profile_id();
  elsif new.owner_id <> old.owner_id then
    raise exception 'A note keeps its owner.' using errcode = '42501';
  elsif new.title is distinct from old.title or new.body is distinct from old.body then
    new.updated_at := now();
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

revoke all on public.notes from authenticated;
grant select, delete on public.notes to authenticated;
grant insert (title, body, color, label_ids, project_id, pinned, meeting_id, meeting_title, meeting_on) on public.notes to authenticated;
grant update (title, body, color, label_ids, project_id, pinned, meeting_id, meeting_title, meeting_on) on public.notes to authenticated;

-- ---------------- todos: a project of their own ----------------
alter table public.todos add column project_id uuid references public.projects (id) on delete set null;
create index todos_project_idx on public.todos (project_id);

create or replace function public.todos_guard()
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

update public.todos t set project_id = i.project_id from public.issues i where i.id = t.issue_id;

grant insert (title, notes, due_on, done_at, issue_id, project_id, position, shared_with) on public.todos to authenticated;
grant update (title, notes, due_on, done_at, issue_id, project_id, position, shared_with) on public.todos to authenticated;
