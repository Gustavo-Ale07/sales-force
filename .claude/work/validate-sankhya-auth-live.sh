#!/usr/bin/env bash
# STAGING live validation of "Sankhya-only login". READ-ONLY on config: changes no env, no flag, no container.
#   sudo bash validate-sankhya-auth-live.sh
# Tests: Gustavo (login, logout, re-login idempotence), Cristiane (login + second login), SUP (manager, no seller link,
# not external_directory_refused), optional wrong password (401 invalid_credentials).
# Passwords: hidden prompts, shell variables only. Printed: status codes, YES/NO, counts, sanitized reasons.
# Never printed: passwords, tokens, cookies, account ids, external ids.
set -u
PROJECT="${SF_COMPOSE_PROJECT:-salesforce-staging}"
BASE=https://force.sistemasplac.com.br/api/v1
ORIGIN=https://force.sistemasplac.com.br
cid() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n1; }
PG="$(cid postgres)"; API="$(cid api)"; WK="$(cid worker)"
[ -n "$PG" ] && [ -n "$API" ] || { echo "STOP: postgres/api containers not running"; exit 2; }

psqlq() { local sql="${!#}"; set -- "${@:1:$#-1}"; printf '%s\n' "$sql" | docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c 'psql -X -q -t -A -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off "$@"' sh "$@"; }

echo "== flags (api container) =="
for n in EXTERNAL_LOGIN_ENABLED EXTERNAL_AUTO_PROVISION EXTERNAL_IDUSU_IS_CODUSU_VALIDATED EXTERNAL_DIRECTORY_MAX_AGE_MINUTES; do
  echo "$n=$(docker exec "$API" printenv "$n" 2>/dev/null | grep -E '^[0-9]{1,4}$' || echo '<unset/invalid>')"
done
if [ -n "$WK" ]; then
  for n in AUTH_DIRECTORY_SYNC_ENABLED AUTH_DIRECTORY_SYNC_CRON; do
    echo "$n=$(docker exec "$WK" printenv "$n" 2>/dev/null | grep -E '^[0-9*/, ]{1,40}$' || echo '<unset/invalid>')"
  done
fi
echo; echo "== directory mirror freshness =="
psqlq "select entity||' status='||status||' age_min='||round(extract(epoch from (now()-last_success_at))/60) from sync_state where entity in ('sellers','directoryUsers') order by entity"

T="$(mktemp -d)"; umask 077
trap 'rm -rf "$T"; unset PW' EXIT
esc() { local s="${1//\\/\\\\}"; printf '%s' "${s//\"/\\\"}"; }
CODE=""; AUTHOK=false; ROLE="-"; ERRCODE="-"
login() { # user pass jar
  CODE=$(curl -s -m 40 -o "$T/body" -c "$3" -w '%{http_code}' -H 'content-type: application/json' -H "Origin: $ORIGIN" \
    -d "{\"username\":\"$(esc "$1")\",\"password\":\"$(esc "$2")\"}" "$BASE/auth/login")
  CODE="${CODE//[^0-9]/}"; CODE="${CODE:0:3}"
  AUTHOK=false; grep -q '"authenticated":true' "$T/body" && AUTHOK=true
  ERRCODE="$(sed -n 's/.*"code":"\([a-z_]*\)".*/\1/p' "$T/body" | head -n1)"; ERRCODE="${ERRCODE:--}"
}
session() { # jar
  curl -s -m 20 -o "$T/body" -b "$1" "$BASE/auth/session"
  ROLE="$(sed -n 's/.*"role":"\([a-z]*\)".*/\1/p' "$T/body" | head -n1)"; ROLE="${ROLE:--}"
}
logout() { curl -s -m 20 -o /dev/null -b "$1" -X POST -H "Origin: $ORIGIN" "$BASE/auth/logout"; }
now_db() { psqlq "select clock_timestamp()"; }
actor_since() { psqlq -v since="$1" "select actor_account_id from audit_log where action='auth.login.success' and at >= :'since'::timestamptz and actor_account_id is not null order by at desc limit 1"; }
reasons_since() { psqlq -v since="$1" "select distinct coalesce(detail->>'reason','-') from audit_log where action='auth.login.failure' and at >= :'since'::timestamptz order by 1" | grep -E '^[a-z_]{1,40}$' | tr '\n' ' '; }
counts() { # account id -> "accounts=N links=N auto=N role=R"
  local a="$1" e
  e="$(psqlq -v a="$a" "select external_user_id from account where id = :'a'::uuid")"
  echo "accounts_for_external_id=$(psqlq -v e="$e" "select count(*) from account where external_user_id = :'e'") links=$(psqlq -v a="$a" "select count(*) from account_seller_link where account_id = :'a'::uuid") sankhya_auto=$(psqlq -v a="$a" "select count(*) from account_seller_link where account_id = :'a'::uuid and source='sankhya_auto'") role_db=$(psqlq -v a="$a" "select role from account where id = :'a'::uuid")"
}
RESULTS=(); FAIL=0
check() { # label cond
  if [ "$2" = "yes" ]; then RESULTS+=("PASS $1"); else RESULTS+=("FAIL $1"); FAIL=1; fi
}
isacc() { case "$1" in [0-9a-f]*-*-*-*-*) echo yes;; *) echo no;; esac; }

seller_case() { # label default-login
  local label="$1" def="$2" lg pw m acc
  read -r -p "$label login (default: $def): " lg; lg="${lg:-$def}"
  read -rs -p "$label password: " pw; echo
  m="$(now_db)"; login "$lg" "$pw" "$T/a"
  echo "$label login #1: HTTP $CODE authenticated=$AUTHOK"
  check "$label login 1 = 200 authenticated" "$([ "$CODE" = 200 ] && [ "$AUTHOK" = true ] && echo yes || echo no)"
  if [ "$CODE" != 200 ]; then echo "  reasons: $(reasons_since "$m")"; unset pw; return; fi
  session "$T/a"; check "$label session role=seller" "$([ "$ROLE" = seller ] && echo yes || echo no)"
  acc="$(actor_since "$m")"; logout "$T/a"
  m="$(now_db)"; login "$lg" "$pw" "$T/b"; unset pw
  echo "$label login #2: HTTP $CODE authenticated=$AUTHOK"
  check "$label login 2 = 200 authenticated" "$([ "$CODE" = 200 ] && [ "$AUTHOK" = true ] && echo yes || echo no)"
  logout "$T/b"
  if [ "$(isacc "$acc")" = yes ]; then
    local c; c="$(counts "$acc")"; echo "  $c"
    check "$label 1 account / 1 link / sankhya_auto" "$([ "$c" = "accounts_for_external_id=1 links=1 sankhya_auto=1 role_db=seller" ] && echo yes || echo no)"
  else check "$label account resolved from audit" no; fi
}

echo; echo "== 1. Gustavo =="; seller_case Gustavo "gustavo sousa"
echo; echo "== 2. Cristiane =="; seller_case Cristiane "Cristiane Vietta"

echo; echo "== 3. SUP (existing manager) =="
read -r -p "SUP login (default: SUP): " SL; SL="${SL:-SUP}"
read -rs -p "SUP password: " PW; echo
M="$(now_db)"; login "$SL" "$PW" "$T/s"; unset PW
echo "SUP login: HTTP $CODE authenticated=$AUTHOK"
check "SUP login = 200 authenticated" "$([ "$CODE" = 200 ] && [ "$AUTHOK" = true ] && echo yes || echo no)"
if [ "$CODE" = 200 ]; then
  session "$T/s"; check "SUP role=manager" "$([ "$ROLE" = manager ] && echo yes || echo no)"
  ACC="$(actor_since "$M")"; logout "$T/s"
  if [ "$(isacc "$ACC")" = yes ]; then
    c="$(counts "$ACC")"; echo "  $c"
    check "SUP 0 seller links" "$(case "$c" in *" links=0 "*) echo yes;; *) echo no;; esac)"
  fi
  REF="$(psqlq -v since="$M" "select count(*) from audit_log where action='auth.login.failure' and at >= :'since'::timestamptz and detail->>'reason'='external_directory_refused'")"
  check "SUP not external_directory_refused" "$([ "$REF" = 0 ] && echo yes || echo no)"
else echo "  reasons: $(reasons_since "$M")"; fi

echo; echo "== 4. wrong password (optional) =="
read -r -p "Run wrong-password test with a user name? (blank = skip): " WL
if [ -n "$WL" ]; then
  login "$WL" "definitely-wrong-$RANDOM" "$T/w"
  echo "wrong password: HTTP $CODE code=$ERRCODE"
  check "wrong password = 401 invalid_credentials" "$([ "$CODE" = 401 ] && [ "$ERRCODE" = invalid_credentials ] && echo yes || echo no)"
fi

echo; echo "== RESULTS =="; printf '%s\n' "${RESULTS[@]}"
if [ "$FAIL" -eq 0 ]; then echo "RESULT: SANKHYA-ONLY LOGIN WORKING"; else echo "RESULT: FAILED (see FAIL lines)"; exit 1; fi
