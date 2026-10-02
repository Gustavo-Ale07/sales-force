#!/usr/bin/env bash
# Deploy ONE exact commit to STAGING. Runs ON the VPS as the deploy user, invoked over SSH by
# .github/workflows/deploy-staging.yml (or by the operator). Never production. Runbook: deploy/README-cicd.md.
#
#   deploy-staging.sh <40-hex-sha>           deploy that commit
#   deploy-staging.sh --dry-run <sha>        validate and print the plan, change nothing (also DEPLOY_DRY_RUN=1)
#   deploy-staging.sh --print-deployed-sha   print the recorded DEPLOYED_SHA (no lock, no docker)
#
# Flow: lock -> record PREVIOUS_SHA -> fetch -> verify commit + reachable from origin/<branch> -> checkout --detach
#       -> compose config -> backup -> migrate -> build images tagged with the SHA -> up -d
#       -> health of api/worker/verifier/web(/edge) -> /api/v1/ready -> record DEPLOYED_SHA.
# The database is never rolled back by this script. Nothing prints env file contents; no `set -x`.
#
# Everything lives in functions and the last line is `main "$@"; exit`: `git checkout` replaces this very file
# while it runs, so bash must never read from it again after main starts. A changed script takes effect on the
# NEXT run (the script of the previously deployed commit performs a deploy).
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/lib-deploy.sh
. "$here/lib-deploy.sh"

STAGE="start"
CHECKED_OUT="no"
MIGRATED="no"
PREVIOUS_SHA="none"
DEPLOY_SHA=""

on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] && return 0
  printf '\n' >&2
  sf_log "DEPLOY FAILED at stage: $STAGE (exit $rc)" >&2
  if [ "$CHECKED_OUT" = "yes" ]; then
    if [ "$MIGRATED" = "no" ]; then
      sf_log "The database was NOT migrated by this run and the previous containers were not replaced." >&2
      if [ "$PREVIOUS_SHA" != "none" ]; then
        if git -C "$SF_REPO_DIR" checkout --detach --quiet "$PREVIOUS_SHA" 2> /dev/null; then
          sf_log "Working tree restored to previous commit $PREVIOUS_SHA." >&2
        fi
      fi
      sf_log "Nothing to roll back; fix the cause and re-run." >&2
    else
      sf_log "The migration of $DEPLOY_SHA may have been applied; the database is NOT rolled back by any script." >&2
      sf_log "Application rollback to $PREVIOUS_SHA is possible only if the migrations were expand-only:" >&2
      sf_log "  deploy/scripts/rollback-staging.sh refuses when migrations differ (manual intervention then)." >&2
      sf_log "If data must be undone, restore from the pre-migration dump (deploy/README-staging.md, Backup and restore)." >&2
    fi
  fi
  exit "$rc"
}

migration_files_added() { # prev sha -> added/changed migration SQL paths (empty when prev is none)
  [ "$1" != "none" ] || return 0
  git -C "$SF_REPO_DIR" diff --name-only --diff-filter=AM "$1" "$2" -- 'packages/db/migrations/*.sql'
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
  local first="no"
  [ -r "$SF_STATE_FILE" ] || first="yes"

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
    sf_log "edge_mode=$SF_EDGE_MODE db_mode=$SF_DB_MODE branch=$SF_DEPLOY_BRANCH first_deploy=$first"
    sf_log "plan: fetch origin; verify reachable from origin/$SF_DEPLOY_BRANCH; checkout --detach; compose config -q;"
    if [ "$first" = "yes" ]; then
      sf_log "      migrate (first deploy, requires SF_FIRST_DEPLOY=1); build migrate web;"
    else
      sf_log "      backup then migrate; build migrate web;"
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
  PREVIOUS_SHA="$(sf_state_get DEPLOYED_SHA)"
  if [ -z "$PREVIOUS_SHA" ]; then
    PREVIOUS_SHA="$(git -C "$SF_REPO_DIR" rev-parse --verify --quiet HEAD 2> /dev/null || true)"
    sf_validate_sha "$PREVIOUS_SHA" || PREVIOUS_SHA="none"
  fi
  sf_log "previous_sha=$PREVIOUS_SHA first_deploy=$first"
  if [ "$first" = "yes" ] && [ "${SF_FIRST_DEPLOY:-0}" != "1" ]; then
    sf_die "no deploy state recorded: this looks like the FIRST deploy, which the operator runs by hand with SF_FIRST_DEPLOY=1 (plain migrate, no backup; roles bootstrapped first, see deploy/README-cicd.md)"
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

  STAGE="migration pre-check"
  local added="" needs_roles="no" f
  added="$(migration_files_added "$PREVIOUS_SHA" "$DEPLOY_SHA" || true)"
  if [ -n "$added" ]; then
    sf_log "migrations added or changed since previous: $(printf '%s' "$added" | tr '\n' ' ')"
    while IFS= read -r f; do
      if git -C "$SF_REPO_DIR" show "$DEPLOY_SHA:$f" | grep -qi 'create table'; then needs_roles="yes"; fi
    done <<< "$added"
  fi
  if [ "$first" = "yes" ]; then needs_roles="no"; fi
  if [ "$needs_roles" = "yes" ] && [ "${SF_RUN_DB_ROLES:-0}" != "1" ]; then
    sf_die "this release adds a table: api/worker need 'db-roles' grants after the migration (deploy/README-staging.md, Role bootstrap). Set SF_RUN_DB_ROLES=1 (needs db-admin.env on this host) or arrange it first. Nothing was changed."
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
      if ss -Hltn 2> /dev/null | awk '{print $4}' | grep -Eq '[:.](80|443)$'; then
        sf_die "a listener already holds port 80 or 443 and the edge container is not running. Use SF_EDGE_MODE=external or free the ports; an existing proxy is never replaced automatically."
      fi
    fi
  fi

  if [ "$SF_DB_MODE" = "self-hosted" ]; then
    STAGE="database up"
    sf_compose up -d --no-deps --wait --wait-timeout 120 postgres
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
  STAGE="migrate"
  MIGRATED="yes" # from here the schema may have changed
  sf_compose run --rm -T migrate

  if [ "$needs_roles" = "yes" ]; then
    STAGE="db-roles (grants for new tables)"
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
  sf_state_write "$DEPLOY_SHA" "$PREVIOUS_SHA"
  sf_log "DEPLOY OK environment=staging DEPLOYED_SHA=$DEPLOY_SHA PREVIOUS_SHA=$PREVIOUS_SHA"
}

trap on_exit EXIT
main "$@"; exit $?
