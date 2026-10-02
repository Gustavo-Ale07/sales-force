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

work="$(mktemp -d /tmp/sf-offsite.XXXXXX)"
trap 'rm -rf -- "$work"' EXIT
trap 'exit 1' INT TERM

payload="$dump"
object="$base"
if [ -n "$recipient" ]; then
  age -r "$recipient" -o "$work/$base.age" "$dump"
  payload="$work/$base.age"
  object="$base.age"
fi
payload_sum="$(sha256sum "$payload" | cut -d ' ' -f 1)"
payload_size="$(wc -c < "$payload" | tr -d ' ')"
key_payload="${prefix}${object}"
key_sum="${prefix}${base}.sha256"

s3 s3 cp "$payload" "s3://$OFFSITE_S3_BUCKET/$key_payload" --only-show-errors
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
