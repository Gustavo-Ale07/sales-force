#!/bin/sh
# Copies the newest VERIFIED dump (and its .sha256) from /backups to an S3-compatible bucket in a SECOND FAILURE
# DOMAIN, outside the VPS (OPS-2: a backup that lives only next to the database is not a backup). Runs in the
# `offsite` compose service (profile `offsite`); the image comes from OFFSITE_IMAGE and must provide `aws`
# (AWS CLI v2) and, when client-side encryption is wanted, `age`.
#
# Configuration (all from the secrets file offsite.env, outside the repository; values are never printed):
#   OFFSITE_S3_ENDPOINT          required, https:// URL of the S3-compatible service (http:// only with OFFSITE_ALLOW_HTTP=1)
#   OFFSITE_S3_BUCKET            required
#   OFFSITE_S3_PREFIX            optional key prefix (default "salesforce-staging/")
#   OFFSITE_S3_REGION            optional (default "us-east-1": many S3-compatible services ignore it)
#   OFFSITE_S3_ACCESS_KEY_ID / OFFSITE_S3_SECRET_ACCESS_KEY   required; use a key that can write but not delete/overwrite
#   OFFSITE_AGE_RECIPIENT        optional age public key ("age1..."): the dump is encrypted before it leaves the VPS
#                                (only the public key lives here; the private key stays with the owner). Requires `age`.
#   OFFSITE_ALLOW_UNENCRYPTED=1  explicit owner acceptance to upload the plain dump (provider-side encryption only).
#                                Without a recipient AND without this opt-in the script refuses.
#   OFFSITE_VERIFY               download (default: re-download and compare sha256) or size (compare ContentLength only)
#   OFFSITE_REQUIRE_RESTORE_MARKER=1  optional hard gate, default 0 (off): upload only when <dump>.restore-ok exists and
#                                matches the dump's .sha256 (written by ops-restore-check.sh after a successful restore).
#                                With 0 the script only reminds you that a copy counts after a restore-check.
#
# Steps: refuse on missing config -> pick the newest dump -> `sha256sum -c` against its .sha256 (an unverified
# dump is never uploaded) -> [encrypt] -> upload dump + checksum -> verify the uploaded copy -> report.
# Retention is NOT handled here on purpose: a compromised VPS must not be able to delete the off-site copies.
# Use the bucket's lifecycle policy (e.g. expire after N days) and, if the provider offers it, object lock /
# versioning. A copy counts only after ops-restore-check passed on the same dump (OPS-2).
set -eu
umask 077

fail() { echo "ops-offsite-sync: refusing: $1" >&2; exit 1; }

: "${OFFSITE_S3_ENDPOINT:=}"
: "${OFFSITE_S3_BUCKET:=}"
[ -n "$OFFSITE_S3_ENDPOINT" ] || fail "OFFSITE_S3_ENDPOINT is not set (the off-site location is pending infrastructure)."
[ -n "$OFFSITE_S3_BUCKET" ] || fail "OFFSITE_S3_BUCKET is not set (the off-site location is pending infrastructure)."
[ -n "${OFFSITE_S3_ACCESS_KEY_ID:-}" ] && [ -n "${OFFSITE_S3_SECRET_ACCESS_KEY:-}" ] || fail "OFFSITE_S3_ACCESS_KEY_ID / OFFSITE_S3_SECRET_ACCESS_KEY are not set."
case "$OFFSITE_S3_ENDPOINT" in
  https://*) ;;
  http://*) [ "${OFFSITE_ALLOW_HTTP:-}" = "1" ] || fail "OFFSITE_S3_ENDPOINT is http://; the dump would travel unencrypted in transit (OFFSITE_ALLOW_HTTP=1 only for a local rehearsal)." ;;
  *) fail "OFFSITE_S3_ENDPOINT must be an https:// URL." ;;
esac
case "$OFFSITE_S3_ENDPOINT$OFFSITE_S3_BUCKET" in *[[:space:]]*) fail "endpoint and bucket must not contain whitespace." ;; esac
case "$OFFSITE_S3_BUCKET" in *[!A-Za-z0-9._-]*) fail "OFFSITE_S3_BUCKET has characters a bucket name cannot have." ;; esac

prefix="${OFFSITE_S3_PREFIX-salesforce-staging/}"
case "$prefix" in ''|*/) ;; *) prefix="$prefix/" ;; esac
case "$prefix" in *[!A-Za-z0-9._/-]*|/*|*..*) fail "OFFSITE_S3_PREFIX may only contain A-Z a-z 0-9 . _ - / and must be relative." ;; esac
verify_mode="${OFFSITE_VERIFY:-download}"
case "$verify_mode" in download|size) ;; *) fail "OFFSITE_VERIFY must be download or size." ;; esac

recipient="${OFFSITE_AGE_RECIPIENT:-}"
if [ -n "$recipient" ]; then
  case "$recipient" in age1[a-z0-9]*) ;; *) fail "OFFSITE_AGE_RECIPIENT must be an age public key (age1...)." ;; esac
  command -v age > /dev/null 2>&1 || fail "OFFSITE_AGE_RECIPIENT is set but this image has no \`age\` (use an image that provides aws and age, or unset it and accept OFFSITE_ALLOW_UNENCRYPTED=1)."
elif [ "${OFFSITE_ALLOW_UNENCRYPTED:-}" != "1" ]; then
  fail "no OFFSITE_AGE_RECIPIENT and no OFFSITE_ALLOW_UNENCRYPTED=1: the dump contains business data and is not uploaded unencrypted by accident."
fi
command -v aws > /dev/null 2>&1 || fail "the \`aws\` CLI is not available in this image (OFFSITE_IMAGE)."

# Credentials only in the environment of this process (never in arguments, never printed).
AWS_ACCESS_KEY_ID="$OFFSITE_S3_ACCESS_KEY_ID"
AWS_SECRET_ACCESS_KEY="$OFFSITE_S3_SECRET_ACCESS_KEY"
AWS_DEFAULT_REGION="${OFFSITE_S3_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
unset OFFSITE_S3_ACCESS_KEY_ID OFFSITE_S3_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE || true
# Never probe instance metadata; do not let a shared config file change the target; broader S3-compatible support.
AWS_EC2_METADATA_DISABLED=true
AWS_PAGER=""
AWS_REQUEST_CHECKSUM_CALCULATION=when_required
AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
export AWS_EC2_METADATA_DISABLED AWS_PAGER AWS_REQUEST_CHECKSUM_CALCULATION AWS_RESPONSE_CHECKSUM_VALIDATION

s3() { aws --endpoint-url "$OFFSITE_S3_ENDPOINT" "$@"; }

dump="$(ls -1t /backups/sf-staging-*.dump 2>/dev/null | head -n 1 || true)"
[ -n "$dump" ] && [ -f "$dump" ] || fail "no dump found in /backups."
base="$(basename "$dump")"
[ -f "$dump.sha256" ] || fail "$base has no .sha256."
(cd /backups && sha256sum -c "$base.sha256" > /dev/null) || fail "$base does not match its .sha256; not uploaded."

# Optional hard gate (default off): upload only a dump on which ops-restore-check passed. restore-check writes
# <dump>.restore-ok (a copy of the dump's .sha256 line) after a successful restore; here the marker must exist AND
# match the checksum of the dump being uploaded. Anything but 0 or 1 is refused.
gate="${OFFSITE_REQUIRE_RESTORE_MARKER:-0}"
case "$gate" in 0|1) ;; *) fail "OFFSITE_REQUIRE_RESTORE_MARKER must be 0 or 1." ;; esac
if [ "$gate" = "1" ]; then
  [ -f "$dump.restore-ok" ] || fail "OFFSITE_REQUIRE_RESTORE_MARKER=1 and $base has no .restore-ok (run restore-check on this dump first)."
  [ "$(cat "$dump.restore-ok")" = "$(cat "$dump.sha256")" ] || fail "$base.restore-ok does not match the dump's .sha256 (stale marker); run restore-check again."
fi

# Only small files live in $work (checksums, FIFOs): the dump itself is never copied to local storage, so the
# tmpfs of this service stays tiny whatever the dump size. With age the ciphertext is STREAMED to the upload.
work="$(mktemp -d /tmp/sf-offsite.XXXXXX)"
trap 'rm -rf -- "$work"' EXIT
trap 'exit 1' INT TERM

key_sum="${prefix}${base}.sha256"
if [ -n "$recipient" ]; then
  object="$base.age"
  key_payload="${prefix}${object}"
  # Upper bound of the ciphertext (age adds a 16-byte tag per 64 KiB chunk plus a small header); only used by
  # the AWS CLI to size multipart parts of a stream of unknown length.
  plain_size="$(wc -c < "$dump" | tr -d ' ')"
  expected_size=$((plain_size + plain_size / 4096 + 8192))
  # The bytes that are sent are hashed and counted in the same pass (encryption is not reproducible, so it
  # cannot be repeated to compute them afterwards). An age failure must not hide behind a truncated upload.
  mkfifo "$work/sum.fifo" "$work/count.fifo"
  sha256sum < "$work/sum.fifo" | cut -d ' ' -f 1 > "$work/payload.sum" &
  sum_pid=$!
  wc -c < "$work/count.fifo" | tr -d ' ' > "$work/payload.size" &
  count_pid=$!
  { age -r "$recipient" "$dump" || : > "$work/age.failed"; } \
    | tee "$work/sum.fifo" "$work/count.fifo" \
    | s3 s3 cp - "s3://$OFFSITE_S3_BUCKET/$key_payload" --expected-size "$expected_size" --only-show-errors
  wait "$sum_pid" && wait "$count_pid" || fail "could not hash the encrypted stream."
  [ ! -e "$work/age.failed" ] || fail "age failed; delete the partial object $key_payload from the bucket."
  payload_sum="$(cat "$work/payload.sum")"
  payload_size="$(cat "$work/payload.size")"
else
  object="$base"
  key_payload="${prefix}${object}"
  payload_sum="$(cut -d ' ' -f 1 < "$dump.sha256")"
  payload_size="$(wc -c < "$dump" | tr -d ' ')"
  s3 s3 cp "$dump" "s3://$OFFSITE_S3_BUCKET/$key_payload" --only-show-errors
fi
s3 s3 cp "$dump.sha256" "s3://$OFFSITE_S3_BUCKET/$key_sum" --only-show-errors

# Verification of what is actually stored, not of what we sent.
remote_size="$(s3 s3api head-object --bucket "$OFFSITE_S3_BUCKET" --key "$key_payload" --query ContentLength --output text)"
[ "$remote_size" = "$payload_size" ] || fail "uploaded size ($remote_size) differs from the local size ($payload_size)."
if [ "$verify_mode" = "download" ]; then
  remote_sum="$(s3 s3 cp "s3://$OFFSITE_S3_BUCKET/$key_payload" - --only-show-errors | sha256sum | cut -d ' ' -f 1)"
  [ "$remote_sum" = "$payload_sum" ] || fail "the re-downloaded copy of $object does not match its checksum."
  s3 s3 cp "s3://$OFFSITE_S3_BUCKET/$key_sum" "$work/remote.sha256" --only-show-errors
  [ "$(cat "$work/remote.sha256")" = "$(cat "$dump.sha256")" ] || fail "the uploaded .sha256 differs from the local one."
fi

echo "ops-offsite-sync: OK $object ($payload_size bytes, verified by $verify_mode, encrypted: $([ -n "$recipient" ] && echo yes || echo no))"
echo "ops-offsite-sync: reminder: a copy counts as a backup only after ops-restore-check passed on this dump."
