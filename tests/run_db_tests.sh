#!/bin/bash
# Runs the schema against a throwaway local Postgres with Supabase stubs.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
TMP=$(mktemp -d)
chown postgres "$TMP" 2>/dev/null || true
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$PGBIN/initdb -D $TMP/data -A trust -U postgres >/dev/null"
run "$PGBIN/pg_ctl -D $TMP/data -o '-k $TMP -p 55432 -c listen_addresses=' -l $TMP/log start >/dev/null"
trap 'run "$PGBIN/pg_ctl -D $TMP/data stop -m fast >/dev/null"' EXIT
sleep 1
export PGOPTIONS="-c client_min_messages=warning"
PSQL="psql -h $TMP -p 55432 -U postgres -v ON_ERROR_STOP=1 -q -t"
$PSQL -c "create database t" >/dev/null
$PSQL -d t -f "$DIR/supabase_stub.sql" >/dev/null
$PSQL -d t -f "$DIR/../supabase/schema.sql" >/dev/null
$PSQL -d t -f "$DIR/../supabase/schema.sql" >/dev/null   # re-run must be safe
$PSQL -d t -f "$DIR/db_tests.sql" 2>&1 2>&1 | grep -E "PASS|FAIL|ERROR|ALL DATABASE" | sed "s/^psql:[^ ]* NOTICE:  /  /"
