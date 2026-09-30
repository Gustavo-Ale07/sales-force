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
export * from "./local-orders";
export * from "./order-sync";
export * from "./sync-manager";

export type LocalStorageStatus =
  | { readonly available: false; readonly reason: "encrypted_library_not_selected" }
  | { readonly available: true };

/**
 * Static capability flag kept for the shell badge. The library is validated by S7 but offline storage is not wired
 * into the app yet (next slice), so this still reports unavailable until then.
 */
export function getLocalStorageStatus(): LocalStorageStatus {
  return { available: false, reason: "encrypted_library_not_selected" };
}
