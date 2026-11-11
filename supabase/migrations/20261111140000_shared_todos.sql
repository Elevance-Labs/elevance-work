-- Shared todos: a todo can include other people.
--
-- Until now a todo was private to whoever wrote it. Its creator (or anyone
-- already on it) can now add people. Everyone on a todo sees it, edits it,
-- checks it off and changes who is on it, just like its creator. Only the
-- creator deletes it. Someone on a todo may take themselves off it, through
-- todo_leave (a plain update can't: they no longer see the row after it).
--
-- The people sit in todos.shared_with, beside owner_id. todos_guard (in
-- place of todos_stamp) keeps that list to active people, each once, never
-- the creator. It also checks that a todo is tied only to an issue the
-- person writing it can see, now that an issue shows its todos.

alter table public.todos add column shared_with uuid[] not null default '{}';
create index todos_shared_with_idx on public.todos using gin (shared_with);

drop trigger todos_stamp on public.todos;
drop function public.todos_stamp();

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

create function public.todo_leave(p_todo uuid)
returns void language sql security definer set search_path = '' as $$
  update public.todos set shared_with = array_remove(shared_with, public.current_profile_id())
   where id = p_todo and shared_with @> array[public.current_profile_id()];
$$;

revoke execute on function public.todos_guard(), public.todo_leave(uuid) from public, anon, authenticated;
grant execute on function public.todo_leave(uuid) to authenticated;

grant insert (title, notes, due_on, done_at, issue_id, position, shared_with) on public.todos to authenticated;
grant update (title, notes, due_on, done_at, issue_id, position, shared_with) on public.todos to authenticated;

-- The creator and everyone on a todo see and change it; only the creator
-- deletes it. todos_guard keeps the owner.
drop policy todos_select on public.todos;
drop policy todos_update on public.todos;

create policy todos_select on public.todos for select to authenticated
  using (owner_id = (select public.current_profile_id())
         or shared_with @> array[(select public.current_profile_id())]);
create policy todos_update on public.todos for update to authenticated
  using (owner_id = (select public.current_profile_id())
         or shared_with @> array[(select public.current_profile_id())])
  with check (owner_id = (select public.current_profile_id())
              or shared_with @> array[(select public.current_profile_id())]);
