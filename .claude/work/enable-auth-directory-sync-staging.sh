#!/usr/bin/env bash
# STAGING ONLY. Sets AUTH_DIRECTORY_SYNC_ENABLED=1 and AUTH_DIRECTORY_SYNC_CRON=*/15 * * * * in compose.env, recreates ONLY the
# worker (--no-deps), waits for health, then reports sellers/directoryUsers sync_state and scheduler evidence.
#   sudo bash enable-auth-directory-sync-staging.sh
# Touches no other key, no api/postgres/verifier/web/edge, no migration, no deploy. Prints no secrets.
set -u
SF_ROOT="${SF_ROOT:-/opt/force-staging}"
REPO="${SF_REPO_DIR:-$SF_ROOT/repo}"
ENVF="${SF_COMPOSE_ENV:-$SF_ROOT/config/compose.env}"
PROJECT="${SF_COMPOSE_PROJECT:-salesforce-staging}"
cid() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n1; }
die() { echo "STOP: $*"; exit 2; }

[ -r "$ENVF" ] && [ -w "$ENVF" ] || die "compose.env not readable/writable"
[ -d "$REPO/deploy" ] || die "repository directory not found"
PG="$(cid postgres)"; API="$(cid api)"; WEB="$(cid web)"; WK="$(cid worker)"
[ -n "$PG" ] && [ -n "$API" ] && [ -n "$WEB" ] && [ -n "$WK" ] || die "postgres, api, web and worker must be running"
echo "deployed sha: $(env SF_ROOT="$SF_ROOT" "$REPO/deploy/scripts/deploy-staging.sh" --print-deployed-sha 2>/dev/null | head -n1)"
val() { sed -n "s/^$1=//p" "$ENVF" | tail -n1; }
[ "$(val EXTERNAL_LOGIN_ENABLED)" = "1" ] || die "EXTERNAL_LOGIN_ENABLED is not 1"
[ "$(val SYNC_MIRROR_ENABLED)" != "1" ] && [ "$(val SYNC_MIRROR_ENABLED)" != "true" ] || die "SYNC_MIRROR_ENABLED is on; this script only enables the targeted auth mirror"

psqlq() { local sql="${!#}"; set -- "${@:1:$#-1}"; printf '%s\n' "$sql" | docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c 'psql -X -q -t -A -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off "$@"' sh "$@"; }
compose_wk() {
  ( cd "$REPO" && SERVER_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$API")" WEB_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$WEB")" \
      docker compose -p "$PROJECT" --env-file "$ENVF" -f deploy/docker-compose.staging.yml -f deploy/docker-compose.staging.external-edge.yml "$@" )
}
wait_healthy() { local i s; for i in $(seq 1 36); do WK="$(cid worker)"; s=""
    [ -n "$WK" ] && s="$(docker inspect --format '{{if .State.Running}}running{{else}}stopped{{end}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' "$WK" 2>/dev/null)"
    case "$s" in running/healthy|running/nohealth) return 0;; esac; sleep 5; done; return 1; }

echo "== 1. compose.env (two keys only) =="
BACKUP="$ENVF.bak.$(date -u +%Y%m%dT%H%M%SZ)"; cp -p "$ENVF" "$BACKUP" || die "backup failed"; echo "backup: $(basename "$BACKUP")"
tmp="$(mktemp "$ENVF.tmp.XXXXXX")" || die "mktemp failed"
grep -Ev "^[[:space:]]*(AUTH_DIRECTORY_SYNC_ENABLED|AUTH_DIRECTORY_SYNC_CRON)=" "$ENVF" > "$tmp"; [ $? -le 1 ] || { rm -f "$tmp"; die "edit failed"; }
printf 'AUTH_DIRECTORY_SYNC_ENABLED=1\nAUTH_DIRECTORY_SYNC_CRON=*/15 * * * *\n' >> "$tmp"
chmod --reference="$ENVF" "$tmp" && chown --reference="$ENVF" "$tmp" && mv -f "$tmp" "$ENVF" || { cp -p "$BACKUP" "$ENVF"; die "could not write compose.env; restored"; }
for k in AUTH_DIRECTORY_SYNC_ENABLED AUTH_DIRECTORY_SYNC_CRON; do
  [ "$(grep -Ec "^[[:space:]]*$k=" "$ENVF")" = 1 ] || { cp -p "$BACKUP" "$ENVF"; die "$k not exactly once; restored"; }
done
compose_wk config -q 2>/dev/null || { cp -p "$BACKUP" "$ENVF"; die "compose config invalid; restored, nothing recreated"; }

echo "== 2. recreate ONLY worker (--no-deps) =="
START="$(psqlq "select clock_timestamp()")"
if ! compose_wk up -d --no-deps --force-recreate worker >/dev/null 2>&1 || ! wait_healthy; then
  echo "worker not healthy: restoring compose.env and recreating worker with the previous config"
  cp -p "$BACKUP" "$ENVF"; compose_wk up -d --no-deps --force-recreate worker >/dev/null 2>&1; wait_healthy && echo "worker healthy again (previous config)"
  die "auth directory sync NOT enabled (rolled back)"
fi
WK="$(cid worker)"
echo "worker: $(docker inspect --format '{{if .State.Running}}running{{else}}stopped{{end}}' "$WK") health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$WK")"
for n in AUTH_DIRECTORY_SYNC_ENABLED AUTH_DIRECTORY_SYNC_CRON SYNC_MIRROR_ENABLED PRODUCT_MEDIA_SYNC_ENABLED; do
  echo "$n=$(docker exec "$WK" printenv "$n" 2>/dev/null | grep -E '^[0-9a-z*/, ]{1,40}$' || echo '<unset>')"
done

echo "== 3. wait for startup sync (up to ~3 min) =="
for i in $(seq 1 36); do
  N="$(psqlq -v s="$START" "select count(*) from sync_state where entity in ('sellers','directoryUsers') and status='succeeded' and last_success_at >= :'s'::timestamptz")"
  [ "$N" = 2 ] && break; sleep 5
done
psqlq "select entity||' status='||status||' age_min='||round(extract(epoch from (now()-last_success_at))/60)||' rows='||coalesce(row_count::text,'-')||' err='||coalesce(last_error_class,'-') from sync_state where entity in ('sellers','directoryUsers') order by entity"
psqlq "select 'erp_seller live='||count(*)||' active='||count(*) filter (where active) from erp_seller where deleted_at is null"
psqlq "select 'erp_directory_user live='||count(*)||' with_seller_code='||count(*) filter (where seller_code is not null) from erp_directory_user where deleted_at is null"

echo "== 4. scheduler evidence (pg-boss schedules) =="
psqlq "select name||' cron='||cron from pgboss.schedule where name like 'sync.mirror.%' order by name" 2>/dev/null || echo "(pgboss.schedule not readable here)"
echo "worker log lines (counts): $(docker logs --since 10m "$WK" 2>&1 | grep -ci 'startup')"
[ "$N" = 2 ] && echo "RESULT: auth directory mirror ENABLED and fresh" || { echo "RESULT: startup sync did not complete in time; check the sync_state lines above"; exit 3; }
