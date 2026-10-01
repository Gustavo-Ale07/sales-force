import type { SqlExecutor } from "./connection";
import { META_KEYS, countCached, deleteMeta, getMeta, setMeta } from "./reference-cache";

/**
 * Dataset identity: which data the installation serves (fake / real, sandbox / production). The server declares it
 * (`GET /order-entry/configuration` -> `dataset`); the device never invents it. Everything the device holds that was
 * priced or cached against one dataset (reference cache, drafts, outbox) carries that identity, and nothing crosses to
 * another dataset: a mismatch fails closed (cache not shown, orders not sent), it never converts.
 */
export interface DatasetIdentity {
  readonly environment: string;
  readonly datasetId: string;
}

/** Outcome of the push guard / classification of a draft or outbox row against the current confirmed dataset. */
export type Eligibility = "unchecked" | "eligible" | "legacy_local" | "environment_mismatch" | "dataset_mismatch" | "owner_mismatch";

export type IneligibleReason = Exclude<Eligibility, "unchecked" | "eligible">;

/** Eligibility values under which a row still counts as normal, operational work. */
export const OPERATIONAL_ELIGIBILITY: readonly Eligibility[] = ["unchecked", "eligible"];

/** The server cannot tell which dataset it serves (or it could not be read): the pull is aborted, the old cache kept. */
export class DatasetIdentityError extends Error {
  constructor(message = "Não foi possível confirmar o conjunto de dados do servidor.") {
    super(message);
    this.name = "DatasetIdentityError";
  }
}

/** A new order cannot be created because no dataset was ever confirmed (it could not be priced against a known dataset). */
export class DatasetUnavailableError extends Error {
  constructor(message = "Não foi possível confirmar os dados do servidor. Conecte-se à internet para criar pedidos.") {
    super(message);
    this.name = "DatasetUnavailableError";
  }
}

export function sameDataset(a: DatasetIdentity | null, b: DatasetIdentity | null): boolean {
  return a !== null && b !== null && a.environment === b.environment && a.datasetId === b.datasetId;
}

async function readIdentity(db: SqlExecutor, environmentKey: string, idKey: string): Promise<DatasetIdentity | null> {
  const [environment, datasetId] = await Promise.all([getMeta(db, environmentKey), getMeta(db, idKey)]);
  return environment === null || datasetId === null || environment === "" || datasetId === "" ? null : { environment, datasetId };
}

/** The identity the server most recently confirmed to this device (online); `null` when none, or when the server last said it cannot tell. */
export function readExpectedDataset(db: SqlExecutor): Promise<DatasetIdentity | null> {
  return readIdentity(db, META_KEYS.expectedDatasetEnvironment, META_KEYS.expectedDatasetId);
}

/** The identity of the data currently in the reference cache. */
export function readCacheDataset(db: SqlExecutor): Promise<DatasetIdentity | null> {
  return readIdentity(db, META_KEYS.cacheDatasetEnvironment, META_KEYS.cacheDatasetId);
}

export async function writeCacheDataset(tx: SqlExecutor, identity: DatasetIdentity, now: string): Promise<void> {
  await setMeta(tx, META_KEYS.cacheDatasetEnvironment, identity.environment, now);
  await setMeta(tx, META_KEYS.cacheDatasetId, identity.datasetId, now);
}

/**
 * Records what the server said ONLINE. A `null` answer ("cannot tell") removes the confirmation: from then on nothing
 * is considered current until the server declares an identity again (fail closed).
 */
export async function confirmDataset(tx: SqlExecutor, identity: DatasetIdentity | null, now: string): Promise<void> {
  if (identity === null) {
    await deleteMeta(tx, META_KEYS.expectedDatasetEnvironment);
    await deleteMeta(tx, META_KEYS.expectedDatasetId);
    return;
  }
  await setMeta(tx, META_KEYS.expectedDatasetEnvironment, identity.environment, now);
  await setMeta(tx, META_KEYS.expectedDatasetId, identity.datasetId, now);
}

/**
 * The reference cache may be shown only when ALL hold: it was filled for this account, it carries the identity of the
 * dataset the server last confirmed (same environment AND same dataset id), and it has rows. Anything else makes the
 * readers fall back to the remote path; a new pull is required.
 */
export async function isCacheReady(db: SqlExecutor, ownerAccountId: string): Promise<boolean> {
  if ((await getMeta(db, META_KEYS.cacheOwner)) !== ownerAccountId) return false;
  const [cached, expected] = await Promise.all([readCacheDataset(db), readExpectedDataset(db)]);
  if (!sameDataset(cached, expected)) return false;
  const counts = await countCached(db);
  return counts.customers > 0 || counts.products > 0;
}

/**
 * Pure classification of one draft/outbox row against the current account and the confirmed dataset.
 * `unconfirmed` = the row has an identity but the device has no confirmed one right now (retryable, not ineligible).
 */
export function classifyEligibility(args: {
  readonly rowOwnerAccountId: string;
  readonly currentOwnerAccountId: string;
  readonly rowDataset: DatasetIdentity | null;
  readonly current: DatasetIdentity | null;
}): "eligible" | IneligibleReason | "unconfirmed" {
  if (args.rowOwnerAccountId !== args.currentOwnerAccountId) return "owner_mismatch";
  if (args.rowDataset === null) return "legacy_local";
  if (args.current === null) return "unconfirmed";
  if (args.rowDataset.environment !== args.current.environment) return "environment_mismatch";
  if (args.rowDataset.datasetId !== args.current.datasetId) return "dataset_mismatch";
  return "eligible";
}

/** Seller-safe pt-BR text for why a command is not sent. */
export function ineligibleMessage(reason: IneligibleReason): string {
  switch (reason) {
    case "legacy_local":
      return "Pedido criado antes da verificação de dados — não será enviado.";
    case "environment_mismatch":
    case "dataset_mismatch":
      return "Pedido de outro conjunto de dados — não será enviado.";
    case "owner_mismatch":
      return "Pedido de outra conta — não será enviado.";
  }
}

export function isOperationalEligibility(value: string): boolean {
  return (OPERATIONAL_ELIGIBILITY as readonly string[]).includes(value);
}

/** SQL predicate "this draft is normal work for the confirmed dataset" (alias `d`); `null` dataset matches nothing. */
export function operationalDraftSql(dataset: DatasetIdentity | null): { sql: string; params: string[] } {
  if (dataset === null) return { sql: "0", params: [] };
  return {
    sql: "(d.dataset_environment = ? AND d.dataset_id = ? AND d.eligibility IN ('unchecked', 'eligible'))",
    params: [dataset.environment, dataset.datasetId],
  };
}
