import { createDb } from '@salesforce/db';
import { loadWorkerConfig } from './config/worker-env.js';
import { BOOTSTRAP_USAGE, BootstrapArgsError, parseBootstrapArgs } from './media/bootstrap-args.js';
import { FilesystemObjectStore } from './media/object-store.js';
import { ProductMediaSyncService } from './media/product-media-sync.service.js';
import { SharpThumbnailRenderer } from './media/thumbnail-renderer.js';
import { createLogger } from './observability/logger.js';
import { runMain } from './process.js';
import { loadCurrentReadScope } from './sync/mirror-scope.js';

/**
 * One-shot product photo synchronization / initial load
 * (`pnpm --filter @salesforce/server run product-media:bootstrap -- [--limit N | --codprod CODE[,CODE...]] [--concurrency N] [--dry-run] [--force-verify] [--prune]`).
 * Runs the same `ProductMediaSyncService` as the scheduled job, once, without pg-boss, so the first load
 * of the whole catalog can be done (and watched) outside the job queue. Safe next to a running worker:
 * the advisory lock makes the second runner skip. Read-only towards the ERP; the gateway comes from the
 * worker environment (default: the synthetic fake). Needs PRODUCT_MEDIA_DIR; it does not need
 * PRODUCT_MEDIA_SYNC_ENABLED (that switch governs the schedule only). Exit code 1 on a run-level failure.
 */
runMain('product-media-bootstrap', async () => {
  let args;
  try {
    args = parseBootstrapArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof BootstrapArgsError) {
      process.stdout.write(`${error.message}\n${BOOTSTRAP_USAGE}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  const { env, gateway, gatewayDescription } = loadWorkerConfig(process.env);
  if (env.PRODUCT_MEDIA_DIR === undefined) {
    throw new Error('PRODUCT_MEDIA_DIR is required (absolute path of the persistent photo directory).');
  }
  const logger = createLogger({ level: env.LOG_LEVEL, service: 'product-media-bootstrap' });
  const db = createDb(env.DATABASE_URL.reveal(), { max: 4, applicationName: 'salesforce-product-media-bootstrap' });
  const out = (line: string) => process.stdout.write(`${line}\n`);
  try {
    out(`gateway: ${gatewayDescription.mode} (${gatewayDescription.environmentKind})${args.dryRun ? ' [dry run]' : ''}`);
    const service = new ProductMediaSyncService({
      db,
      gateway,
      store: new FilesystemObjectStore(env.PRODUCT_MEDIA_DIR),
      renderer: new SharpThumbnailRenderer(),
      logger,
      now: () => new Date(),
      readScope: () => loadCurrentReadScope(db.db),
      settings: {
        maxBytes: env.PRODUCT_MEDIA_MAX_BYTES,
        verifyObjects: env.PRODUCT_MEDIA_VERIFY_OBJECTS,
        pageSize: 100,
        concurrency: env.PRODUCT_MEDIA_SYNC_CONCURRENCY,
        allowFakeGateway: env.PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY,
        sourceFailureLimit: env.PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT,
      },
    });
    try {
      const result = await service.run({
        dryRun: args.dryRun,
        forceVerify: args.forceVerify,
        prune: args.prune,
        allowLargePrune: args.allowLargePrune,
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.productCodes === undefined ? {} : { productCodes: args.productCodes }),
        ...(args.concurrency === undefined ? {} : { concurrency: args.concurrency }),
      });
      if (result.stats === null) {
        out(`product media: ${result.outcome}`);
      } else {
        const s = result.stats;
        out(
          `product media: ${result.outcome} complete=${result.complete} examined=${s.examined} created=${s.created} updated=${s.updated} ` +
            `unchanged=${s.unchanged} repaired=${s.repaired} failed=${s.failed} skippedPermanent=${s.skippedPermanent} ` +
            `pruned=${s.pruned} wouldDownload=${s.wouldDownload} thumbnailsGenerated=${s.thumbnailsGenerated} thumbnailsReused=${s.thumbnailsReused} ` +
            `thumbnailFailed=${s.thumbnailFailed} thumbnailBytes=${s.thumbnailBytes} wouldGenerateThumbnails=${s.wouldGenerateThumbnails}`,
        );
        if (result.missingCodes !== undefined) {
          out(`targeted: requested=${args.productCodes?.length ?? 0} missing=${result.missingCodes.length}${result.missingCodes.length === 0 ? '' : ` (not returned by the scoped listing: ${result.missingCodes.join(', ')})`}`);
        }
        if (result.prune !== null) {
          const p = result.prune;
          out(
            `prune: candidates=${p.candidates} of ${p.total} stored` +
              `${p.refusal === null ? '' : ` REFUSED (${p.refusal})`}${result.dryRun ? ' [dry run: nothing removed]' : ''}`,
          );
        }
      }
    } catch (error) {
      out(`product media: FAILED ${error instanceof Error ? error.message : 'unknown error'}`);
      process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
});
