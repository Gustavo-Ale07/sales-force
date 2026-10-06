#!/bin/sh
# Writes /usr/share/nginx/html/config.json from the container environment at start (STACK-5): the
# installation name, the auth mode and the brand are per installation and never baked into the bundle. No
# secret belongs here: the file is public.
#   INSTALLATION_NAME  shown in the shell and on the login page (default: "Force PLAC";1-60 chars)
#   WEB_AUTH_MODE      dev | standard | local (REQUIRED, no default; the server refuses dev auth in production anyway)
#   BRAND_LOGO_URL     optional, /brand/<file>.(png|svg|webp|jpg|jpeg): horizontal logo (already carries the name)
#   BRAND_MARK_URL     optional, same shape: square mark (favicon; next to the name when there is no logo)
#   BRAND_ACCENT       optional, #rrggbb: accent color (the web app falls back to the default when white text
#                      on it would fail WCAG AA)
# The brand files live in /usr/share/nginx/html/brand/ (mounted by the installation, never in the image).
# The web app validates every brand value again; this script refuses the malformed ones early.
set -eu

name="${INSTALLATION_NAME:-Force PLAC}"
mode="${WEB_AUTH_MODE:-}"
if [ -z "$mode" ]; then
  echo "40-runtime-config: WEB_AUTH_MODE is required (dev | standard | local); there is no default." >&2
  exit 1
fi
logo="${BRAND_LOGO_URL:-}"
mark="${BRAND_MARK_URL:-}"
accent="${BRAND_ACCENT:-}"

case "$mode" in
  dev|standard|local) ;;
  *) echo "40-runtime-config: WEB_AUTH_MODE must be 'dev', 'standard' or 'local'." >&2; exit 1 ;;
esac

# Strip control characters, then JSON-escape backslash and double quote.
name="$(printf '%s' "$name" | tr -d '\000-\037')"
if [ -z "$name" ] || [ "${#name}" -gt 60 ]; then
  echo "40-runtime-config: INSTALLATION_NAME must be 1-60 characters." >&2
  exit 1
fi
escaped="$(printf '%s' "$name" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"

# grep is line-oriented: a multi-line value would pass when one of its lines matched, so anything outside
# this character set (newline included) is refused before the patterns below run.
for pair in "BRAND_LOGO_URL:$logo" "BRAND_MARK_URL:$mark" "BRAND_ACCENT:$accent"; do
  case "${pair#*:}" in
    *[!A-Za-z0-9._/#-]*) echo "40-runtime-config: ${pair%%:*} has characters outside A-Z a-z 0-9 . _ / # -." >&2; exit 1 ;;
  esac
done

asset_pattern='^/brand/[A-Za-z0-9_-][A-Za-z0-9._-]{0,80}\.(png|svg|webp|jpe?g)$'
for pair in "BRAND_LOGO_URL:$logo" "BRAND_MARK_URL:$mark"; do
  value="${pair#*:}"
  if [ -n "$value" ] && ! printf '%s' "$value" | grep -Eq "$asset_pattern"; then
    echo "40-runtime-config: ${pair%%:*} must be /brand/<file name>.(png|svg|webp|jpg|jpeg)." >&2
    exit 1
  fi
done
if [ -n "$accent" ] && ! printf '%s' "$accent" | grep -Eq '^#[0-9a-fA-F]{6}$'; then
  echo "40-runtime-config: BRAND_ACCENT must be #rrggbb." >&2
  exit 1
fi

# Only the values that were set; each one is restricted above to characters that need no escaping.
brand=""
add() { brand="${brand}${brand:+, }\"$1\": \"$2\""; }
[ -z "$logo" ] || add logoUrl "$logo"
[ -z "$mark" ] || add markUrl "$mark"
[ -z "$accent" ] || add accent "$accent"

if [ -n "$brand" ]; then
  printf '{\n  "installationName": "%s",\n  "authMode": "%s",\n  "brand": { %s }\n}\n' "$escaped" "$mode" "$brand" > /usr/share/nginx/html/config.json
else
  printf '{\n  "installationName": "%s",\n  "authMode": "%s"\n}\n' "$escaped" "$mode" > /usr/share/nginx/html/config.json
fi
echo "40-runtime-config: config.json written (authMode=$mode)"
