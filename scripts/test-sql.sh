#!/usr/bin/env bash
# The database's own behaviour tests: RLS, column grants, triggers and RPCs,
# exercised as real signed-in people against a throwaway Postgres built from
# supabase/migrations/. This is what the browser tests (test/*.test.tsx)
# can't prove, since their Supabase is a mock.
#
# Each test/sql/*.test.sql file runs on a fresh copy of the fixtures
# (test/sql/_fixtures.sql), as `postgres` until it calls t.login(), which
# switches to the `authenticated` role as that person. Assertions are the
# t.* helpers in test/sql/_helpers.sql; any FAIL, or any error outside
# t.throws(), fails the run.
#
# Needs the Postgres server binaries on PATH (see check-schema.sh).
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/pg-sandbox.sh

# Supabase's auth, Vault and pg_net, as far as the schema uses them. auth.uid()
# and auth.jwt() read what t.login() set; net.http_post() only records the call.
stubs=$(cat <<'SQL'
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('test.jwt', true), '')::jsonb, '{}'::jsonb) $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
grant usage on schema auth to authenticated, anon;
create publication supabase_realtime;
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create schema net;
create table net.calls (id serial primary key, url text, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as
  $$ insert into net.calls (url, body) values (url, body) returning id $$;
SQL
)

createdb template_work
psql -d template_work -c "$stubs" >/dev/null
for f in supabase/migrations/*.sql test/sql/_helpers.sql test/sql/_fixtures.sql; do
  psql -d template_work -f "$f" >/dev/null
done

status=0
for f in test/sql/*.test.sql; do
  echo "--- $f"
  db="t_$(basename "$f" .test.sql | tr -c 'a-z0-9\n' '_')"
  createdb -T template_work "$db"
  stopped=
  out=$(psql -d "$db" -o /dev/null -f "$f" 2>&1) || stopped=1
  results=$(psql -d "$db" -At -c "select case when ok then 'OK  ' else 'FAIL' end || ' ' || name ||
                                   case when ok then '' else coalesce(' — ' || detail, '') end
                                   from t.results order by id")
  echo "$results"
  if grep -q '^FAIL' <<<"$results"; then status=1; fi
  if [ -n "$stopped" ]; then
    echo "$out" | grep -E 'ERROR|CONTEXT|LINE' | head -6
    echo "FAIL $f stopped on an unexpected error"
    status=1
  fi
done
exit $status
