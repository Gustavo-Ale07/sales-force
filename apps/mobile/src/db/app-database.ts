import { openEncryptedDatabase, type OpenedDatabase } from "@salesforce/mobile-db/expo";
import { createSecureStoreKeyStore, secureRandomBytes } from "./secure-key-store";

export const APP_DATABASE_NAME = "salesforce.db";
const APP_DATABASE_KEY_NAME = "salesforce.db.key";

/** Opens the encrypted application database (production schema). Wired into repositories by the offline slice. */
export function openAppDatabase(): Promise<OpenedDatabase> {
  return openEncryptedDatabase({
    name: APP_DATABASE_NAME,
    keyStore: createSecureStoreKeyStore(APP_DATABASE_KEY_NAME),
    randomBytes: secureRandomBytes,
  });
}
