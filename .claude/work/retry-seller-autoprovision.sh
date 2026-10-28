#!/usr/bin/env bash
# STAGING, test only: one seller login + session + logout + second login against the CURRENT configuration.
#   sudo bash retry-seller-autoprovision.sh
# Changes nothing: no compose.env edit, no recreate/restart, no flags, no deploy, no migration. DB access is read-only.
# Password: hidden prompt, shell variable only. Printed: status codes, YES/NO, counts, sanitized audit reason/method.
set -u
PROJECT="${SF_COMPOSE_PROJECT:-salesforce-staging}"
BASE=https://force.sistemasplac.com.br/api/v1
ORIGIN=https://force.sistemasplac.com.br
cid() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n1; }
PG="$(cid postgres)"; API="$(cid api)"
[ -n "$PG" ] && [ -n "$API" ] || { echo "STOP: postgres and api containers must be running"; exit 2; }
psqlq() { local sql="${!#}"; set -- "${@:1:$#-1}"; printf '%s\n' "$sql" | docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c 'psql -X -q -t -A -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off "$@"' sh "$@"; }
T="$(mktemp -d)"; umask 077
trap 'rm -rf "$T"; unset PW' EXIT
esc() { local s="${1//\\/\\\\}"; printf '%s' "${s//\"/\\\"}"; }

echo "== 1. flags seen by the running api (read-only) =="
FLAGS_OK=yes
for n in EXTERNAL_LOGIN_ENABLED EXTERNAL_AUTO_PROVISION EXTERNAL_IDUSU_IS_CODUSU_VALIDATED; do
  v="$(docker exec "$API" printenv "$n" 2>/dev/null | grep -E '^[01]$' || echo '?')"; echo "$n=$v"; [ "$v" = 1 ] || FLAGS_OK=no
done
[ "$FLAGS_OK" = yes ] || { echo "STOP: a required flag is not 1 in the running api. Nothing was changed."; echo "RESULT: SELLER LOGIN FAILED"; exit 3; }

LOGIN_CODE=""; COOKIE=""; HO=""; SE=""
login() { # user pass jar
  LOGIN_CODE=$(printf '%s' "{\"username\":\"$(esc "$1")\",\"password\":\"$(esc "$2")\"}" | curl -s -m 40 -o "$T/body" -D "$T/hdr" -c "$3" -w '%{http_code}' -H 'content-type: application/json' -H "Origin: $ORIGIN" --data-binary @- "$BASE/auth/login")
  COOKIE=NO; HO=NO; SE=NO
  if grep -qi '^set-cookie: sf_session=' "$T/hdr"; then COOKIE=YES
    grep -i '^set-cookie: sf_session=' "$T/hdr" | grep -qi httponly && HO=YES
    grep -i '^set-cookie: sf_session=' "$T/hdr" | grep -qi secure && SE=YES; fi
}
S_CODE=""; S_AUTH=false; S_ROLE="-"; S_N=0
session() {
  S_CODE=$(curl -s -m 20 -o "$T/body" -b "$1" -c "$1" -w '%{http_code}' "$BASE/auth/session")
  S_AUTH=false; grep -q '"authenticated":true' "$T/body" && S_AUTH=true
  S_ROLE="$(sed -n 's/.*"role":"\([a-z]*\)".*/\1/p' "$T/body" | head -n1)"; S_ROLE="${S_ROLE:--}"
  S_N="$(grep -o '"sellerCodes":\[[^]]*\]' "$T/body" | grep -o '[0-9]\+' | wc -l | tr -d ' ')"
}
logout() { curl -s -m 20 -o /dev/null -b "$1" -c "$1" -X POST -H "Origin: $ORIGIN" "$BASE/auth/logout"; }
counts() { # prints "accounts links auto" for account id $1
  local ext; ext="$(psqlq -v a="$1" "select external_user_id from account where id = :'a'::uuid")"
  echo "$(psqlq -v e="$ext" "select count(*) from account where external_user_id = :'e'") $(psqlq -v a="$1" "select count(*) from account_seller_link where account_id = :'a'::uuid") $(psqlq -v a="$1" "select count(*) from account_seller_link where account_id = :'a'::uuid and source='sankhya_auto'")"
}

echo; echo "== 2. first login =="
read -r -p "Seller login: " SELLER
read -rs -p "Seller password: " PW; echo
M1="$(psqlq "select clock_timestamp()")"
login "$SELLER" "$PW" "$T/j1"
echo "login HTTP: $LOGIN_CODE"
echo "sf_session cookie: $COOKIE"; echo "HttpOnly: $HO"; echo "Secure: $SE"
if [ "$LOGIN_CODE" != "200" ]; then
  echo "-- audit rows written by this attempt (sanitized) --"
  psqlq -v since="$M1" "select 'reason: ' || coalesce(detail->>'reason','-') || E'\nmethod: ' || coalesce(detail->>'method', detail->>'kind', detail->>'via', '-') from audit_log where action in ('auth.login.failure','auth.login.blocked','auth.directory.link_refused','auth.login.link_mismatch') and at >= :'since'::timestamptz order by at" \
    | grep -E '^(reason|method): [A-Za-z0-9_.:-]{1,60}$'
  echo "audit detail keys (names only): $(psqlq -v since="$M1" "select distinct k from audit_log, jsonb_object_keys(coalesce(detail,'{}'::jsonb)) k where action='auth.login.failure' and at >= :'since'::timestamptz" | grep -E '^[a-zA-Z_]{1,30}$' | tr '\n' ' ')"
  echo "RESULT: SELLER LOGIN FAILED"; exit 4
fi
session "$T/j1"
echo; echo "== 3. session =="
echo "authenticated: $S_AUTH"; echo "role: $S_ROLE"; echo "sellerCodes count: $S_N"
ACC="$(psqlq -v since="$M1" "select actor_account_id from audit_log where action='auth.login.success' and at >= :'since'::timestamptz and actor_account_id is not null order by at desc limit 1")"
case "$ACC" in [0-9a-f]*-*-*-*-*) ;; *) echo "STOP: no account recorded for this login"; echo "RESULT: SELLER LOGIN FAILED"; exit 5;; esac
read -r A1 L1 U1 <<<"$(counts "$ACC")"
echo; echo "== 4. counts after first login =="
echo "account count: $A1"; echo "seller link count: $L1"; echo "automatic seller link count: $U1"
logout "$T/j1"

echo; echo "== 5. second login =="
login "$SELLER" "$PW" "$T/j2"; C2="$LOGIN_CODE"; unset PW
session "$T/j2"; S2A="$S_AUTH"; S2R="$S_ROLE"
read -r A2 L2 U2 <<<"$(counts "$ACC")"
logout "$T/j2"
echo "login HTTP: $C2"; echo "authenticated: $S2A"; echo "role: $S2R"
echo "account count: $A2"; echo "seller link count: $L2"; echo "automatic seller link count: $U2"

OK=yes
[ "$S_AUTH" = true ] && [ "$S_ROLE" = seller ] && [ "$S_N" = 1 ] && [ "$A1 $L1 $U1" = "1 1 1" ] || OK=no
[ "$C2" = 200 ] && [ "$S2A" = true ] && [ "$S2R" = seller ] && [ "$A2 $L2 $U2" = "1 1 1" ] || OK=no
echo; echo "RESULT: $([ "$OK" = yes ] && echo 'SELLER AUTO-PROVISION WORKING' || echo 'SELLER LOGIN FAILED')"
[ "$OK" = yes ]
