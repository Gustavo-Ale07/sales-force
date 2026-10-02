#!/bin/sh
# Logical dump of the staging database (pg_dump custom format) into /backups (host: SF_BACKUP_DIR).
# Runs inside the `backup` compose service (postgres client of the production major). DATABASE_URL comes
# from migrate.env (the table-owner role, force_migrator: a dump needs to read every table); it is never
# printed, and its password is passed to pg_dump through PGPASSWORD (not in the process arguments). The URL
# is parsed strictly by ops-lib.sh: only sslmode/sslrootcert/connect_timeout may appear in its query, so a
# host=/password=/dbname= override (however encoded) is refused before pg_dump runs.
# The dump is NOT a valid backup until ops-restore-check.sh passed on it (OPS-2).
# Retention (default 14 dumps) is local; ops-offsite-sync.sh copies the newest verified pair off the VPS.
# The .sha256 holds the dump's basename, so `sha256sum -c` works from the directory the pair is copied to.
set -eu
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
keep="${BACKUP_KEEP:-14}"
case "$keep" in ''|*[!0-9]*) echo "ops-backup: BACKUP_KEEP must be a positive integer." >&2; exit 1 ;; esac
[ "$keep" -ge 1 ] || { echo "ops-backup: BACKUP_KEEP must be at least 1." >&2; exit 1; }

fail() { echo "ops-backup: refusing: $1" >&2; exit 1; }
# shellcheck source=ops-lib.sh
. "${OPS_LIB:-/ops/ops-lib.sh}"

parse_url "$DATABASE_URL" "DATABASE_URL"
if [ -n "$P_PASS_RAW" ]; then
  PGPASSWORD="$(pct_decode "$P_PASS_RAW")"
  export PGPASSWORD
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="/backups/.sf-staging-${stamp}.dump.partial"
final="/backups/sf-staging-${stamp}.dump"
base="$(basename "$final")"

# A failed or interrupted run never leaves a partial dump behind.
trap 'rm -f -- "$tmp"' EXIT
trap 'exit 1' INT TERM

pg_dump --format=custom --no-owner --no-privileges --file="$tmp" "$P_URL_NOPASS"
# A dump that pg_restore cannot even list is rejected before it replaces anything.
pg_restore --list "$tmp" > /dev/null
mv "$tmp" "$final"
(cd /backups && sha256sum "$base" > "$base.sha256")
echo "ops-backup: wrote $base ($(wc -c < "$final") bytes)"

# Keep the newest $keep dumps.
ls -1t /backups/sf-staging-*.dump 2>/dev/null | tail -n +$((keep + 1)) | while read -r old; do
  rm -f -- "$old" "$old.sha256"
  echo "ops-backup: pruned $(basename "$old")"
done
