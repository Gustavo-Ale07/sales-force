#!/bin/bash
# SSH forced-command entry point for the staging deploy key. bootstrap-vps.sh apply COPIES this file to a root-owned
# path (/usr/local/sbin/force-staging-deploy, root:root 0755) and pins it in authorized_keys:
#   command="/usr/local/sbin/force-staging-deploy",restrict ssh-ed25519 ...
# so a later `git checkout` of the repository cannot change what the key may run. It reads ONLY $SSH_ORIGINAL_COMMAND
# and accepts exactly two forms (nothing is evaluated, expanded or passed through a shell):
#   deploy <40 lowercase hex>     -> detached deploy of that commit, output followed live (see below)
#   print-deployed-sha            -> prints the recorded DEPLOYED_SHA
# The deploy runs detached (setsid, own log under the logs dir) and this wrapper only FOLLOWS the log: an SSH drop or a
# cancelled runner stops the following, not the deploy, which keeps the lock until it ends.
# The installed copy has SF_ROOT_FIXED rewritten by apply (the --root value); the default below is the standard layout.
set -euo pipefail
umask 077

readonly SF_ROOT_FIXED="/opt/force-staging"
readonly REPO_SCRIPT="$SF_ROOT_FIXED/repo/deploy/scripts/deploy-staging.sh"
readonly LOGS_DIR="$SF_ROOT_FIXED/logs"

deny() { printf 'force-staging-deploy: refused\n' >&2; exit 126; }

cmd="${SSH_ORIGINAL_COMMAND:-}"
# Clean, fixed environment for everything started from here (no variable of the SSH client survives).
clean_env=(env -i "PATH=/usr/local/bin:/usr/bin:/bin" "HOME=${HOME:-/}" "LANG=C" "SF_ROOT=$SF_ROOT_FIXED")

is_sha() { [ "${#1}" -eq 40 ] && [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

case "$cmd" in
  "print-deployed-sha")
    exec "${clean_env[@]}" "$REPO_SCRIPT" --print-deployed-sha
    ;;
  "deploy "*)
    sha="${cmd#deploy }"
    is_sha "$sha" || deny
    [ -d "$LOGS_DIR" ] || deny
    log="$LOGS_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}.log"
    : > "$log"
    # Positional parameters only: the SHA is never part of a shell text.
    setsid "${clean_env[@]}" bash -c '"$@"; rc=$?; echo "SF_EXIT=$rc"; exit "$rc"' _ "$REPO_SCRIPT" "$sha" \
      >> "$log" 2>&1 < /dev/null &
    pid=$!
    echo "force-staging-deploy: started pid=$pid log=$log"
    # Follow until the detached job ends; this process may die on HUP/PIPE without affecting it.
    tail -n +1 -f --pid="$pid" "$log" 2> /dev/null || true
    rc=""
    for _ in 1 2 3 4 5; do
      rc="$(sed -n 's/^SF_EXIT=\([0-9][0-9]*\)$/\1/p' "$log" | tail -n 1)"
      [ -z "$rc" ] || break
      sleep 1
    done
    [ -n "$rc" ] || rc=1
    exit "$rc"
    ;;
  *)
    deny
    ;;
esac
