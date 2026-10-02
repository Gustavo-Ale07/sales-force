#!/bin/sh
# Shared helpers of the staging ops scripts (sourced, never executed): percent-decoding and a strict
# PostgreSQL connection-URL parser. The caller defines `fail MESSAGE` (print and exit non-zero) first.
#
# parse_url URL LABEL sets, or calls `fail`:
#   P_SCHEME P_USER_RAW P_PASS_RAW P_HOST (lower-case, no brackets) P_PORT P_DB P_QUERY (no leading "?")
#   P_URL_NOPASS  the URL rebuilt from the validated parts WITHOUT the password (the password travels in
#                 PGPASSWORD, never in the process arguments).
# The parser is deliberately narrow, it rejects instead of guessing (a mis-parsed target is how a restore hits
# the wrong database):
#   - scheme postgres:// or postgresql://; no whitespace, no "#" fragment;
#   - authority = everything up to the first "/" (so an "@" in the path can never become user information);
#     user information splits at the last "@" of the authority;
#   - the path is exactly one database name made only of [A-Za-z0-9_.-] (no percent-encoding, no "/", no "@");
#   - host: a DNS name/IPv4 ([A-Za-z0-9.-]) or a BRACKETED IPv6 literal; a bare IPv6 address or a lone
#     bracket is refused; no host lists; port digits only (default 5432);
#   - the query may only carry sslmode, sslrootcert, connect_timeout (each at most once), values made of
#     [A-Za-z0-9_./:-], and no "%" anywhere: host, hostaddr, port, dbname, user, password, service, options,
#     passfile, ... are therefore impossible as overrides, however they are spelled or encoded.

pct_decode() {
  printf '%s' "$1" | awk 'BEGIN { h = "0123456789abcdef" }
    { s = $0; out = ""
      while (length(s) > 0) {
        c = substr(s, 1, 1); a = index(h, tolower(substr(s, 2, 1))); b = index(h, tolower(substr(s, 3, 1)))
        if (c == "%" && length(s) >= 3 && a > 0 && b > 0) { out = out sprintf("%c", (a - 1) * 16 + b - 1); s = substr(s, 4) }
        else { out = out c; s = substr(s, 2) }
      }
      printf "%s", out }'
}

parse_url() {
  _url="$1"
  _label="$2"
  case "$_url" in postgres://*|postgresql://*) ;; *) fail "$_label must be a postgres:// URL." ;; esac
  case "$_url" in *"#"*) fail "$_label must not contain a fragment (#)." ;; esac
  case "$_url" in *[[:space:]]*) fail "$_label must not contain whitespace." ;; esac
  P_SCHEME="${_url%%://*}"
  _rest="${_url#*://}"

  P_QUERY=""
  case "$_rest" in *\?*) P_QUERY="${_rest#*\?}"; _rest="${_rest%%\?*}" ;; esac
  _authority="${_rest%%/*}"
  _path=""
  case "$_rest" in */*) _path="${_rest#*/}" ;; esac
  case "$_path" in */*) fail "$_label must name a single database (no \"/\" in the path)." ;; esac

  _userinfo=""
  _hostport="$_authority"
  case "$_authority" in *@*) _userinfo="${_authority%@*}"; _hostport="${_authority##*@}" ;; esac

  P_PORT=""
  case "$_hostport" in
    \[*\]) P_HOST="${_hostport#\[}"; P_HOST="${P_HOST%\]}" ;;
    \[*\]:*) _bracketed="${_hostport%%\]*}"; P_HOST="${_bracketed#\[}"; P_PORT="${_hostport#*\]:}" ;;
    \[*) fail "$_label has a malformed bracketed host." ;;
    *:*:*) fail "$_label has an IPv6 host without brackets (write [address] or [address]:port)." ;;
    *:*) P_HOST="${_hostport%%:*}"; P_PORT="${_hostport#*:}" ;;
    *) P_HOST="$_hostport" ;;
  esac
  [ -n "$P_PORT" ] || P_PORT="5432"
  case "$P_PORT" in *[!0-9]*) fail "$_label has a non-numeric port." ;; esac
  [ "$P_PORT" -ge 1 ] && [ "$P_PORT" -le 65535 ] || fail "$_label has a port outside 1-65535."
  [ -n "$P_HOST" ] || fail "$_label has no host."
  case "$P_HOST" in *[!A-Za-z0-9.:-]*) fail "$_label has characters in the host that are not allowed (host lists are refused)." ;; esac
  P_HOST="$(printf '%s' "$P_HOST" | tr 'A-Z' 'a-z')"

  P_USER_RAW="${_userinfo%%:*}"
  P_PASS_RAW=""
  case "$_userinfo" in *:*) P_PASS_RAW="${_userinfo#*:}" ;; esac
  case "$P_USER_RAW" in *[!A-Za-z0-9._~%-]*) fail "$_label has characters in the user name that are not allowed (percent-encode them)." ;; esac

  [ -n "$_path" ] || _path="$P_USER_RAW"
  [ -n "$_path" ] || fail "$_label names no database."
  case "$_path" in *[!A-Za-z0-9_.-]*) fail "$_label: the database name may only contain A-Z a-z 0-9 _ . - (no percent-encoding)." ;; esac
  P_DB="$_path"

  case "$P_QUERY" in *%*) fail "$_label: percent-encoding is not accepted in the query." ;; esac
  _remaining="$P_QUERY"
  _seen=" "
  while [ -n "$_remaining" ]; do
    _pair="${_remaining%%&*}"
    case "$_remaining" in *\&*) _remaining="${_remaining#*&}" ;; *) _remaining="" ;; esac
    case "$_pair" in *=*) ;; *) fail "$_label: malformed query parameter." ;; esac
    _key="${_pair%%=*}"
    _value="${_pair#*=}"
    case "$_key" in sslmode|sslrootcert|connect_timeout) ;; *) fail "$_label: query parameter not allowed (only sslmode, sslrootcert, connect_timeout)." ;; esac
    case "$_seen" in *" $_key "*) fail "$_label: query parameter given twice." ;; esac
    _seen="$_seen$_key "
    [ -n "$_value" ] || fail "$_label: empty query parameter value."
    case "$_value" in *[!A-Za-z0-9_./:-]*) fail "$_label: characters in a query value that are not allowed." ;; esac
  done

  _hostpart="$P_HOST"
  case "$P_HOST" in *:*) _hostpart="[$P_HOST]" ;; esac
  P_URL_NOPASS="${P_SCHEME}://"
  [ -n "$P_USER_RAW" ] && P_URL_NOPASS="${P_URL_NOPASS}${P_USER_RAW}@"
  P_URL_NOPASS="${P_URL_NOPASS}${_hostpart}:${P_PORT}/${P_DB}"
  [ -n "$P_QUERY" ] && P_URL_NOPASS="${P_URL_NOPASS}?${P_QUERY}"
  return 0
}
