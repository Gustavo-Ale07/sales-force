#!/usr/bin/env bash
# One-shot STAGING mirror sync of `sellers` and `directoryUsers` ONLY, run inside the EXISTING running worker container.
#   sudo bash sync-sellers-directory-users-once.sh
# Why `docker exec` into the worker: same image, same worker.env and compose env the worker already has, same private network;
# no compose invocation, no image re-resolution, no restart, no edit of compose.env or any env file, no migration, no deploy.
# Nothing is printed from the environment except the two guard values SANKHYA_MODE / SANKHYA_ENVIRONMENT.
# Reads Sankhya (SANDBOX, refused otherwise); writes only erp_seller / erp_directory_user / sync_state via the worker role.
# Does NOT enable SYNC_MIRROR_ENABLED, auto-provision, media sync, or any other entity.
set -u
PROJECT="${SF_COMPOSE_PROJECT:-salesforce-staging}"
cid() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n1; }
PG="$(cid postgres)"; WK="$(cid worker)"
[ -n "$PG" ] || { echo "STOP: no running postgres container in $PROJECT"; exit 2; }
[ -n "$WK" ] || { echo "STOP: no running worker container in $PROJECT"; exit 2; }

psqlq() { docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c 'psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off "$@"' sh "$@"; }

MODE="$(docker exec "$WK" printenv SANKHYA_MODE 2>/dev/null || true)"
ENVK="$(docker exec "$WK" printenv SANKHYA_ENVIRONMENT 2>/dev/null || true)"
echo "guard: SANKHYA_MODE=$MODE SANKHYA_ENVIRONMENT=$ENVK"
if [ "$MODE" != "live" ] || [ "$ENVK" != "sandbox" ]; then
  echo "STOP: worker must be SANKHYA_MODE=live and SANKHYA_ENVIRONMENT=sandbox. Nothing was run."; exit 3
fi
if ! docker exec "$WK" test -f dist/sync-once.js; then
  echo "STOP: dist/sync-once.js not found in the worker image. Nothing was run."; exit 4
fi

counts() {
  psqlq <<'SQL'
select 'erp_seller live rows' as metric, count(*)::text as value from erp_seller where deleted_at is null
union all select 'erp_seller active rows', count(*)::text from erp_seller where deleted_at is null and active
union all select 'erp_directory_user live rows', count(*)::text from erp_directory_user where deleted_at is null
union all select 'directory users with seller_code', count(*)::text from erp_directory_user where deleted_at is null and seller_code is not null;
SQL
}

echo; echo "== BEFORE =="; counts

echo; echo "== RUN: sync-once sellers directoryUsers (in the running worker container) =="
# Only the result lines are shown (gateway line, per-entity outcome/counters, FAILED lines, sync_state), cut to 300 chars.
timeout 900 docker exec "$WK" node dist/sync-once.js sellers directoryUsers 2>&1 \
  | grep -E '^(gateway:|sellers:|directoryUsers:|sync_state (sellers|directoryUsers):)' | cut -c1-300
RC=${PIPESTATUS[0]}
echo "exit code: $RC"

echo; echo "== AFTER =="; counts
echo
psqlq <<'SQL'
select entity, status, to_char(last_success_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_success_utc,
       round(extract(epoch from (now() - last_success_at)) / 60) as age_minutes,
       row_count, coalesce(last_error_class, '-') as last_error_class
from sync_state where entity in ('sellers', 'directoryUsers') order by entity;
SQL

if [ "$RC" -ne 0 ]; then echo "RESULT: FAILED (see lines above). Do not enable auto-provision."; exit "$RC"; fi
echo "RESULT: sync-once finished with exit 0. Check: directoryUsers outcome=completed, users>0, with seller_code>0, age<=120."
