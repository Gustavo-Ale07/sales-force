import type { SqlExecutor, SqlRow } from "./connection";
import { isOperationalEligibility, sameDataset, type DatasetIdentity } from "./dataset-identity";
import { META_KEYS } from "./reference-cache";

/**
 * Read-only diagnostic of the local database for dataset isolation. Executes only SELECT statements. Never reads the
 * database key or any token (they live in the device secure store, not in this database), and never reports customer
 * names or free-text notes. `sync_metadata` values are shown only for an allow-list of non-sensitive keys; any other
 * key (e.g. the remembered account record, the cached configuration) is reported by name and size only.
 */
export type LocalClassification = "operational" | "legacy_local" | "mismatch";

export interface LocalStateReport {
  readonly cache: {
    readonly customers: number;
    readonly products: number;
    readonly ownerAccountId: string | null;
    readonly environment: string | null;
    readonly datasetId: string | null;
  };
  readonly expectedDataset: DatasetIdentity | null;
  readonly metadata: readonly { readonly key: string; readonly value: string | null; readonly valueLength: number; readonly updatedAt: string }[];
  readonly drafts: readonly {
    readonly localId: string;
    readonly status: string;
    readonly ownerAccountId: string;
    readonly customerCode: number;
    readonly datasetEnvironment: string | null;
    readonly datasetId: string | null;
    readonly eligibility: string;
    readonly itemProductCodes: readonly number[];
    readonly createdAt: string;
    readonly classification: LocalClassification;
  }[];
  readonly outbox: readonly {
    readonly localId: string;
    readonly draftLocalId: string | null;
    readonly type: string;
    readonly state: string;
    readonly eligibility: string;
    readonly attempts: number;
    readonly lastError: string | null;
    readonly classification: LocalClassification;
  }[];
}

const SAFE_VALUE_KEYS: ReadonlySet<string> = new Set([
  META_KEYS.customersSyncedAt,
  META_KEYS.productsSyncedAt,
  META_KEYS.cacheOwner,
  META_KEYS.cacheDatasetEnvironment,
  META_KEYS.cacheDatasetId,
  META_KEYS.expectedDatasetEnvironment,
  META_KEYS.expectedDatasetId,
  META_KEYS.lastAuthAt,
  "sync.last_success_at",
]);

const MAX_ERROR_LENGTH = 120;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function classify(
  row: { datasetEnvironment: string | null; datasetId: string | null; eligibility: string },
  expected: DatasetIdentity | null,
): LocalClassification {
  if (row.datasetEnvironment === null || row.datasetId === null || row.eligibility === "legacy_local") return "legacy_local";
  const own = { environment: row.datasetEnvironment, datasetId: row.datasetId };
  return isOperationalEligibility(row.eligibility) && sameDataset(own, expected) ? "operational" : "mismatch";
}

export async function inspectLocalState(db: SqlExecutor): Promise<LocalStateReport> {
  const one = async (sql: string): Promise<SqlRow | undefined> => (await db.query<SqlRow>(sql))[0];
  const customers = Number((await one("SELECT count(*) AS n FROM cache_customer"))?.n ?? 0);
  const products = Number((await one("SELECT count(*) AS n FROM cache_product"))?.n ?? 0);

  const metaRows = await db.query<SqlRow>("SELECT key, value, updated_at FROM sync_metadata ORDER BY key");
  const meta = new Map(metaRows.map((row) => [String(row.key), String(row.value)]));
  const metadata = metaRows.map((row) => ({
    key: String(row.key),
    value: SAFE_VALUE_KEYS.has(String(row.key)) ? String(row.value) : null,
    valueLength: String(row.value).length,
    updatedAt: String(row.updated_at),
  }));
  const envKey = meta.get(META_KEYS.expectedDatasetEnvironment);
  const idKey = meta.get(META_KEYS.expectedDatasetId);
  const expectedDataset = envKey !== undefined && idKey !== undefined && envKey !== "" && idKey !== "" ? { environment: envKey, datasetId: idKey } : null;

  const items = await db.query<SqlRow>("SELECT draft_local_id, product_code FROM local_order_item ORDER BY draft_local_id, position");
  const codesByDraft = new Map<string, number[]>();
  for (const row of items) {
    const key = String(row.draft_local_id);
    codesByDraft.set(key, [...(codesByDraft.get(key) ?? []), Number(row.product_code)]);
  }

  const draftRows = await db.query<SqlRow>(
    `SELECT local_id, status, owner_account_id, customer_code, dataset_environment, dataset_id, eligibility, created_at
     FROM local_order_draft ORDER BY created_at, local_id`,
  );
  const drafts = draftRows.map((row) => {
    const shape = { datasetEnvironment: text(row.dataset_environment), datasetId: text(row.dataset_id), eligibility: String(row.eligibility) };
    return {
      localId: String(row.local_id),
      status: String(row.status),
      ownerAccountId: String(row.owner_account_id),
      customerCode: Number(row.customer_code),
      ...shape,
      itemProductCodes: codesByDraft.get(String(row.local_id)) ?? [],
      createdAt: String(row.created_at),
      classification: classify(shape, expectedDataset),
    };
  });

  const outboxRows = await db.query<SqlRow>(
    `SELECT local_id, draft_local_id, type, state, eligibility, attempts, last_error, dataset_environment, dataset_id
     FROM outbox ORDER BY created_at, rowid`,
  );
  const outbox = outboxRows.map((row) => {
    const error = text(row.last_error);
    return {
      localId: String(row.local_id),
      draftLocalId: text(row.draft_local_id),
      type: String(row.type),
      state: String(row.state),
      eligibility: String(row.eligibility),
      attempts: Number(row.attempts),
      lastError: error === null ? null : error.slice(0, MAX_ERROR_LENGTH),
      classification: classify({ datasetEnvironment: text(row.dataset_environment), datasetId: text(row.dataset_id), eligibility: String(row.eligibility) }, expectedDataset),
    };
  });

  return {
    cache: {
      customers,
      products,
      ownerAccountId: meta.get(META_KEYS.cacheOwner) ?? null,
      environment: meta.get(META_KEYS.cacheDatasetEnvironment) ?? null,
      datasetId: meta.get(META_KEYS.cacheDatasetId) ?? null,
    },
    expectedDataset,
    metadata,
    drafts,
    outbox,
  };
}
