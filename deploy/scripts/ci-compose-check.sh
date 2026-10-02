#!/usr/bin/env bash
# CI gate: validate deploy/docker-compose.staging.yml (and the external-edge override) against the repository's
# *.env.example files. Fictional values only; nothing is started, nothing is built, no secret is involved.
# Usage: ci-compose-check.sh <scratch-dir>   (the directory is created; it must be outside the repository)
set -euo pipefail

scratch="${1:?usage: ci-compose-check.sh <scratch-dir outside the repository>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

case "$(cd "$(dirname "$scratch")" && pwd)/$(basename "$scratch")" in
  "$repo"/*) echo "refusing: scratch directory is inside the repository" >&2; exit 1 ;;
esac

mkdir -p "$scratch/secrets"
for f in "$repo"/deploy/staging/*.env.example; do
  name="$(basename "$f" .example)"
  [ "$name" = "compose.env" ] && continue
  cp "$f" "$scratch/secrets/$name"
done
mkdir -p "$scratch/backups"

# compose.env: example values with this scratch layout.
sed -e "s#^SF_SECRETS_DIR=.*#SF_SECRETS_DIR=$scratch/secrets#" \
    -e "s#^SF_BACKUP_DIR=.*#SF_BACKUP_DIR=$scratch/backups#" \
    -e "s#^SERVER_IMAGE=.*#SERVER_IMAGE=sales-force-server:ci#" \
    -e "s#^WEB_IMAGE=.*#WEB_IMAGE=sales-force-web:ci#" \
    "$repo/deploy/staging/compose.env.example" > "$scratch/compose.env"

compose=(docker compose -p ci-compose-check --env-file "$scratch/compose.env" -f "$repo/deploy/docker-compose.staging.yml")
"${compose[@]}" config -q
"${compose[@]}" --profile self-hosted-db --profile ops --profile ops-admin --profile offsite config -q
# External-edge mode (no Caddy service): valid together with the base file WITHOUT edge.env (not copied here).
mkdir -p "$scratch/secrets-external"
for f in "$scratch"/secrets/*.env; do
  [ "$(basename "$f")" = "edge.env" ] || cp "$f" "$scratch/secrets-external/"
done
sed -e "s#^SF_SECRETS_DIR=.*#SF_SECRETS_DIR=$scratch/secrets-external#" "$scratch/compose.env" > "$scratch/compose-external.env"
external=(docker compose -p ci-compose-check --env-file "$scratch/compose-external.env" -f "$repo/deploy/docker-compose.staging.yml" -f "$repo/deploy/docker-compose.staging.external-edge.yml")
"${external[@]}" config -q
services="$("${external[@]}" config --services)"
if grep -qx edge <<< "$services"; then echo "external mode must not define the edge service" >&2; exit 1; fi
# Control: the base file alone must still demand edge.env (proves the check above exercises the removal).
if docker compose -p ci-compose-check --env-file "$scratch/compose-external.env" -f "$repo/deploy/docker-compose.staging.yml" config -q 2> /dev/null; then
  echo "control failed: base file validated without edge.env" >&2; exit 1
fi
echo "compose config: ok"
