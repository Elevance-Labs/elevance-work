-- Your own Google Calendar in the app. Each person may connect their Google
-- account (read-only Calendar access); the `google-calendar` Edge Function
-- keeps the refresh token here, encrypted, and reads their events with it.
-- No client can read or write this table: the function uses service role.
-- Deactivating someone drops their connection.

create table public.calendar_connections (
  profile_id    uuid primary key references public.profiles (id) on delete cascade,
  -- The Google account (its primary calendar id), which matches the profile's email.
  google_email  text not null,
  -- AES-GCM ciphertext, keyed by the function secret GOOGLE_TOKEN_KEY.
  refresh_token text not null,
  connected_at  timestamptz not null default now()
);

create function public.profiles_drop_calendar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.calendar_connections where profile_id = new.id;
  return new;
end;
$$;

create trigger profiles_drop_calendar
  after update of active on public.profiles
  for each row when (old.active and not new.active)
  execute function public.profiles_drop_calendar();

revoke all on public.calendar_connections from anon, authenticated;
revoke execute on function public.profiles_drop_calendar() from public, anon, authenticated;
alter table public.calendar_connections enable row level security;
