import { describe, expect, it } from "vitest";
import { getOrCreateDatabaseKey, isValidHexKey, KeyMissingError, toHex, type KeyStore } from "../src/key";

function memoryStore(initial: string | null = null): KeyStore & { value: string | null } {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (key: string) => {
      store.value = key;
    },
  };
  return store;
}
const bytes = (fill: number) => (length: number) => new Uint8Array(length).fill(fill);

describe("getOrCreateDatabaseKey", () => {
  it("creates and stores a 256-bit hex key on first use", async () => {
    const store = memoryStore();
    const key = await getOrCreateDatabaseKey(store, bytes(0xab), false);
    expect(key).toBe("ab".repeat(32));
    expect(store.value).toBe(key);
  });

  it("returns the stored key without regenerating", async () => {
    const stored = "0f".repeat(32);
    expect(await getOrCreateDatabaseKey(memoryStore(stored), bytes(1), true)).toBe(stored);
  });

  it("refuses to mint a new key when a database already exists (R45: no silent orphaning)", async () => {
    const store = memoryStore();
    await expect(getOrCreateDatabaseKey(store, bytes(1), true)).rejects.toBeInstanceOf(KeyMissingError);
    expect(store.value).toBeNull();
  });

  it("rejects a malformed stored key and a short random source", async () => {
    await expect(getOrCreateDatabaseKey(memoryStore("nothex"), bytes(1), false)).rejects.toThrow("malformed");
    await expect(getOrCreateDatabaseKey(memoryStore(), (n) => new Uint8Array(n - 1), false)).rejects.toThrow("wrong number");
  });

  it("hex helpers", () => {
    expect(toHex(new Uint8Array([0, 255, 16]))).toBe("00ff10");
    expect(isValidHexKey("ab".repeat(32))).toBe(true);
    expect(isValidHexKey("AB".repeat(32))).toBe(false);
  });
});
