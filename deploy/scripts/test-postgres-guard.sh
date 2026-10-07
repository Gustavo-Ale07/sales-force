#!/usr/bin/env bash
# Self-test of sf_postgres_guard / sf_postgres_converged (lib-deploy.sh). No Docker, no network, no secret:
# sf_compose is replaced by a stub that prints the `up --dry-run` events recorded from a real Docker Compose
# (2026-10-07: converged -> "Running", changed image/env_file -> "Recreate", stopped -> "Starting/Started").
# Usage: bash deploy/scripts/test-postgres-guard.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
pass=0
ok() { pass=$((pass + 1)); echo "ok - $1"; }
bad() { echo "NOT OK - $1" >&2; exit 1; }

# shellcheck source=lib-deploy.sh
. "$here/lib-deploy.sh"

# Scenario inputs (set per case): STUB_PS = container id printed by `ps -aq postgres` (empty = absent),
# STUB_PLAN = text printed by `up --dry-run`, STUB_PLAN_RC = its exit code. Real `up` calls are logged to $t/real-up.
sf_compose() {
  case " $* " in
    *' ps -aq postgres '*) printf '%s' "${STUB_PS:-}" ;;
    *' --dry-run '*) printf '%s' "${STUB_PLAN:-}"; return "${STUB_PLAN_RC:-0}" ;;
    # `config --hash` is what the old guard used; under the affected Compose it never matches the label. Unused now.
    *' config --hash '*) printf 'postgres a753311348c4b127b1a9f61fb2ade99aa779398f38b77e531e15b41612872442\n' ;;
    *' up '*) echo "up $*" >> "$t/real-up" ;;
    *) return 1 ;;
  esac
}

# run <label> : runs the guard in a subshell (sf_die exits) and records rc + whether a real `up` happened.
run() {
  : > "$t/real-up"
  set +e
  ( sf_postgres_guard ) > "$t/out" 2>&1
  rc=$?
  set -e
}

CONV=$' Container salesforce-staging-postgres-1 Running \n'
RECREATE=$' Container salesforce-staging-postgres-1 Recreate \n Container salesforce-staging-postgres-1 Recreated \n Container bb340a0eddfe_salesforce-staging-postgres-1 Starting \n Container bb340a0eddfe_salesforce-staging-postgres-1 Started \n'
STOPPED=$' Container salesforce-staging-postgres-1 Starting \n Container salesforce-staging-postgres-1 Started \n'

# 1. converged -> passes and starts/keeps postgres with the real `up`.
STUB_PS=abc123 STUB_PLAN="$CONV" STUB_PLAN_RC=0
run
{ [ "$rc" -eq 0 ] && grep -q ' up ' "$t/real-up"; } && ok "converged postgres passes" || bad "converged postgres passes (rc=$rc)"

# 2. Compose would recreate -> blocks, no real `up`.
STUB_PS=abc123 STUB_PLAN="$RECREATE" STUB_PLAN_RC=0
run
{ [ "$rc" -ne 0 ] && [ ! -s "$t/real-up" ] && grep -q 'would recreate or replace' "$t/out" && grep -q 'Recreate' "$t/out"; } && ok "recreate needed blocks, nothing started" || bad "recreate needed blocks (rc=$rc)"

# 3. indeterminate -> blocks: dry-run fails / empty answer / unknown event / no container event.
for case_ in "rc1:garbage:1" "empty::0" "unknown: Container x Frobnicating :0" "network-only: Network sfguardtest_default Creating :0" "removing: Container x Removing :0" "stopping: Container x Stopping :0" "error: Container x Error :0"; do
  label="${case_%%:*}"; rest="${case_#*:}"; plan="${rest%:*}"; rc_="${rest##*:}"
  STUB_PS=abc123 STUB_PLAN="$plan" STUB_PLAN_RC="$rc_"
  run
  { [ "$rc" -ne 0 ] && [ ! -s "$t/real-up" ]; } && ok "indeterminate ($label) blocks" || bad "indeterminate ($label) blocks (rc=$rc)"
done

# 4. postgres absent -> keeps the current behaviour: no dry-run consulted, starts it.
STUB_PS="" STUB_PLAN="$RECREATE" STUB_PLAN_RC=1
run
{ [ "$rc" -eq 0 ] && grep -q ' up ' "$t/real-up"; } && ok "absent postgres is started" || bad "absent postgres is started (rc=$rc)"

# 5. Compose affected by the env_file bug: `config --hash` differs from the container label (stub always prints a hash
#    that cannot match), yet the container is converged -> must pass. The old hash comparison blocked this case.
STUB_PS=abc123 STUB_PLAN="$CONV" STUB_PLAN_RC=0
docker() { echo 4b8ee281f30c70c86f1cdc353371a15ea23fba26dc43249f9c1473fe1c39af80; }  # label of the running container
run
{ [ "$rc" -eq 0 ] && grep -q ' up ' "$t/real-up"; } && ok "env_file hash mismatch with converged container passes" || bad "env_file hash mismatch passes (rc=$rc)"
unset -f docker

# 6. stopped-but-identical container: starting it is allowed (same as before).
STUB_PS=abc123 STUB_PLAN="$STOPPED" STUB_PLAN_RC=0
run
{ [ "$rc" -eq 0 ] && grep -q ' up ' "$t/real-up"; } && ok "stopped but identical postgres is started" || bad "stopped but identical (rc=$rc)"

# 7. a mix with one non-converged event among converged ones still blocks (never partial acceptance).
STUB_PS=abc123 STUB_PLAN=$' Container a Running \n Container b Recreate \n' STUB_PLAN_RC=0
run
{ [ "$rc" -ne 0 ] && [ ! -s "$t/real-up" ]; } && ok "mixed events block" || bad "mixed events block (rc=$rc)"

echo "all $pass checks passed"
