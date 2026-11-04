#!/usr/bin/env bash
# Self-test of sf_check_erp_environment (D-X, K2). No Docker, no network, no secret.
# Usage: bash deploy/scripts/test-erp-environment-check.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
mkdir -p "$t/config" "$t/secrets"
export SF_ROOT="$t" SF_COMPOSE_ENV="$t/config/compose.env"
unset SF_ERP_ENVIRONMENT SANKHYA_ENVIRONMENT SF_SECRETS_DIR || true
# shellcheck source=deploy/scripts/lib-deploy.sh
. "$here/lib-deploy.sh"
fail() { echo "NOT OK - $1" >&2; exit 1; }

run() { ( sf_check_erp_environment ) 2>&1; }

# Equal: passes, silent about values.
printf 'SF_ERP_ENVIRONMENT=sandbox\nSF_SECRETS_DIR=%s\n' "$t/secrets" > "$SF_COMPOSE_ENV"
printf 'SANKHYA_ENVIRONMENT=sandbox\nSANKHYA_CLIENT_SECRET=do-not-print\n' > "$t/secrets/worker.env"
out="$(run)" || fail "equal values must pass: $out"
echo "ok - equal"

# Different: aborts, names the variables, never prints the secret line.
printf 'SANKHYA_ENVIRONMENT=production\nSANKHYA_CLIENT_SECRET=do-not-print\n' > "$t/secrets/worker.env"
if out="$(run)"; then fail "different values must abort"; fi
grep -q "SF_ERP_ENVIRONMENT" <<< "$out" || fail "must name SF_ERP_ENVIRONMENT: $out"
grep -q "SANKHYA_ENVIRONMENT" <<< "$out" || fail "must name SANKHYA_ENVIRONMENT: $out"
! grep -q "do-not-print" <<< "$out" || fail "must never print other lines of the env file"
echo "ok - different aborts"

# One side absent: nothing to compare, passes.
printf 'SANKHYA_CLIENT_SECRET=do-not-print\n' > "$t/secrets/worker.env"
out="$(run)" || fail "an absent SANKHYA_ENVIRONMENT must pass: $out"
printf 'SF_SECRETS_DIR=%s\n' "$t/secrets" > "$SF_COMPOSE_ENV"
printf 'SANKHYA_ENVIRONMENT=sandbox\n' > "$t/secrets/worker.env"
out="$(run)" || fail "an absent SF_ERP_ENVIRONMENT must pass: $out"
echo "ok - absent side"
echo "all ok"
