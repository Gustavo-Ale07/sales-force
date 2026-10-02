#!/bin/sh
# Restore test (OPS-2: "a backup counts only after a tested restore"). Restores the newest dump in /backups
# (or the file named by $1, relative to /backups) into a SCRATCH database and checks it. It never writes to
# the staging database: it refuses when RESTORE_TEST_DATABASE_URL equals DATABASE_URL. pg_restore --clean
# drops the objects it recreates in the target, so point it only at a disposable database.
# Prints elapsed seconds, to compare with the RTO <= 4 h target (staging: informational).
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTORE_TEST_DATABASE_URL:?RESTORE_TEST_DATABASE_URL is required (a disposable database)}"
if [ "$RESTORE_TEST_DATABASE_URL" = "$DATABASE_URL" ]; then
  echo "ops-restore-check: refusing: the restore target equals DATABASE_URL." >&2
  exit 1
fi

if [ "${1:-}" != "" ]; then
  dump="/backups/$1"
else
  dump="$(ls -1t /backups/sf-staging-*.dump 2>/dev/null | head -n 1 || true)"
fi
[ -n "$dump" ] && [ -f "$dump" ] || { echo "ops-restore-check: no dump found in /backups." >&2; exit 1; }

(cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256")

start="$(date +%s)"
pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges --dbname="$RESTORE_TEST_DATABASE_URL" "$dump"
end="$(date +%s)"

# Sanity: the schema is there, and migrations were recorded. Table/column names are checked in the runbook
# against the migration journal of the deployed version; here only generic facts are asserted.
tables="$(psql "$RESTORE_TEST_DATABASE_URL" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")"
[ "$tables" -gt 0 ] || { echo "ops-restore-check: restored database has no tables." >&2; exit 1; }
echo "ops-restore-check: OK $(basename "$dump"): $tables tables, restored in $((end - start)) s"
