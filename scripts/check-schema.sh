#!/usr/bin/env bash
# Checks that supabase/schema.sql describes the same database as
# supabase/migrations/ applied in order.
#
# Starts a throwaway local Postgres, stubs the bits of Supabase the schema
# touches (auth, the API roles, the realtime publication), builds one database
# from the migrations and one from schema.sql, and diffs their schema-only
# dumps.
#
# Needs the Postgres server binaries (initdb, pg_ctl, psql, pg_dump) on PATH,
# e.g. `brew install postgresql@16` and
# `export PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH`.
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/pg-sandbox.sh

stubs=$(cat <<'SQL'
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create publication supabase_realtime;
SQL
)

for db in from_migrations from_schema; do
  createdb "$db"
  psql -d "$db" -c "$stubs"
done

for f in supabase/migrations/*.sql; do
  psql -d from_migrations -f "$f"
done
psql -d from_schema -f supabase/schema.sql

pg_dump -s from_migrations > "$tmp/from_migrations.sql"
pg_dump -s from_schema > "$tmp/from_schema.sql"

if diff -u "$tmp/from_migrations.sql" "$tmp/from_schema.sql"; then
  echo "check-schema: schema.sql matches the migrations."
else
  echo "check-schema: schema.sql and the migrations disagree (diff above: - migrations, + schema.sql)." >&2
  exit 1
fi
