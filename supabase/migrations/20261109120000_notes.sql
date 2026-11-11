-- Notes: each person's own sticky notes, private to them (even from admins).
-- A note has a colour (sticky-note yellow unless chosen), the owner's own
-- labels, and may be linked to a project and to a meeting (a calendar event,
-- and for a repeating one, the day). A project's or a meeting's page shows
-- your notes on it, and only yours.

create type public.note_color as enum
  ('yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'gray', 'white');

-- Each person's own labels; names unique per person, ignoring case.
create table public.note_labels (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index note_labels_owner_name_key on public.note_labels (owner_id, lower(name));

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  title      text not null default '' check (length(title) <= 200),
  body       text not null default '' check (length(body) <= 20000),
  color      public.note_color not null default 'yellow',
  -- The owner's note_labels (notes_guard keeps only theirs).
  label_ids  uuid[] not null default '{}',
  project_id uuid references public.projects (id) on delete set null,
  event_id   uuid references public.events (id) on delete set null,
  -- Which day of a repeating meeting it is about.
  event_date date,
  created_at timestamptz not null default now(),
  -- Last time its title or text changed.
  updated_at timestamptz not null default now(),
  check (length(trim(title)) > 0 or length(trim(body)) > 0),
  check (event_date is null or event_id is not null)
);
create index notes_owner_idx on public.notes (owner_id, updated_at desc);
create index notes_project_idx on public.notes (project_id);
create index notes_event_idx on public.notes (event_id);

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

create function public.notes_guard()
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
  if new.event_id is null then
    new.event_date := null;
  end if;
  new.title := trim(new.title);
  return new;
end;
$$;

create trigger notes_guard
  before insert or update on public.notes
  for each row execute function public.notes_guard();

revoke all on public.note_labels, public.notes from anon, authenticated;

grant select, delete on public.note_labels to authenticated;
grant insert (name) on public.note_labels to authenticated;
grant update (name) on public.note_labels to authenticated;

grant select, delete on public.notes to authenticated;
grant insert (title, body, color, label_ids, project_id, event_id, event_date) on public.notes to authenticated;
grant update (title, body, color, label_ids, project_id, event_id, event_date) on public.notes to authenticated;

revoke execute on function public.note_labels_stamp(), public.note_labels_after_delete(), public.notes_guard()
  from public, anon, authenticated;

alter table public.note_labels enable row level security;
alter table public.notes enable row level security;

-- Private to their owner, even from admins.
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
  using (owner_id = (select public.current_profile_id()));
