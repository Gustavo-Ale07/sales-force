#!/usr/bin/env bash
# Manual `docker compose` for the STAGING stack with exactly what deploy-staging.sh uses: project name, env file,
# compose files, external-edge overlay (SF_EDGE_MODE=external), profile self-hosted-db (SF_DB_MODE=self-hosted) and the
# image tags of the last fully successful deploy (DEPLOYED_SHA in the state file, first 12 characters). It never takes an
# image tag from compose.env (stale tags there are what broke a manual run on 2026-10-29). Runs ON the VPS.
#
#   deploy/scripts/sf-compose.sh ps
#   deploy/scripts/sf-compose.sh up -d --no-deps --force-recreate api web
#   deploy/scripts/sf-compose.sh --print up -d --no-deps api      print the command, run nothing
#
# Environment overrides are the same as lib-deploy.sh (SF_ROOT, SF_COMPOSE_ENV, SF_REPO_DIR, SF_STATE_FILE, ...).
# Reads no secret; prints no env file content. Same-file lock handling as the deploy is NOT taken: do not run it
# while a deploy or rollback is running.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib-deploy.sh
. "$here/lib-deploy.sh"

main() {
  local print=0
  if [ "${1:-}" = "--print" ]; then print=1; shift; fi
  [ "$#" -gt 0 ] || sf_die "usage: sf-compose.sh [--print] <docker compose arguments...>"

  sf_init
  [ -r "$SF_COMPOSE_ENV" ] || sf_die "compose env file not readable: $SF_COMPOSE_ENV"
  local sha
  sha="$(sf_state_get DEPLOYED_SHA)"
  [ -n "$sha" ] || sf_die "no valid DEPLOYED_SHA in $SF_STATE_FILE: cannot choose the image tags (never taken from compose.env)"
  SF_TARGET_SHORT="${sha:0:12}"

  if [ "$print" = "1" ]; then
    # Replaces the docker binary for sf_compose (same subshell logic) so the exact command can be inspected.
    docker() {
      printf 'cwd=%s\nSERVER_IMAGE=%s\nWEB_IMAGE=%s\ndocker' "$PWD" "$SERVER_IMAGE" "$WEB_IMAGE"
      printf ' %s' "$@"
      printf '\n'
    }
  else
    sf_require_tools
  fi
  sf_compose "$@"
}

main "$@"
