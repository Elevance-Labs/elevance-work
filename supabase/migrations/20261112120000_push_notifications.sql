-- Notifications on people's devices (Web Push), as in Elevance Support.
--
-- Until now a notification lived only in the app: the bell heard it over
-- Realtime while the app was open, and nothing reached a closed app or a
-- phone in a pocket. Now each new notification is also pushed to the devices
-- its recipient turned notifications on for.
--
--   * push_subscriptions — those devices (the push service's endpoint and the
--     browser's keys). The owner reads and removes their own, never the keys;
--     writes only through save_push_subscription(), which also hands a shared
--     browser to whoever turned it on last. Deactivating someone drops theirs.
--   * notifications_push — a statement trigger that queues one call to the
--     `push-send` Edge Function (call_function, so a no-op until the Vault
--     secrets exist, and never failing the write) with the new rows' ids;
--     push-send reads the rest with service role and encrypts per device.
--   * send_test_notification() — the one notification a person can cause
--     directly, to themselves: proves the whole path to a device. Its kind is
--     the new `test`.

alter type public.notification_kind add value if not exists 'test';

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  -- The push service's address for this browser on this device. Unique: one
  -- device, one owner.
  endpoint     text not null unique check (endpoint ~ '^https://' and length(endpoint) < 2048),
  -- The browser's public key and auth secret (base64url) that each payload is
  -- encrypted to (RFC 8291). Only push-send reads them.
  p256dh       text not null check (length(p256dh) between 80 and 100),
  auth         text not null check (length(auth) between 16 and 32),
  -- "Chrome on Android": how a person tells their devices apart.
  device       text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id);

revoke all on public.push_subscriptions from anon, authenticated;
grant select (id, profile_id, endpoint, device, created_at, last_used_at), delete
  on public.push_subscriptions to authenticated;

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (profile_id = (select public.current_profile_id()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (profile_id = (select public.current_profile_id()));

-- Turning this device on (`p_refresh_only` false) makes it the caller's, even
-- if somebody else turned it on before: a shared machine must not carry the
-- last person's notifications to the next.
--
-- Checking it (`p_refresh_only` true, whenever the app looks) never registers
-- anything. If the device is the caller's its keys are refreshed; if it is
-- somebody else's, that registration ends (they are no longer the one using
-- this browser); if there is none (removed on another device, or dropped by
-- push-send as gone) it stays gone.
--
-- Returns whether this device now gets the caller's notifications: what the
-- app shows as on or off.
create function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_device text default null,
  p_refresh_only boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := public.current_profile_id();
  v_owner uuid;
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  if p_refresh_only then
    select profile_id into v_owner from public.push_subscriptions where endpoint = p_endpoint;
    if v_owner is null then
      return false;
    end if;
    if v_owner <> v_me then
      delete from public.push_subscriptions where endpoint = p_endpoint;
      return false;
    end if;
    update public.push_subscriptions
       set p256dh = p_p256dh, auth = p_auth, device = coalesce(left(p_device, 80), device)
     where endpoint = p_endpoint;
    return true;
  end if;

  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, device)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(p_device, 80))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth,
        device = excluded.device, created_at = now(), last_used_at = null;
  return true;
end;
$$;

create function public.send_test_notification()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if v_me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  insert into public.notifications (recipient_id, kind) values (v_me, 'test');
end;
$$;

-- One call to push-send per statement that writes notifications, with the
-- new rows' ids; push-send reads everything else itself.
create function public.notifications_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from inserted;
  if v_ids is not null then
    perform public.call_function('push-send', jsonb_build_object('notification_ids', to_jsonb(v_ids)));
  end if;
  return null;
end;
$$;

create trigger notifications_push
  after insert on public.notifications
  referencing new table as inserted
  for each statement execute function public.notifications_push();

-- Deactivating someone drops their devices.
create function public.profiles_drop_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions where profile_id = new.id;
  return new;
end;
$$;

create trigger profiles_drop_push
  after update of active on public.profiles
  for each row when (old.active and not new.active)
  execute function public.profiles_drop_push();

revoke execute on function
  public.save_push_subscription(text, text, text, text, boolean), public.send_test_notification(),
  public.notifications_push(), public.profiles_drop_push()
  from public, anon, authenticated;
grant execute on function
  public.save_push_subscription(text, text, text, text, boolean), public.send_test_notification()
  to authenticated;
