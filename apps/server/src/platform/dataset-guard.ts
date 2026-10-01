import type { DatasetIdentity } from '@salesforce/contracts';
import { AppError } from '../http/app-error.js';

/**
 * Dataset trust boundary for order-mutating requests. The client states the dataset its data came from
 * (`expectedDataset`); the request is accepted only when it equals the identity THIS process declares
 * (`DATASET_IDENTITY`, from `SF_ERP_ENVIRONMENT` / `SF_DATASET_ID`).
 *
 * Fails closed: a server that declares no dataset rejects every such request. The comparison is exact and
 * there is no fallback, recalculation or "closest match". It is called before any transaction, lock,
 * idempotency lookup or write, so a rejection has no side effects. The declared identity is process-level
 * configuration read once at startup and immutable for the process lifetime, so the identity itself cannot
 * change between this check and the write of the same request. The configuration, prices and mirror are
 * DB-backed and are NOT covered here (that is `configVersionId` / `revisao_preco`).
 *
 * This is a consistency (fail-fast) check against an honest but stale client, not an independent barrier: the
 * client can read the server's identity from `GET /order-entry/configuration` (non-secret by design) and echo
 * it. The real barriers are the server-side `datasetOrigin` stamp and the DB gates of migration 0005. The
 * identity is an env label, not yet bound to the data the server holds (architectural debt, architecture.md §5.5).
 *
 * The message never carries either identity (the server's own is only exposed by
 * `GET /order-entry/configuration`).
 */
export function assertDatasetMatches(declared: DatasetIdentity | null, expected: DatasetIdentity): void {
  if (declared !== null && declared.environment === expected.environment && declared.datasetId === expected.datasetId) return;
  throw new AppError('dataset_mismatch');
}
