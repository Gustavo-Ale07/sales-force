import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemObjectStore, isObjectStoreError, isValidObjectKey } from '../../src/media/object-store.js';

let root: string;
let store: FilesystemObjectStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sf-object-store-'));
  store = new FilesystemObjectStore(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('FilesystemObjectStore', () => {
  it('round-trips bytes under a nested key', async () => {
    await store.put('product-images/10/abc123', bytes(1, 2, 3));
    expect([...((await store.get('product-images/10/abc123')) ?? [])]).toEqual([1, 2, 3]);
    expect(await store.has('product-images/10/abc123')).toBe(true);
  });

  it('checks the size on disk before reading when expectedBytes / maxBytes are given', async () => {
    await store.put('product-images/10/sized', bytes(1, 2, 3, 4));
    expect((await store.get('product-images/10/sized', { expectedBytes: 4, maxBytes: 4 }))?.length).toBe(4);
    await expect(store.get('product-images/10/sized', { expectedBytes: 3 })).rejects.toMatchObject({ code: 'size_mismatch' });
    await expect(store.get('product-images/10/sized', { maxBytes: 3 })).rejects.toMatchObject({ code: 'size_mismatch' });
    expect(await store.get('product-images/10/missing', { expectedBytes: 4 })).toBeNull();
  });

  it('answers null / false for a missing key, including a key below a file', async () => {
    expect(await store.get('product-images/10/none')).toBeNull();
    expect(await store.has('product-images/10/none')).toBe(false);
    await store.put('product-images/10/file', bytes(9));
    expect(await store.get('product-images/10/file/deeper')).toBeNull();
  });

  it('put is idempotent and overwrites atomically (no partial file, no temp leftovers)', async () => {
    await store.put('a/b', bytes(1, 1, 1, 1));
    await store.put('a/b', bytes(1, 1, 1, 1));
    await store.put('a/b', bytes(2, 2));
    expect([...((await store.get('a/b')) ?? [])]).toEqual([2, 2]);
    // The staging area is empty once every write finished.
    expect(readdirSync(join(root, '.tmp'))).toEqual([]);
  });

  it('delete is idempotent', async () => {
    await store.put('a/b', bytes(1));
    await store.delete('a/b');
    await store.delete('a/b');
    expect(await store.has('a/b')).toBe(false);
  });

  it.each([
    '',
    '/abs',
    '../escape',
    'a/../../escape',
    'a//b',
    'a/./b',
    'a\\b',
    'C:/x',
    '.hidden',
    'a/.tmp/x',
    'a/b.',
    'a b',
    'a/%2e%2e/b',
    'a/b\u0000c',
    `a/${'x'.repeat(200)}`,
  ])('refuses the unsafe key %j without touching the filesystem', async (key) => {
    expect(isValidObjectKey(key)).toBe(false);
    await expect(store.put(key, bytes(1))).rejects.toMatchObject({ code: 'invalid_key' });
    await expect(store.get(key)).rejects.toMatchObject({ code: 'invalid_key' });
    await expect(store.delete(key)).rejects.toMatchObject({ code: 'invalid_key' });
    expect(readdirSync(root).filter((entry) => entry !== '.tmp')).toEqual([]);
  });

  it('accepts the keys the photo pipeline builds', () => {
    expect(isValidObjectKey(`product-images/123/${'a'.repeat(64)}`)).toBe(true);
  });

  it('reports a storage failure as an unavailable error without leaking the path, and leaves no temp file', async () => {
    // A FILE where the directory should be: mkdir of the key's parent fails.
    writeFileSync(join(root, 'blocked'), 'x');
    const error = await store.put('blocked/key', bytes(1)).catch((raised: unknown) => raised);
    expect(isObjectStoreError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'unavailable' });
    expect(String((error as Error).message)).not.toContain(root);
    expect(readdirSync(join(root, '.tmp'))).toEqual([]);
  });

  it('a root that does not exist yet is created on first write', async () => {
    const nested = join(root, 'not', 'yet');
    const lazy = new FilesystemObjectStore(nested);
    await lazy.put('k/v', bytes(7));
    expect([...((await lazy.get('k/v')) ?? [])]).toEqual([7]);
  });

  it('an unreadable root is reported as unavailable by get', async () => {
    mkdirSync(join(root, 'dir-as-object'));
    // Reading a directory as an object is an I/O error, not "missing".
    await expect(store.get('dir-as-object')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('refuses a relative root', () => {
    expect(() => new FilesystemObjectStore('relative/dir')).toThrow(/absolute/);
  });
});
