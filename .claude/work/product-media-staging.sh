#!/usr/bin/env bash
# STAGING + SANDBOX only, READ-ONLY on Sankhya. Product photo bootstrap/enable, run inside the EXISTING worker container.
#   sudo bash product-media-staging.sh check     # guards, volume, migration, counts (read-only)
#   sudo bash product-media-staging.sh dry       # bootstrap --dry-run --codprod <small set>   (writes nothing)
#   sudo bash product-media-staging.sh small     # bootstrap --codprod <small set> (writes photos to the media volume)
#   sudo bash product-media-staging.sh full      # complete bootstrap (run only after `small` passed)
#   sudo bash product-media-staging.sh enable    # PRODUCT_MEDIA_SYNC_ENABLED=true, recreate ONLY the worker (rollback on failure)
# Small set: SMALL_CODES env (default 4158,15 plus the 3 lowest active product codes of the mirror).
# Nothing is printed except counters, codes, status words. Image bytes/base64 are never printed.
set -u
MODE="${1:-check}"
SF_ROOT="${SF_ROOT:-/opt/force-staging}"; REPO="${SF_REPO_DIR:-$SF_ROOT/repo}"; ENVF="${SF_COMPOSE_ENV:-$SF_ROOT/config/compose.env}"
PROJECT="${SF_COMPOSE_PROJECT:-salesforce-staging}"
cid() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n1; }
die() { echo "STOP: $*"; exit 2; }
PG="$(cid postgres)"; WK="$(cid worker)"; API="$(cid api)"; WEB="$(cid web)"
[ -n "$PG" ] && [ -n "$WK" ] || die "postgres/worker not running"
psqlq() { local sql="${!#}"; set -- "${@:1:$#-1}"; printf '%s\n' "$sql" | docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c 'psql -X -q -t -A -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off "$@"' sh "$@"; }
MODEV="$(docker exec "$WK" printenv SANKHYA_MODE 2>/dev/null)"; ENVK="$(docker exec "$WK" printenv SANKHYA_ENVIRONMENT 2>/dev/null)"
echo "guard: SANKHYA_MODE=$MODEV SANKHYA_ENVIRONMENT=$ENVK"
[ "$MODEV" = live ] && [ "$ENVK" = sandbox ] || die "worker must be live + sandbox"
docker exec "$WK" test -f dist/product-media-bootstrap.js || die "dist/product-media-bootstrap.js missing in the worker image"
MEDIA_DIR="$(docker exec "$WK" printenv PRODUCT_MEDIA_DIR 2>/dev/null)"; echo "PRODUCT_MEDIA_DIR=$MEDIA_DIR"

report() {
  echo "-- volume (persistent named volume):"; docker volume ls --format '{{.Name}}' | grep -E 'product_media$' | sed 's/^/   /'
  echo "-- migration 0010 (thumbnail columns): $(psqlq "select case when exists (select 1 from information_schema.columns where table_name='product_media' and column_name='thumbnail_storage_key') then 'YES' else 'NO' end")"
  echo "-- product_media rows by status:"; psqlq "select '   '||status||'='||count(*) from product_media group by status order by 1"
  echo "-- with thumbnail: $(psqlq "select count(*) from product_media where thumbnail_storage_key is not null")"
  echo "-- disk usage in worker volume: $(docker exec "$WK" sh -c "du -sh '$MEDIA_DIR' 2>/dev/null | cut -f1") files: $(docker exec "$WK" sh -c "find '$MEDIA_DIR' -type f 2>/dev/null | wc -l")"
  echo "-- PRODUCT_MEDIA_SYNC_ENABLED (worker)=$(docker exec "$WK" printenv PRODUCT_MEDIA_SYNC_ENABLED 2>/dev/null)"
}
codes() { echo "${SMALL_CODES:-4158,15,$(psqlq "select string_agg(code::text, ',' order by code) from (select code from erp_product where active and deleted_at is null and code not in (4158,15) order by code limit 3) t")}"; }
run_bootstrap() { # args...
  timeout 3000 docker exec "$WK" node dist/product-media-bootstrap.js "$@" 2>&1 | cut -c1-220 | grep -vE '^[A-Za-z0-9+/=]{200,}$'
  return "${PIPESTATUS[0]}"
}

case "$MODE" in
check) report ;;
dry)   C="$(codes)"; echo "codes: $C"; run_bootstrap --dry-run --codprod "$C"; echo "exit: $?" ;;
small) C="$(codes)"; echo "codes: $C"; run_bootstrap --codprod "$C"; echo "exit: $?"; report
       echo "-- per product (code status type bytes thumb):"
       psqlq -v c="$C" "select '   '||product_code||' '||status||' '||coalesce(content_type,'-')||' '||coalesce(byte_length::text,'-')||' thumb='||coalesce(thumbnail_content_type||':'||thumbnail_byte_length,'none')||' '||coalesce(failure_reason,'') from product_media where product_code = any(string_to_array(:'c', ',')::int[]) order by 1" ;;
full)  echo "== full bootstrap (resumable/idempotent) =="; run_bootstrap --concurrency 1; echo "exit: $?"; report ;;
enable)
  [ -n "$API" ] && [ -n "$WEB" ] || die "api/web must be running"
  [ "$(psqlq "select count(*) from product_media where status='stored'")" -gt 0 ] 2>/dev/null || die "no stored photos yet: run small/full first; nothing changed"
  BACKUP="$ENVF.bak.$(date -u +%Y%m%dT%H%M%SZ)"; cp -p "$ENVF" "$BACKUP" || die "backup failed"; echo "backup: $(basename "$BACKUP")"
  tmp="$(mktemp "$ENVF.tmp.XXXXXX")" || die mktemp
  grep -Ev '^[[:space:]]*PRODUCT_MEDIA_SYNC_ENABLED=' "$ENVF" > "$tmp"; [ $? -le 1 ] || { rm -f "$tmp"; die "edit failed"; }
  echo 'PRODUCT_MEDIA_SYNC_ENABLED=true' >> "$tmp"
  chmod --reference="$ENVF" "$tmp" && chown --reference="$ENVF" "$tmp" && mv -f "$tmp" "$ENVF" || { cp -p "$BACKUP" "$ENVF"; die "write failed; restored"; }
  [ "$(grep -Ec '^[[:space:]]*PRODUCT_MEDIA_SYNC_ENABLED=' "$ENVF")" = 1 ] || { cp -p "$BACKUP" "$ENVF"; die "key not exactly once; restored"; }
  cw() { ( cd "$REPO" && SERVER_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$API")" WEB_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$WEB")" docker compose -p "$PROJECT" --env-file "$ENVF" -f deploy/docker-compose.staging.yml -f deploy/docker-compose.staging.external-edge.yml "$@" ); }
  waitw() { local i s; for i in $(seq 1 36); do WK="$(cid worker)"; s=""; [ -n "$WK" ] && s="$(docker inspect --format '{{if .State.Running}}running{{else}}stopped{{end}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' "$WK" 2>/dev/null)"; case "$s" in running/healthy|running/nohealth) return 0;; esac; sleep 5; done; return 1; }
  cw config -q 2>/dev/null || { cp -p "$BACKUP" "$ENVF"; die "compose config invalid; restored"; }
  if ! cw up -d --no-deps --force-recreate worker >/dev/null 2>&1 || ! waitw; then
    echo "worker not healthy: rolling back"; cp -p "$BACKUP" "$ENVF"; cw up -d --no-deps --force-recreate worker >/dev/null 2>&1; waitw && echo "worker healthy again (previous config)"; die "NOT enabled (rolled back)"
  fi
  WK="$(cid worker)"; echo "PRODUCT_MEDIA_SYNC_ENABLED=$(docker exec "$WK" printenv PRODUCT_MEDIA_SYNC_ENABLED) cron=$(docker exec "$WK" printenv PRODUCT_MEDIA_SYNC_CRON)"
  echo "files after recreate (persistence): $(docker exec "$WK" sh -c "find '$MEDIA_DIR' -type f 2>/dev/null | wc -l")"
  psqlq "select 'schedule '||name||' cron='||cron from pgboss.schedule where name like 'media.%'" 2>/dev/null; echo "RESULT: product media sync ENABLED" ;;
*) die "usage: check|dry|small|full|enable" ;;
esac
