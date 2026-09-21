#!/bin/sh
# Writes /usr/share/nginx/html/config.json from the container environment at start (STACK-5): the
# installation name and the auth mode are per installation and never baked into the bundle. No secret
# belongs here: the file is public.
#   INSTALLATION_NAME  shown in the shell and on the login page (default: "Sales Force"; 1-60 chars)
#   WEB_AUTH_MODE      dev | standard (default: dev; the server refuses dev auth in production anyway)
set -eu

name="${INSTALLATION_NAME:-Sales Force}"
mode="${WEB_AUTH_MODE:-dev}"

case "$mode" in
  dev|standard) ;;
  *) echo "40-runtime-config: WEB_AUTH_MODE must be 'dev' or 'standard'." >&2; exit 1 ;;
esac

# Strip control characters, then JSON-escape backslash and double quote.
name="$(printf '%s' "$name" | tr -d '\000-\037')"
if [ -z "$name" ] || [ "${#name}" -gt 60 ]; then
  echo "40-runtime-config: INSTALLATION_NAME must be 1-60 characters." >&2
  exit 1
fi
escaped="$(printf '%s' "$name" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

printf '{\n  "installationName": "%s",\n  "authMode": "%s"\n}\n' "$escaped" "$mode" > /usr/share/nginx/html/config.json
echo "40-runtime-config: config.json written (authMode=$mode)"
