#!/bin/sh
# One-time (and re-runnable) bootstrap of the least-privilege database roles: force_api, force_worker,
# force_migrator (deploy/staging/db-roles.sql). Run by the OWNER, by hand, as the database administrator, through
# the `db-roles` compose service (profile `ops-admin`, never part of `up` or of the routine ops profile).
#
# The administrator connection and the three role passwords come from ${SF_SECRETS_DIR}/db-admin.env (outside the
# repository, 0600), as environment variables:
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE [PGSSLMODE PGSSLROOTCERT]   the ADMIN connection
#   FORCE_MIGRATOR_PASSWORD FORCE_API_PASSWORD FORCE_WORKER_PASSWORD         passwords to SET on the roles
#   DB_ROLES_ADOPT_EXISTING=on   optional, re-owns objects created earlier by another role (see db-roles.sql)
# The administrator is the database superuser/admin and is NEVER used by an application service. The passwords
# reach psql through a temporary preamble file (mode 0600, in tmpfs, removed on exit), not through the process
# arguments, and are never printed. Only [A-Za-z0-9._~+=:/$-] is accepted so no quoting rule can be abused;
# generate them with e.g. `openssl rand -hex 32`, or pass a pre-hashed SCRAM verifier ("SCRAM-SHA-256$...").
set -eu
umask 077

fail() { echo "ops-db-roles: refusing: $1" >&2; exit 1; }

for name in PGHOST PGUSER PGPASSWORD PGDATABASE FORCE_MIGRATOR_PASSWORD FORCE_API_PASSWORD FORCE_WORKER_PASSWORD; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || fail "$name is not set (db-admin.env)."
done
case "$PGUSER" in force_api|force_worker|force_migrator) fail "PGUSER is one of the application roles; use the database administrator." ;; esac
case "$PGDATABASE" in *[!A-Za-z0-9_.-]*) fail "PGDATABASE has characters that are not allowed." ;; esac
adopt="${DB_ROLES_ADOPT_EXISTING:-off}"
case "$adopt" in on|off) ;; *) fail "DB_ROLES_ADOPT_EXISTING must be on or off." ;; esac

for name in FORCE_MIGRATOR_PASSWORD FORCE_API_PASSWORD FORCE_WORKER_PASSWORD; do
  eval "value=\${$name}"
  case "$value" in *[!A-Za-z0-9._~+=:/\$-]*) fail "$name has characters that are not allowed (use [A-Za-z0-9._~+=:/\$-], e.g. openssl rand -hex 32)." ;; esac
  [ "${#value}" -ge 24 ] || fail "$name is shorter than 24 characters."
done
[ "$FORCE_MIGRATOR_PASSWORD" != "$FORCE_API_PASSWORD" ] && [ "$FORCE_MIGRATOR_PASSWORD" != "$FORCE_WORKER_PASSWORD" ] \
  && [ "$FORCE_API_PASSWORD" != "$FORCE_WORKER_PASSWORD" ] || fail "the three role passwords must all be different."

work="$(mktemp -d /tmp/sf-db-roles.XXXXXX)"
trap 'rm -rf -- "$work"' EXIT
trap 'exit 1' INT TERM
{
  printf "\\\\set migrator_password '%s'\n" "$FORCE_MIGRATOR_PASSWORD"
  printf "\\\\set api_password '%s'\n" "$FORCE_API_PASSWORD"
  printf "\\\\set worker_password '%s'\n" "$FORCE_WORKER_PASSWORD"
  printf "\\\\set adopt_existing '%s'\n" "$adopt"
} > "$work/preamble.psql"

# The administrator password stays in PGPASSWORD (libpq reads it); nothing secret is in the arguments.
psql -X -v ON_ERROR_STOP=1 -f "$work/preamble.psql" -f "${DB_ROLES_SQL:-/ops/db-roles.sql}"
echo "ops-db-roles: OK (roles force_migrator, force_api, force_worker configured in database $PGDATABASE)"
