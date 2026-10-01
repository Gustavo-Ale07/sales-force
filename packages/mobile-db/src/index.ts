/**
 * Local (on-device) encrypted database of the mobile app (MOB-2). This entry point is engine-agnostic and safe to
 * import anywhere (including Node tests): the SQL port, the migration runner, the production migrations and key
 * management. The SQLite library itself lives only in `@salesforce/mobile-db/expo`.
 */
export * from "./connection";
export * from "./key";
export { migrations } from "./migrations";
export * from "./migrator";
export * from "./offline-env";
export * from "./reference-cache";
export * from "./dataset-identity";
export * from "./inspect";
export * from "./local-orders";
export * from "./sales-query";
export * from "./order-sync";
export * from "./sync-manager";

export type LocalStorageStatus = { readonly available: true };

/**
 * Static capability flag kept for the shell. The encrypted database (MOB-6) is the app's only local store; when it
 * cannot be opened the app refuses to start rather than falling back to plaintext or to online-only.
 */
export function getLocalStorageStatus(): LocalStorageStatus {
  return { available: true };
}
