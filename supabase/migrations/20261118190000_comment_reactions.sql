-- Reactions on comments: a thumbs up or a thumbs down.
--
-- Anyone who can read the issue (and so may comment on it) reacts to its
-- comments, one reaction per person per comment: switching from up to down
-- changes it, reacting the same again takes it away. A reaction is yours:
-- comment_reactions_guard stamps who and the comment's issue (for the
-- policies), and only you change or remove it. It goes with its comment.
-- Reactions tell nobody: no notification, no Chat.

create table public.comment_reactions (
  comment_id uuid not null,
  issue_id   uuid not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('up', 'down')),
  created_at timestamptz not null default now(),
  primary key (comment_id, profile_id),
  constraint comment_reactions_comment_fkey foreign key (comment_id, issue_id)
    references public.comments (id, issue_id) on delete cascade
);
create index comment_reactions_issue_idx on public.comment_reactions (issue_id);

create function public.comment_reactions_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.profile_id := public.current_profile_id();
    select issue_id into new.issue_id from public.comments where id = new.comment_id;
  elsif new.comment_id <> old.comment_id or new.issue_id <> old.issue_id or new.profile_id <> old.profile_id then
    raise exception 'A reaction stays on its comment and with its person.' using errcode = '42501';
  end if;
  new.created_at := now();
  return new;
end;
$$;
create trigger comment_reactions_guard
  before insert or update on public.comment_reactions
  for each row execute function public.comment_reactions_guard();

revoke execute on function public.comment_reactions_guard() from public, anon, authenticated;

revoke all on public.comment_reactions from anon, authenticated;
grant select, delete on public.comment_reactions to authenticated;
grant insert (comment_id, kind) on public.comment_reactions to authenticated;
grant update (kind) on public.comment_reactions to authenticated;

alter table public.comment_reactions enable row level security;

create policy comment_reactions_select on public.comment_reactions for select to authenticated
  using (public.can_view_issue(issue_id));
create policy comment_reactions_insert on public.comment_reactions for insert to authenticated
  with check (profile_id = (select public.current_profile_id()) and public.can_view_issue(issue_id));
create policy comment_reactions_update on public.comment_reactions for update to authenticated
  using (profile_id = (select public.current_profile_id()))
  with check (profile_id = (select public.current_profile_id()) and public.can_view_issue(issue_id));
create policy comment_reactions_delete on public.comment_reactions for delete to authenticated
  using (profile_id = (select public.current_profile_id()));
