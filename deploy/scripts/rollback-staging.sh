#!/usr/bin/env bash
# APPLICATION-ONLY rollback of STAGING to a previous commit. Runs ON the VPS as the deploy user. Never touches the
# database: no migrate, no backup, no restore, no db-roles; containers are recreated with --no-deps so the
# `migrate` dependency of api/worker is not run either. Runbook: deploy/README-cicd.md. Manual use only (the
# GitHub workflow never calls it).
#
#   rollback-staging.sh [<40-hex previous sha>]   target defaults to PREVIOUS_SHA in the state file
#   rollback-staging.sh --dry-run [<sha>]         validate and print the plan (also DEPLOY_DRY_RUN=1)
#
# Refuses, with a "manual intervention required" message, when the commit being rolled back (the recorded
# DEPLOYED_SHA) changed the migration set compared with the target: expand-only compatibility cannot be proven
# automatically (P-16). The operator may override only by naming the newer SHA explicitly:
#   ROLLBACK_ACK_MIGRATIONS=<DEPLOYED_SHA> rollback-staging.sh <previous sha>
# That acknowledges that the OLD application version runs against the NEWER schema; it is a human judgement.
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib-deploy.sh
. "$here/lib-deploy.sh"

STAGE="start"
TARGET_SHA=""

on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] && return 0
  printf '\n' >&2
  sf_log "ROLLBACK FAILED at stage: $STAGE (exit $rc). The database was not touched." >&2
  exit "$rc"
}

main() {
  local dry="${DEPLOY_DRY_RUN:-0}" arg=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      -*) sf_die "unknown option: $1" ;;
      *)
        [ -z "$arg" ] || sf_die "only one SHA argument is accepted"
        arg="$1"
        ;;
    esac
    shift
  done

  STAGE="configuration"
  sf_init
  local current
  current="$(sf_state_get DEPLOYED_SHA)"
  TARGET_SHA="${arg:-${DEPLOY_SHA:-$(sf_state_get PREVIOUS_SHA)}}"
  [ -n "$TARGET_SHA" ] || sf_die "no rollback target: pass a SHA (no valid PREVIOUS_SHA in the state file)"
  sf_validate_sha "$TARGET_SHA" || sf_die "rollback target must be exactly 40 lowercase hex characters"
  [ -n "$current" ] || sf_die "no DEPLOYED_SHA recorded in $SF_STATE_FILE; nothing to roll back from"
  [ "$current" != "$TARGET_SHA" ] || sf_die "target equals the deployed commit; nothing to do"
  SF_TARGET_SHORT="${TARGET_SHA:0:12}"

  if [ "$dry" = "1" ]; then
    sf_log "DRY RUN (no git write, no docker, no state change)"
    if [ -d "$SF_LOGS_DIR" ]; then
      sf_lock
      sf_log "lock acquired (released at exit): $SF_LOCK_FILE"
    fi
    sf_log "environment=staging rollback from=$current to=$TARGET_SHA image_tag=$SF_TARGET_SHORT project=$SF_COMPOSE_PROJECT"
    sf_log "edge_mode=$SF_EDGE_MODE db_mode=$SF_DB_MODE migrations_ack=$([ "${ROLLBACK_ACK_MIGRATIONS:-}" = "$current" ] && echo yes || echo no)"
    sf_log "plan: migration-set comparison; checkout --detach; compose config -q; build only missing images;"
    sf_log "      up -d --no-deps $(sf_app_services); wait healthy; /api/v1/ready; write state. Database untouched."
    return 0
  fi

  sf_require_tools
  STAGE="lock"
  sf_lock
  [ -d "$SF_REPO_DIR/.git" ] || sf_die "repository not found at $SF_REPO_DIR"
  [ -r "$SF_COMPOSE_ENV" ] || sf_die "compose env file not readable: $SF_COMPOSE_ENV"

  STAGE="verify commits"
  git -C "$SF_REPO_DIR" cat-file -e "$TARGET_SHA^{commit}" || sf_die "target commit $TARGET_SHA is not in the local repository (git fetch first)"
  git -C "$SF_REPO_DIR" cat-file -e "$current^{commit}" || sf_die "deployed commit $current is not in the local repository"
  if ! git -C "$SF_REPO_DIR" diff --quiet || ! git -C "$SF_REPO_DIR" diff --cached --quiet; then
    sf_die "the working tree at $SF_REPO_DIR has local changes; refusing"
  fi

  STAGE="migration comparison"
  local changed
  changed="$(git -C "$SF_REPO_DIR" diff --name-only "$TARGET_SHA" "$current" -- packages/db/migrations)"
  if [ -n "$changed" ]; then
    if [ "${ROLLBACK_ACK_MIGRATIONS:-}" = "$current" ]; then
      sf_log "WARNING: migrations differ between $TARGET_SHA and $current and ROLLBACK_ACK_MIGRATIONS names $current."
      sf_log "The older application will run against the newer schema (operator acknowledged, manual-only override)."
    else
      sf_log "Migration files differ between the rollback target and the deployed commit:" >&2
      printf '%s\n' "$changed" | sed 's/^/  /' >&2
      sf_die "MANUAL INTERVENTION REQUIRED: the newer commit changed the database migrations, so an application-only rollback cannot be proven safe (expand-only compatibility is a human judgement, P-16). Nothing was changed. Options: fix forward with a new commit; or, if you have verified that the migrations are expand-only, re-run with ROLLBACK_ACK_MIGRATIONS=$current (never set by the workflow); or restore the database from the pre-migration dump and roll back together (deploy/README-staging.md)."
    fi
  fi

  STAGE="checkout"
  git -C "$SF_REPO_DIR" checkout --detach --quiet "$TARGET_SHA"
  [ "$(git -C "$SF_REPO_DIR" rev-parse HEAD)" = "$TARGET_SHA" ] || sf_die "checkout did not land on $TARGET_SHA"

  STAGE="compose config"
  sf_compose config -q

  STAGE="images"
  if ! docker image inspect "$SF_SERVER_IMAGE_NAME:$SF_TARGET_SHORT" > /dev/null 2>&1 \
    || ! docker image inspect "$SF_WEB_IMAGE_NAME:$SF_TARGET_SHORT" > /dev/null 2>&1; then
    sf_log "images for $SF_TARGET_SHORT are missing; rebuilding them from the checked-out source"
    sf_compose build migrate web
  fi

  STAGE="up"
  # shellcheck disable=SC2046 # the service list is a fixed word list
  sf_compose up -d --no-deps $(sf_app_services)
  STAGE="health"
  local svc
  for svc in $(sf_app_services); do sf_wait_healthy "$svc"; done
  if [ "$SF_EDGE_MODE" = "caddy" ]; then
    sf_compose up -d --no-deps edge
    sf_wait_healthy edge
  fi
  STAGE="readiness"
  sf_wait_ready

  STAGE="record state"
  sf_state_write "$TARGET_SHA" "none" "$current"
  sf_log "ROLLBACK OK environment=staging DEPLOYED_SHA=$TARGET_SHA rolled_back_from=$current (database untouched)"
}

trap on_exit EXIT
main "$@"; exit $?
