/**
 * Database key management (MOB-2, R45). The SQLCipher key is a random 256-bit value generated on the device and kept
 * only in the platform secure store (keystore-backed); it is never derived from a password, never logged, never sent
 * to the server and never stored in the database itself. Both collaborators are injected so this stays pure.
 */
export interface KeyStore {
  get(): Promise<string | null>;
  set(hexKey: string): Promise<void>;
}

/** Cryptographically secure random bytes (the app injects `expo-crypto`). */
export type RandomBytes = (length: number) => Uint8Array;

const KEY_BYTES = 32;
const KEY_PATTERN = /^[0-9a-f]{64}$/;

export class KeyMissingError extends Error {
  constructor() {
    super("The database exists but its key is missing from the secure store; the data is unrecoverable on this device.");
    this.name = "KeyMissingError";
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isValidHexKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/**
 * Returns the stored key, or creates and stores one when none exists. `databaseExists` guards R45: if a database file
 * is already there but the key is gone (secure store wiped, device restore), minting a new key would silently orphan
 * the data, so this throws `KeyMissingError` and the caller decides (wipe + resync, never a silent overwrite).
 */
export async function getOrCreateDatabaseKey(
  store: KeyStore,
  randomBytes: RandomBytes,
  databaseExists: boolean,
): Promise<string> {
  const existing = await store.get();
  if (existing !== null) {
    if (!isValidHexKey(existing)) throw new Error("Stored database key is malformed.");
    return existing;
  }
  if (databaseExists) throw new KeyMissingError();
  const bytes = randomBytes(KEY_BYTES);
  if (bytes.length !== KEY_BYTES) throw new Error("Random source returned the wrong number of bytes.");
  const key = toHex(bytes);
  await store.set(key);
  return key;
}
