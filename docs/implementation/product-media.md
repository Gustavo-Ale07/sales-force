# Product photos: server pipeline

Status: implemented in `apps/server`, verified only against the fake gateway. No real Sankhya read was made, nothing is deployed. Working notes, not a decision record.

## Flow

Sankhya -> worker (read port only) -> object store -> `product_media` metadata -> `StoredProductImageSource` in the API -> `GET /api/v1/products/{code}/image` -> web/mobile.

- The API never calls Sankhya and holds no Sankhya setting (STACK-2/3). It reads PostgreSQL and the object store.
- Photos are never in Git, in a Docker image, in `apps/web/public` or in an ephemeral container filesystem. They live in a persistent volume mounted at `PRODUCT_MEDIA_DIR`.
- The product mirror sync (`PRODUCT_SPEC` / `readProducts`) is unchanged and still does not select the image column. Photos use the separate gateway media port (`readProductMediaSignatures`, `readProductMediaBytes`).

## OWNER DECISION NEEDED: interim filesystem store

P-17 and STACK-7 require blobs in managed, private, S3-compatible object storage (provider undecided, V-05). Until it is chosen the code uses `FilesystemObjectStore` behind the `ObjectStore` port (`put`, `get`, `has`, `delete`). It is an INTERIM adapter:

- single host, no replication, no PITR; the volume is in the host backup scope only if the host backup covers it;
- it does not satisfy STACK-7 (S3-compatible, managed, per environment). Replacing it means writing an S3 adapter for the same port (needs an S3 client dependency, which was not added) and copying the objects (keys are stable: `product-images/<code>/<sha256>`).

This is not recorded in `docs/decisions.md`; the owner must accept or reject it as a temporary measure.

## Worker behavior (`ProductMediaSyncService`)

1. Lists signatures (`productCode`, `byteLength`, `fingerprint`) page by page, ascending by code, with the same read scope as the mirror. With a live gateway and no scope the run refuses (fail closed).
2. Compares with `product_media`. Unchanged signature: no download. New or changed: download, validate (`inspectImage`: png/jpeg/webp magic bytes, structural integrity, size cap), hash (sha256), store at `product-images/<code>/<sha256>`, upsert the row, then delete the superseded object.
3. Announced size above `PRODUCT_MEDIA_MAX_BYTES`: recorded as `media_too_large` without downloading.
4. Failures per product never stop the run. The previous object (if any) keeps being served.
   - Permanent (not retried until the source signature changes or `--force-verify`): `empty`, `oversize`, `unsupported_type`, `corrupt`, `media_too_large`, `gateway_permanent`, `gateway_validation`, `source_unavailable`.
   - Size refusals (`oversize`, `media_too_large`) are also retried, without a source change, as soon as the announced size fits the configured `PRODUCT_MEDIA_MAX_BYTES` again: raising the cap re-examines them on the next run.
   - Transient (retried every run): `media_changed_during_read`, `gateway_temporary`, `gateway_unavailable`.
   - ERP unavailable for one product (no starvation): the failure is held back during the run. If any other download succeeds in the same run, the source is proved up and the held products are recorded `gateway_unavailable` with a consecutive-run count; at `PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT` (default 3) the product is parked as `source_unavailable`. If no download succeeded, or `PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT` unavailable downloads happen in a row, the run aborts as a retryable outage and nothing is recorded per product. Limit: a lone failing product with nothing else to download in that run cannot be told from an outage, so it is never parked and the run keeps failing (retryable) until it changes or the source recovers. Rate limit and rejected credentials always abort the run.
5. Run-level failures abort the run, are recorded in `sync_state` (`worker.product-media`, reserved prefix, hidden from integration summaries) and rethrown so pg-boss retries only retryable classes: gateway unavailable, rate limit, object store unavailable, cancellation. Auth and permanent errors are not retried.
6. A PostgreSQL advisory lock (namespace `SFPM`) makes a second concurrent run skip.
7. `verifyObjects` (default on): an unchanged product whose object is gone from the store is downloaded and stored again; it is counted as `repaired` also under `--force-verify`.
8. Only a LIVE gateway is stored. A fake gateway is refused before anything is read or recorded (permanent, not retried) unless `PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY=true`, which in production is honoured only together with `ALLOW_FAKE_GATEWAY=1`. Switching gateway mode (fake to live) needs the `product_media` rows and the volume reset first.

### Known behaviors

- Replacing a photo: the row changes first, then the superseded object is deleted; a request that read the old row in that instant can answer a transient 503 (the client retries).
- `PRODUCT_MEDIA_SYNC_CONCURRENCY` above 1 has no effect against the real gateway while ERP reads are serialized (spike S0.2); it only parallelizes against the fake.
- Bytes after the end marker of a PNG (IEND) or JPEG (EOI) are rejected as `corrupt`. Review the failed-by-reason counts of the first real run before concluding anything about the catalog.
- Stale `.tmp/` staging files left by a crash are not swept automatically.
- At startup the API warns (it does not fail) when `product_media` has stored photos but the directory is missing or empty (volume not mounted).
- Image responses carry `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-site` and `nosniff`. The object read checks the size on disk against the recorded `byte_length` before loading it.

### Residual risk of the fingerprint

The fingerprint is sha256 over the length and four sampled 32-byte windows. A same-length edit that misses every window is not detected by the cheap pass. Mitigation: `--force-verify` downloads every image and compares the hash. A Sankhya modification-timestamp column would close this and is NEEDS VALIDATION (S1.7). Do not read it as proof that every change is seen.

### Known hardening (not done, future)

- `FilesystemObjectStore` does not refuse a symbolic link planted inside the photo directory. The directory is writable only by the worker/bootstrap runtime, so this is LOW; harden (`lstat`/`O_NOFOLLOW`) together with the move to S3-compatible storage.

### Pruning and orphans

- Without `--prune`, rows of products no longer listed (or out of scope) are left alone and keep being served.
- `--prune` needs the complete listing (refused with `--limit`) from a LIVE gateway (refused otherwise): it deletes the row, then the object. Safety rules: an empty listing is never pruned (not even with `--allow-large-prune`); a prune that would remove more than half of the stored rows is refused unless `--allow-large-prune`. A refused prune still lets the run's own photo work stand (recorded as succeeded) and exits with a failure; a `--dry-run --prune` prints the candidates and any refusal without failing.
- Objects not referenced by any row (for example after a database failure between `put` and the upsert) are harmless and not swept automatically.

### Thumbnail

**Decision (APPROVED 2026-10-06, `decisions.md` MEDIA-1):** every stored photo gets a real thumbnail made by the worker with `sharp` (exact pin `0.35.5`, `apps/server` only; prebuilt `@img/sharp-*` binaries, no install scripts, build scripts stay disabled). Reason: the Sandbox probe found 457 of 1651 originals above 256 KiB (max 3.9 MB, about 391 MiB in total), so the former "serve the original if small" thumb was 404 for them. There is no "reuse the original if small" branch.

- Rendition: longest side 256 px, `fit: inside`, no enlargement, EXIF orientation applied, all metadata dropped, WebP quality 80, alpha kept. Output above 256 KiB is refused.
- Limits (`SharpThumbnailRenderer`): `sharp.cache(false)`, `sharp.concurrency(1)`, input limit **32 megapixels** (the largest catalog file measured is 3.9 MB, a 12-24 MP photo decodes below it), `failOn: 'error'`, animated input refused (`animated`). After `metadata()` the format must be jpeg, png or webp (libvips also decodes GIF, TIFF, SVG...: anything else is refused as `unsupported_format`). Renders are **serialized process-wide behind a semaphore of 1**, whatever `PRODUCT_MEDIA_SYNC_CONCURRENCY` is, so memory is bounded by one decoded raster. The renderer sits behind the `ThumbnailRenderer` port.
- Storage key: `product-thumbnails/<code>/<sha256 of the thumbnail bytes>`, in the same store as `product-images/`. Columns `thumbnail_*` of `product_media` (migration 0010) hold key, hash, size, content type; the database allows a thumbnail only for `status = 'stored'`.
- Order in the worker: the original is stored first, then rendered from the in-memory bytes, then the row is upserted with both. A renderer failure never loses the original: the product stays `stored`, the thumbnail columns stay NULL, the reason is recorded in `failure_reason` and counted in `thumbnailFailed`.
- Idempotent: a stored product with a verified thumbnail is not read nor rendered again (counted `unchanged` and `thumbnailsReused`). Backfill: a legacy row (original stored, thumbnail NULL) is rendered from the stored original with NO Sankhya byte call; the original is read bounded by its RECORDED size (not by the current `PRODUCT_MEDIA_MAX_BYTES`) and re-hashed first. If the stored original is missing or fails its hash, the product is downloaded again; the old object is **never deleted before the replacement is downloaded, validated and stored** (the download overwrites it; if the download fails, e.g. the cap was lowered, the object stays exactly as it was and the failure is recorded on the row). Repair (with `verifyObjects`): the thumbnail check is a CONTENT check, not only existence: an object that is missing, has another size, or whose sha256 differs from the recorded hash is deleted and re-rendered from the original, counted `repaired`.
- Counters: a forced verify of a legacy row (no thumbnail) is a backfill (`thumbnailsGenerated`, not `unchanged`, not `repaired`); `repaired` means a thumbnail or original that was recorded but damaged or gone.
- Failure reasons (stored in `failure_reason`, stable codes, never the native message): permanent for this original, **parked** while its `content_hash` is unchanged: `decode_failed`, `animated`, `too_many_pixels`, `unsupported_format`, `thumbnail_too_large` (output above 256 KiB). A parked product is skipped (`skippedPermanent`, no render, no log, `failure_count` does not grow) and retried only with `--force-verify` or when the original changes (new signature/hash). Retried on every run (per product, so no starvation): `thumbnail_failed` (unexpected renderer error, empty or invalid output). Changing the renderer or its limits therefore needs a `--force-verify` run to retry parked products.
- API: `variant=thumb` (the default) is served ONLY from the generated rendition, with its own content type (`image/webp`), size and ETag; it answers 404 while the thumbnail is NULL. `variant=full` serves the original. `PRODUCT_MEDIA_THUMB_MAX_BYTES` now only bounds the generated thumbnail the API reads (default 262144; keep it >= 256 KiB).
- `version` (DTO field and `&v=` cache key): the original content hash while there is no thumbnail; once there is one, `sha256(<originalHash>|<thumbnailHash>)` as hex (`mediaVersion`). It therefore changes when either rendition changes, and the step from "no thumbnail" to "thumbnail" changes it too, so clients refetch images that were 404. **Every product's version changes once, at the first backfill** (and, for products whose thumbnail later fails and is dropped, back to the original hash). The ETag of both variants derives from this combined version (variant-qualified): re-rendering only the thumbnail also revalidates the full image, a harmless extra conditional request that answers 304 or one re-download. The response shape of the contract is unchanged.
- First backfill: because every version changes once, run it **off hours and in batches** (`--limit N` nightly, e.g. 200-400 products per night, then the complete run) so clients do not all refetch at the same time on the first morning; a partial `--limit` run never prunes.
- **Web and mobile have NO full-image fallback after a thumbnail failure.** `variant=thumb` answers 404 while the thumbnail is NULL (never the original). The previous web behavior (retry with the full image) is removed by a separate frontend change that follows; until it lands the web client may still request `variant=full` on a thumb error, and the mobile client shows its placeholder and never retries. Do not read the API's `thumb` 404 as a defect of a stored photo.
- Accepted behaviors and limits: (1) a failed REFRESH (the source turned invalid or unavailable) goes through `recordFailure`, which drops the thumbnail columns (the schema allows them only on a `stored` row); the original stays described by the row and keeps being served (`thumb` answers 404 for that product, `full` works) until the next successful download renders a thumbnail again; accepted. (2) There is no garbage collection of objects: a superseded original or thumbnail whose delete failed, objects of a refresh that dropped the thumbnail record, and objects written before a failed upsert stay as orphans in the store (harmless, never referenced). They are included in the media backup. An orphan sweep (list objects, compare with the rows) is a FUTURE task, not implemented. (3) A failed row that still references a damaged original is not re-written by a later successful download of the same content while object verification is off.
- Counters (bootstrap output, `sync_state` last run): `thumbnailsGenerated`, `thumbnailsReused`, `thumbnailFailed`, `thumbnailBytes`. `--dry-run` reports what would be generated and writes nothing.
- Performance estimate (an estimate, not measured on real photos): decoding a JPEG with shrink-on-load and encoding a 256 px WebP is typically 30-150 ms for a multi-megapixel photo with `concurrency(1)`; 1651 images are roughly 1 to 4 minutes of CPU on a small VPS, plus the 391 MiB download from the ERP (about 5 s per 1700 listing entries; bytes are the larger cost). Thumbnails total roughly 5-20 KiB each (about 10-35 MiB for the catalog). Measure on the first real run.
- Memory: one original (up to `PRODUCT_MEDIA_MAX_BYTES`, 5 MiB) per concurrent download, but only ONE decoded raster at a time (renders are serialized, 32 MP limit: at most about 128 MB RGBA at the limit); keep the worker memory limit in mind.

First-run checklist (staging, after deploy approval; nothing here was run against a real environment):
1. Confirm migration 0010 applied and the image contains sharp (`@img/sharp-linuxmusl-x64`).
2. `start:product-media-bootstrap --dry-run`, then `--limit 20`, then the full run; check `thumbnailsGenerated`, `thumbnailFailed` (expect near 0) and `thumbnailBytes`.
3. Request `thumbnailUrl` of one product: `image/webp`, at most 256 KiB, long cache headers; request `?variant=full` for the original.
4. Take a media backup (both prefixes), verify and test-restore it.
5. Only then set `PRODUCT_MEDIA_SYNC_ENABLED=true`.

## API side (`StoredProductImageSource`)

`versions` is one batched query returning the cache version (`sha256(<originalHash>|<thumbnailHash>)`, or the original hash while no thumbnail exists), the source of the variant-qualified ETag. `getImage` reads the object and verifies its sha256 against the row; a missing object or a mismatch raises, and the API answers 503 and logs. A row without a servable object answers 404. The object key comes only from the database row, never from the client.

## Configuration

Worker (`loadWorkerConfig`, fail fast):

| Variable | Default | Notes |
|---|---|---|
| `PRODUCT_MEDIA_SYNC_ENABLED` | `false` | `true`/`false`. Off: no handler, no schedule, a stored schedule is dropped. |
| `PRODUCT_MEDIA_DIR` | none | Absolute path; required when enabled. |
| `PRODUCT_MEDIA_MAX_BYTES` | 5242880 | 1024..20 MiB. |
| `PRODUCT_MEDIA_SYNC_CRON` | `30 3 * * *` | Frequency is PROPOSED, not decided. |
| `PRODUCT_MEDIA_SYNC_CONCURRENCY` | 2 | 1..8 simultaneous downloads. |
| `PRODUCT_MEDIA_VERIFY_OBJECTS` | `true` | Re-store missing objects. |
| `PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY` | `false` | Store the fake gateway's synthetic images (dev/tests). In production only with `ALLOW_FAKE_GATEWAY=1`. |
| `PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT` | 3 | 1..20 consecutive runs a product may fail with the ERP unavailable before it is parked (`source_unavailable`); also the streak that aborts a run. |

API: `PRODUCT_MEDIA_DIR` (unset = no product has an image), `PRODUCT_MEDIA_MAX_BYTES` (5 MiB), `PRODUCT_MEDIA_THUMB_MAX_BYTES` (262144; the largest GENERATED thumbnail the API serves, no longer a cut on originals; the minimum accepted is 262144, the renderer's own output bound, a lower value fails at startup). Keep `PRODUCT_MEDIA_MAX_BYTES` equal on both sides.

## Compose and image

- `deploy/Dockerfile.server` creates `/var/lib/sales-force/product-media` owned by `node` (empty).
- `deploy/docker-compose.staging.yml` and `docker-compose.dev.yml`: named volume `product_media`, read-write on the worker, read-only on the API. The worker root filesystem stays read-only; this volume and `/tmp` are its only writable paths. Nothing is applied by this change; only `docker compose config` was run.
- The volume must be added to the backup scope by whoever runs the host. A backup counts only after a tested restore (OPS-2).

## Runbook (nothing below was run against any real environment)

1. Initial load: run `product-media:bootstrap` (dev) or `start:product-media-bootstrap` (built image) with `--dry-run` first, then a bounded `--limit` (or an explicit `--codprod`, below), then the full run. Options: `--limit N`, `--codprod CODE[,CODE...]`, `--concurrency 1..16`, `--dry-run`, `--force-verify`, `--prune [--allow-large-prune]` (not with `--limit`; live gateway only). It needs `PRODUCT_MEDIA_DIR`, not `PRODUCT_MEDIA_SYNC_ENABLED`. Exit code 1 on a run-level failure, 2 on bad arguments.
   **Targeted run (`--codprod`).** `--codprod 15` or `--codprod 15,16` (repeatable) processes exactly those products and nothing else, so specific products (for example the first staging validation set) can be loaded deterministically instead of raising `--limit`. Rules: positive integers only (anything else is refused before the database is opened; no text reaches SQL), at most 50 distinct codes, duplicates ignored. Each code is looked up with the gateway's scoped keyset read (`afterCode = code - 1`, one product), so the product read scope applies: a code the scoped listing does not return is reported as `missing` and nothing is downloaded for it. Precedence/compatibility: `--codprod` is **mutually exclusive with `--limit`** and with `--prune` (a partial run never prunes and never marks the catalog as fully reconciled); it combines with `--dry-run`, `--force-verify` and `--concurrency`. It is idempotent: a repeat run with unchanged signatures downloads nothing.
2. Enable the schedule only afterwards: `PRODUCT_MEDIA_SYNC_ENABLED=true` and restart the worker. The queue `media.products` is always created by `queue:install`.
3. Observe: `sync_state` row `worker.product-media` (status, `cursor.lastRun.stats`, `rowCount`), and `product_media.status = 'failed'` rows with `failure_reason`.
4. Against a real Sankhya: only the non-production environment, per SNK-3, after the spike questions on the media read are validated. No production probe without owner authorization.

## Tests

`object-store`, `bootstrap-args`, `media-env` and `thumbnail-renderer` (real sharp, generated images) unit tests; integration: `product-media-sync` (service against the fake gateway and a real PostgreSQL), `stored-product-image` (API, headers, 304, thumb, 503, 404), `product-media-job` (queue registration, schedule, job execution).

## Backup, verify and restore of the `product_media` volume (STAGING INTERIM ONLY)

> **STAGING INTERIM ONLY.** Filesystem storage is accepted temporarily for staging. It is NOT the definitive production storage: the P-17 / STACK-7 pendency (managed, private, S3-compatible object storage, provider V-05) stays OPEN. The volume is NOT covered by the PostgreSQL dump or PITR (OPS-2), and this procedure meets neither RPO <= 15 min nor RTO <= 4 h. It is a manual or cron-driven file copy, nothing more. Not for production.

Script: `deploy/staging/ops-media-backup.sh` (bash on the host as the deploy user; tar, gzip, sha256sum; Docker only for `--volume` / `--to-volume`). No database access, no network, no new dependency. Image bytes are never printed.

```sh
# Back up (volume mounted read-only in a throwaway alpine container; or --dir <path> for a plain directory)
deploy/staging/ops-media-backup.sh backup --volume <compose-project>_product_media --out /srv/sf/media-backups
# Verify (re-hashes every object; also checks the .sha256 beside the archive)
deploy/staging/ops-media-backup.sh verify /srv/sf/media-backups/sf-staging-media-<UTC>.tar.gz
# Restore (verifies first; refuses a non-empty target)
deploy/staging/ops-media-backup.sh restore <archive> --to-volume <compose-project>_product_media   # or --to <dir>
```

- The real volume name carries the compose project prefix: `docker volume ls | grep product_media`.
- Archive: `MANIFEST.tsv` (sha256, size, relative path; sorted) + `data/`. Beside it: `<archive>.sha256` and `<archive>.manifest.tsv`. `.tmp/` staging leftovers are skipped.
- `verify` checks, per object: the path is exactly `product-images/<code>/<sha256>` or `product-thumbnails/<code>/<sha256>`, sha256(content) equals the file name and the manifest, the size matches; no object outside the manifest; no unsafe or link members. It reports object count and bytes and exits non-zero on any failure. `backup` itself refuses a store that contains a non-conforming file or a name/content mismatch.
- `restore` never overwrites. A non-empty target is refused; `--allow-non-empty` only adds missing objects and aborts, writing nothing, if any object already exists. Restoring into a volume runs as root in the helper: afterwards align ownership with the worker user (`chown -R` to the uid the worker image runs as, from a throwaway container) before starting the worker; confirm the API (read-only mount) can read it.
- Where to store: copy the archive and its `.sha256` OFF the VPS (same destination class as the DB dump, which `ops-offsite-sync.sh` handles for dumps only; it does not copy photo archives). Back up after each product-media sync that changed photos and before any host rebuild; there is no scheduler in this repository for it.
- A backup counts only after `verify` passed and a test restore into a scratch directory/volume succeeded.
- Self-test (no Docker): `bash deploy/scripts/test-ops-media-backup.sh`. The `--volume` / `--to-volume` paths need Docker and were not exercised in that test.

### Cross-check against the database (operator runs it; the script does not connect)

After a restore, or periodically, compare rows with the manifest. Run in `psql` against staging (read-only role):

```sql
-- \copy (...) to 'rows.tsv'  -> compare with MANIFEST.tsv: storage_key = product-images/<code>/<hash>
-- (thumbnails: thumbnail_storage_key, thumbnail_content_hash, thumbnail_byte_length, same comparison), byte_length = manifest size, content_hash = manifest sha256.
SELECT content_hash, byte_length, storage_key FROM product_media ORDER BY storage_key;
```

Rows without an object, or objects without a row, show up in `diff <(cut -f1-3 MANIFEST.tsv | ...) rows.tsv` after normalizing column order to hash, size, key. Orphan objects are harmless (see Pruning); a row without an object is repaired by the next worker run with `verifyObjects` on.

## Measured on the Sandbox (2026-10-05, owner-run read-only protocol probe)

Same SQL as the adapter, run by a probe in the staging worker environment (not by the new code, which is not deployed there yet; see `sankhya-spike.md` F-55). Scope `USOPROD IN ('V','R')`, active: 1,689 products, 1,651 with a photo; 17 pages of 100 in 5.3 s; announced total 410,094,842 bytes (about 391 MiB); min 12,336, max 3,913,336 bytes; none above 5 MiB (`PRODUCT_MEDIA_MAX_BYTES` is sufficient); **457 above 256 KiB**.

### Thumbnail gap (addressed by the worker rendition, see "Thumbnail")

Without a resizer, `variant=thumb` answered 404 for the 457 originals above 256 KiB (web retried with the full image, up to 3.9 MB for a 40 px box; mobile showed the placeholder and never retried). The worker rendition replaces that: each photo has a generated 256 px WebP. Until the first run generates them, thumb is 404 for every product (version changes afterwards, so clients refetch).
