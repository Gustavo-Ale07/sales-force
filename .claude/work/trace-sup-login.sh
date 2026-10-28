#!/usr/bin/env bash
# READ-ONLY trace of the newest login attempt on STAGING. Run: sudo bash trace-sup-login.sh
# Changes nothing: no restart, deploy, migration, config or env edit; never opens compose.env or any secrets file;
# no Sankhya access. DB session is forced read-only. Prints only: timestamps, audit action, reason code, method,
# YES/NO flags, role, status, counts, service names, log level / event / status code.
set -u
PROJECT="${SF_COMPOSE_PROJECT:-salesforce-staging}"

cid() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$1" | head -n1; }
PG="$(cid postgres)"; API="$(cid api)"; VER="$(cid verifier)"

echo "== services (name / state only) =="
docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Label "com.docker.compose.service"}}\t{{.State}}\t{{.Status}}' | sort
echo
if [ -z "$PG" ]; then
  echo "No running 'postgres' container in project $PROJECT (managed database?). Stopping: tell the assistant."; exit 2
fi

# psql inside the container using its own POSTGRES_USER/POSTGRES_DB (values are never printed), read-only session.
psqlq() {
  docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$PG" sh -c 'psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off "$@"' sh "$@"
}

echo "== 1. Newest login/auth audit row and its account (sanitized) =="
psqlq <<'SQL'
with last as (
  select * from audit_log
  where action like 'auth.login%' or action like 'auth.session%' or action like 'auth.directory%'
  order by at desc limit 1
)
select to_char(l.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at_utc,
       l.action,
       coalesce(l.detail->>'reason', '-') as reason,
       coalesce(l.detail->>'method', '-') as method,
       case when l.actor_account_id is not null then 'YES' else 'NO' end as actor_account_present,
       coalesce(a.role::text, '-') as account_role,
       coalesce(a.status::text, '-') as account_status,
       case when a.id is null then '-' when a.external_user_id is not null then 'YES' else 'NO' end as external_user_id_present,
       coalesce((select count(*) from account_seller_link k where k.account_id = a.id), 0) as seller_links,
       case when exists (select 1 from session s where s.account_id = a.id and s.created_at >= l.at - interval '5 seconds'
                                                      and s.created_at <= l.at + interval '60 seconds') then 'YES' else 'NO' end as session_created
from last l left join account a on a.id = l.actor_account_id;
SQL
echo
echo "== 2. Last 5 login-related audit rows (time / action / reason / method only) =="
psqlq <<'SQL'
select to_char(at at time zone 'UTC', 'HH24:MI:SS') as t_utc, action, coalesce(detail->>'reason', '-') as reason, coalesce(detail->>'method', '-') as method
from audit_log where action like 'auth.login%' or action like 'auth.session%' or action like 'auth.directory%'
order by at desc limit 5;
SQL
echo

TS="$(psqlq -t -A <<'SQL'
select to_char(max(at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from audit_log where action like 'auth.login%';
SQL
)"
TS="$(echo "$TS" | tr -d '[:space:]')"
if [ -z "$TS" ]; then echo "No login audit rows; skipping logs."; exit 0; fi
SINCE="$(date -u -d "$TS - 90 seconds" +%Y-%m-%dT%H:%M:%SZ)"
UNTIL="$(date -u -d "$TS + 60 seconds" +%Y-%m-%dT%H:%M:%SZ)"

# Whitelist extractor for pino JSON lines: level, short event message, status code, reason/code fields. Nothing else is printed.
filter() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -I -c '
import sys, json, re
LV = {10:"trace",20:"debug",30:"info",40:"warn",50:"error",60:"fatal"}
def g(d, *path):
    for p in path:
        if not isinstance(d, dict) or p not in d: return None
        d = d[p]
    return d
n = 0
for raw in sys.stdin:
    raw = raw.strip()
    if not raw: continue
    try: d = json.loads(raw)
    except Exception:
        continue
    msg = d.get("msg") if isinstance(d.get("msg"), str) else ""
    msg = re.sub(r"\s+", " ", msg)[:140]
    code = g(d, "res", "statusCode") or d.get("statusCode") or d.get("status")
    url = g(d, "req", "url") or d.get("url") or ""
    path = url.split("?")[0] if isinstance(url, str) else ""
    if path and not path.startswith("/api/v1/auth") and path not in ("/verify", "/v1/verify") and "verif" not in path and "auth" not in path:
        continue
    out = []
    t = d.get("time")
    out.append(str(t)[-13:-1] if isinstance(t, (int, str)) else "-")
    out.append(LV.get(d.get("level"), str(d.get("level"))))
    if path: out.append(path)
    if code is not None: out.append("status=%s" % code)
    for k in ("reason", "failure", "result", "event", "outcome", "errorClass", "errorCode"):
        v = d.get(k) if not isinstance(d.get(k), (dict, list)) else None
        if isinstance(v, (str, int)) and len(str(v)) < 60: out.append("%s=%s" % (k, v))
    e = d.get("err")
    if isinstance(e, dict):
        for k in ("type", "code"):
            if isinstance(e.get(k), (str, int)): out.append("err.%s=%s" % (k, e[k]))
    if msg: out.append("msg=\"%s\"" % msg)
    print("  " + " | ".join(out)); n += 1
    if n >= 40: break
if n == 0: print("  (no matching auth events in this window)")
'
  else
    echo "  python3 not available: showing line counts by level only"
    grep -o '"level":[0-9]*' | sort | uniq -c
  fi
}

for pair in "api:$API" "verifier:$VER"; do
  name="${pair%%:*}"; id="${pair#*:}"
  echo "== 3. $name logs ($SINCE .. $UNTIL, sanitized event view) =="
  if [ -z "$id" ]; then echo "  container not running"; continue; fi
  docker logs --since "$SINCE" --until "$UNTIL" "$id" 2>&1 | filter
  echo
done
echo "Done. Read-only; nothing was changed."
