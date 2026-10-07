import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * API-side settings of the directory (Sankhya user) login (AUTH-5, STACK-2a). The API holds NO Sankhya setting: it only
 * knows where the internal verifier is and the shared Bearer secret that proves the call comes from the API.
 * Off unless `EXTERNAL_LOGIN_ENABLED=1`; when on, the verifier URL and exactly one secret source are required
 * (fail closed on boot, values never echoed).
 */
export const externalLoginFields = {
  EXTERNAL_LOGIN_ENABLED: z.enum(['0', '1'], { error: "must be '0' or '1'." }).default('0'),
  /** Internal network URL of the verifier, e.g. `http://verifier:3002`. */
  VERIFIER_URL: z.string().optional(),
  VERIFIER_SHARED_SECRET: z.string().optional(),
  VERIFIER_SHARED_SECRET_FILE: z.string().min(1).optional(),
};

export const MIN_VERIFIER_SECRET_LENGTH = 32;

interface ExternalLoginInput {
  readonly EXTERNAL_LOGIN_ENABLED: '0' | '1';
  readonly VERIFIER_URL?: string | undefined;
  readonly VERIFIER_SHARED_SECRET?: string | undefined;
  readonly VERIFIER_SHARED_SECRET_FILE?: string | undefined;
}

export function externalLoginProblems(parsed: ExternalLoginInput): string[] {
  if (parsed.EXTERNAL_LOGIN_ENABLED !== '1') return [];
  const problems: string[] = [];
  if (parsed.VERIFIER_URL === undefined || parsed.VERIFIER_URL.trim() === '') {
    problems.push('VERIFIER_URL: is required when EXTERNAL_LOGIN_ENABLED=1.');
  } else {
    try {
      const url = new URL(parsed.VERIFIER_URL.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
      if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') throw new Error('parts');
    } catch {
      problems.push('VERIFIER_URL: must be an http(s) URL of the internal verifier without credentials, query or fragment.');
    }
  }
  const hasInline = parsed.VERIFIER_SHARED_SECRET !== undefined;
  const hasFile = parsed.VERIFIER_SHARED_SECRET_FILE !== undefined;
  if (hasInline === hasFile) problems.push('VERIFIER_SHARED_SECRET / VERIFIER_SHARED_SECRET_FILE: set exactly one when EXTERNAL_LOGIN_ENABLED=1.');
  return problems;
}

export interface ExternalVerifierSettings {
  readonly url: string;
  readonly sharedSecret: string;
}

/** Resolved settings, or `null` when the directory login is off. Throws a value-free message when the secret is unusable. */
export function externalVerifierOf(
  parsed: ExternalLoginInput,
  readSecretFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): ExternalVerifierSettings | null {
  if (parsed.EXTERNAL_LOGIN_ENABLED !== '1' || parsed.VERIFIER_URL === undefined) return null;
  let secret = parsed.VERIFIER_SHARED_SECRET;
  if (secret === undefined && parsed.VERIFIER_SHARED_SECRET_FILE !== undefined) {
    try {
      secret = readSecretFile(parsed.VERIFIER_SHARED_SECRET_FILE).replace(/[\r\n]+$/, '');
    } catch {
      throw new Error('VERIFIER_SHARED_SECRET_FILE: the file cannot be read.');
    }
  }
  if (secret === undefined || secret.length < MIN_VERIFIER_SECRET_LENGTH) {
    throw new Error(`VERIFIER_SHARED_SECRET: must be at least ${MIN_VERIFIER_SECRET_LENGTH} characters.`);
  }
  return { url: parsed.VERIFIER_URL.trim(), sharedSecret: secret };
}
