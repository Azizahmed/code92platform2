#!/usr/bin/env bash
# Replays migrations/ against a throwaway local Postgres (with a shim for the
# InsForge-managed auth/system schemas) and runs every tests/sql/*.test.sql.
#
# Each test file runs in its own fresh database so tests cannot leak state.
# A test fails by raising an exception; psql runs with ON_ERROR_STOP.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/postgres" ]]; then
  echo "PostgreSQL server binaries not found; set PG_BIN" >&2
  exit 1
fi

WORK="$(mktemp -d)"
PORT="${PG_TEST_PORT:-54329}"
RUN=()
if [[ "$(id -u)" == "0" ]]; then
  chown postgres "$WORK"
  RUN=(runuser -u postgres --)
fi

cleanup() {
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/log" \
  -o "-p $PORT -k $WORK -c listen_addresses=''" -w start >/dev/null

export PGOPTIONS="-c client_min_messages=warning"
PSQL=("${RUN[@]}" "$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X)

setup_db() {
  local db="$1"
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE $db" >/dev/null
  # Roles are cluster-wide: create them once.
  if [[ ! -f "$WORK/.roles" ]]; then
    "${PSQL[@]}" -d "$db" -f "$ROOT/tests/sql/_shim.sql" >/dev/null
    touch "$WORK/.roles"
  else
    sed '/^CREATE ROLE/d' "$ROOT/tests/sql/_shim.sql" | "${PSQL[@]}" -d "$db" >/dev/null
  fi
  for migration in "$ROOT"/migrations/*.sql; do
    # Migrations run as project_admin on InsForge.
    { echo "SET ROLE project_admin;"; cat "$migration"; } \
      | "${PSQL[@]}" -d "$db" --single-transaction >/dev/null \
      || { echo "FAILED applying $(basename "$migration")" >&2; return 1; }
  done
}

# Every file is readable by the postgres user when running as root.
chmod -R a+rX "$ROOT/tests/sql" "$ROOT/migrations"

setup_db migrations_check
echo "ok   migrations apply cleanly ($(ls "$ROOT"/migrations/*.sql | wc -l) files)"

failed=0
i=0
for test in "$ROOT"/tests/sql/*.test.sql; do
  [[ -e "$test" ]] || continue
  i=$((i + 1))
  db="t$i"
  setup_db "$db"
  if out=$("${PSQL[@]}" -d "$db" -f "$ROOT/tests/sql/_fixtures.sql" -f "$test" -o /dev/null 2>&1); then
    echo "ok   $(basename "$test")"
  else
    echo "FAIL $(basename "$test")"
    echo "$out" | sed 's/^/     /'
    failed=1
  fi
done

exit $failed
