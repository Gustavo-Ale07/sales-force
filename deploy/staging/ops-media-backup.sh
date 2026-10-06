#!/usr/bin/env bash
# STAGING INTERIM ONLY. Backup / verify / restore of the product photo store (Docker named volume
# `product_media`, mounted at PRODUCT_MEDIA_DIR). Filesystem storage is an accepted temporary measure for staging;
# it is NOT the definitive production storage (P-17 / STACK-7: managed S3-compatible storage, still open, V-05).
# This volume is NOT covered by the PostgreSQL dump/PITR and this script does not meet RPO <= 15 min / RTO <= 4 h.
#
# Runs on the HOST as the deploy user (needs bash, tar, gzip, sha256sum, find; docker only for --volume/--to-volume).
# No database access, no network. Image bytes are never printed: logs carry counts, sizes and key paths only.
#
#   ops-media-backup.sh backup  (--dir <path> | --volume <name>) --out <backup-dir>
#   ops-media-backup.sh verify  <archive.tar.gz>
#   ops-media-backup.sh restore <archive.tar.gz> (--to <dir> | --to-volume <name>) [--allow-non-empty]
#
# Archive layout: MANIFEST.tsv (sha256<TAB>size<TAB>relative-path, sorted by path in the C locale) + data/<paths>.
# Beside the archive: <archive>.sha256 (basename form, `sha256sum -c` works) and <archive>.manifest.tsv (copy).
# Every object path must be exactly product-images/<code>/<sha256> (original) or product-thumbnails/<code>/<sha256>
# (generated thumbnail), and sha256(content) must equal the file name.
# `.tmp/` (stale staging files of the worker) is skipped by backup. Non-conforming files are reported and make the
# backup fail (never silently archived).
# Volume names: the compose project prefixes them (docker volume ls | grep product_media). With --volume the
# volume is mounted READ-ONLY in a throwaway alpine container (image must be available locally or pullable).
# On Windows/Git Bash use forward-slash paths (C:/dir); MSYS_NO_PATHCONV=1 is set for the docker calls.
set -euo pipefail
umask 077
export LC_ALL=C
export MSYS_NO_PATHCONV=1
HELPER_IMAGE="${MEDIA_BACKUP_HELPER_IMAGE:-alpine:3}"

die() { echo "ops-media-backup: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }
need tar; need gzip; need sha256sum; need find

tmpdirs=()
cleanup() { local d; for d in "${tmpdirs[@]:-}"; do if [ -n "$d" ]; then rm -rf -- "$d"; fi; done; return 0; }
trap cleanup EXIT
trap 'exit 1' INT TERM
mktmp() { local d; d="$(mktemp -d)"; tmpdirs+=("$d"); echo "$d"; }

# <code> is the CODPROD (digits only); the object name is the SHA-256 of its content.
KEY_RE='^(product-images|product-thumbnails)/[0-9]+/[0-9a-f]{64}$'
# Docker named volume: starts alphanumeric, then [A-Za-z0-9_.-]. Rejects '/' (a host path would become a bind mount), ':' and options.
VOL_RE='^[A-Za-z0-9][A-Za-z0-9_.-]*$'
check_volume_name() { [[ "$2" =~ $VOL_RE ]] || die "$1: invalid volume name (a Docker named volume, no '/' or ':'): $2"; }

# manifest_from_dir <dir> <out-file>: tab-separated sha256, size, path; fails on non-conforming files.
manifest_from_dir() {
  local dir="$1" out="$2" bad=0 rel size hash name
  : > "$out"
  while IFS= read -r -d '' rel; do
    rel="${rel#./}"
    case "$rel" in .tmp|.tmp/*) continue ;; esac
    if ! [[ "$rel" =~ $KEY_RE ]]; then echo "ops-media-backup: non-conforming path: $rel" >&2; bad=1; continue; fi
    hash="$(sha256sum < "$dir/$rel" | cut -d' ' -f1)"
    name="${rel##*/}"
    if [ "$hash" != "$name" ]; then echo "ops-media-backup: content hash differs from name: $rel" >&2; bad=1; continue; fi
    size="$(wc -c < "$dir/$rel" | tr -d ' ')"
    printf '%s\t%s\t%s\n' "$hash" "$size" "$rel" >> "$out"
  done < <(cd "$dir" && find . -type f -print0 | sort -z)
  [ "$bad" -eq 0 ] || return 1
  sort -t$'\t' -k3,3 -o "$out" "$out"
}

# Strict archive member listing: only MANIFEST.tsv and data/..., no absolute/.. paths, no links or devices.
check_members() {
  local archive="$1" line
  while IFS= read -r line; do
    case "$line" in
      /*|*..*) die "unsafe member path in archive: $line" ;;
      MANIFEST.tsv|data/|data/*) ;;
      *) die "unexpected member in archive: $line" ;;
    esac
  done < <(tar -tzf "$archive")
  if tar -tvzf "$archive" | grep -qv '^[-d]'; then die "archive contains links or special files"; fi
}

# verify_archive <archive> <extract-dir>: extracts and checks; sets V_COUNT V_BYTES. Returns 1 on any failure.
verify_archive() {
  local archive="$1" x="$2" fails=0 hash size rel actual n=0 total=0 listed
  [ -f "$archive" ] || die "archive not found: $archive"
  check_members "$archive"
  tar -xzf "$archive" -C "$x"
  [ -f "$x/MANIFEST.tsv" ] || die "archive has no MANIFEST.tsv"
  if [ -f "$archive.sha256" ]; then
    (cd "$(dirname "$archive")" && sha256sum -c --status "$(basename "$archive").sha256") \
      || { echo "ops-media-backup: archive checksum (.sha256) mismatch" >&2; fails=1; }
  fi
  listed="$(mktemp -p "$x")"
  while IFS=$'\t' read -r hash size rel; do
    [ -n "$rel" ] || continue
    n=$((n + 1))
    if ! [[ "$rel" =~ $KEY_RE ]]; then echo "FAIL path layout: $rel" >&2; fails=1; continue; fi
    if [ "${rel##*/}" != "$hash" ]; then echo "FAIL manifest hash differs from name: $rel" >&2; fails=1; continue; fi
    if [ ! -f "$x/data/$rel" ]; then echo "FAIL missing object: $rel" >&2; fails=1; continue; fi
    actual="$(sha256sum < "$x/data/$rel" | cut -d' ' -f1)"
    if [ "$actual" != "$hash" ]; then echo "FAIL content hash mismatch: $rel" >&2; fails=1; continue; fi
    [ "$(wc -c < "$x/data/$rel" | tr -d ' ')" = "$size" ] || { echo "FAIL size mismatch: $rel" >&2; fails=1; continue; }
    total=$((total + size))
    printf '%s\n' "$rel" >> "$listed"
  done < "$x/MANIFEST.tsv"
  # Objects present in data/ but not in the manifest.
  local extra
  extra="$(cd "$x/data" 2>/dev/null && find . -type f | sed 's#^\./##' | sort | comm -23 - <(sort "$listed") || true)"
  if [ -n "$extra" ]; then echo "FAIL objects not in manifest:" >&2; echo "$extra" >&2; fails=1; fi
  rm -f -- "$listed"
  V_COUNT="$n"; V_BYTES="$total"
  [ "$fails" -eq 0 ]
}

cmd_backup() {
  local dir="" vol="" out=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir) dir="${2:?--dir needs a value}"; shift 2 ;;
      --volume) vol="${2:?--volume needs a value}"; shift 2 ;;
      --out) out="${2:?--out needs a value}"; shift 2 ;;
      *) die "backup: unknown argument $1" ;;
    esac
  done
  { [ -n "$dir" ] && [ -z "$vol" ]; } || { [ -z "$dir" ] && [ -n "$vol" ]; } || die "backup: give exactly one of --dir / --volume"
  [ -z "$vol" ] || check_volume_name backup "$vol"
  [ -n "$out" ] || die "backup: --out <backup-dir> is required"
  mkdir -p "$out"
  local src work stamp archive base
  work="$(mktmp)"
  if [ -n "$vol" ]; then
    need docker
    src="$work/src"; mkdir -p "$src"
    docker run --rm -v "$vol:/data:ro" "$HELPER_IMAGE" tar -C /data -cf - . | tar -C "$src" -xf -
  else
    [ -d "$dir" ] || die "backup: directory not found: $dir"
    src="$dir"
  fi
  manifest_from_dir "$src" "$work/MANIFEST.tsv" || die "backup: refused, see messages above"
  mkdir -p "$work/stage"
  cp "$work/MANIFEST.tsv" "$work/stage/MANIFEST.tsv"
  mkdir -p "$work/stage/data"
  if [ -s "$work/MANIFEST.tsv" ]; then
    local rel
    while IFS=$'\t' read -r _ _ rel; do mkdir -p "$work/stage/data/${rel%/*}"; cp "$src/$rel" "$work/stage/data/$rel"; done < "$work/MANIFEST.tsv"
  fi
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  archive="$out/sf-staging-media-$stamp.tar.gz"
  base="$(basename "$archive")"
  [ ! -e "$archive" ] || die "backup: $base already exists (never overwritten)"
  (cd "$work/stage" && tar -czf "$archive.partial" MANIFEST.tsv data)
  mv "$archive.partial" "$archive"
  cp "$work/MANIFEST.tsv" "$archive.manifest.tsv"
  (cd "$out" && sha256sum "$base" > "$base.sha256")
  local n b
  n="$(wc -l < "$work/MANIFEST.tsv" | tr -d ' ')"
  b="$(awk -F'\t' '{s+=$2} END {print s+0}' "$work/MANIFEST.tsv")"
  echo "ops-media-backup: wrote $base ($n objects, $b object bytes, $(wc -c < "$archive" | tr -d ' ') archive bytes)"
  echo "ops-media-backup: NOT a valid backup until 'verify' passed AND a restore was tested; copy it off the VPS."
}

cmd_verify() {
  local archive="${1:?usage: verify <archive.tar.gz>}"
  local x; x="$(mktmp)"; mkdir -p "$x"
  if verify_archive "$archive" "$x"; then
    echo "ops-media-backup: verify OK: $V_COUNT objects, $V_BYTES bytes"
  else
    echo "ops-media-backup: verify FAILED" >&2; exit 1
  fi
}

cmd_restore() {
  local archive="${1:?usage: restore <archive> (--to <dir> | --to-volume <name>) [--allow-non-empty]}"; shift
  local to="" tovol="" force=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --to) to="${2:?--to needs a value}"; shift 2 ;;
      --to-volume) tovol="${2:?--to-volume needs a value}"; shift 2 ;;
      --allow-non-empty) force=1; shift ;;
      *) die "restore: unknown argument $1" ;;
    esac
  done
  { [ -n "$to" ] && [ -z "$tovol" ]; } || { [ -z "$to" ] && [ -n "$tovol" ]; } || die "restore: give exactly one of --to / --to-volume"
  [ -z "$tovol" ] || check_volume_name restore "$tovol"
  local x; x="$(mktmp)"
  verify_archive "$archive" "$x" || die "restore: refused, archive failed verification"
  echo "ops-media-backup: archive verified ($V_COUNT objects, $V_BYTES bytes)"
  local nonempty rel
  if [ -n "$to" ]; then
    mkdir -p "$to"
    [ -n "$(ls -A "$to")" ] && nonempty=1 || nonempty=0
  else
    need docker
    [ -n "$(docker run --rm -v "$tovol:/data:ro" "$HELPER_IMAGE" ls -A /data)" ] && nonempty=1 || nonempty=0
  fi
  if [ "$nonempty" -eq 1 ]; then
    [ "$force" -eq 1 ] || die "restore: target is not empty; refusing (add --allow-non-empty to add missing objects only)"
    # Never overwrite: with the flag, any object that already exists in the target aborts before anything is written.
    while IFS=$'\t' read -r _ _ rel; do
      if [ -n "$to" ]; then
        [ ! -e "$to/$rel" ] || die "restore: $rel already exists in the target; nothing was written"
      else
        docker run --rm -v "$tovol:/data:ro" "$HELPER_IMAGE" test ! -e "/data/$rel" || die "restore: $rel already exists in the target; nothing was written"
      fi
    done < "$x/MANIFEST.tsv"
  fi
  if [ -n "$to" ]; then
    tar -C "$x/data" -cf - . | tar -C "$to" -xf -
  else
    # Extracted as root inside the helper: ownership must be fixed to the worker user afterwards (see docs).
    tar -C "$x/data" -cf - . | docker run -i --rm -v "$tovol:/data" "$HELPER_IMAGE" tar -C /data -xf -
  fi
  echo "ops-media-backup: restored $V_COUNT objects ($V_BYTES bytes). Run the SQL cross-check in docs/implementation/product-media.md."
}

case "${1:-}" in
  backup) shift; cmd_backup "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  *) die "usage: backup|verify|restore (see the header of this script)" ;;
esac
