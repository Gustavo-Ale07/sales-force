import { randomBytes } from 'node:crypto';
import { argon2Verify, argon2id } from 'hash-wasm';
import type { PasswordHashParams } from '../config/auth-env.js';

/**
 * Password hashing port (P-11). The rest of the module depends on this interface only, so the
 * implementation can be replaced (for example by `node:crypto` `argon2` once the Node baseline has
 * it) without touching the login flow.
 */
export interface PasswordHasher {
  /** Argon2id PHC string (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`). */
  hash(password: string): Promise<string>;
  /**
   * Verifies a password. With `storedHash === null` (unknown account) it performs the same work
   * against a throw-away hash and returns `false`, so an unknown e-mail costs the same time as a
   * wrong password (no user enumeration by timing).
   */
  verify(storedHash: string | null, password: string): Promise<boolean>;
  /** True when the stored hash was made with weaker parameters than the configured ones. */
  needsRehash(storedHash: string): boolean;
  /** Precomputes the throw-away hash used for unknown accounts (once, at start-up). */
  warmUp(): Promise<void>;
}

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const PHC_PARAMS = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/;

/**
 * Argon2id through `hash-wasm` (pure WebAssembly, no native build step or install script, no
 * dependencies). Trade-off: the WASM work runs on the event loop (~100 ms at the OWASP minimum
 * cost). Login throttling rejects blocked keys before any hashing happens, which bounds the
 * exposure; a thread-pool implementation can replace this class behind `PasswordHasher`.
 */
export class Argon2idPasswordHasher implements PasswordHasher {
  #dummyHash: Promise<string> | undefined;

  constructor(private readonly params: PasswordHashParams) {}

  hash(password: string): Promise<string> {
    return argon2id({
      password,
      salt: randomBytes(SALT_BYTES),
      parallelism: this.params.parallelism,
      iterations: this.params.timeCost,
      memorySize: this.params.memoryKib,
      hashLength: HASH_BYTES,
      outputType: 'encoded',
    });
  }

  /** The throw-away hash, computed once with the configured parameters (never per request). */
  #dummy(): Promise<string> {
    this.#dummyHash ??= this.hash(randomBytes(24).toString('base64url'));
    return this.#dummyHash;
  }

  async warmUp(): Promise<void> {
    await this.#dummy();
  }

  async verify(storedHash: string | null, password: string): Promise<boolean> {
    if (storedHash === null) {
      await argon2Verify({ password, hash: await this.#dummy() });
      return false;
    }
    try {
      return await argon2Verify({ password, hash: storedHash });
    } catch {
      // A malformed stored hash (e.g. the unusable marker of a directory account) must not become a 500 or a timing
      // signal: it never verifies, after the same work as an unknown account.
      await argon2Verify({ password, hash: await this.#dummy() });
      return false;
    }
  }

  needsRehash(storedHash: string): boolean {
    const match = PHC_PARAMS.exec(storedHash);
    if (match === null) return true;
    const [, memory, time, parallelism] = match;
    return (
      Number(memory) < this.params.memoryKib ||
      Number(time) < this.params.timeCost ||
      Number(parallelism) !== this.params.parallelism
    );
  }
}
