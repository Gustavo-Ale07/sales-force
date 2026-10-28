#!/usr/bin/env bash
# STAGING ONLY. Enables EXTERNAL_IDUSU_IS_CODUSU_VALIDATED=1 + EXTERNAL_AUTO_PROVISION=1 (compose.env), recreates ONLY the api
# service, then proves the seller auto-provisioning with a real login (seller user), a second login (idempotence), and the SUP
# regression. Run on the VPS:   sudo bash enable-auto-provision-staging.sh
# No code deploy, no migration, no SF_FIRST_DEPLOY, no postgres/worker/verifier/web/edge recreate, no Sankhya call from here.
# Passwords: hidden prompts, shell variables only. Printed: flags, status codes, YES/NO, counts, sanitized failure reasons.
set -u
SF_ROOT="${SF_ROOT:-/opt/force-staging}"
REPO="${SF_REPO_DIR:-$SF_ROOT/repo}"
ENVF="${SF_COMPOSE_ENV:-$SF_ROOT/config/compose.env}"
PROJECT="${SF_COMPOSE_PROJECT:-salesforce-staging}"
BASE=https://force.sistemasplac.com.br/api/v1
ORIGIN=https://force.sistemasplac.com.br
cid() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n1; }
die() { echo "STOP: $*"; exit 2; }

[ -r "$ENVF" ] && [ -w "$ENVF" ] || die "compose.env not readable/writable at the expected path"
[ -d "$REPO/deploy" ] || die "repository directory not found"
PG="$(cid postgres)"; API="$(cid api)"; WEB="$(cid web)"
[ -n "$PG" ] && [ -n "$API" ] && [ -n "$WEB" ] || die "postgres, api and web containers must be running"
EDGE="$(sed -n 's/^SF_EDGE_MODE=//p' "$ENVF" | tail -n1)"
[ "$EDGE" = "external" ] || die "SF_EDGE_MODE is not 'external' in compose.env (unexpected edge setup); nothing changed"
# Guard: preconditions the owner stated must hold before we touch anything (values only for these names).
val() { sed -n "s/^$1=//p" "$ENVF" | tail -n1; }
[ "$(val EXTERNAL_LOGIN_ENABLED)" = "1" ] || die "EXTERNAL_LOGIN_ENABLED is not 1"
[ "$(val VERIFIER_MODE)" = "live" ] || die "VERIFIER_MODE is not live"
[ "$(val VERIFIER_SANKHYA_BASE_URL)" = "https://placfestas-teste.sankhyacloud.com.br" ] || die "VERIFIER_SANKHYA_BASE_URL is not the sandbox"

psqlq() { local sql="${!#}"; set -- "${@:1:$#-1}"; printf '%s
' "$sql" | docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c 'psql -X -q -t -A -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off "$@"' sh "$@"; }

compose_api() { # same files / project / env-file as the deploy scripts; images taken from the running containers
  ( cd "$REPO" && SERVER_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$API")" WEB_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$WEB")" \
      docker compose -p "$PROJECT" --env-file "$ENVF" -f deploy/docker-compose.staging.yml -f deploy/docker-compose.staging.external-edge.yml "$@" )
}
wait_healthy() { # up to ~150 s
  local i s
  for i in $(seq 1 30); do
    API="$(cid api)"; s=""
    [ -n "$API" ] && s="$(docker inspect --format '{{if .State.Running}}running{{else}}stopped{{end}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' "$API" 2>/dev/null)"
    [ "$s" = "running/healthy" ] && return 0
    sleep 5
  done
  return 1
}
set_keys() { # atomic + idempotent: 0 or 1 active assignment per key is valid; drop it (comments kept), append exactly one; keep owner/group/mode
  local tmp; tmp="$(mktemp "$ENVF.tmp.XXXXXX")" || return 1
  grep -Ev "^[[:space:]]*(EXTERNAL_AUTO_PROVISION|EXTERNAL_IDUSU_IS_CODUSU_VALIDATED)=" "$ENVF" > "$tmp"
  [ $? -le 1 ] || { rm -f "$tmp"; return 1; }
  printf "EXTERNAL_IDUSU_IS_CODUSU_VALIDATED=1
EXTERNAL_AUTO_PROVISION=1
" >> "$tmp"
  chmod --reference="$ENVF" "$tmp" && chown --reference="$ENVF" "$tmp" && mv -f "$tmp" "$ENVF"
}

echo "== 1. compose.env change (two keys only) =="
BACKUP="$ENVF.bak.$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$ENVF" "$BACKUP" || die "could not back up compose.env"
echo "backup: $(basename "$BACKUP")"
for k in EXTERNAL_AUTO_PROVISION EXTERNAL_IDUSU_IS_CODUSU_VALIDATED; do
  n="$(grep -Ec "^[[:space:]]*$k=" "$ENVF")"
  [ "$n" -le 1 ] 2>/dev/null || die "$k has $n active assignments (expected 0 or 1); nothing changed"
done
set_keys || { cp -p "$BACKUP" "$ENVF"; die "could not edit compose.env; restored the backup"; }
for k in EXTERNAL_AUTO_PROVISION EXTERNAL_IDUSU_IS_CODUSU_VALIDATED; do
  [ "$(grep -Ec "^[[:space:]]*$k=" "$ENVF")" = "1" ] || { cp -p "$BACKUP" "$ENVF"; die "$k does not occur exactly once; restored the backup"; }
done

echo; echo "== 2. recreate ONLY api (--no-deps) =="
compose_api config -q 2> /dev/null || { cp -p "$BACKUP" "$ENVF"; die "compose config invalid; backup restored, nothing recreated"; }
if ! compose_api up -d --no-deps --force-recreate api > /dev/null 2>&1 || ! wait_healthy; then
  echo "api did not become healthy: restoring compose.env and recreating api"
  cp -p "$BACKUP" "$ENVF"; compose_api up -d --no-deps --force-recreate api > /dev/null 2>&1; wait_healthy && echo "api healthy again with the previous config"
  die "auto-provision NOT enabled (rolled back)"
fi
API="$(cid api)"
echo "api container: $(docker inspect --format '{{if .State.Running}}running{{else}}stopped{{end}}' "$API")  health: $(docker inspect --format '{{.State.Health.Status}}' "$API")"
for n in EXTERNAL_LOGIN_ENABLED EXTERNAL_AUTO_PROVISION EXTERNAL_IDUSU_IS_CODUSU_VALIDATED EXTERNAL_DIRECTORY_MAX_AGE_MINUTES; do
  echo "$n=$(docker exec "$API" printenv "$n" 2>/dev/null | grep -E '^[0-9]{1,4}$' || echo '<unset/invalid>')"
done

echo; echo "== 3. real logins (hidden prompts) =="
T="$(mktemp -d)"; umask 077
trap 'rm -rf "$T"; unset PW_S PW_U' EXIT
esc() { local s="${1//\\/\\\\}"; printf '%s' "${s//\"/\\\"}"; }
LOGIN_CODE=""; COOKIE=""; FLAGS=""
login() { # user pass jar
  LOGIN_CODE=$(curl -s -m 40 -o "$T/body" -D "$T/hdr" -c "$3" -w '%{http_code}' -H 'content-type: application/json' -H "Origin: $ORIGIN" \
    -d "{\"username\":\"$(esc "$1")\",\"password\":\"$(esc "$2")\"}" "$BASE/auth/login")
  LOGIN_CODE="${LOGIN_CODE//[^0-9]/}"; LOGIN_CODE="${LOGIN_CODE:0:3}"   # status = digits only, never mixed with a body
  COOKIE=no; FLAGS=""
  if grep -qi '^set-cookie: sf_session=' "$T/hdr"; then COOKIE=yes
    grep -i '^set-cookie: sf_session=' "$T/hdr" | grep -qi httponly && FLAGS="HttpOnly"
    grep -i '^set-cookie: sf_session=' "$T/hdr" | grep -qi secure && FLAGS="$FLAGS Secure"; fi
}
SESS_CODE=""; SESS_AUTH=false; SESS_ROLE="-"; SESS_N=0
session() { # jar
  SESS_CODE=$(curl -s -m 20 -o "$T/body" -b "$1" -w '%{http_code}' "$BASE/auth/session")
  SESS_AUTH=false; grep -q '"authenticated":true' "$T/body" && SESS_AUTH=true
  SESS_ROLE="$(sed -n 's/.*"role":"\([a-z]*\)".*/\1/p' "$T/body" | head -n1)"; SESS_ROLE="${SESS_ROLE:--}"
  SESS_N="$(grep -o '"sellerCodes":\[[^]]*\]' "$T/body" | grep -o '[0-9]\+' | wc -l | tr -d ' ')"
}
logout() { curl -s -m 20 -o /dev/null -b "$1" -X POST -H "Origin: $ORIGIN" "$BASE/auth/logout"; }
now_db() { psqlq "select clock_timestamp()"; }
# Account that got a successful external login after $1 (sanitized: the id stays in a shell variable, never printed).
actor_since() { psqlq -v since="$1" "select actor_account_id from audit_log where action='auth.login.success' and at >= :'since'::timestamptz and actor_account_id is not null order by at desc limit 1"; }
failure_reasons_since() { psqlq -v since="$1" "select distinct coalesce(detail->>'reason','-') from audit_log where action='auth.login.failure' and at >= :'since'::timestamptz order by 1" \
  | grep -E '^[a-z_]{1,40}$' | tr '\n' ' '; }

read -r -p "Seller user login name (e.g. Cristiane Vietta; visible, not a secret): " SELLER_LOGIN
read -rs -p "Seller user password: " PW_S; echo
M1="$(now_db)"
login "$SELLER_LOGIN" "$PW_S" "$T/s1"; C1="$LOGIN_CODE"; K1="$COOKIE"; F1="$FLAGS"
if [ "$C1" != "200" ]; then
  echo "first login: HTTP $C1  (sanitized reasons in audit_log since the attempt: $(failure_reasons_since "$M1"))"
  echo "STOP: no code change attempted. auto-provision flags stay ON in staging; report the reason above."
  echo "RESULT: AUTO-PROVISION FAILED"; exit 4
fi
session "$T/s1"; S1A="$SESS_AUTH"; S1R="$SESS_ROLE"; S1N="$SESS_N"
ACC="$(actor_since "$M1")"
logout "$T/s1"

M2="$(now_db)"
login "$SELLER_LOGIN" "$PW_S" "$T/s2"; C2="$LOGIN_CODE"
session "$T/s2"; S2A="$SESS_AUTH"; S2R="$SESS_ROLE"
logout "$T/s2"; unset PW_S

echo; echo "== 4. database counts for that account (counts only) =="
ACC_OK=no; case "$ACC" in [0-9a-f]*-*-*-*-*) ACC_OK=yes;; esac
if [ "$ACC_OK" = yes ]; then
  EXT_ID="$(psqlq -v a="$ACC" "select external_user_id from account where id = :'a'::uuid")"
  N_ACC="$(psqlq -v e="$EXT_ID" "select count(*) from account where external_user_id = :'e'")"
  N_LINK="$(psqlq -v a="$ACC" "select count(*) from account_seller_link where account_id = :'a'::uuid")"
  N_AUTO="$(psqlq -v a="$ACC" "select count(*) from account_seller_link where account_id = :'a'::uuid and source='sankhya_auto'")"
  ROLE_DB="$(psqlq -v a="$ACC" "select role from account where id = :'a'::uuid")"
  A_SUCCESS="$(psqlq -v a="$ACC" -v since="$M1" "select count(*) from audit_log where actor_account_id = :'a'::uuid and action='auth.login.success' and at >= :'since'::timestamptz")"
  A_CREATED="$(psqlq -v a="$ACC" -v since="$M1" "select count(*) from audit_log where action='account.created' and detail->>'accountId' = :'a' and at >= :'since'::timestamptz")"
  A_LINKED="$(psqlq -v a="$ACC" -v since="$M1" "select count(*) from audit_log where action='account.seller_linked' and actor_account_id = :'a'::uuid and at >= :'since'::timestamptz")"
  A_METHOD="$(psqlq -v a="$ACC" -v since="$M1" "select count(*) from audit_log where actor_account_id = :'a'::uuid and action='auth.login.success' and at >= :'since'::timestamptz and detail::text ilike '%external%'")"
  A_SESS="$(psqlq -v a="$ACC" "select count(*) from session where account_id = :'a'::uuid")"
else
  N_ACC="n/a"; N_LINK="n/a"; N_AUTO="n/a"; ROLE_DB="n/a"; A_SUCCESS=0; A_CREATED=0; A_LINKED=0; A_METHOD=0; A_SESS=0
fi
echo "accounts for this external identity: $N_ACC"
echo "seller links for this account: $N_LINK"
echo "automatic seller links: $N_AUTO"

echo; echo "== 5. SUP regression =="
read -rs -p "SUP password: " PW_U; echo
M3="$(now_db)"
login SUP "$PW_U" "$T/u1"; CU="$LOGIN_CODE"; KU="$COOKIE"
session "$T/u1"; UA="$SESS_AUTH"; UR="$SESS_ROLE"
SUP_ACC="$(actor_since "$M3")"
logout "$T/u1"; unset PW_U
U_LINKS="n/a"; U_ROLE_DB="n/a"
case "$SUP_ACC" in [0-9a-f]*-*-*-*-*)
  U_LINKS="$(psqlq -v a="$SUP_ACC" "select count(*) from account_seller_link where account_id = :'a'::uuid")"
  U_ROLE_DB="$(psqlq -v a="$SUP_ACC" "select role from account where id = :'a'::uuid")";; esac

yn() { [ "$1" = "yes" ] && echo YES || echo NO; }
echo; echo "==================== FINAL ===================="
echo "flags:"
for n in EXTERNAL_LOGIN_ENABLED EXTERNAL_AUTO_PROVISION EXTERNAL_IDUSU_IS_CODUSU_VALIDATED EXTERNAL_DIRECTORY_MAX_AGE_MINUTES; do
  echo "$n=$(docker exec "$(cid api)" printenv "$n" 2>/dev/null | grep -E '^[0-9]{1,4}$' || echo '?')"
done
echo; echo "Seller user:"
echo "login: HTTP $C1"
echo "cookie: $K1 $F1"
echo "session: authenticated:$S1A"
echo "role: $S1R (db: $ROLE_DB)"
echo "sellerCodes count: $S1N"
echo "account count: $N_ACC"
echo "seller link count: $N_LINK"
echo "automatic link: $([ "$N_AUTO" = "1" ] && echo YES || echo NO)"
echo "second login: HTTP $C2 authenticated:$S2A role:$S2R"
echo "audit: auth.login.success=$([ "$A_SUCCESS" -ge 1 ] 2>/dev/null && echo YES || echo NO) method external=$([ "$A_METHOD" -ge 1 ] 2>/dev/null && echo YES || echo NO) session created=$([ "$A_SESS" -ge 1 ] 2>/dev/null && echo YES || echo NO) account provisioned=$([ "$A_CREATED" -ge 1 ] 2>/dev/null && echo YES || echo NO) seller link created=$([ "$A_LINKED" -ge 1 ] 2>/dev/null && echo YES || echo NO)"
echo; echo "SUP regression:"
echo "login: HTTP $CU (cookie $KU)"
echo "session: authenticated:$UA"
echo "role: $UR (db: $U_ROLE_DB)"
echo "seller links: $U_LINKS"

OK=yes
[ "$C1" = 200 ] && [ "$K1" = yes ] && [ "$S1A" = true ] && [ "$S1R" = seller ] && [ "$S1N" = 1 ] || OK=no
[ "$N_ACC" = 1 ] && [ "$N_LINK" = 1 ] && [ "$N_AUTO" = 1 ] || OK=no
[ "$C2" = 200 ] && [ "$S2A" = true ] && [ "$S2R" = seller ] || OK=no
[ "$CU" = 200 ] && [ "$UA" = true ] && [ "$UR" = manager ] && [ "$U_LINKS" = 0 ] || OK=no
echo; echo "RESULT: $([ "$OK" = yes ] && echo 'AUTO-PROVISION WORKING' || echo 'AUTO-PROVISION FAILED (see the lines above; no code change attempted)')"
[ "$OK" = yes ]
