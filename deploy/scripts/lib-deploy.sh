#!/usr/bin/env bash
# Shared helpers for deploy-staging.sh and rollback-staging.sh. Sourced, never executed. Runs ON the VPS.
# No secret is read or printed here: only the non-secret deploy settings (see deploy/README-cicd.md).
# shellcheck shell=bash

# A closed output pipe (SSH drop) must never abort a running deploy: callers ignore SIGPIPE and the write error is swallowed.
sf_log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" || true; }
sf_die() { printf '%s ERROR: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2 || true; exit 1; }

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
    DEPLOYED_SHA | PREVIOUS_SHA | ROLLED_BACK_FROM | ATTEMPTED_SHA)
      if sf_validate_sha "$val"; then printf '%s' "$val"; fi
      ;;
    *) printf '%s' "$val" ;;
  esac
}

# Atomic write of the whole state. DEPLOYED_SHA is always the last FULLY successful deploy (or "none");
# ATTEMPTED_SHA + MIGRATED=yes mark a run whose migration started: the schema may already be at that commit.
# Arguments: deployed previous rolled_back_from attempted migrated(yes|no)
sf_state_write() {
  local tmp="$SF_STATE_FILE.tmp.$$"
  {
    printf 'DEPLOYED_SHA=%s\n' "$1"
    printf 'DEPLOYED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'PREVIOUS_SHA=%s\n' "$2"
    printf 'ROLLED_BACK_FROM=%s\n' "${3:-none}"
    printf 'ATTEMPTED_SHA=%s\n' "${4:-none}"
    printf 'MIGRATED=%s\n' "${5:-no}"
  } > "$tmp"
  mv -f "$tmp" "$SF_STATE_FILE"
  printf '%s deployed=%s previous=%s rolled_back_from=%s attempted=%s migrated=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${3:-none}" "${4:-none}" "${5:-no}" >> "$SF_LOGS_DIR/deploy-history.log"
}

# True when $1 equals $2 or is an ancestor of it (a commit missing locally counts as "no").
sf_is_ancestor_or_equal() {
  [ "$1" != "$2" ] || return 0
  git -C "$SF_REPO_DIR" cat-file -e "$1^{commit}" 2> /dev/null || return 1
  git -C "$SF_REPO_DIR" merge-base --is-ancestor "$1" "$2"
}

# Does a migration text create objects the application roles need grants on? Whitespace is normalised first
# (newlines, tabs, runs of spaces), case-insensitive. Reads the SQL text on stdin.
sf_sql_creates_objects() {
  local text
  text="$(tr '\n\t\r' '   ' | tr -s ' ')"
  grep -Eqi 'create (or replace )?(unlogged |temp |temporary )?(table|sequence|view|materialized view|schema|type) ' <<< "$text "
}

# Does Compose intend to leave the existing postgres container alone? Asks Compose itself (`up --dry-run`, the same
# convergence logic the real `up` applies) instead of comparing `config --hash` with the container's
# com.docker.compose.config-hash label: Compose versions before the fix of docker/compose PR #14002 ("resolve service
# environment when computing --hash") do not resolve `env_file` in `config --hash`, so for a service with `env_file`
# (postgres.env) the two hashes differ even when the container is converged, and the old comparison blocked every deploy.
# Fail closed: only container events Running / Starting / Started are accepted, at least one must be present, and a
# non-zero exit, an empty answer or any other event (Recreate, Recreated, Stopping, Removing, Creating, Error, anything
# unknown) means "not converged or cannot tell". Reads nothing secret; the event text is returned on stdout.
sf_postgres_converged() {
  local out line state seen=0
  out="$(sf_compose --ansi never --progress plain up -d --no-deps --dry-run postgres 2>&1)" || { printf '%s\n' "$out"; return 1; }
  while IFS= read -r line; do
    case "$line" in
      *' Container '*)
        state="${line##* Container }"
        state="$(printf '%s' "$state" | awk '{print $2}')"
        case "$state" in
          Running | Starting | Started) seen=1 ;;
          *) printf '%s\n' "$out"; return 1 ;;
        esac
        ;;
    esac
  done <<< "$out"
  [ "$seen" -eq 1 ] || { printf '%s\n' "$out"; return 1; }
  return 0
}

# Refuses to continue when Compose would recreate/replace the running postgres container (a changed image / PG_MAJOR /
# env files definition; `up` would do it, which must never happen before the backup) or when that cannot be told.
# Starts it when absent or stopped-but-identical.
sf_postgres_guard() {
  local cid detail
  cid="$(sf_compose ps -aq postgres 2> /dev/null || true)"
  if [ -n "$cid" ]; then
    if ! detail="$(sf_postgres_converged)"; then
      sf_die "Compose would recreate or replace the postgres container (image / PG_MAJOR / env files differ from the one running), or its plan cannot be read. It is NOT recreated by this deploy. Take a backup, recreate it by hand if intended (deploy/README-staging.md), then re-run. Nothing was changed. Compose plan: $(printf '%s' "$detail" | tr '\n' ';' | tr -s ' ')"
    fi
  fi
  sf_compose up -d --no-deps --wait --wait-timeout 120 postgres
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
  # `!reset` (external-edge override) needs Docker Compose >= 2.24 (`up --dry-run`, used by the postgres guard, is older).
  local cv cmaj cmin
  cv="$(docker compose version --short 2> /dev/null || true)"
  cv="${cv#v}"
  cmaj="${cv%%.*}"
  cmin="${cv#*.}"
  cmin="${cmin%%.*}"
  case "$cmaj$cmin" in
    '' | *[!0-9]*) sf_die "cannot read the Docker Compose version (got '$cv'); Docker Compose >= 2.24 is required" ;;
  esac
  if [ "$cmaj" -lt 2 ] || { [ "$cmaj" -eq 2 ] && [ "$cmin" -lt 24 ]; }; then
    sf_die "Docker Compose $cv is too old: >= 2.24 is required (\`!reset\` override). Upgrade the compose plugin from your distribution's official instructions."
  fi
}

# Waits until one service container reports healthy. Fails on unhealthy/exited or timeout.
sf_wait_healthy() {
  local svc="$1" deadline cid status
  deadline=$(( $(date +%s) + SF_HEALTH_TIMEOUT ))
  while :; do
    cid="$(sf_compose ps -q "$svc" 2> /dev/null || true)"
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
