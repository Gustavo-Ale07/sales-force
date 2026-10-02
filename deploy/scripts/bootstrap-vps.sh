#!/usr/bin/env bash
# One-time preparation of the company VPS for STAGING deploys. Run MANUALLY by the operator, as root (or sudo).
# Never run by CI. Installs nothing (no package manager call, no curl|bash), never touches an existing reverse
# proxy, firewall, container, network or volume. Idempotent. Runbook: deploy/README-cicd.md.
#
#   bootstrap-vps.sh detect                      read-only inspection; changes nothing
#   bootstrap-vps.sh apply --deploy-pubkey-file FILE [options]
#
# apply options:
#   --deploy-pubkey-file FILE   REQUIRED. The public half of the dedicated ed25519 deploy key (one line).
#   --user NAME                 deploy user (default force-deploy)
#   --root DIR                  base directory (default /opt/force-staging)
#   --allow-from PATTERN        optional OpenSSH `from=` restriction for the key (e.g. a CIDR); GitHub-hosted runners
#                               have no fixed addresses, so this only helps with self-hosted runners
#   --add-to-docker-group-acknowledging-root-equivalence
#                               add the deploy user to the `docker` group. The docker group is ROOT-EQUIVALENT on
#                               the host (anyone controlling it can mount the host filesystem into a container).
#                               Without this flag the user cannot run docker and deploys will fail; the
#                               alternatives (rootless Docker, a sudo wrapper) are in deploy/README-cicd.md.
#   --dry-run                   print what apply would do, change nothing
# Environment: SF_EDGE_MODE=external is REQUIRED to proceed when a foreign process already listens on 80/443
#   (it records that an existing proxy stays in charge; this script never replaces it).
set -euo pipefail
umask 022

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------------- detect
listeners() { # prints "port<TAB>process" for TCP listeners on 80 and 443
  command -v ss > /dev/null 2>&1 || { say "(ss not available: cannot inspect listeners)"; return 0; }
  ss -Hltnp 2> /dev/null | awk '{ n=split($4, a, ":"); p=a[n]; if (p=="80" || p=="443") print p "\t" $0 }' \
    | while IFS=$'\t' read -r port line; do
        proc="$(printf '%s' "$line" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p')"
        printf '%s\t%s\n' "$port" "${proc:-unknown (run as root to see the owner)}"
      done
}

foreign_listener() { # exit 0 when something listens on 80/443
  [ -n "$(listeners | grep -E '^(80|443)'$'\t' || true)" ]
}

do_detect() {
  say "== SALES FORCE STAGING: read-only host inspection =="
  say "-- OS"
  if [ -r /etc/os-release ]; then grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release; else say "no /etc/os-release"; fi
  say "kernel: $(uname -sr)    arch: $(uname -m)"
  say "-- Docker"
  if command -v docker > /dev/null 2>&1; then
    docker --version 2> /dev/null || say "docker present but not answering"
    docker compose version 2> /dev/null || say "docker compose plugin: NOT available"
  else
    say "docker: NOT installed (this script installs nothing; see deploy/README-cicd.md)"
  fi
  say "-- Listeners on 80/443 (port, process)"
  l="$(listeners)"
  if [ -z "$l" ]; then say "none"; else printf '%s\n' "$l"; fi
  say "classification:"
  if [ -z "$l" ]; then
    say "  ports free: SF_EDGE_MODE=caddy is possible"
  else
    for name in nginx caddy traefik apache2 httpd haproxy docker-proxy; do
      if printf '%s' "$l" | grep -q "$name"; then say "  $name holds a port: choose SF_EDGE_MODE=external (never replaced automatically)"; fi
    done
    say "  anything already listening means SF_EDGE_MODE=external unless you free the ports yourself"
  fi
  say "-- Docker projects and networks (names only)"
  if command -v docker > /dev/null 2>&1; then
    docker compose ls --all 2> /dev/null || say "(docker compose ls unavailable)"
    docker network ls --format '{{.Name}} ({{.Driver}})' 2> /dev/null || true
  fi
  say "-- Firewall"
  if command -v ufw > /dev/null 2>&1; then ufw status 2> /dev/null | head -n 5 || say "ufw: cannot read status"; else say "ufw: not installed"; fi
  if command -v systemctl > /dev/null 2>&1; then say "firewalld: $(systemctl is-active firewalld 2> /dev/null || true)"; fi
  say "-- Disk"
  df -h / /opt 2> /dev/null | sort -u
  say "-- Deploy user and directories (defaults)"
  if id force-deploy > /dev/null 2>&1; then say "user force-deploy: exists ($(id force-deploy))"; else say "user force-deploy: absent"; fi
  if [ -d /opt/force-staging ]; then ls -ld /opt/force-staging /opt/force-staging/* 2> /dev/null; else say "/opt/force-staging: absent"; fi
  say "== end of inspection: nothing was changed =="
}

# ----------------------------------------------------------------------------------------------------- apply
do_apply() {
  local user="force-deploy" root="/opt/force-staging" pubfile="" allow_from="" docker_group="no" dry="no"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --deploy-pubkey-file) pubfile="${2:-}"; shift ;;
      --user) user="${2:-}"; shift ;;
      --root) root="${2:-}"; shift ;;
      --allow-from) allow_from="${2:-}"; shift ;;
      --add-to-docker-group-acknowledging-root-equivalence) docker_group="yes" ;;
      --dry-run) dry="yes" ;;
      *) die "unknown option: $1" ;;
    esac
    shift
  done
  [ "$(id -u)" -eq 0 ] || [ "$dry" = "yes" ] || die "apply must run as root (sudo)"
  [ -n "$pubfile" ] || die "--deploy-pubkey-file is required"
  [ -r "$pubfile" ] || die "cannot read public key file: $pubfile"
  printf '%s' "$user" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || die "invalid user name"
  [ "$user" != "root" ] || die "the deploy user must not be root"
  case "$root" in /opt/*) ;; *) die "--root must be under /opt" ;; esac
  printf '%s' "$root" | grep -Eq '^/opt/[A-Za-z0-9._/-]+$' || die "invalid --root"
  case "$root" in *..*) die "--root must not contain '..'" ;; esac
  if [ -n "$allow_from" ]; then
    printf '%s' "$allow_from" | grep -Eq '^[A-Za-z0-9.:,/*?!-]+$' || die "invalid --allow-from pattern"
  fi

  # The key: exactly one ed25519 public key line, validated by shape (and by ssh-keygen when present).
  local key_line
  [ "$(grep -cve '^[[:space:]]*$' "$pubfile")" -eq 1 ] || die "the public key file must contain exactly one key"
  key_line="$(grep -ve '^[[:space:]]*$' "$pubfile" | head -n 1)"
  printf '%s' "$key_line" | grep -Eq '^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [A-Za-z0-9@._:+-]{0,100})?$' \
    || die "not a plain ssh-ed25519 public key line (no options, no private key material)"
  if command -v ssh-keygen > /dev/null 2>&1; then
    ssh-keygen -l -f "$pubfile" > /dev/null 2>&1 || die "ssh-keygen cannot parse the public key"
  fi
  local key_blob
  key_blob="$(printf '%s' "$key_line" | awk '{print $2}')"

  # Preconditions that must hold before anything is created.
  command -v docker > /dev/null 2>&1 || die "docker is not installed. This script installs nothing: install Docker Engine + the compose plugin from your distribution's official instructions first."
  docker compose version > /dev/null 2>&1 || die "docker compose plugin missing"
  if foreign_listener && [ "${SF_EDGE_MODE:-}" != "external" ]; then
    listeners >&2
    die "something already listens on port 80/443. Re-run with SF_EDGE_MODE=external (an existing proxy stays in charge; see deploy/README-cicd.md) after reading the 'detect' output. Nothing was changed."
  fi
  case "${SF_EDGE_MODE:-}" in caddy | external) ;; *) die "set SF_EDGE_MODE=caddy or SF_EDGE_MODE=external explicitly for apply" ;; esac

  say "plan (user=$user root=$root docker_group=$docker_group edge_mode=${SF_EDGE_MODE})"
  say "  create system-style login user '$user' (no password, no sudo) if absent"
  say "  create $root/{repo,config,data,backups,logs} (config 0700, all owned by $user)"
  say "  install the deploy public key into ~$user/.ssh/authorized_keys with 'restrict'${allow_from:+ and from=\"$allow_from\"}"
  if [ "$docker_group" = "yes" ]; then
    say "  add $user to the docker group (ROOT-EQUIVALENT, acknowledged by flag)"
  else
    say "  $user is NOT added to the docker group: deploys cannot run docker until you decide (README-cicd.md)"
  fi
  [ "$dry" = "no" ] || { say "dry run: stopping before any change"; return 0; }

  # -- user
  if id "$user" > /dev/null 2>&1; then
    [ "$(id -u "$user")" -ne 0 ] || die "user $user has uid 0"
    say "user $user exists: left as is"
    if id -nG "$user" | tr ' ' '\n' | grep -Eqx 'sudo|wheel|admin'; then
      say "WARNING: $user is in a sudo-capable group; the deploy user must not have sudo. Not changed automatically."
    fi
  else
    command -v useradd > /dev/null 2>&1 || die "useradd not found"
    useradd --create-home --shell /bin/bash --comment "Sales Force staging deploy" "$user"
    passwd -l "$user" > /dev/null 2>&1 || usermod -L "$user"
    say "created user $user (password locked)"
  fi
  local home uid gid
  home="$(getent passwd "$user" | cut -d: -f6)"
  uid="$(id -u "$user")"
  gid="$(id -g "$user")"

  # -- docker group (explicit acknowledgement only)
  if [ "$docker_group" = "yes" ]; then
    getent group docker > /dev/null 2>&1 || die "group docker does not exist"
    if id -nG "$user" | tr ' ' '\n' | grep -qx docker; then say "$user already in docker group"; else usermod -aG docker "$user"; say "added $user to docker group"; fi
  fi

  # -- directories
  install -d -m 0750 -o "$user" -g "$user" "$root"
  for d in repo data backups logs; do install -d -m 0750 -o "$user" -g "$user" "$root/$d"; done
  install -d -m 0700 -o "$user" -g "$user" "$root/config"
  install -d -m 0700 -o "$user" -g "$user" "$root/config/secrets"
  say "directories ready under $root (config and config/secrets are 0700)"

  # -- authorized_keys
  install -d -m 0700 -o "$user" -g "$user" "$home/.ssh"
  local ak="$home/.ssh/authorized_keys" opts="restrict"
  [ -z "$allow_from" ] || opts="from=\"$allow_from\",restrict"
  if [ -f "$ak" ] && grep -qF "$key_blob" "$ak"; then
    say "deploy key already present in $ak: left as is"
  else
    printf '%s %s\n' "$opts" "$key_line" >> "$ak"
    say "deploy key installed with options: $opts"
  fi
  chown "$user:$user" "$ak"
  chmod 0600 "$ak"

  say ""
  say "== next manual steps (see deploy/README-cicd.md) =="
  say "1. As $user: create a READ-ONLY GitHub deploy key on the VPS and clone the repository into $root/repo."
  say "2. Put compose.env, the per-role env files and installation.json under $root/config (never in the repo)."
  say "   In compose.env use: SF_SECRETS_DIR=$root/config/secrets  SF_BACKUP_DIR=$root/backups  SF_OPS_USER=$uid:$gid"
  say "   and set SF_EDGE_MODE=${SF_EDGE_MODE} (and SF_DB_MODE=self-hosted|managed)."
  say "3. First deploy order: db-roles -> migrate -> db-roles -> config-bootstrap -> first admin, then the first deploy by hand with SF_FIRST_DEPLOY=1."
  say "4. Later, once the script path is stable, tighten the key with a forced command:"
  say "   command=\"$root/repo/deploy/scripts/deploy-staging.sh \$SSH_ORIGINAL_COMMAND\" (validate the argument inside; not done here)."
}

# ------------------------------------------------------------------------------------------------------ main
case "${1:-}" in
  detect) shift; [ "$#" -eq 0 ] || die "detect takes no arguments"; do_detect ;;
  apply) shift; do_apply "$@" ;;
  *) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
