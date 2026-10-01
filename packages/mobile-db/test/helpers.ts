import { confirmDataset, type DatasetIdentity, type SqlExecutor } from "../src/index";

/** Synthetic dataset identities (never real environment names or ids). */
export const REAL: DatasetIdentity = { environment: "production", datasetId: "mirror-real-001" };
export const FAKE: DatasetIdentity = { environment: "production", datasetId: "fake-seed-001" };
export const SANDBOX: DatasetIdentity = { environment: "sandbox", datasetId: "mirror-real-001" };

export const confirm = (db: SqlExecutor, identity: DatasetIdentity | null = REAL) => confirmDataset(db, identity, "2026-09-30T11:00:00.000Z");
