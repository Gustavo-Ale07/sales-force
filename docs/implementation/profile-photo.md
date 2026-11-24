# Own profile photo (implementation note)

Status: implementation note, not a decision. Routes: `PUT/DELETE/GET /api/v1/me/photo`; own account only (no route names another account).

## Storage

- Metadata in `account_photo` (one row per account); bytes in the INTERIM filesystem object store (`ACCOUNT_PHOTO_DIR`, volume `account_photos`, writable by the API only). Key: `account-photos/<accountId>/<sha256>`.
- `Dockerfile.server` creates `/var/lib/sales-force/account-photos` owned by `node`, so a fresh named volume inherits that ownership.
- The upload is never stored: it is decoded and re-encoded as a 512 px WebP square (no metadata). GET always answers `image/webp`, `Cache-Control: private, no-cache`, `Vary: Cookie`, ETag (304 on revalidation).

## Limits

- Upload at most 5 MiB, decoded at most 32 MP, rendition at most 512 KiB.
- One change slot per account per 5 s, shared by PUT and DELETE; every attempt (also a failed one) consumes it (429 `rate_limited`). Guards: in-process map (bounded to 10 000 entries, expired entries dropped first) and a database claim under `pg_advisory_xact_lock` that re-reads and bumps `account_photo.updated_at`. An account WITHOUT a row has nothing to bump, so across several API instances only the in-process guard applies to it; with several instances the DB check is what holds once a row exists.
- Renders run one at a time per process; at most 8 may wait (more: 503 `service_unavailable`); a render (wait included) is abandoned after 15 s (503).

## Known gaps

- Orphan objects: if the object is written and the database transaction fails, or the old object delete fails, an unreferenced object stays (logged, never served). No sweeper exists.
- Account deletion: the order must be row first, then objects of the prefix `account-photos/<accountId>/`; no account-deletion flow exists yet, so nothing deletes them today.
- Backup of the `account_photos` volume (not in the PostgreSQL dump or PITR; the media backup script covers only product media): NEEDS VALIDATION, together with the S3-compatible store choice (V-05, STACK-7).

## ERP write (spike S1.8) - implemented, CLOSED by default

Flow: `PUT /me/photo` -> JPEG derived from the stored WebP (flattened on white, quality 88, at most 512 KiB) -> row in `integration_outbox` (`aggregate_type` `account_photo`, `operation` `profile_photo.write`, `origin_id` `photo:<accountId>:<photoVersion>`) in the SAME transaction as the photo change, with the ERP user already resolved -> worker sweep (5 s, no pg-boss queue; the outbox row is the record) -> `SankhyaGateway.writeUserPhoto` -> `TSIUSU.FOTO`. Only the worker talks to Sankhya (STACK-2/6). Flag closed = nothing is queued and nothing changes.

- Two flags, both default closed. API: `ERP_PROFILE_PHOTO_ENQUEUE_ENABLED` (staging or a local non-production run only; the API env may never hold `SANKHYA*` names). Worker: `SANKHYA_PROFILE_PHOTO_WRITE_ENABLED`, accepted only with staging + live + Sandbox + an allow-listed Sandbox host (SNK-3, SNK-6); otherwise startup fails. `deploy/docker-compose.staging.yml` sets the worker flag to `false`.
- ERP user: `account.external_user_id` (numeric) first, else the ONE non-deleted `erp_directory_user` of the account's seller link (CFG-2). None or more than one = permanent rejection (`photo_no_erp_user`, `photo_ambiguous_erp_user`), never guessed. Resolved by the API, so the worker role needs no new grant.
- Idempotent per account + photoVersion (unique `origin_id`). The write sets a state, so a repeat is harmless; what is guarded is order: a version with a newer one queued is rejected `photo_superseded`, so a late retry never overwrites a newer photo.
- Failures follow the shared order policy: transient/rate-limit retried with backoff (8 attempts), authentication retried without consuming attempts, validation/permanent rejected, never retried blindly. The image is removed from the outbox payload on confirm or reject. Audit: `account.photo_erp_written`, `account.photo_erp_rejected`.
- `DELETE /me/photo` is NOT propagated to the ERP.
- `.env.example` placeholders (`ERP_PROFILE_PHOTO_ENQUEUE_ENABLED=false`, `SANKHYA_PROFILE_PHOTO_WRITE_ENABLED=false`) still have to be added by the owner (the file is write-protected for agents).

How the owner opens and tests it (only the owner, only the Sandbox, only with the account "sup", which needs `external_user_id` or a seller link to exactly one ERP user): set both flags to `true` on staging (the worker also needs the Sandbox settings), upload a photo, wait one sweep, check the outbox row (`status = 'confirmed'`) and verify `TSIUSU.FOTO` of that user by SELECT. Close both flags afterwards.

NEEDS VALIDATION (S1.8): the write wire (`CRUDServiceProvider.saveRecord` on entity `Usuario`, base64 BLOB encoding) is not confirmed against the Sandbox; permission of the API user to write `TSIUSU`; size limit and refusal text; `ACCOUNTNOMEFOTO` (could not be read, never filled).
