#!/usr/bin/env bash
# Deploy ONE exact commit to STAGING. Runs ON the VPS as the deploy user, started by the root-owned SSH forced-command
# wrapper (force-staging-ssh-entry.sh, detached) or by the operator. Never production. Runbook: deploy/README-cicd.md.
#
#   deploy-staging.sh <40-hex-sha>           deploy that commit
#   deploy-staging.sh --dry-run <sha>        validate and print the plan, change nothing (also DEPLOY_DRY_RUN=1)
#   deploy-staging.sh --print-deployed-sha   print the recorded DEPLOYED_SHA (no lock, no docker)
#
# Flow: lock -> record PREVIOUS_SHA -> fetch -> verify commit + reachable from origin/<branch> + moves forward from the
#       last good deploy -> checkout --detach -> compose config -> postgres guard -> build images tagged with the SHA
#       -> backup -> state marker (ATTEMPTED_SHA, MIGRATED=yes) -> migrate -> up -d -> health of
#       api/worker/verifier/web(/edge) -> /api/v1/ready -> record DEPLOYED_SHA.
# DEPLOYED_SHA in the state file is always the last FULLY successful deploy. The database is never rolled back by
# this script. Nothing prints env file contents; no `set -x`.
#
# HUP and PIPE are ignored: an SSH drop or a cancelled runner must not kill a started backup/migration/compose run.
# The flock (fd 9) lives as long as this process. Everything lives in functions and the last line is `main "$@"; exit`:
# `git checkout` replaces this very file while it runs, so bash must never read from it again after main starts.
# A changed script takes effect on the NEXT run (the script of the previously deployed commit performs a deploy).
set -euo pipefail
umask 077
trap '' HUP PIPE

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib-deploy.sh
. "$here/lib-deploy.sh"

STAGE="start"
CHECKED_OUT="no"
MIGRATION_STARTED="no"
LAST_GOOD=""
PREVIOUS_SHA="none"
DEPLOY_SHA=""

on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] && return 0
  printf '\n' >&2 || true
  sf_log "DEPLOY FAILED at stage: $STAGE (exit $rc)" >&2
  if [ "$CHECKED_OUT" = "yes" ]; then
    if [ "$MIGRATION_STARTED" = "no" ]; then
      sf_log "Schema: unchanged by this run (the migration never started). Running containers: the previous ones, not replaced." >&2
      if [ "$PREVIOUS_SHA" != "none" ]; then
        if git -C "$SF_REPO_DIR" checkout --detach --quiet "$PREVIOUS_SHA" 2> /dev/null; then
          sf_log "Working tree restored to $PREVIOUS_SHA." >&2
        fi
      fi
      sf_log "Nothing to roll back; fix the cause and re-run." >&2
    else
      sf_log "Schema: the migration of $DEPLOY_SHA STARTED and may be applied (state file: ATTEMPTED_SHA=$DEPLOY_SHA MIGRATED=yes). The database is NOT rolled back by any script." >&2
      sf_log "Running containers: ${LAST_GOOD:-none} (last good) unless the stage reached 'up' (stage was: $STAGE)." >&2
      sf_log "Recovery, choose one:" >&2
      sf_log "  a) fix forward: fix the cause, push, and let the next deploy run (it migrates again, idempotent);" >&2
      sf_log "  b) application rollback (only if the migration is expand-only): deploy/scripts/rollback-staging.sh ${LAST_GOOD:-<last good sha>}" >&2
      sf_log "     (it compares migrations against $DEPLOY_SHA and stops for manual intervention when they differ);" >&2
      sf_log "  c) data undone: restore the pre-migration dump (deploy/README-staging.md, Backup and restore)." >&2
    fi
  fi
  exit "$rc"
}

state_only_init() {
  SF_ROOT="${SF_ROOT:-/opt/force-staging}"
  SF_LOGS_DIR="${SF_LOGS_DIR:-$SF_ROOT/logs}"
  SF_STATE_FILE="${SF_STATE_FILE:-$SF_LOGS_DIR/deployed.state}"
}

main() {
  local dry="${DEPLOY_DRY_RUN:-0}" arg="" s=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      --print-deployed-sha)
        state_only_init
        s="$(sf_state_get DEPLOYED_SHA)"
        [ -n "$s" ] || sf_die "no DEPLOYED_SHA recorded"
        printf '%s\n' "$s"
        return 0
        ;;
      -*) sf_die "unknown option: $1" ;;
      *)
        [ -z "$arg" ] || sf_die "only one SHA argument is accepted"
        arg="$1"
        ;;
    esac
    shift
  done
  DEPLOY_SHA="${arg:-${DEPLOY_SHA:-}}"
  sf_validate_sha "$DEPLOY_SHA" || sf_die "DEPLOY_SHA must be exactly 40 lowercase hex characters"

  STAGE="configuration"
  sf_init
  SF_TARGET_SHORT="${DEPLOY_SHA:0:12}"
  LAST_GOOD="$(sf_state_get DEPLOYED_SHA)"
  local first="no"
  [ -n "$LAST_GOOD" ] || first="yes"

  if [ "$dry" = "1" ]; then
    sf_log "DRY RUN (no git write, no docker, no state change)"
    if [ -d "$SF_LOGS_DIR" ]; then
      sf_lock
      sf_log "lock acquired (released at exit): $SF_LOCK_FILE"
    else
      sf_log "logs dir absent, lock not tested: $SF_LOGS_DIR"
    fi
    sf_log "environment=staging sha=$DEPLOY_SHA image_tag=$SF_TARGET_SHORT project=$SF_COMPOSE_PROJECT"
    sf_log "paths: repo=$SF_REPO_DIR config=$SF_CONFIG_DIR logs=$SF_LOGS_DIR backups=$SF_BACKUP_DIR compose_env=$SF_COMPOSE_ENV"
    sf_log "edge_mode=$SF_EDGE_MODE db_mode=$SF_DB_MODE branch=$SF_DEPLOY_BRANCH first_deploy=$first last_good=${LAST_GOOD:-none}"
    sf_log "plan: fetch origin; verify reachable from origin/$SF_DEPLOY_BRANCH and forward from last good; checkout --detach; compose config -q; postgres guard; build migrate web;"
    if [ "$first" = "yes" ]; then
      sf_log "      (first deploy, requires SF_FIRST_DEPLOY=1) state marker; migrate;"
    else
      sf_log "      backup; state marker (ATTEMPTED_SHA, MIGRATED=yes); migrate;"
    fi
    sf_log "      up -d --no-deps $(sf_app_services)$([ "$SF_EDGE_MODE" = caddy ] && printf ' edge' || true); wait healthy; /api/v1/ready; write state"
    return 0
  fi

  sf_require_tools
  STAGE="lock"
  sf_lock
  [ -d "$SF_REPO_DIR/.git" ] || sf_die "repository not found at $SF_REPO_DIR (manual clone step, see deploy/README-cicd.md)"
  [ -r "$SF_COMPOSE_ENV" ] || sf_die "compose env file not readable: $SF_COMPOSE_ENV"

  sf_log "environment=staging target_sha=$DEPLOY_SHA project=$SF_COMPOSE_PROJECT edge_mode=$SF_EDGE_MODE db_mode=$SF_DB_MODE"

  STAGE="previous commit"
  PREVIOUS_SHA="$LAST_GOOD"
  if [ -z "$PREVIOUS_SHA" ]; then
    PREVIOUS_SHA="$(git -C "$SF_REPO_DIR" rev-parse --verify --quiet HEAD 2> /dev/null || true)"
    sf_validate_sha "$PREVIOUS_SHA" || PREVIOUS_SHA="none"
  fi
  sf_log "last_good=${LAST_GOOD:-none} previous_sha=$PREVIOUS_SHA first_deploy=$first"
  if [ "$first" = "yes" ] && [ "${SF_FIRST_DEPLOY:-0}" != "1" ]; then
    sf_die "no successful deploy recorded: this is the FIRST deploy, which the operator runs by hand with SF_FIRST_DEPLOY=1 (plain migrate, no backup; roles bootstrapped first, see deploy/README-cicd.md)"
  fi

  STAGE="git state"
  if ! git -C "$SF_REPO_DIR" diff --quiet || ! git -C "$SF_REPO_DIR" diff --cached --quiet; then
    sf_die "the working tree at $SF_REPO_DIR has local changes; refusing"
  fi

  STAGE="git fetch"
  GIT_TERMINAL_PROMPT=0 timeout 180 git -C "$SF_REPO_DIR" fetch --prune --quiet origin \
    "+refs/heads/$SF_DEPLOY_BRANCH:refs/remotes/origin/$SF_DEPLOY_BRANCH"
  STAGE="verify commit"
  git -C "$SF_REPO_DIR" cat-file -e "$DEPLOY_SHA^{commit}" || sf_die "commit $DEPLOY_SHA is not present after fetch"
  git -C "$SF_REPO_DIR" merge-base --is-ancestor "$DEPLOY_SHA" "refs/remotes/origin/$SF_DEPLOY_BRANCH" \
    || sf_die "commit $DEPLOY_SHA is not reachable from origin/$SF_DEPLOY_BRANCH; refusing"

  # A deploy only moves forward from the last good one (a late or replayed run must not install older code over a
  # newer schema). Going back is rollback-staging.sh. Manual override only by naming the target SHA.
  STAGE="forward check"
  if [ -n "$LAST_GOOD" ] && [ "$LAST_GOOD" != "$DEPLOY_SHA" ]; then
    if ! git -C "$SF_REPO_DIR" cat-file -e "$LAST_GOOD^{commit}" 2> /dev/null \
      || ! git -C "$SF_REPO_DIR" merge-base --is-ancestor "$LAST_GOOD" "$DEPLOY_SHA"; then
      if [ "${DEPLOY_ACK_NONFORWARD:-}" = "$DEPLOY_SHA" ]; then
        sf_log "WARNING: $DEPLOY_SHA does not descend from the last good $LAST_GOOD; DEPLOY_ACK_NONFORWARD names it (manual-only override)."
      else
        sf_die "commit $DEPLOY_SHA does not descend from the last good deploy $LAST_GOOD (older or diverged commit). Use deploy/scripts/rollback-staging.sh to go back, or, manually and knowingly, DEPLOY_ACK_NONFORWARD=$DEPLOY_SHA. Nothing was changed."
      fi
    fi
  fi

  STAGE="migration pre-check"
  local needs_roles="no" status path text
  if [ "$first" = "no" ] && [ "$PREVIOUS_SHA" != "none" ]; then
    local changes
    changes="$(git -C "$SF_REPO_DIR" diff --name-status --no-renames "$PREVIOUS_SHA" "$DEPLOY_SHA" -- 'packages/db/migrations/*.sql' || true)"
    while IFS=$'\t' read -r status path; do
      [ -n "$status" ] || continue
      case "$status" in
        A)
          sf_log "migration added: $path"
          text="$(git -C "$SF_REPO_DIR" show "$DEPLOY_SHA:$path")"
          if sf_sql_creates_objects <<< "$text"; then needs_roles="yes"; fi
          ;;
        M)
          sf_log "WARNING: existing migration MODIFIED, needs human review (already applied migrations must not change): $path"
          needs_roles="yes"
          ;;
        D) sf_log "WARNING: migration DELETED, needs human review: $path" ;;
        *) sf_log "WARNING: unexpected change '$status' in migrations, needs human review: $path" ;;
      esac
    done <<< "$changes"
  fi
  if [ "$needs_roles" = "yes" ] && [ "${SF_RUN_DB_ROLES:-0}" != "1" ]; then
    sf_die "this release adds database objects (or edits a migration): api/worker need 'db-roles' grants after the migration (deploy/README-staging.md, Role bootstrap). Set SF_RUN_DB_ROLES=1 (needs db-admin.env on this host) or arrange it first. Nothing was changed."
  fi

  STAGE="checkout"
  git -C "$SF_REPO_DIR" checkout --detach --quiet "$DEPLOY_SHA"
  CHECKED_OUT="yes"
  [ "$(git -C "$SF_REPO_DIR" rev-parse HEAD)" = "$DEPLOY_SHA" ] || sf_die "checkout did not land on $DEPLOY_SHA"

  STAGE="compose config"
  sf_compose config -q

  # Edge ownership (checked after checkout so the compose files are those of the target commit).
  STAGE="edge ports"
  if [ "$SF_EDGE_MODE" = "caddy" ] && command -v ss > /dev/null 2>&1; then
    if [ -z "$(sf_compose ps -q edge 2> /dev/null || true)" ]; then
      local listeners
      listeners="$(ss -Hltn 2> /dev/null | awk '{print $4}' || true)"
      if grep -Eq '[:.](80|443)$' <<< "$listeners"; then
        sf_die "a listener already holds port 80 or 443 and the edge container is not running. Use SF_EDGE_MODE=external or free the ports; an existing proxy is never replaced automatically."
      fi
    fi
  fi

  if [ "$SF_DB_MODE" = "self-hosted" ]; then
    STAGE="database up"
    sf_postgres_guard
  fi

  STAGE="build"
  sf_compose build migrate web

  if [ "$first" = "yes" ]; then
    sf_log "first deploy: plain migrate (no database content to back up; README-staging.md rule)"
  else
    # Equivalent to `run --rm migrate-safe` (backup is its compose dependency), split so the failing stage is
    # known exactly: a failing dump stops here and nothing is migrated.
    STAGE="backup"
    sf_compose --profile ops run --rm -T backup
  fi

  STAGE="state marker"
  MIGRATION_STARTED="yes"
  sf_state_write "${LAST_GOOD:-none}" "$PREVIOUS_SHA" "none" "$DEPLOY_SHA" "yes"
  STAGE="migrate"
  sf_compose run --rm -T migrate

  if [ "$needs_roles" = "yes" ]; then
    STAGE="db-roles (grants for new objects)"
    sf_compose --profile ops-admin run --rm -T db-roles
  fi

  STAGE="up"
  # shellcheck disable=SC2046 # the service list is a fixed word list
  sf_compose up -d --no-deps $(sf_app_services)
  STAGE="health"
  local svc
  for svc in $(sf_app_services); do sf_wait_healthy "$svc"; done
  if [ "$SF_EDGE_MODE" = "caddy" ]; then
    STAGE="edge"
    sf_compose up -d --no-deps edge
    sf_wait_healthy edge
  fi
  STAGE="readiness"
  sf_wait_ready

  STAGE="record state"
  sf_state_write "$DEPLOY_SHA" "$PREVIOUS_SHA" "none" "none" "no"
  sf_log "DEPLOY OK environment=staging DEPLOYED_SHA=$DEPLOY_SHA PREVIOUS_SHA=$PREVIOUS_SHA"
}

trap on_exit EXIT
main "$@"; exit $?
