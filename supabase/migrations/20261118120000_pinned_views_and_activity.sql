-- Faster navigation: pinned views and recent activity.
--
-- saved_filter_pins: each person pins saved filters (their own or shared
-- ones) to the navigation, under Issues. Pins are private to their owner and
-- may only name a filter the person can read; a filter's deletion takes its
-- pins with it. A filter unshared after someone pinned it leaves their pin
-- behind, but the filter itself is no longer readable, so the app drops it.
--
-- watched_activity: the Work page's Recent activity. For each issue you
-- watch (reporters, assignees and commenters are added as watchers), its
-- latest change or comment, newest first. Security invoker, so the issue,
-- history and comment policies still decide what you see: an issue in a
-- project you can no longer see drops out.

create table public.saved_filter_pins (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  filter_id  uuid not null references public.saved_filters (id) on delete cascade,
  position   double precision not null default extract(epoch from now()),
  created_at timestamptz not null default now(),
  primary key (profile_id, filter_id)
);
create index saved_filter_pins_filter_idx on public.saved_filter_pins (filter_id);

create function public.saved_filter_pins_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.profile_id := public.current_profile_id();
  elsif new.profile_id <> old.profile_id or new.filter_id <> old.filter_id then
    raise exception 'A pin keeps its owner and filter.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger saved_filter_pins_stamp
  before insert or update on public.saved_filter_pins
  for each row execute function public.saved_filter_pins_stamp();

create function public.watched_activity(p_limit integer default 50)
returns table (issue_id uuid, at timestamptz, actor_id uuid, kind text, field text, to_value text)
language sql stable security invoker set search_path = '' as $$
  with mine as (
    select w.issue_id from public.issue_watchers w
     where w.profile_id = (select public.current_profile_id())
  ),
  activity as (
    select e.issue_id, e.created_at as at, e.actor_id, 'change'::text as kind, e.field, e.to_value
      from public.issue_events e join mine m on m.issue_id = e.issue_id
    union all
    select c.issue_id, c.created_at, c.author_id, 'comment'::text, null::text, null::text
      from public.comments c join mine m on m.issue_id = c.issue_id
  ),
  latest as (
    select distinct on (a.issue_id) a.* from activity a
     where exists (select 1 from public.issues i where i.id = a.issue_id)
     order by a.issue_id, a.at desc
  )
  select l.issue_id, l.at, l.actor_id, l.kind, l.field, l.to_value from latest l
   order by l.at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on public.saved_filter_pins from anon, authenticated;
revoke execute on function public.saved_filter_pins_stamp(), public.watched_activity(integer)
  from public, anon, authenticated;
grant execute on function public.watched_activity(integer) to authenticated;

grant select, delete on public.saved_filter_pins to authenticated;
grant insert (filter_id, position) on public.saved_filter_pins to authenticated;
grant update (position) on public.saved_filter_pins to authenticated;

alter table public.saved_filter_pins enable row level security;

-- Your pins: private to you; only a filter you can read.
create policy saved_filter_pins_select on public.saved_filter_pins for select to authenticated
  using (profile_id = (select public.current_profile_id()));
create policy saved_filter_pins_insert on public.saved_filter_pins for insert to authenticated
  with check (profile_id = (select public.current_profile_id())
              and exists (select 1 from public.saved_filters f where f.id = filter_id));
create policy saved_filter_pins_update on public.saved_filter_pins for update to authenticated
  using (profile_id = (select public.current_profile_id()))
  with check (profile_id = (select public.current_profile_id()));
create policy saved_filter_pins_delete on public.saved_filter_pins for delete to authenticated
  using (profile_id = (select public.current_profile_id()));
