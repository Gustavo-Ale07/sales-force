#!/usr/bin/env bash
# Shared helpers for deploy-staging.sh and rollback-staging.sh. Sourced, never executed. Runs ON the VPS.
# No secret is read or printed here: only the non-secret deploy settings (see deploy/README-cicd.md).
# shellcheck shell=bash

sf_log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
sf_die() { printf '%s ERROR: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; exit 1; }

# 40 lowercase hex characters, nothing else. Called before the value is used anywhere.
sf_validate_sha() {
  case "${1:-}" in
    *[!0-9a-f]* | '') return 1 ;;
  esac
  [ "${#1}" -eq 40 ]
}

# Setting lookup: environment variable first, then the (non-secret) compose env file, then the default.
# Only fixed names are looked up. The compose env file is never sourced or printed.
sf_cfg() {
  local name="$1" def="${2:-}" val=""
  val="${!name:-}"
  if [ -z "$val" ] && [ -r "$SF_COMPOSE_ENV" ]; then
    val="$(sed -n "s/^${name}=//p" "$SF_COMPOSE_ENV" | tail -n 1)"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
  fi
  printf '%s' "${val:-$def}"
}

# Paths and settings. All overridable by environment; defaults under /opt/force-staging.
sf_init() {
  SF_ROOT="${SF_ROOT:-/opt/force-staging}"
  SF_REPO_DIR="${SF_REPO_DIR:-$SF_ROOT/repo}"
  SF_CONFIG_DIR="${SF_CONFIG_DIR:-$SF_ROOT/config}"
  SF_DATA_DIR="${SF_DATA_DIR:-$SF_ROOT/data}"
  SF_LOGS_DIR="${SF_LOGS_DIR:-$SF_ROOT/logs}"
  SF_COMPOSE_ENV="${SF_COMPOSE_ENV:-$SF_CONFIG_DIR/compose.env}"
  SF_STATE_FILE="${SF_STATE_FILE:-$SF_LOGS_DIR/deployed.state}"
  SF_LOCK_FILE="${SF_LOCK_FILE:-$SF_LOGS_DIR/deploy.lock}"

  SF_COMPOSE_PROJECT="$(sf_cfg SF_COMPOSE_PROJECT salesforce-staging)"
  SF_DEPLOY_BRANCH="$(sf_cfg SF_DEPLOY_BRANCH feat/sales-force-evolution)"
  SF_EDGE_MODE="$(sf_cfg SF_EDGE_MODE '')"
  SF_DB_MODE="$(sf_cfg SF_DB_MODE self-hosted)"
  SF_BACKUP_DIR="$(sf_cfg SF_BACKUP_DIR "$SF_ROOT/backups")"
  SF_HEALTH_TIMEOUT="$(sf_cfg SF_HEALTH_TIMEOUT 240)"
  SF_READY_TIMEOUT="$(sf_cfg SF_READY_TIMEOUT 90)"
  SF_SERVER_IMAGE_NAME="$(sf_cfg SF_SERVER_IMAGE_NAME sales-force-server)"
  SF_WEB_IMAGE_NAME="$(sf_cfg SF_WEB_IMAGE_NAME sales-force-web)"
  export SF_BACKUP_DIR

  printf '%s' "$SF_COMPOSE_PROJECT" | grep -Eq '^[a-z0-9][a-z0-9_-]{0,62}$' || sf_die "SF_COMPOSE_PROJECT has unexpected characters"
  printf '%s' "$SF_DEPLOY_BRANCH" | grep -Eq '^[A-Za-z0-9._/-]{1,100}$' || sf_die "SF_DEPLOY_BRANCH has unexpected characters"
  case "$SF_DEPLOY_BRANCH" in *..*) sf_die "SF_DEPLOY_BRANCH must not contain '..'" ;; esac
  printf '%s' "$SF_HEALTH_TIMEOUT$SF_READY_TIMEOUT" | grep -Eq '^[0-9]+$' || sf_die "timeouts must be integers (seconds)"
  printf '%s' "$SF_SERVER_IMAGE_NAME$SF_WEB_IMAGE_NAME" | grep -Eq '^[a-z0-9._/-]+$' || sf_die "image names have unexpected characters"
  case "$SF_DB_MODE" in self-hosted | managed) ;; *) sf_die "SF_DB_MODE must be self-hosted or managed" ;; esac
  case "$SF_EDGE_MODE" in
    caddy | external) ;;
    '') sf_die "SF_EDGE_MODE is not set. Choose it explicitly (caddy: this stack owns 80/443; external: an existing proxy does) in $SF_COMPOSE_ENV or the environment. Refusing to start the edge by default." ;;
    *) sf_die "SF_EDGE_MODE must be caddy or external" ;;
  esac
}

# Application services started by `up` (the database and `migrate` are handled separately; `edge` last).
sf_app_services() { printf '%s' "api worker verifier web"; }

# Runs docker compose for the fixed project, from the repository directory, with the images of one commit.
# $SF_TARGET_SHORT selects the image tag; it is set by the caller before any compose call.
sf_compose() {
  local files=(-f deploy/docker-compose.staging.yml) profile=()
  [ "$SF_EDGE_MODE" = "external" ] && files+=(-f deploy/docker-compose.staging.external-edge.yml)
  [ "$SF_DB_MODE" = "self-hosted" ] && profile=(--profile self-hosted-db)
  (
    cd "$SF_REPO_DIR" || exit 1
    SERVER_IMAGE="$SF_SERVER_IMAGE_NAME:$SF_TARGET_SHORT" WEB_IMAGE="$SF_WEB_IMAGE_NAME:$SF_TARGET_SHORT" \
      docker compose -p "$SF_COMPOSE_PROJECT" --env-file "$SF_COMPOSE_ENV" "${files[@]}" "${profile[@]}" "$@"
  )
}

# State file: non-sensitive KEY=VALUE lines. Values are re-validated on read.
sf_state_get() {
  local key="$1" val=""
  [ -r "$SF_STATE_FILE" ] || return 0
  val="$(sed -n "s/^${key}=//p" "$SF_STATE_FILE" | tail -n 1)"
  case "$key" in
    DEPLOYED_SHA | PREVIOUS_SHA | ROLLED_BACK_FROM)
      if sf_validate_sha "$val"; then printf '%s' "$val"; fi
      ;;
    *) printf '%s' "$val" ;;
  esac
}

sf_state_write() { # deployed previous rolled_back_from
  local tmp="$SF_STATE_FILE.tmp.$$"
  {
    printf 'DEPLOYED_SHA=%s\n' "$1"
    printf 'DEPLOYED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'PREVIOUS_SHA=%s\n' "$2"
    printf 'ROLLED_BACK_FROM=%s\n' "${3:-none}"
  } > "$tmp"
  mv -f "$tmp" "$SF_STATE_FILE"
  printf '%s %s previous=%s rolled_back_from=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-none}" >> "$SF_LOGS_DIR/deploy-history.log"
}

# Exclusive lock shared by deploy and rollback. Fails at once when held (never waits).
sf_lock() {
  [ -d "$SF_LOGS_DIR" ] || sf_die "logs/state directory missing: $SF_LOGS_DIR (run bootstrap-vps.sh apply)"
  command -v flock > /dev/null 2>&1 || sf_die "flock not found"
  exec 9> "$SF_LOCK_FILE"
  flock -n 9 || sf_die "another deploy or rollback holds the lock ($SF_LOCK_FILE)"
}

sf_require_tools() {
  command -v git > /dev/null 2>&1 || sf_die "git not found"
  command -v docker > /dev/null 2>&1 || sf_die "docker not found"
  docker compose version > /dev/null 2>&1 || sf_die "docker compose plugin not found"
}

# Waits until one service container reports healthy. Fails on unhealthy/exited or timeout.
sf_wait_healthy() {
  local svc="$1" deadline cid status
  deadline=$(( $(date +%s) + SF_HEALTH_TIMEOUT ))
  while :; do
    cid="$(sf_compose ps -q "$svc" 2> /dev/null | head -n 1)"
    if [ -n "$cid" ]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2> /dev/null || echo unknown)"
      case "$status" in
        healthy) sf_log "healthy: $svc"; return 0 ;;
        unhealthy | exited | dead) sf_log "service $svc is $status"; return 1 ;;
      esac
    fi
    [ "$(date +%s)" -lt "$deadline" ] || { sf_log "timeout waiting for $svc (last status: ${status:-no container})"; return 1; }
    sleep 5
  done
}

# Readiness through the API container itself (works in both edge modes, needs no DNS, TLS or published port).
sf_wait_ready() {
  local deadline code
  deadline=$(( $(date +%s) + SF_READY_TIMEOUT ))
  while :; do
    code="$(sf_compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/v1/ready').then((r)=>{console.log(r.status);process.exit(r.status===200?0:1)},()=>{console.log('unreachable');process.exit(1)})" 2> /dev/null || true)"
    case "$code" in *200*) sf_log "ready: GET /api/v1/ready -> 200"; return 0 ;; esac
    [ "$(date +%s)" -lt "$deadline" ] || { sf_log "not ready after ${SF_READY_TIMEOUT}s (last: ${code:-no answer})"; return 1; }
    sleep 5
  done
}

sf_wait_all_healthy() {
  local svc
  for svc in $(sf_app_services); do sf_wait_healthy "$svc" || return 1; done
  if [ "$SF_EDGE_MODE" = "caddy" ]; then sf_wait_healthy edge || return 1; fi
}
