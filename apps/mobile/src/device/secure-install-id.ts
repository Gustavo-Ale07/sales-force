import * as SecureStore from "expo-secure-store";
import { newClientRequestId } from "../lib/uuid";
import { createInstallIdStore, type InstallIdStore } from "./install-id";

const STORE_KEY = "salesforce.install.id";

/** The installation id lives in the platform secure store, like the database key (never in the database, which a wipe empties). */
export function createSecureInstallIdStore(): InstallIdStore {
  return createInstallIdStore(
    {
      read: () => SecureStore.getItemAsync(STORE_KEY),
      write: (value) => SecureStore.setItemAsync(STORE_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
      remove: () => SecureStore.deleteItemAsync(STORE_KEY),
    },
    newClientRequestId,
  );
}
