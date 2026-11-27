#!/usr/bin/env bash
# Server code of an environment: show its hash prefix or rotate it. Runs ON the VPS (over SSH) and executes the CLI
# `dist/server-code-cli.js` INSIDE the api container of the chosen environment. There is no HTTP route and no screen for this
# (owner ruling 2026-11-27).
#
#   deploy/scripts/server-code.sh staging show-hash   says whether a code is active; prints a short hash prefix and the date, NEVER the code
#   deploy/scripts/server-code.sh staging rotate      generates a new code, revokes every session, prints the code ONCE on stdout
#
# `rotate` invalidates every installed app and every open site session: distribute the new code afterwards. Redirect nothing
# to a file or a log: the code is shown once and only its hash is stored.
#
# staging: uses sf-compose.sh (same project, env file and image tags as the deploy) and refuses to run unless the api container
# itself reports SF_DEPLOY_ENVIRONMENT=staging. production: exists only as a parameter. The production stack has no compose
# tooling in this repository yet, so it requires SF_PRODUCTION_COMPOSE (the command that runs `docker compose` for the production
# stack) and the same container-side guard (SF_DEPLOY_ENVIRONMENT=production); without it the script refuses. Do not run it
# against production before the owner authorizes it.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { printf 'server-code.sh: %s\n' "$*" >&2; exit 1; }

[ "$#" -eq 2 ] || die "usage: server-code.sh <staging|production> <show-hash|rotate>"
environment="$1"
action="$2"
case "$environment" in staging | production) ;; *) die "unknown environment '$environment' (staging|production)" ;; esac
case "$action" in show-hash | rotate) ;; *) die "unknown action '$action' (show-hash|rotate)" ;; esac

if [ "$environment" = "staging" ]; then
  compose=("$here/sf-compose.sh")
else
  [ -n "${SF_PRODUCTION_COMPOSE:-}" ] || die "production has no compose tooling here: set SF_PRODUCTION_COMPOSE (only with the owner's authorization)"
  # shellcheck disable=SC2206
  compose=(${SF_PRODUCTION_COMPOSE})
fi

# The container decides which environment it is: a mismatch (a staging name pointed at the wrong stack, or the reverse) stops here.
actual="$("${compose[@]}" exec -T api sh -c 'printf %s "${SF_DEPLOY_ENVIRONMENT:-}"' < /dev/null)" || die "could not reach the api container"
[ "$actual" = "$environment" ] || die "the api container reports SF_DEPLOY_ENVIRONMENT='${actual}', expected '${environment}': nothing was changed"

exec "${compose[@]}" exec -T api node dist/server-code-cli.js "$action" < /dev/null
