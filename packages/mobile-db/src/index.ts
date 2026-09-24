/**
 * Local (on-device) database of the mobile app: STUB.
 *
 * MOB-2 (approved in direction only): offline data must be encrypted; unencrypted local storage is rejected.
 * The encrypted SQLite library is NOT selected until spike S7 concludes (V-09), so this package declares no
 * schema, no migration and no driver. It exists so that `apps/mobile` can already depend on the package
 * that will own them (`architecture.md` section 4.2, section 9) and read the storage capability from one place.
 *
 * Do not add a database library, a table or a migration here before V-09 is closed and the owner has approved
 * the library. Local persistence stays behind the repository ports of `apps/mobile/src/data/ports.ts`.
 */
export type LocalStorageStatus =
  | { readonly available: false; readonly reason: "encrypted_library_not_selected" }
  | { readonly available: true };

/** Always unavailable until spike S7 (V-09) selects and validates an encrypted SQLite library. */
export function getLocalStorageStatus(): LocalStorageStatus {
  return { available: false, reason: "encrypted_library_not_selected" };
}
