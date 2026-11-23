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
