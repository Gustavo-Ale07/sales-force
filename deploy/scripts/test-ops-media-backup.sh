#!/usr/bin/env bash
# Self-test of deploy/staging/ops-media-backup.sh on a synthetic temp directory. No Docker, no network, no secret.
# Usage: bash deploy/scripts/test-ops-media-backup.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/../staging/ops-media-backup.sh"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
pass=0
ok() { pass=$((pass + 1)); echo "ok - $1"; }
bad() { echo "NOT OK - $1" >&2; exit 1; }
expect_fail() { local label="$1"; shift; if "$@" >"$t/o" 2>&1; then bad "$label (expected failure)"; else ok "$label"; fi; }

mk() { # mk <root> <code> <content>
  local h; h="$(printf '%s' "$3" | sha256sum | cut -d' ' -f1)"
  mkdir -p "$1/product-images/$2"; printf '%s' "$3" > "$1/product-images/$2/$h"
}
src="$t/src"; mkdir -p "$src/.tmp"; echo junk > "$src/.tmp/partial"
mk "$src" 100 "fake image one"; mk "$src" 100 "fake image two"; mk "$src" 205 "other"

bash "$script" backup --dir "$src" --out "$t/out" >"$t/o" && ok "backup" || bad "backup"
grep -q '3 objects' "$t/o" || bad "backup counts"
archive="$(ls "$t"/out/*.tar.gz)"
[ -f "$archive.sha256" ] && [ -f "$archive.manifest.tsv" ] || bad "sidecar files"
[ "$(wc -l < "$archive.manifest.tsv" | tr -d ' ')" = 3 ] && ok "manifest has 3 rows" || bad "manifest rows"

bash "$script" verify "$archive" >"$t/o" && grep -q 'verify OK: 3 objects' "$t/o" && ok "verify" || bad "verify"

bash "$script" restore "$archive" --to "$t/dst" >"$t/o" && ok "restore into empty dir" || bad "restore"
diff -r "$src/product-images" "$t/dst/product-images" && ok "restored tree identical" || bad "restored tree differs"
expect_fail "restore refuses non-empty target" bash "$script" restore "$archive" --to "$t/dst"
expect_fail "restore --allow-non-empty never overwrites" bash "$script" restore "$archive" --to "$t/dst" --allow-non-empty
mkdir -p "$t/dst2"; echo x > "$t/dst2/other"
bash "$script" restore "$archive" --to "$t/dst2" --allow-non-empty >/dev/null && ok "restore adds to non-empty with flag" || bad "restore flag"

# Non-conforming file in the source: backup refuses.
cp -r "$src" "$t/src2"; echo hi > "$t/src2/stray.txt"
expect_fail "backup refuses a non-conforming file" bash "$script" backup --dir "$t/src2" --out "$t/out2"
# Name that does not match the content.
cp -r "$src" "$t/src3"; f="$(find "$t/src3/product-images/205" -type f)"; printf 'tampered' > "$f"
expect_fail "backup refuses content/name mismatch" bash "$script" backup --dir "$t/src3" --out "$t/out3"

# Corruption: flip a byte of an object inside the archive (rebuild archive without the sidecar checksum).
mkdir -p "$t/c/x"; tar -xzf "$archive" -C "$t/c/x"
f="$(find "$t/c/x/data" -type f | head -1)"; printf 'Z' | dd of="$f" bs=1 seek=0 conv=notrunc 2>/dev/null
(cd "$t/c/x" && tar -czf "$t/c/corrupt.tar.gz" MANIFEST.tsv data)
expect_fail "verify fails on a flipped byte" bash "$script" verify "$t/c/corrupt.tar.gz"
expect_fail "restore refuses a corrupt archive" bash "$script" restore "$t/c/corrupt.tar.gz" --to "$t/dst3"
# Sidecar checksum mismatch (archive modified after backup).
cp "$archive" "$t/c/mod.tar.gz"; cp "$archive.sha256" "$t/c/mod.tar.gz.sha256"; printf 'x' >> "$t/c/mod.tar.gz"
expect_fail "verify fails on archive checksum mismatch" bash "$script" verify "$t/c/mod.tar.gz"
# Extra object not in manifest.
mkdir -p "$t/e"; tar -xzf "$archive" -C "$t/e"; mk "$t/e/data" 999 "sneaky"
(cd "$t/e" && tar -czf "$t/e.tar.gz" MANIFEST.tsv data)
expect_fail "verify fails on object missing from manifest" bash "$script" verify "$t/e.tar.gz"


# Thumbnails: product-thumbnails/<code>/<sha256 of the thumbnail> is covered by backup, verify and restore too.
mkt() { # mkt <root> <code> <content>
  local h; h="$(printf '%s' "$3" | sha256sum | cut -d' ' -f1)"
  mkdir -p "$1/product-thumbnails/$2"; printf '%s' "$3" > "$1/product-thumbnails/$2/$h"
}
srct="$t/srct"; mkdir -p "$srct/.tmp"
mk "$srct" 100 "original one"; mkt "$srct" 100 "thumb one"; mk "$srct" 205 "original two"; mkt "$srct" 205 "thumb two"
bash "$script" backup --dir "$srct" --out "$t/outt" >"$t/o" && grep -q '4 objects' "$t/o" && ok "backup covers both prefixes" || bad "backup thumbnails"
archivet="$(ls "$t"/outt/*.tar.gz)"
grep -q 'product-thumbnails/100/' "$archivet.manifest.tsv" && ok "manifest lists thumbnails" || bad "manifest thumbnails"
bash "$script" verify "$archivet" >"$t/o" && grep -q 'verify OK: 4 objects' "$t/o" && ok "verify covers both prefixes" || bad "verify thumbnails"
bash "$script" restore "$archivet" --to "$t/dstt" >/dev/null && diff -r "$srct/product-thumbnails" "$t/dstt/product-thumbnails" && diff -r "$srct/product-images" "$t/dstt/product-images" && ok "restore brings back both prefixes" || bad "restore thumbnails"
cp -r "$srct" "$t/srct2"; ft="$(find "$t/srct2/product-thumbnails/205" -type f)"; printf 'tampered' > "$ft"
expect_fail "backup refuses a thumbnail whose content differs from its name" bash "$script" backup --dir "$t/srct2" --out "$t/outt2"
cp -r "$srct" "$t/srct3"; mkdir -p "$t/srct3/product-thumbs/100"; cp "$(find "$t/srct3/product-thumbnails/100" -type f)" "$t/srct3/product-thumbs/100/"
expect_fail "backup refuses an unknown prefix" bash "$script" backup --dir "$t/srct3" --out "$t/outt3"
mkdir -p "$t/et"; tar -xzf "$archivet" -C "$t/et"; mkt "$t/et/data" 999 "sneaky thumb"
(cd "$t/et" && tar -czf "$t/et.tar.gz" MANIFEST.tsv data)
expect_fail "verify fails on a thumbnail missing from the manifest" bash "$script" verify "$t/et.tar.gz"
# Volume names: only a Docker named volume; '/' (host path / bind mount), ':' and options are refused before docker is touched.
for v in "/" "/etc" "a/b" "../x" "vol:/data" "-v" ".hidden" "a b"; do
  expect_fail "backup refuses volume name '$v'" bash "$script" backup --volume "$v" --out "$t/outv"
  expect_fail "restore refuses volume name '$v'" bash "$script" restore "$archive" --to-volume "$v"
done
# Product code segment: digits only (no '..', no letters, no spaces).
for code in ".." "abc" "10a" "1.0"; do
  cp -r "$srct" "$t/srck"; mkdir -p "$t/srck/product-images/$code"; h="$(printf 'x%s' "$code" | sha256sum | cut -d' ' -f1)"; printf 'x%s' "$code" > "$t/srck/product-images/$code/$h"
  expect_fail "backup refuses product code segment '$code'" bash "$script" backup --dir "$t/srck" --out "$t/outk"
  rm -rf "$t/srck"
done
echo "all $pass checks passed"
