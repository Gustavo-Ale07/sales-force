#!/bin/sh
# Logical dump of the staging database (pg_dump custom format) into /backups (host: SF_BACKUP_DIR).
# Runs inside the `backup` compose service (postgres client of the production major). DATABASE_URL comes
# from database.env; it is never printed. The dump is NOT a valid backup until ops-restore-check.sh passed
# on it (OPS-2). Retention (default 14 dumps) is local; copy the files to a second failure domain.
set -eu
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
keep="${BACKUP_KEEP:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="/backups/.sf-staging-${stamp}.dump.partial"
final="/backups/sf-staging-${stamp}.dump"

pg_dump --format=custom --no-owner --no-privileges --file="$tmp" "$DATABASE_URL"
# A dump that pg_restore cannot even list is rejected before it replaces anything.
pg_restore --list "$tmp" > /dev/null
mv "$tmp" "$final"
sha256sum "$final" > "$final.sha256"
echo "ops-backup: wrote $(basename "$final") ($(wc -c < "$final") bytes)"

# Keep the newest $keep dumps.
ls -1t /backups/sf-staging-*.dump 2>/dev/null | tail -n +$((keep + 1)) | while read -r old; do
  rm -f -- "$old" "$old.sha256"
  echo "ops-backup: pruned $(basename "$old")"
done
