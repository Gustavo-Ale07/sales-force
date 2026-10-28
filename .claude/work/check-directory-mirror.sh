#!/usr/bin/env bash
# READ-ONLY staging check: migration 0011, directory mirror health, and the four EXTERNAL_* switches.
# Run: sudo bash check-directory-mirror.sh
# Changes nothing. Prints only YES/NO, counts, timestamps and the four switch values. No names, ids, secrets or other env.
set -u
PROJECT="${SF_COMPOSE_PROJECT:-salesforce-staging}"
cid() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n1; }
PG="$(cid postgres)"; API="$(cid api)"; WK="$(cid worker)"
[ -n "$PG" ] || { echo "no running postgres container in project $PROJECT"; exit 2; }
[ -n "$API" ] || { echo "no running api container in project $PROJECT"; exit 2; }

psqlq() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c 'psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off "$@"' sh "$@"; }

echo "== 2. Switches seen by the running api container (only these four names) =="
MAXAGE=120
for n in EXTERNAL_LOGIN_ENABLED EXTERNAL_AUTO_PROVISION EXTERNAL_IDUSU_IS_CODUSU_VALIDATED EXTERNAL_DIRECTORY_MAX_AGE_MINUTES; do
  v="$(docker exec "$API" printenv "$n" 2>/dev/null || echo '<unset>')"
  case "$n" in
    EXTERNAL_DIRECTORY_MAX_AGE_MINUTES) case "$v" in ''|*[!0-9]*) v='<unset/invalid>';; *) MAXAGE="$v";; esac ;;
    *) case "$v" in 0|1) ;; *) v='<unset/invalid>';; esac ;;
  esac
  echo "$n=$v"
done
echo

echo "== 1. Migration 0011 and the directory mirror =="
psqlq -v maxage="$MAXAGE" <<'SQL'
select case when to_regclass('public.erp_directory_user') is not null then 'YES' else 'NO' end as table_erp_directory_user_exists;
select 'YES' as pgboss_queue_directoryUsers_exists
where to_regclass('pgboss.queue') is not null and exists (select 1 from pgboss.queue where name = 'sync.mirror.directoryUsers');
select case when to_regclass('public.erp_directory_user') is null then null else
  (select count(*) from erp_directory_user where deleted_at is null) end as users_mirrored,
 case when to_regclass('public.erp_directory_user') is null then null else
  (select count(*) from erp_directory_user where deleted_at is null and seller_code is not null) end as with_seller_code;
select to_char(last_success_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as directoryUsers_last_success_utc,
       round(extract(epoch from (now() - last_success_at)) / 60) as age_minutes,
       case when now() - last_success_at <= make_interval(mins => :maxage) then 'YES' else 'NO' end as within_max_age
from sync_state where entity = 'directoryUsers';
select count(*) as sync_state_rows_for_directoryUsers from sync_state where entity = 'directoryUsers';
SQL
echo
echo "== worker: directoryUsers log lines in the last 6 hours (count only) =="
if [ -n "$WK" ]; then
  n="$(docker logs --since 6h "$WK" 2>&1 | grep -c 'directoryUsers')"
  echo "lines mentioning directoryUsers: $n"
  echo "worker syncing directoryUsers (log evidence): $([ "$n" -gt 0 ] && echo YES || echo NO)"
else
  echo "worker container not running"
fi
echo "Done. Read-only."
