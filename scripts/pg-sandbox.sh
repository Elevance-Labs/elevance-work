# Sourced by check-schema.sh and test-sql.sh: a throwaway Postgres on a
# private port, with Supabase's API roles, stopped and removed on exit.
for bin in initdb pg_ctl psql pg_dump createdb; do
  command -v "$bin" >/dev/null || { echo "$(basename "$0"): '$bin' not found on PATH" >&2; exit 2; }
done

tmp=$(mktemp -d)
export PGHOST=127.0.0.1 PGPORT=${PG_SANDBOX_PORT:-54331} PGUSER=postgres
cleanup() {
  pg_ctl -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

initdb -D "$tmp/data" -U postgres -A trust >/dev/null
# TCP only: the socket path under a long temp dir can exceed the OS limit.
pg_ctl -D "$tmp/data" -l "$tmp/log" -w \
  -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c wal_level=logical -c unix_socket_directories=''" start >/dev/null

psql() { command psql -X -q -v ON_ERROR_STOP=1 "$@"; }

psql -d postgres <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role supabase_auth_admin nologin;
SQL
