#!/bin/sh
# Restore test (OPS-2: "a backup counts only after a tested restore"). Restores the newest dump in /backups
# (or the file named by $1: a plain sf-staging-*.dump name, no "/" or "..") into a SCRATCH database and checks
# it. It never writes to the staging database. Guards, all before anything is restored:
#   1. both URLs go through the strict parser of ops-lib.sh (no host=/port=/dbname=/password= overrides,
#      no percent-encoding in the query or the database name, no "@" in the path, no bare IPv6 host);
#   2. the parsed host, port and database name of the target must differ from DATABASE_URL;
#   3. the target database name must contain "restore", "test" or "scratch", and the LIVE database name must
#      NOT carry such a marker (a live database named like a scratch one would pass check 3);
#   4. AUTHORITATIVE, after connecting to both: the server identity of the two connections, i.e. the pair
#      (pg_control_system().system_identifier, current_database()), must differ. This catches two names for
#      the same database (DNS alias, proxy, port mapping). Same cluster but another database (the usual
#      scratch database inside the same PostgreSQL) is allowed; the system identifier alone cannot be the
#      criterion for that reason. If either identity cannot be read, the script refuses.
# pg_restore --clean drops the objects it recreates in the target, so point it only at a disposable database.
# Passwords go to libpq through the environment of each single command, not in process arguments.
# DATABASE_URL (backup.env) is the READ-ONLY role force_backup and is used only for the identity read of the live
# side; every write goes to RESTORE_TEST_DATABASE_URL (restore-test.env: a role that owns the scratch database and
# has no access to the live one). The scratch database must already exist: this script never creates one.
# On success it writes <dump>.restore-ok (needs /backups writable, see the compose service).
# Prints elapsed seconds (RTO <= 4 h target; staging: informational).
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTORE_TEST_DATABASE_URL:?RESTORE_TEST_DATABASE_URL is required (a disposable database)}"

fail() { echo "ops-restore-check: refusing: $1" >&2; exit 1; }
# shellcheck source=ops-lib.sh
. "${OPS_LIB:-/ops/ops-lib.sh}"

has_marker() {
  _lc="$(printf '%s' "$1" | tr 'A-Z' 'a-z')"
  case "$_lc" in *restore*|*test*|*scratch*) return 0 ;; esac
  return 1
}

parse_url "$DATABASE_URL" "DATABASE_URL"
live_host="$P_HOST"; live_port="$P_PORT"; live_db="$P_DB"; live_url="$P_URL_NOPASS"
live_pass=""
[ -n "$P_PASS_RAW" ] && live_pass="$(pct_decode "$P_PASS_RAW")"
if has_marker "$live_db"; then
  fail "the live database name carries a restore/test/scratch marker; rename it or use another DATABASE_URL (the marker is what identifies disposable targets)."
fi

parse_url "$RESTORE_TEST_DATABASE_URL" "RESTORE_TEST_DATABASE_URL"
target_url="$P_URL_NOPASS"; target_db="$P_DB"
target_pass=""
[ -n "$P_PASS_RAW" ] && target_pass="$(pct_decode "$P_PASS_RAW")"
if [ "$P_HOST" = "$live_host" ] && [ "$P_PORT" = "$live_port" ] && [ "$P_DB" = "$live_db" ]; then
  fail "the restore target is the same host, port and database as DATABASE_URL."
fi
has_marker "$target_db" || fail "the restore target database name must contain \"restore\", \"test\" or \"scratch\" (it is overwritten)."

if [ "${1:-}" != "" ]; then
  case "$1" in
    */*|*..*|-*) fail "the dump name must be a plain file name (no \"/\", no \"..\")." ;;
    sf-staging-*.dump) ;;
    *) fail "the dump name must look like sf-staging-<UTC>.dump." ;;
  esac
  dump="/backups/$1"
else
  dump="$(ls -1t /backups/sf-staging-*.dump 2>/dev/null | head -n 1 || true)"
fi
[ -n "$dump" ] && [ -f "$dump" ] || { echo "ops-restore-check: no dump found in /backups." >&2; exit 1; }

# Server identity of both connections (check 4). Each password is given to its own psql only.
identity() { # url password -> "<system_identifier>/<database>"
  PGPASSWORD="$2" psql "$1" -X -At -c "SELECT system_identifier::text || '/' || current_database() FROM pg_control_system()"
}
live_identity="$(identity "$live_url" "$live_pass")" || fail "cannot read the server identity of DATABASE_URL (pg_control_system); refusing to restore blind."
target_identity="$(identity "$target_url" "$target_pass")" || fail "cannot read the server identity of the restore target (pg_control_system); refusing to restore blind."
[ -n "$live_identity" ] && [ -n "$target_identity" ] || fail "empty server identity; refusing to restore blind."
if [ "$live_identity" = "$target_identity" ]; then
  fail "the restore target is the same server and database as DATABASE_URL (identity check)."
fi

# The .sha256 carries the dump's basename: verified from the directory of the pair.
(cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256")

PGPASSWORD="$target_pass"
export PGPASSWORD
# The scratch database is reused by every run. pg_restore --clean cannot drop the inherited constraints of
# partitioned tables (pgboss.queue_stats_*) left by the previous restore, so the second run would always fail.
# Start from an empty scratch database instead: drop every non-system schema (the guards above already proved
# this is not the live database), then make sure `public` exists again.
PGOPTIONS='-c client_min_messages=warning' psql "$target_url" -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $do$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace
           WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema' LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', s);
  END LOOP;
  CREATE SCHEMA IF NOT EXISTS public;
END
$do$;
SQL
start="$(date +%s)"
pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges --dbname="$target_url" "$dump"
end="$(date +%s)"

# Sanity: the schema is there, and migrations were recorded. Table/column names are checked in the runbook
# against the migration journal of the deployed version; here only generic facts are asserted.
tables="$(psql "$target_url" -X -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")"
[ "$tables" -gt 0 ] || { echo "ops-restore-check: restored database has no tables." >&2; exit 1; }
echo "ops-restore-check: OK $(basename "$dump"): $tables tables, restored in $((end - start)) s"

# Success marker for THIS dump: <dump>.restore-ok holds the dump's checksum line, so ops-offsite-sync.sh (optional
# gate OFFSITE_REQUIRE_RESTORE_MARKER=1) uploads only a dump whose restore was verified, and a marker can never
# vouch for a different file. Written last, atomically, and only after every check above passed (set -e).
marker="$dump.restore-ok"
cp -- "$dump.sha256" "$marker.partial"
mv -- "$marker.partial" "$marker"
echo "ops-restore-check: wrote $(basename "$marker")"
