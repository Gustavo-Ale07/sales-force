import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/**
 * Object storage port (P-17: blobs live in object storage, metadata in PostgreSQL). The product photo
 * pipeline depends on this interface only; where the bytes physically are is an adapter decision.
 *
 * Keys are opaque, server-built, content-addressed strings (`product-images/<code>/<sha256>`): never
 * derived from client input. Every adapter refuses keys that are not `isValidObjectKey`.
 *
 * `FilesystemObjectStore` below is an INTERIM adapter (a mounted persistent volume). The target is a
 * managed S3-compatible private bucket per environment (STACK-7, V-05: provider undecided); that
 * adapter will implement this same interface. The substitution is an owner decision, flagged in
 * `docs/implementation/product-media.md`; it is never silent.
 */
export interface ObjectStore {
  /** Stores `bytes` under `key`. Atomic (a reader never sees a partial object) and idempotent. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /**
   * The object, or `null` when it does not exist. Any other failure rejects with an `ObjectStoreError`.
   * With `expectedBytes` / `maxBytes` the size is checked BEFORE reading (a wrong-sized or oversized
   * object rejects with `size_mismatch` without being loaded into memory).
   */
  get(key: string, options?: ObjectReadOptions): Promise<Uint8Array | null>;
  has(key: string): Promise<boolean>;
  /** Removes the object; a missing object is not an error. */
  delete(key: string): Promise<void>;
}

export interface ObjectReadOptions {
  /** The object must be exactly this long. */
  readonly expectedBytes?: number;
  /** The object must not be longer than this. */
  readonly maxBytes?: number;
}

export type ObjectStoreErrorCode = 'invalid_key' | 'unavailable' | 'size_mismatch';

/**
 * `invalid_key` is a programming error (never retried); `unavailable` is an infrastructure condition
 * (retryable); `size_mismatch` is a stored object whose size contradicts its record (corruption, not retried).
 */
export class ObjectStoreError extends Error {
  readonly code: ObjectStoreErrorCode;

  constructor(code: ObjectStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ObjectStoreError';
    this.code = code;
  }
}

export function isObjectStoreError(value: unknown): value is ObjectStoreError {
  return value instanceof ObjectStoreError;
}

/**
 * Segments of letters, digits, `.`, `_`, `-`, starting and ending with a letter or digit (no hidden
 * names, no `.`/`..`, no trailing dot that some filesystems drop), separated by single `/`.
 */
const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const MAX_KEY_LENGTH = 256;
const MAX_SEGMENTS = 6;

export function isValidObjectKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  const segments = key.split('/');
  return segments.length <= MAX_SEGMENTS && segments.every((segment) => SEGMENT.test(segment));
}

const STAGING_DIR = '.tmp';

function errno(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

function unavailable(operation: string, cause: unknown): ObjectStoreError {
  // The message never carries a filesystem path: it can reach the integration status and the logs.
  const code = errno(cause);
  return new ObjectStoreError('unavailable', `Object store ${operation} failed${code === undefined ? '' : ` (${code})`}.`, { cause });
}

/**
 * Interim adapter over a persistent directory (a mounted volume, never the container filesystem, never
 * Git, never a Docker image). Writes go to a staging file inside the same directory tree and are
 * renamed into place, so a crash or a concurrent reader never observes a partial object.
 */
export class FilesystemObjectStore implements ObjectStore {
  readonly #root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error('The object store directory must be an absolute path.');
    this.#root = resolve(root);
  }

  #pathOf(key: string): string {
    if (!isValidObjectKey(key)) throw new ObjectStoreError('invalid_key', 'Invalid object key.');
    const path = resolve(this.#root, ...key.split('/'));
    // Defence in depth: validated keys cannot climb out of the root, but this is checked anyway.
    if (!path.startsWith(this.#root + sep)) throw new ObjectStoreError('invalid_key', 'Invalid object key.');
    return path;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.#pathOf(key);
    const stagingDir = join(this.#root, STAGING_DIR);
    const staged = join(stagingDir, randomUUID());
    try {
      await mkdir(stagingDir, { recursive: true });
      const file = await open(staged, 'wx');
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await mkdir(dirname(target), { recursive: true });
      await rename(staged, target);
    } catch (error) {
      await rm(staged, { force: true }).catch(() => undefined);
      throw unavailable('write', error);
    }
  }

  async get(key: string, options: ObjectReadOptions = {}): Promise<Uint8Array | null> {
    const target = this.#pathOf(key);
    try {
      if (options.expectedBytes !== undefined || options.maxBytes !== undefined) {
        const { size } = await stat(target);
        if ((options.expectedBytes !== undefined && size !== options.expectedBytes) || (options.maxBytes !== undefined && size > options.maxBytes)) {
          throw new ObjectStoreError('size_mismatch', 'Object store read refused: the object size does not match its record.');
        }
      }
      return new Uint8Array(await readFile(target));
    } catch (error) {
      if (error instanceof ObjectStoreError) throw error;
      if (errno(error) === 'ENOENT' || errno(error) === 'ENOTDIR') return null;
      throw unavailable('read', error);
    }
  }

  async has(key: string): Promise<boolean> {
    const target = this.#pathOf(key);
    try {
      return (await stat(target)).isFile();
    } catch (error) {
      if (errno(error) === 'ENOENT' || errno(error) === 'ENOTDIR') return false;
      throw unavailable('stat', error);
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.#pathOf(key);
    try {
      await rm(target, { force: true });
    } catch (error) {
      throw unavailable('delete', error);
    }
  }
}
