#!/bin/sh
# Logical dump of the staging database (pg_dump custom format) into /backups (host: SF_BACKUP_DIR).
# Runs inside the `backup` compose service (postgres client of the production major). DATABASE_URL comes
# from database.env; it is never printed, and its password is passed to pg_dump through PGPASSWORD (not
# in the process arguments). The dump is NOT a valid backup until ops-restore-check.sh passed on it (OPS-2).
# Retention (default 14 dumps) is local; copy the files (dump + .sha256) to a second failure domain.
# The .sha256 holds the dump's basename, so `sha256sum -c` works from the directory the pair is copied to.
set -eu
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
keep="${BACKUP_KEEP:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="/backups/.sf-staging-${stamp}.dump.partial"
final="/backups/sf-staging-${stamp}.dump"
base="$(basename "$final")"

# A failed or interrupted run never leaves a partial dump behind.
trap 'rm -f -- "$tmp"' EXIT
trap 'exit 1' INT TERM

# Percent-decoding (awk keeps the secret out of any process argument list).
pct_decode() {
  printf '%s' "$1" | awk 'BEGIN { h = "0123456789abcdef" }
    { s = $0; out = ""
      while (length(s) > 0) {
        c = substr(s, 1, 1); a = index(h, tolower(substr(s, 2, 1))); b = index(h, tolower(substr(s, 3, 1)))
        if (c == "%" && length(s) >= 3 && a > 0 && b > 0) { out = out sprintf("%c", (a - 1) * 16 + b - 1); s = substr(s, 4) }
        else { out = out c; s = substr(s, 2) }
      }
      printf "%s", out }'
}

# postgres://USER:PASSWORD@HOST:PORT/DB?QUERY -> U_USER U_PASS HOSTPORT DB QUERY (user/password decoded for PGPASSWORD only).
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "ops-backup: DATABASE_URL must be a postgres:// URL." >&2; exit 1 ;;
esac
scheme="${DATABASE_URL%%://*}"
rest="${DATABASE_URL#*://}"
query=""
case "$rest" in *\?*) query="?${rest#*\?}"; rest="${rest%%\?*}" ;; esac
auth=""
case "$rest" in *@*) auth="${rest%@*}"; rest="${rest##*@}" ;; esac
hostport="${rest%%/*}"
dbname=""
case "$rest" in */*) dbname="${rest#*/}" ;; esac
user_raw="${auth%%:*}"
pass_raw=""
case "$auth" in *:*) pass_raw="${auth#*:}" ;; esac

if [ -n "$pass_raw" ]; then
  PGPASSWORD="$(pct_decode "$pass_raw")"
  export PGPASSWORD
fi
safe_url="${scheme}://"
[ -n "$user_raw" ] && safe_url="${safe_url}${user_raw}@"
safe_url="${safe_url}${hostport}/${dbname}${query}"

pg_dump --format=custom --no-owner --no-privileges --file="$tmp" "$safe_url"
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
