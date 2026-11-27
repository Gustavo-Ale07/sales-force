import * as SecureStore from "expo-secure-store";
import type { ServerCodeStore } from "./server-connection";

const STORE_KEY = "salesforce.server.code";

/** The server code is a credential: it lives only in the platform secure store, like the database key. */
export function createSecureServerCodeStore(): ServerCodeStore {
  return {
    get: () => SecureStore.getItemAsync(STORE_KEY),
    set: (code) => SecureStore.setItemAsync(STORE_KEY, code, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    clear: () => SecureStore.deleteItemAsync(STORE_KEY),
  };
}
