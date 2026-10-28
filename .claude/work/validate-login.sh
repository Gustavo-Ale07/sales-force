#!/bin/bash
# Real login validation against staging. Passwords come from hidden prompts, live only in shell variables, and are
# never printed. Output: status codes and booleans only. Cookie jars live in a private temp dir removed on exit.
set -u
BASE=https://force.sistemasplac.com.br/api/v1
ORIGIN=https://force.sistemasplac.com.br
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; umask 077

json() { printf '{"username":"%s","password":"%s"}' "$(esc "$1")" "$(esc "$2")"; }
esc() { local s="${1//\\/\\\\}"; printf '%s' "${s//\"/\\\"}"; }

login() { # label user pass jar
  local code
  # Body goes through stdin (printf is a builtin): the password never appears in a process argument list.
  code=$(json "$2" "$3" | curl -s -m 40 -o "$T/body" -D "$T/hdr" -c "$4" -w '%{http_code}' -H 'content-type: application/json' -H "Origin: $ORIGIN" --data-binary @- "$BASE/auth/login")
  local cookie=no; grep -qi '^set-cookie: sf_session=' "$T/hdr" && cookie=yes
  local flags=""; grep -i '^set-cookie: sf_session=' "$T/hdr" | grep -qi 'httponly' && flags="HttpOnly"
  grep -i '^set-cookie: sf_session=' "$T/hdr" | grep -qi 'secure' && flags="$flags Secure"
  printf '%-34s HTTP %s  session-cookie:%s %s\n' "$1" "$code" "$cookie" "$flags"
  LAST_CODE=$code
}
session() { # label jar
  local code; code=$(curl -s -m 20 -o "$T/body" -b "$2" -c "$2" -w '%{http_code}' "$BASE/auth/session")
  local auth=false; grep -q '"authenticated":true' "$T/body" && auth=true
  local role; role=$(sed -n 's/.*"role":"\([a-z]*\)".*/\1/p' "$T/body")
  printf '%-34s HTTP %s  authenticated:%s role:%s\n' "$1" "$code" "$auth" "${role:--}"
}
leak_check() { # label  (body + headers + jar must not carry credential-looking data)
  local bad=no
  grep -qiE 'jsessionid|mgeSession|externalUserId|external_user_id|idusu|VERIFIER' "$T/body" "$T/hdr" "$1" 2>/dev/null && bad=YES
  printf 'credential/identity markers in responses or cookie jar: %s\n' "$bad"
}

printf 'SUP (Sankhya TESTE) password: '; read -rs SUPPW; echo
echo '--- SUP'
login "SUP wrong password" SUP "definitely-wrong-Pass-123" "$T/j0"
login "SUP correct password" SUP "$SUPPW" "$T/j1"; leak_check "$T/j1"
session "SUP session (refresh 1)" "$T/j1"
session "SUP session (refresh 2)" "$T/j1"
echo "cookie names in jar: $(awk '!/^#/ && NF>=7 {print $6}' "$T/j1" | tr '\n' ' ')"
lo=$(curl -s -m 20 -o /dev/null -b "$T/j1" -c "$T/j1" -w '%{http_code}' -X POST -H "Origin: $ORIGIN" "$BASE/auth/logout"); echo "logout: HTTP $lo"
session "after logout" "$T/j1"
login "SUP login again" SUP "$SUPPW" "$T/j2"
session "SUP session after re-login" "$T/j2"
printf 'Test local Force admin too? [y/N] '; read -r DO_ADMIN
case "$DO_ADMIN" in
  [yY]|[yY][eE][sS])
    printf 'Local Force admin login name: '; read -r ADMIN
    printf 'Local Force admin password: '; read -rs ADMPW; echo
    echo '--- local admin'
    login "admin correct password" "$ADMIN" "$ADMPW" "$T/j3"; session "admin session" "$T/j3"
    ;;
  *) echo '--- local admin: skipped' ;;
esac
unset SUPPW ADMPW
