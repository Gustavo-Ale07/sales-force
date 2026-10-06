import { createHash } from 'node:crypto';
import { syncState, type DbHandle } from '@salesforce/db';
import {
  isSankhyaGatewayError,
  type GatewayDescription,
  type ProductMediaSignature,
  type ReadScope,
  type SankhyaGatewayError,
  type SankhyaProductMediaPort,
} from '@salesforce/sankhya';
import { inspectImage, type ImageContentType } from '../catalog/product-image.js';
import { errorLogFields, type Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import { withAdvisoryLock } from '../sync/entity-lock.js';
import { describeSyncFailure } from '../sync/failure.js';
import { MirrorScopeUnavailableError } from '../sync/mirror-scope.js';
import { PermanentJobError, TransientJobError } from '../worker/job-contract.js';
import { isObjectStoreError, type ObjectStore } from './object-store.js';
import {
  countServable,
  deleteRow,
  listAllKeys,
  loadMediaRows,
  markThumbnailFailed,
  recordFailure,
  setThumbnail,
  thumbnailOf,
  touchAttempt,
  upsertStored,
  type MediaFailureReason,
  type ProductMediaRow,
  type ThumbnailRecord,
} from './product-media.repository.js';
import {
  isThumbnailRenderError,
  THUMBNAIL_MAX_BYTES,
  type ThumbnailRenderErrorCode,
  type ThumbnailRenderer,
} from './thumbnail-renderer.js';

/** `sync_state.entity` of the photo pipeline. The `worker.` prefix is reserved: the mirror summary ignores it. */
export const PRODUCT_MEDIA_ENTITY = 'worker.product-media';

/** First advisory-lock key of the photo pipeline (`SFPM`); the mirror sync uses `SFMS`. */
export const PRODUCT_MEDIA_LOCK_NAMESPACE = 0x5346504d;
const PRODUCT_MEDIA_LOCK_OBJECT = 1;

/** A prune that would remove more than this share of the stored rows needs `allowLargePrune`. */
const LARGE_PRUNE_RATIO = 0.5;

/**
 * What the photo sync may call: the media read port only (the signature list and the bytes of one
 * product). No order or partner write exists here (SNK-4, SNK-6).
 */
export type MediaGateway = SankhyaProductMediaPort & { describe(): GatewayDescription };

export interface ProductMediaSettings {
  /** Largest image stored (and downloaded). Bigger announced sizes are refused WITHOUT downloading. */
  readonly maxBytes: number;
  /** Confirm that the object of an unchanged product still exists, and re-store it when it does not. */
  readonly verifyObjects: boolean;
  /** Signatures per page (1..200). */
  readonly pageSize: number;
  /** Default number of simultaneous downloads. */
  readonly concurrency: number;
  /**
   * Only a LIVE gateway's images are stored. The synthetic fake gateway needs this explicit opt-in
   * (PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY), so fake images never reach a persistent volume by omission.
   */
  readonly allowFakeGateway: boolean;
  /**
   * Runs in a row a product may fail with the ERP unavailable (while other products succeed) before it is
   * parked as `source_unavailable` until its signature changes or a forced verification. Also the number of
   * consecutive unavailable products that proves a whole-source outage and aborts the run.
   */
  readonly sourceFailureLimit: number;
}

export interface ProductMediaSyncDeps {
  readonly db: DbHandle;
  readonly gateway: MediaGateway;
  readonly store: ObjectStore;
  /** Renders the one thumbnail of every stored original (sharp in production; injectable for tests). */
  readonly renderer: ThumbnailRenderer;
  readonly logger: Logger;
  readonly now: Clock;
  /** Same scope rule as the mirror (`loadCurrentReadScope`); absent = unscoped (fake/demo and tests). */
  readonly readScope?: () => Promise<ReadScope>;
  readonly settings: ProductMediaSettings;
}

export interface ProductMediaRunOptions {
  /** Examine at most this many products (a partial run: never prunes). */
  readonly limit?: number;
  /**
   * Targeted run: examine exactly these products (positive integers, at most MAX_TARGETED_CODES, duplicates ignored)
   * instead of walking the listing. Each code is looked up with the gateway's own scoped keyset read
   * (`afterCode = code - 1`, `limit 1`) and accepted only when the returned code is exactly the requested one, so a
   * product outside the read scope or absent from the ERP is reported in `missingCodes`, never processed. A partial
   * run: never prunes, never marks the catalog fully reconciled, and cannot be combined with `limit`.
   */
  readonly productCodes?: readonly number[];
  readonly concurrency?: number;
  /** Read and compare only: nothing is downloaded, stored, deleted or recorded. */
  readonly dryRun?: boolean;
  /** Download every listed image and compare its hash, even when its signature did not change (residual-risk escape hatch). */
  readonly forceVerify?: boolean;
  /** After a COMPLETE listing from a LIVE gateway, delete the rows and objects of products that are no longer listed. */
  readonly prune?: boolean;
  /** Let a prune remove more than half of the stored rows. Never allows pruning an empty listing. */
  readonly allowLargePrune?: boolean;
  readonly signal?: AbortSignal;
}

export interface ProductMediaStats {
  examined: number;
  /** First object of the product. */
  created: number;
  /** A different image replaced the previous one. */
  updated: number;
  unchanged: number;
  /** The stored original, or its thumbnail object, had gone missing and was written again. */
  repaired: number;
  /** Failures recorded per product (the run itself continued). */
  failed: number;
  /** Known permanent failure whose source did not change: not retried. */
  skippedPermanent: number;
  pruned: number;
  /** Dry run only: images a real run would download. */
  wouldDownload: number;
  /** Thumbnails rendered and stored (new, changed original, legacy backfill, repair). */
  thumbnailsGenerated: number;
  /** Thumbnails verified present and kept (an unchanged original is never re-rendered). */
  thumbnailsReused: number;
  /** Renderings that failed (the original stays stored and served; retried next run). */
  thumbnailFailed: number;
  /** Total bytes of the thumbnails stored by this run. */
  thumbnailBytes: number;
  /** Dry run only: thumbnails a real run would render. */
  wouldGenerateThumbnails: number;
}

export interface ProductMediaPruneReport {
  /** Rows that the listing no longer contains. */
  readonly candidates: number;
  /** Rows stored before the prune. */
  readonly total: number;
  /** Why the prune was (or, in a dry run, would be) refused; null = it is allowed. */
  readonly refusal: string | null;
}

export interface ProductMediaRunResult {
  readonly outcome: 'completed' | 'skipped_locked';
  readonly dryRun: boolean;
  /** The whole listing was read (no `limit` cut it short). */
  readonly complete: boolean;
  readonly stats: ProductMediaStats | null;
  /** Present only when `prune` was requested. */
  readonly prune: ProductMediaPruneReport | null;
  /** Targeted run only: requested codes the scoped listing did not return (absent, inactive or out of scope). */
  readonly missingCodes?: readonly number[];
}

/** Upper bound of a targeted run: an explicit pilot list, not a way to walk the catalog. */
export const MAX_TARGETED_CODES = 50;

/** An operator-requested prune was refused by a safety rule. The photos of the run itself were processed normally. */
export class PruneRefusedError extends PermanentJobError {
  constructor(message: string) {
    super(message);
    this.name = 'PruneRefusedError';
  }
}

/** Failure reasons that cannot get better by repeating the download: retried only when the source changes. */
const PERMANENT_REASONS: ReadonlySet<string> = new Set([
  'empty',
  'oversize',
  'unsupported_type',
  'corrupt',
  'media_too_large',
  'gateway_permanent',
  'gateway_validation',
  'source_unavailable',
]);

/**
 * Thumbnail failures that repeating the render cannot fix: they are parked while the stored original is unchanged
 * (same `content_hash`) and retried only on `forceVerify` or when the original changes. Any other thumbnail failure
 * (`thumbnail_failed`: unexpected, empty or invalid output) is retried every run.
 */
const PERMANENT_THUMBNAIL_REASONS: ReadonlySet<string> = new Set([
  'decode_failed',
  'animated',
  'too_many_pixels',
  'unsupported_format',
  'thumbnail_too_large',
]);

/** Stable stored reason of a renderer error code (never the native message). */
function thumbnailReasonOf(code: ThumbnailRenderErrorCode): string {
  switch (code) {
    case 'decode_failed':
    case 'animated':
    case 'too_many_pixels':
    case 'unsupported_format':
      return code;
    case 'output_too_large':
      return 'thumbnail_too_large';
    case 'empty_output':
      return 'thumbnail_failed';
  }
}

/** Refusals that depend only on the configured size cap: a larger cap makes them retryable. */
const SIZE_REASONS: ReadonlySet<string> = new Set(['oversize', 'media_too_large']);

const REASON_UNAVAILABLE = 'gateway_unavailable';
const REASON_PARKED = 'source_unavailable';

const MAX_CONCURRENCY = 16;

function emptyStats(): ProductMediaStats {
  return {
    examined: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    repaired: 0,
    failed: 0,
    skippedPermanent: 0,
    pruned: 0,
    wouldDownload: 0,
    thumbnailsGenerated: 0,
    thumbnailsReused: 0,
    thumbnailFailed: 0,
    thumbnailBytes: 0,
    wouldGenerateThumbnails: 0,
  };
}

type Decision = 'unchanged' | 'skip_permanent' | 'download' | 'repair' | 'thumbnail';

/** Per-run bookkeeping of the products the ERP could not serve (see `sourceFailureLimit`). */
interface RunState {
  /** Unavailable failures held back until the run proves the source is up (a later download succeeded). */
  readonly pending: { signature: ProductMediaSignature; row: ProductMediaRow | undefined; error: SankhyaGatewayError }[];
  streak: number;
  sourceProved: boolean;
}

/**
 * Product photo synchronization (worker only). Per run: lists the products that have a photo in the ERP
 * with a cheap signature (length + sampled fingerprint, no image transfer), downloads only the new or
 * changed ones, validates the bytes (png/jpeg/webp, structurally whole, size cap), stores them
 * content-addressed in the object store and records the metadata in `product_media`.
 *
 * - Read only towards the ERP; the API never calls it (the API reads what this stores).
 * - Only a live gateway is stored unless the fake gateway is explicitly allowed (`allowFakeGateway`).
 * - Safe to repeat and to run next to a second runner: a PostgreSQL advisory lock makes the loser skip.
 * - A product that fails never stops the others. Run-level conditions (signature listing failing, rejected
 *   credentials, rate limit, object store down, cancellation, a whole-source outage) abort the run; the job
 *   runner retries the retryable ones.
 * - A failed refresh never removes the previously stored photo: it keeps being served.
 */
export class ProductMediaSyncService {
  constructor(private readonly deps: ProductMediaSyncDeps) {}

  async run(options: ProductMediaRunOptions = {}): Promise<ProductMediaRunResult> {
    const { limit, concurrency } = options;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new RangeError('limit must be a positive integer');
    if (concurrency !== undefined && (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY)) {
      throw new RangeError(`concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
    }
    if (options.prune === true && limit !== undefined) {
      throw new RangeError('prune needs the complete listing: it cannot be combined with a limit');
    }
    if (options.productCodes !== undefined) {
      const codes = options.productCodes;
      if (codes.length < 1 || codes.length > MAX_TARGETED_CODES || !codes.every((code) => Number.isSafeInteger(code) && code >= 1)) {
        throw new RangeError(`productCodes must hold 1..${MAX_TARGETED_CODES} positive integers`);
      }
      if (limit !== undefined) throw new RangeError('productCodes cannot be combined with a limit');
      if (options.prune === true) throw new RangeError('prune needs the complete listing: it cannot be combined with productCodes');
    }
    this.#preflight(options);

    const { logger, db } = this.deps;
    const locked = await withAdvisoryLock(db.pool, PRODUCT_MEDIA_LOCK_NAMESPACE, PRODUCT_MEDIA_LOCK_OBJECT, async () => {
      const startedAt = this.deps.now();
      try {
        return await this.#execute(options, startedAt);
      } catch (raised) {
        // A refused prune is an operator mistake, not a failure of the synchronization (already recorded as succeeded).
        if (raised instanceof PruneRefusedError) throw raised;
        const error = this.#classify(raised, options.signal);
        const failure = describeSyncFailure(error);
        logger.warn({ errorClass: failure.errorClass, errorCode: failure.errorCode, retry: failure.retry }, 'product media sync failed');
        if (options.dryRun !== true) {
          await this.#recordFailed(startedAt, failure).catch((recordError: unknown) =>
            logger.error(errorLogFields(recordError), 'could not record the product media failure in sync_state'),
          );
        }
        throw error;
      }
    });
    if (!locked.acquired) {
      logger.info('product media sync skipped: another run is in progress');
      return { outcome: 'skipped_locked', dryRun: options.dryRun === true, complete: false, stats: null, prune: null };
    }
    return locked.value;
  }

  /** Gateway-mode rules that refuse before anything is read or recorded. */
  #preflight(options: ProductMediaRunOptions): void {
    const mode = this.deps.gateway.describe().mode;
    if (mode !== 'live' && !this.deps.settings.allowFakeGateway) {
      throw new PermanentJobError(
        'Product media sync stores only what a live gateway returned; the current gateway is not live. ' +
          'Set PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY=true (only where the fake gateway is allowed) to store its synthetic images.',
      );
    }
    if (options.prune === true && mode !== 'live') {
      throw new PermanentJobError('Prune is refused unless the gateway is live: a fake or empty source would delete real photos.');
    }
  }

  /** Cancellation and object-store failures are job-level conditions; gateway and database errors keep their own class. */
  #classify(raised: unknown, signal: AbortSignal | undefined): unknown {
    if (isSankhyaGatewayError(raised)) return raised;
    if (signal?.aborted === true) return new TransientJobError('The product media run was cancelled before it finished.', { cause: raised });
    if (isObjectStoreError(raised)) {
      return raised.code === 'unavailable'
        ? new TransientJobError(raised.message, { cause: raised })
        : new PermanentJobError(raised.message, { cause: raised });
    }
    return raised;
  }

  async #execute(options: ProductMediaRunOptions, startedAt: Date): Promise<ProductMediaRunResult> {
    const { gateway, logger, settings } = this.deps;
    const dryRun = options.dryRun === true;
    const signal = options.signal;
    signal?.throwIfAborted();

    const description = gateway.describe();
    const scope = this.deps.readScope === undefined ? undefined : await this.deps.readScope();
    // Fail closed against a real ERP: an absent scope would list the photos of every product, not the sellable ones.
    if (description.mode === 'live' && (scope === undefined || (scope.products?.usageValues ?? []).length === 0)) {
      throw new MirrorScopeUnavailableError(
        'Live product media sync requires a configured read scope with non-empty products.sellableUsageValues; refusing an unscoped read.',
      );
    }
    if (!dryRun) await this.#recordRunning(startedAt);

    const stats = emptyStats();
    const state: RunState = { pending: [], streak: 0, sourceProved: false };
    const seen = new Set<number>();
    const limit = options.limit;
    let after = 0;
    let complete = true;
    let missingCodes: number[] | undefined;
    if (options.productCodes !== undefined) {
      complete = false;
      missingCodes = [];
      const found: ProductMediaSignature[] = [];
      for (const code of new Set(options.productCodes)) {
        signal?.throwIfAborted();
        const [hit] = await gateway.readProductMediaSignatures({
          afterCode: code - 1,
          limit: 1,
          ...(scope === undefined ? {} : { scope }),
          ...(signal === undefined ? {} : { signal }),
        });
        if (hit?.productCode === code) found.push(hit);
        else missingCodes.push(code);
      }
      if (found.length > 0) await this.#processPage(found, options, stats, state);
      stats.examined += found.length;
    } else {
      for (;;) {
        signal?.throwIfAborted();
        const remaining = limit === undefined ? settings.pageSize : Math.min(settings.pageSize, limit - stats.examined);
        if (remaining <= 0) {
          complete = false;
          break;
        }
        const page = await gateway.readProductMediaSignatures({
          afterCode: after,
          limit: remaining,
          ...(scope === undefined ? {} : { scope }),
          ...(signal === undefined ? {} : { signal }),
        });
        if (page.length === 0) break;
        for (const signature of page) seen.add(signature.productCode);
        await this.#processPage(page, options, stats, state);
        stats.examined += page.length;
        after = page[page.length - 1]?.productCode ?? after;
        if (page.length < remaining) break;
      }
    }

    await this.#settleUnavailable(state, stats);

    let prune: ProductMediaPruneReport | null = null;
    if (options.prune === true && complete) {
      prune = await this.#pruneReport(seen, options.allowLargePrune === true);
      if (prune.refusal === null) await this.#prune(seen, dryRun, stats);
    }

    if (!dryRun) await this.#recordSucceeded(startedAt, stats, complete);
    logger.info({ ...stats, dryRun, complete }, 'product media sync completed');
    if (prune?.refusal != null && !dryRun) throw new PruneRefusedError(prune.refusal);
    return { outcome: 'completed', dryRun, complete, stats, prune, ...(missingCodes === undefined ? {} : { missingCodes }) };
  }

  /**
   * Unavailable failures held back during the run. If no download succeeded the whole run saw nothing but
   * an unavailable ERP: that is an outage (abort, count nothing). Otherwise each held product is recorded,
   * parked as `source_unavailable` once it has failed `sourceFailureLimit` runs in a row.
   */
  async #settleUnavailable(state: RunState, stats: ProductMediaStats): Promise<void> {
    if (state.pending.length === 0) return;
    if (!state.sourceProved) throw state.pending[state.pending.length - 1]?.error;
    for (const { signature, row } of state.pending) {
      const previous = row?.failureReason === REASON_UNAVAILABLE ? row.failureCount : 0;
      const count = previous + 1;
      const parked = count >= this.deps.settings.sourceFailureLimit;
      stats.failed += 1;
      this.deps.logger.warn({ productCode: signature.productCode, count, parked }, 'product photo not stored: ERP unavailable for this product');
      await recordFailure(this.deps.db.db, {
        productCode: signature.productCode,
        reason: parked ? REASON_PARKED : REASON_UNAVAILABLE,
        failureCount: count,
        sourceLength: signature.byteLength,
        sourceFingerprint: signature.fingerprint,
        at: this.deps.now(),
      });
    }
  }

  async #processPage(
    page: readonly ProductMediaSignature[],
    options: ProductMediaRunOptions,
    stats: ProductMediaStats,
    state: RunState,
  ): Promise<void> {
    const rows = await loadMediaRows(this.deps.db.db, page.map((signature) => signature.productCode));
    await runBounded(page, options.concurrency ?? this.deps.settings.concurrency, async (signature) => {
      options.signal?.throwIfAborted();
      const row = rows.get(signature.productCode);
      const decision = await this.#decide(signature, row, options.forceVerify === true);
      if (decision === 'unchanged') {
        // `unchanged` is only decided for a row whose thumbnail is recorded and verified: it is reused as is.
        stats.unchanged += 1;
        stats.thumbnailsReused += 1;
        return;
      }
      if (decision === 'skip_permanent') {
        stats.skippedPermanent += 1;
        return;
      }
      if (decision === 'thumbnail') {
        // Only the thumbnail is missing: it is rendered from the stored original, no ERP call.
        if (options.dryRun === true) stats.wouldGenerateThumbnails += 1;
        else await this.#thumbnailFromStore(signature, row as ProductMediaRow, stats, state, options.signal);
        return;
      }
      if (options.dryRun === true) {
        stats.wouldDownload += 1;
        return;
      }
      await this.#download(signature, row, stats, state, options.signal);
    });
  }

  async #decide(signature: ProductMediaSignature, row: ProductMediaRow | undefined, forceVerify: boolean): Promise<Decision> {
    if (row === undefined || forceVerify) return 'download';
    const sameSignature = row.sourceLength === signature.byteLength && row.sourceFingerprint === signature.fingerprint;
    if (!sameSignature) return 'download';
    if (row.status === 'failed') {
      const reason = row.failureReason;
      if (reason === null) return 'download';
      // A raised size cap makes an earlier size refusal worth retrying, even though the source did not change.
      if (SIZE_REASONS.has(reason) && signature.byteLength <= this.deps.settings.maxBytes) return 'download';
      return PERMANENT_REASONS.has(reason) ? 'skip_permanent' : 'download';
    }
    if (this.deps.settings.verifyObjects && row.storageKey !== null && !(await this.deps.store.has(row.storageKey))) return 'repair';
    const thumbnail = thumbnailOf(row);
    if (thumbnail === null) {
      // A permanent rendering failure of THIS original (same content hash, it is the row's own) is parked.
      if (row.failureReason !== null && PERMANENT_THUMBNAIL_REASONS.has(row.failureReason)) return 'skip_permanent';
      // No thumbnail yet (legacy row or a transient rendering failure): render it from the stored original.
      return 'thumbnail';
    }
    if (this.deps.settings.verifyObjects && !(await this.#thumbnailIntact(thumbnail))) return 'thumbnail';
    return 'unchanged';
  }

  /**
   * The thumbnail object exists AND matches its recorded size and sha256 (a content check, not only existence).
   * Only called with `verifyObjects`. A different object store failure propagates as a run-level condition.
   */
  async #thumbnailIntact(thumbnail: ThumbnailRecord): Promise<boolean> {
    let bytes: Uint8Array | null;
    try {
      bytes = await this.deps.store.get(thumbnail.storageKey, { expectedBytes: thumbnail.byteLength, maxBytes: THUMBNAIL_MAX_BYTES });
    } catch (error) {
      if (!isObjectStoreError(error) || error.code !== 'size_mismatch') throw error;
      return false;
    }
    return bytes !== null && createHash('sha256').update(bytes).digest('hex') === thumbnail.contentHash;
  }

  /** Removes a thumbnail object that exists but is damaged, so the re-rendered one is written fresh under the same key. */
  async #discardDamagedThumbnail(productCode: number, thumbnail: ThumbnailRecord): Promise<void> {
    if (await this.#thumbnailIntact(thumbnail)) return;
    this.deps.logger.warn({ productCode }, 'stored product thumbnail is missing or does not match its recorded hash; rendering again');
    await this.deps.store.delete(thumbnail.storageKey).catch((error: unknown) =>
      this.deps.logger.warn({ ...errorLogFields(error), productCode }, 'damaged product thumbnail object not removed'),
    );
  }

  async #download(
    signature: ProductMediaSignature,
    row: ProductMediaRow | undefined,
    stats: ProductMediaStats,
    state: RunState,
    signal: AbortSignal | undefined,
    /** The stored object under this key is known to be damaged: write the downloaded bytes over it. */
    overwriteObject = false,
  ): Promise<void> {
    const { gateway, store, db, logger, settings } = this.deps;
    const { productCode } = signature;
    const fail = async (reason: MediaFailureReason): Promise<void> => {
      stats.failed += 1;
      logger.warn({ productCode, reason }, 'product photo not stored');
      await recordFailure(db.db, {
        productCode,
        reason,
        sourceLength: signature.byteLength,
        sourceFingerprint: signature.fingerprint,
        at: this.deps.now(),
      });
    };

    // The announced size is checked before any transfer: an oversized image is never downloaded.
    if (signature.byteLength > settings.maxBytes) {
      await fail('media_too_large');
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = await gateway.readProductMediaBytes({
        productCode,
        expectedLength: signature.byteLength,
        maxBytes: settings.maxBytes,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (!isSankhyaGatewayError(error)) throw error;
      // Rate limiting and rejected credentials concern the whole run, not this product.
      if (error.kind === 'rate_limit' || error.kind === 'auth') throw error;
      if (error.kind === 'unavailable') {
        // One product that keeps failing must not starve the rest, but a dead ERP must still stop the run:
        // hold the failure; a streak of `sourceFailureLimit` products without any success aborts right away.
        state.streak += 1;
        if (state.streak >= settings.sourceFailureLimit) throw error;
        state.pending.push({ signature, row, error });
        return;
      }
      await fail(error.kind === 'temporary' ? (error.code === 'media_changed_during_read' ? error.code : 'gateway_temporary') : `gateway_${error.kind}`);
      return;
    }
    state.streak = 0;
    state.sourceProved = true;

    const inspected = inspectImage(bytes, settings.maxBytes);
    if (!inspected.ok) {
      await fail(inspected.reason);
      return;
    }

    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `product-images/${productCode}/${contentHash}`;
    const sameObject = row?.storageKey === storageKey && row.contentHash === contentHash;
    const objectPresent = sameObject && !overwriteObject && (await store.has(storageKey));
    if (!objectPresent) await store.put(storageKey, bytes);

    // The thumbnail of the SAME original is kept when its object is still there; anything else is rendered now.
    const previousThumbnail = row === undefined ? null : thumbnailOf(row);
    let thumbnail: ThumbnailRecord | null;
    let thumbnailReason: string | null = null;
    let thumbnailRegenerated = false;
    if (sameObject && previousThumbnail !== null && (await this.#thumbnailIntact(previousThumbnail))) {
      thumbnail = previousThumbnail;
      stats.thumbnailsReused += 1;
    } else {
      // A damaged object under the key the new rendition will get is removed first (content-addressed: same key).
      if (sameObject && previousThumbnail !== null) await this.#discardDamagedThumbnail(productCode, previousThumbnail);
      const made = await this.#renderThumbnail(productCode, bytes, inspected.contentType, stats);
      thumbnail = made.thumbnail;
      thumbnailReason = made.reason;
      thumbnailRegenerated = thumbnail !== null;
    }

    const at = this.deps.now();
    if (
      objectPresent &&
      row?.status === 'stored' &&
      row.sourceLength === signature.byteLength &&
      row.sourceFingerprint === signature.fingerprint &&
      thumbnail === previousThumbnail &&
      thumbnail !== null
    ) {
      // Verified identical (forced check): nothing to change but the attempt time.
      await touchAttempt(db.db, productCode, at);
      stats.unchanged += 1;
      return;
    }
    // Original and thumbnail metadata are written together: a row never describes a thumbnail of other bytes.
    await upsertStored(db.db, {
      productCode,
      contentType: inspected.contentType,
      byteLength: bytes.length,
      contentHash,
      storageKey,
      sourceLength: signature.byteLength,
      sourceFingerprint: signature.fingerprint,
      at,
      thumbnail,
    });
    if (thumbnailReason !== null) await markThumbnailFailed(db.db, productCode, thumbnailReason, at);
    if (objectPresent) {
      // Original untouched. A thumbnail written now is a repair (replacing a recorded one) or a backfill (none was
      // recorded): neither is "unchanged"; a rendering that failed is counted by `thumbnailFailed` only.
      if (thumbnailRegenerated) {
        if (previousThumbnail !== null) stats.repaired += 1;
      } else if (thumbnail !== null) stats.unchanged += 1;
    } else if (sameObject) stats.repaired += 1;
    else if (row?.storageKey != null) stats.updated += 1;
    else stats.created += 1;

    // Superseded objects are removed only after the new row is committed. Failure here leaves an orphan, never a broken row.
    if (row?.storageKey != null && row.storageKey !== storageKey) {
      await store.delete(row.storageKey).catch((error: unknown) => logger.warn({ ...errorLogFields(error), productCode }, 'superseded product photo object not removed'));
    }
    if (previousThumbnail !== null && previousThumbnail.storageKey !== thumbnail?.storageKey) {
      await store.delete(previousThumbnail.storageKey).catch((error: unknown) => logger.warn({ ...errorLogFields(error), productCode }, 'superseded product thumbnail object not removed'));
    }
  }

  /**
   * Renders one thumbnail and stores it content-addressed. A renderer failure is isolated: it yields a stable
   * reason (never bytes, never the native message) and the caller keeps the original. An object store failure is
   * not isolated (it propagates as a run-level condition, like for the original).
   */
  async #renderThumbnail(
    productCode: number,
    original: Uint8Array,
    contentType: ImageContentType,
    stats: ProductMediaStats,
  ): Promise<{ thumbnail: ThumbnailRecord | null; reason: string | null }> {
    const { renderer, store, logger } = this.deps;
    const refuse = (reason: string, renderCode: string): { thumbnail: null; reason: string } => {
      stats.thumbnailFailed += 1;
      logger.warn({ productCode, reason, renderCode }, 'product thumbnail not generated');
      return { thumbnail: null, reason };
    };
    let rendered: Awaited<ReturnType<ThumbnailRenderer['render']>>;
    try {
      rendered = await renderer.render(original, contentType);
    } catch (error) {
      if (isThumbnailRenderError(error)) return refuse(thumbnailReasonOf(error.code), error.code);
      return refuse('thumbnail_failed', 'unexpected');
    }
    // The port is policed too (an injected or future renderer): never store an empty, oversized or non-image rendition.
    if (rendered.bytes.length === 0) return refuse('thumbnail_failed', 'empty_output');
    if (rendered.bytes.length > THUMBNAIL_MAX_BYTES) return refuse('thumbnail_too_large', 'output_too_large');
    const inspected = inspectImage(rendered.bytes, THUMBNAIL_MAX_BYTES);
    if (!inspected.ok || inspected.contentType !== 'image/webp') return refuse('thumbnail_failed', 'invalid_output');

    const contentHash = createHash('sha256').update(rendered.bytes).digest('hex');
    const storageKey = `product-thumbnails/${productCode}/${contentHash}`;
    if (!(await store.has(storageKey))) await store.put(storageKey, rendered.bytes);
    stats.thumbnailsGenerated += 1;
    stats.thumbnailBytes += rendered.bytes.length;
    return {
      thumbnail: { storageKey, contentType: 'image/webp', byteLength: rendered.bytes.length, contentHash, generatedAt: this.deps.now() },
      reason: null,
    };
  }

  /**
   * Backfill / repair: renders the thumbnail from the ORIGINAL IN THE STORE (no ERP byte call). When the stored
   * original is missing or no longer matches its recorded hash, the product is downloaded again instead.
   */
  async #thumbnailFromStore(
    signature: ProductMediaSignature,
    row: ProductMediaRow,
    stats: ProductMediaStats,
    state: RunState,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { store, db, logger } = this.deps;
    const { productCode } = signature;
    if (row.storageKey === null || row.byteLength === null || row.contentHash === null || row.contentType === null) {
      await this.#download(signature, row, stats, state, signal);
      return;
    }
    let original: Uint8Array | null;
    let damaged = false;
    try {
      // Bounded by the RECORDED size, not by the current cap: lowering PRODUCT_MEDIA_MAX_BYTES later must never make a
      // good stored original look unreadable.
      original = await store.get(row.storageKey, { expectedBytes: row.byteLength, maxBytes: row.byteLength });
    } catch (error) {
      if (!isObjectStoreError(error) || error.code !== 'size_mismatch') throw error;
      original = null;
      damaged = true;
    }
    if (original !== null && createHash('sha256').update(original).digest('hex') !== row.contentHash) {
      logger.warn({ productCode }, 'stored product photo does not match its recorded hash; downloading again');
      original = null;
      damaged = true;
    }
    if (original === null) {
      // The stored object is NOT deleted here: the download below overwrites it only after fresh bytes were fetched and
      // validated. If that fails, whatever was stored stays exactly as it was (nothing good is ever deleted first).
      await this.#download(signature, row, stats, state, signal, damaged);
      return;
    }

    const previous = thumbnailOf(row);
    if (previous !== null) await this.#discardDamagedThumbnail(productCode, previous);
    const made = await this.#renderThumbnail(productCode, original, row.contentType as ImageContentType, stats);
    const at = this.deps.now();
    if (made.thumbnail === null) {
      await markThumbnailFailed(db.db, productCode, made.reason ?? 'thumbnail_failed', at);
      return;
    }
    await setThumbnail(db.db, productCode, made.thumbnail, at);
    if (previous !== null) {
      stats.repaired += 1;
      if (previous.storageKey !== made.thumbnail.storageKey) {
        await store.delete(previous.storageKey).catch((error: unknown) => logger.warn({ ...errorLogFields(error), productCode }, 'superseded product thumbnail object not removed'));
      }
    }
  }

  /** What a prune would remove and whether a safety rule refuses it. */
  async #pruneReport(seen: ReadonlySet<number>, allowLargePrune: boolean): Promise<ProductMediaPruneReport> {
    const all = await listAllKeys(this.deps.db.db);
    const candidates = all.filter((entry) => !seen.has(entry.productCode)).length;
    let refusal: string | null = null;
    if (seen.size === 0) {
      refusal = 'Prune refused: the complete listing is empty (an empty source would delete every stored photo).';
    } else if (!allowLargePrune && candidates > all.length * LARGE_PRUNE_RATIO) {
      refusal = `Prune refused: it would remove ${candidates} of ${all.length} stored photos (more than 50%). Use --allow-large-prune if that is intended.`;
    }
    return { candidates, total: all.length, refusal };
  }

  async #prune(seen: ReadonlySet<number>, dryRun: boolean, stats: ProductMediaStats): Promise<void> {
    const { db, store, logger } = this.deps;
    for (const { productCode, storageKey, thumbnailStorageKey } of await listAllKeys(db.db)) {
      if (seen.has(productCode)) continue;
      stats.pruned += 1;
      if (dryRun) continue;
      // Row first: the API stops advertising the photo, then the object goes (an orphan object is harmless).
      await deleteRow(db.db, productCode);
      if (storageKey !== null) {
        await store.delete(storageKey).catch((error: unknown) => logger.warn({ ...errorLogFields(error), productCode }, 'pruned product photo object not removed'));
      }
      if (thumbnailStorageKey !== null) {
        await store.delete(thumbnailStorageKey).catch((error: unknown) => logger.warn({ ...errorLogFields(error), productCode }, 'pruned product thumbnail object not removed'));
      }
    }
  }

  async #recordRunning(at: Date): Promise<void> {
    await this.deps.db.db
      .insert(syncState)
      .values({ entity: PRODUCT_MEDIA_ENTITY, status: 'running', lastAttemptAt: at })
      .onConflictDoUpdate({ target: syncState.entity, set: { status: 'running', lastAttemptAt: at } });
  }

  async #recordSucceeded(startedAt: Date, stats: ProductMediaStats, complete: boolean): Promise<void> {
    const finishedAt = this.deps.now();
    const rowCount = await countServable(this.deps.db.db);
    const values = {
      status: 'succeeded',
      lastSuccessAt: finishedAt,
      lastAttemptAt: startedAt,
      ...(complete ? { lastFullReconcileAt: finishedAt } : {}),
      cursor: {
        strategy: 'media_signatures',
        lastRun: {
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          complete,
          stats,
        },
      },
      rowCount,
      lastErrorClass: null,
      lastErrorMessage: null,
    };
    await this.deps.db.db
      .insert(syncState)
      .values({ entity: PRODUCT_MEDIA_ENTITY, ...values })
      .onConflictDoUpdate({ target: syncState.entity, set: values });
  }

  async #recordFailed(at: Date, failure: { errorClass: string; message: string }): Promise<void> {
    const values = { status: 'failed', lastAttemptAt: at, lastErrorClass: failure.errorClass, lastErrorMessage: failure.message };
    await this.deps.db.db
      .insert(syncState)
      .values({ entity: PRODUCT_MEDIA_ENTITY, ...values })
      .onConflictDoUpdate({ target: syncState.entity, set: values });
  }
}

/**
 * Runs `task` over `items` with at most `limit` in flight. The first failure stops new work, lets the
 * running tasks finish (nothing is abandoned mid-write) and is then rethrown.
 */
async function runBounded<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  const lane = async (): Promise<void> => {
    while (failure === undefined && next < items.length) {
      const item = items[next++] as T;
      try {
        await task(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failure !== undefined) throw failure.error;
}
