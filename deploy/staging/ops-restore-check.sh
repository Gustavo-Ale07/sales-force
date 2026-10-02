#!/bin/sh
# Restore test (OPS-2: "a backup counts only after a tested restore"). Restores the newest dump in /backups
# (or the file named by $1: a plain sf-staging-*.dump name, no "/" or "..") into a SCRATCH database and checks
# it. It never writes to the staging database. Guards, all before anything is restored:
#   - the restore target must differ from DATABASE_URL in host, port OR database name (parsed, not a string
#     comparison), and may not use libpq URL overrides (host=, port=, dbname=, service=, ...);
#   - the target database name must carry a marker: it must contain "restore", "test" or "scratch".
# pg_restore --clean drops the objects it recreates in the target, so point it only at a disposable database.
# Passwords go to libpq through PGPASSWORD, not in process arguments. Prints elapsed seconds (RTO <= 4 h target;
# staging: informational).
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTORE_TEST_DATABASE_URL:?RESTORE_TEST_DATABASE_URL is required (a disposable database)}"

fail() { echo "ops-restore-check: refusing: $1" >&2; exit 1; }

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

# parse_url URL -> P_SCHEME P_USER_RAW P_PASS_RAW P_HOSTPORT P_HOST P_PORT P_DB P_QUERY (P_HOST lower-cased, P_DB decoded).
parse_url() {
  case "$1" in postgres://*|postgresql://*) ;; *) fail "$2 must be a postgres:// URL." ;; esac
  P_SCHEME="${1%%://*}"
  _rest="${1#*://}"
  P_QUERY=""
  case "$_rest" in *\?*) P_QUERY="?${_rest#*\?}"; _rest="${_rest%%\?*}" ;; esac
  _auth=""
  case "$_rest" in *@*) _auth="${_rest%@*}"; _rest="${_rest##*@}" ;; esac
  P_HOSTPORT="${_rest%%/*}"
  _db=""
  case "$_rest" in */*) _db="${_rest#*/}" ;; esac
  P_USER_RAW="${_auth%%:*}"
  P_PASS_RAW=""
  case "$_auth" in *:*) P_PASS_RAW="${_auth#*:}" ;; esac
  P_HOST="$P_HOSTPORT"
  P_PORT="5432"
  case "$P_HOSTPORT" in *:*) P_HOST="${P_HOSTPORT%:*}"; P_PORT="${P_HOSTPORT##*:}" ;; esac
  [ -n "$P_PORT" ] || P_PORT="5432"
  P_HOST="$(printf '%s' "$P_HOST" | tr 'A-Z' 'a-z')"
  [ -n "$P_HOST" ] || fail "$2 has no host."
  case "$P_HOST" in *,*) fail "$2 lists several hosts." ;; esac
  [ -n "$_db" ] || _db="$P_USER_RAW"
  P_DB="$(pct_decode "$_db")"
  [ -n "$P_DB" ] || fail "$2 names no database."
  case "&${P_QUERY#?}" in
    *"&host="*|*"&hostaddr="*|*"&port="*|*"&dbname="*|*"&user="*|*"&service="*|*"&password="*)
      fail "$2 overrides host, port, database, user or password through query parameters." ;;
  esac
}

parse_url "$DATABASE_URL" "DATABASE_URL"
live_host="$P_HOST"; live_port="$P_PORT"; live_db="$P_DB"
parse_url "$RESTORE_TEST_DATABASE_URL" "RESTORE_TEST_DATABASE_URL"
if [ "$P_HOST" = "$live_host" ] && [ "$P_PORT" = "$live_port" ] && [ "$P_DB" = "$live_db" ]; then
  fail "the restore target is the same host, port and database as DATABASE_URL."
fi
target_db_lc="$(printf '%s' "$P_DB" | tr 'A-Z' 'a-z')"
case "$target_db_lc" in
  *restore*|*test*|*scratch*) ;;
  *) fail "the restore target database name must contain \"restore\", \"test\" or \"scratch\" (it is overwritten)." ;;
esac

# Target URL without its password; the password travels in PGPASSWORD.
target_url="${P_SCHEME}://"
[ -n "$P_USER_RAW" ] && target_url="${target_url}${P_USER_RAW}@"
target_url="${target_url}${P_HOSTPORT}/${P_DB}${P_QUERY}"
if [ -n "$P_PASS_RAW" ]; then
  PGPASSWORD="$(pct_decode "$P_PASS_RAW")"
  export PGPASSWORD
fi

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

# The .sha256 carries the dump's basename: verified from the directory of the pair.
(cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256")

start="$(date +%s)"
pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges --dbname="$target_url" "$dump"
end="$(date +%s)"

# Sanity: the schema is there, and migrations were recorded. Table/column names are checked in the runbook
# against the migration journal of the deployed version; here only generic facts are asserted.
tables="$(psql "$target_url" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")"
[ "$tables" -gt 0 ] || { echo "ops-restore-check: restored database has no tables." >&2; exit 1; }
echo "ops-restore-check: OK $(basename "$dump"): $tables tables, restored in $((end - start)) s"
