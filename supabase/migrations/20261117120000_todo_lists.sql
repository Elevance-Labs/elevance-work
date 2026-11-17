-- Todo lists, as in Todoist: each person files their todos into lists of
-- their own.
--
-- todo_lists are private to their owner (name unique per person, ignoring
-- case; a colour; an order). The Inbox is not a row: it is every todo you
-- haven't filed, so everyone has one from the start and it can't be lost.
--
-- Where a todo sits is per person, in todo_places, because a todo is shared:
-- its creator files it in one of their lists, someone they put on it files
-- it in one of theirs (or leaves it in their Inbox). A place names one of
-- the person's own lists (a composite key on the list's owner says so), and
-- is written only through todo_move, which checks that you are on the todo.
-- Deleting a list puts its todos back in the Inbox (the places cascade).
-- A place stays if you leave a todo, so it comes back to the same list if
-- you are put on it again; you never see the todo meanwhile.

create table public.todo_lists (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 60),
  color      text not null default '#5c6bc0' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position   double precision not null default extract(epoch from now()),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index todo_lists_owner_name_key on public.todo_lists (owner_id, lower(name));

create table public.todo_places (
  todo_id    uuid not null references public.todos (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  list_id    uuid not null,
  primary key (todo_id, profile_id),
  foreign key (list_id, profile_id) references public.todo_lists (id, owner_id) on delete cascade
);
create index todo_places_list_idx on public.todo_places (list_id);

create function public.todo_lists_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := public.current_profile_id();
  elsif new.owner_id <> old.owner_id then
    raise exception 'A list keeps its owner.' using errcode = '42501';
  end if;
  new.name := trim(new.name);
  return new;
end;
$$;

create trigger todo_lists_stamp
  before insert or update on public.todo_lists
  for each row execute function public.todo_lists_stamp();

-- Files a todo you are on into one of your lists, or (null) back into your Inbox.
create function public.todo_move(p_todo uuid, p_list uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null or not exists (
    select 1 from public.todos t
     where t.id = p_todo and (t.owner_id = v_me or t.shared_with @> array[v_me])) then
    raise exception 'You can''t move that todo.' using errcode = '42501';
  end if;
  if p_list is null then
    delete from public.todo_places where todo_id = p_todo and profile_id = v_me;
    return;
  end if;
  if not exists (select 1 from public.todo_lists l where l.id = p_list and l.owner_id = v_me) then
    raise exception 'That list isn''t yours.' using errcode = '42501';
  end if;
  insert into public.todo_places (todo_id, profile_id, list_id) values (p_todo, v_me, p_list)
  on conflict (todo_id, profile_id) do update set list_id = excluded.list_id;
end;
$$;

revoke all on public.todo_lists, public.todo_places from anon, authenticated;
revoke execute on function public.todo_lists_stamp(), public.todo_move(uuid, uuid) from public, anon, authenticated;
grant execute on function public.todo_move(uuid, uuid) to authenticated;

grant select, delete on public.todo_lists to authenticated;
grant insert (name, color, position) on public.todo_lists to authenticated;
grant update (name, color, position) on public.todo_lists to authenticated;
-- Written only by todo_move.
grant select on public.todo_places to authenticated;

alter table public.todo_lists enable row level security;
alter table public.todo_places enable row level security;

-- Lists and where your todos sit: private to their owner, even from admins.
create policy todo_lists_select on public.todo_lists for select to authenticated
  using (owner_id = (select public.current_profile_id()));
create policy todo_lists_insert on public.todo_lists for insert to authenticated
  with check (owner_id = (select public.current_profile_id()));
create policy todo_lists_update on public.todo_lists for update to authenticated
  using (owner_id = (select public.current_profile_id()))
  with check (owner_id = (select public.current_profile_id()));
create policy todo_lists_delete on public.todo_lists for delete to authenticated
  using (owner_id = (select public.current_profile_id()));

create policy todo_places_select on public.todo_places for select to authenticated
  using (profile_id = (select public.current_profile_id()));
