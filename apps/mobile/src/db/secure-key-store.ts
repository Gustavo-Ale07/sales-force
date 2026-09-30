import * as SecureStore from "expo-secure-store";
import { getRandomBytes } from "expo-crypto";
import type { KeyStore, RandomBytes } from "@salesforce/mobile-db";

/**
 * Keeps the SQLCipher database key in the platform secure store (Android Keystore-backed), the only place a
 * persistent secret may live on the device (MOB-2, security.md). The key never enters the database, logs or the API.
 */
export function createSecureStoreKeyStore(storeKey: string): KeyStore {
  return {
    get: () => SecureStore.getItemAsync(storeKey),
    set: (hexKey) => SecureStore.setItemAsync(storeKey, hexKey, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  };
}

/** CSPRNG from the OS (`expo-crypto`); Hermes has no `crypto.getRandomValues`. */
export const secureRandomBytes: RandomBytes = (length) => getRandomBytes(length);
