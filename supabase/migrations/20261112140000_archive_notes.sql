-- Notes are archived before they can be deleted.
--
-- A note used to be deleted straight from its dialog, gone for good on one
-- slip. Now a note is first archived (archived_at, stamped by notes_guard):
-- out of the notes page, the project tab, the dashboard and search, but
-- kept, and brought back with one click. Only an archived note can be
-- deleted; the delete policy says so, so the rule holds whatever the client
-- does. An archived note is never pinned (the dashboard shows pinned ones).
-- Clients may set archived_at on update only; a note is never written
-- archived.

alter table public.notes add column archived_at timestamptz;

create or replace function public.notes_guard()
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

grant update (archived_at) on public.notes to authenticated;

drop policy notes_delete on public.notes;
create policy notes_delete on public.notes for delete to authenticated
  using (owner_id = (select public.current_profile_id()) and archived_at is not null);
