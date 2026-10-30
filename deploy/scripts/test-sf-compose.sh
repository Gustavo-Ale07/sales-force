#!/usr/bin/env bash
# Self-test of sf-compose.sh in --print mode. No Docker, no network, no secret.
# Usage: bash deploy/scripts/test-sf-compose.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
mkdir -p "$t/repo" "$t/config" "$t/logs"
sha="0123456789abcdef0123456789abcdef01234567"
printf 'DEPLOYED_SHA=%s\nMIGRATED=no\n' "$sha" > "$t/logs/deployed.state"
export SF_ROOT="$t" SF_REPO_DIR="$t/repo"
fail() { echo "NOT OK - $1" >&2; exit 1; }
has() { grep -qF -- "$2" <<< "$1" || fail "$3: missing '$2' in: $1"; }
hasnt() { ! grep -qF -- "$2" <<< "$1" || fail "$3: unexpected '$2'"; }

# Stale tags in compose.env must be ignored.
printf 'SF_EDGE_MODE=external\nSF_DB_MODE=self-hosted\nSERVER_IMAGE=sales-force-server:62f50b18b4dc\nWEB_IMAGE=sales-force-web:62f50b18b4dc\n' > "$t/config/compose.env"
out="$(bash "$here/sf-compose.sh" --print up -d --no-deps --force-recreate api web)"
has "$out" "SERVER_IMAGE=sales-force-server:0123456789ab" external
has "$out" "WEB_IMAGE=sales-force-web:0123456789ab" external
hasnt "$out" "62f50b18b4dc" external
has "$out" "-p salesforce-staging" external
has "$out" "--env-file $t/config/compose.env" external
has "$out" "-f deploy/docker-compose.staging.yml -f deploy/docker-compose.staging.external-edge.yml" external
has "$out" "--profile self-hosted-db" external
has "$out" "up -d --no-deps --force-recreate api web" external
echo "ok - external edge + self-hosted db"

printf 'SF_EDGE_MODE=caddy\nSF_DB_MODE=managed\n' > "$t/config/compose.env"
out="$(bash "$here/sf-compose.sh" --print ps)"
hasnt "$out" "external-edge" caddy
hasnt "$out" "self-hosted-db" caddy
echo "ok - caddy + managed db"

rm "$t/logs/deployed.state"
if bash "$here/sf-compose.sh" --print ps > /dev/null 2>&1; then fail "no state must fail"; fi
echo "ok - no DEPLOYED_SHA fails"
rm "$t/config/compose.env"
if bash "$here/sf-compose.sh" --print ps > /dev/null 2>&1; then fail "no env file must fail"; fi
echo "ok - no env file fails"
