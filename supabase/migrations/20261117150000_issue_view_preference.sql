-- How each person opens an issue on a wide screen: as a dialog over the page
-- (as before) or in a side panel on the right, chosen from the issue itself.
-- It sits on the profile so it follows them between devices; a phone always
-- opens issues full screen. Only the person can change it (profiles_guard),
-- not even an admin for them.

alter table public.profiles
  add column issue_view text not null default 'modal' check (issue_view in ('modal', 'drawer'));

grant update (issue_view) on public.profiles to authenticated;

create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- auth.uid() is null for the SQL editor / service role: no restrictions.
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      raise exception 'Only a workspace admin can add people.' using errcode = '42501';
    end if;
    if new.app_role is distinct from old.app_role
       or new.email is distinct from old.email
       or new.active is distinct from old.active then
      raise exception 'Only a workspace admin can change a role, an email or access.'
        using errcode = '42501';
    end if;
  end if;
  -- How issues open is each person's own choice, even an admin's to make.
  if auth.uid() is not null and tg_op = 'UPDATE'
     and new.issue_view is distinct from old.issue_view
     and old.id is distinct from public.current_profile_id() then
    raise exception 'Only you choose how your issues open.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- Never leave the workspace without an admin who can sign in.
    if old.app_role = 'admin' and old.active
       and (new.app_role <> 'admin' or not new.active)
       and not exists (select 1 from public.profiles
                        where app_role = 'admin' and active and id <> old.id) then
      raise exception 'The workspace needs at least one active admin.' using errcode = '23514';
    end if;
    if new.email is distinct from old.email then
      new.user_id := null; -- rebinds on next sign-in with the new email
    end if;
    new.updated_at := now();
  end if;
  new.full_name := trim(new.full_name);
  new.title := nullif(trim(new.title), '');
  return new;
end;
$$;
