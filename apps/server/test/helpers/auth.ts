import { SESSION_COOKIE_NAME } from '@salesforce/contracts';
import type { DbHandle } from '@salesforce/db';
import type { AccountRole } from '@salesforce/domain';
import type { LightMyRequestResponse } from 'fastify';
import { createOperatorAccountService } from '../../src/cli/operator.js';
import { DEFAULT_ACCOUNT_THROTTLE, DEFAULT_IP_THROTTLE, type AuthConfig } from '../../src/iam/auth-config.js';
import type { Clock } from '../../src/platform/tokens.js';

/** Passes the password policy; synthetic, used only against disposable test databases. */
export const TEST_PASSWORD = 'Sturdy-Test-Passphrase-42';
export const WRONG_PASSWORD = 'Definitely-Not-The-Passphrase-7';
export const TEST_ORIGIN = 'http://localhost:5173';

/** Minimal Argon2id cost: keeps the suites fast. The production floor is enforced by the env schema. */
export const TEST_HASH_PARAMS = { memoryKib: 64, timeCost: 1, parallelism: 1 } as const;

export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    authMode: 'dev',
    secureCookies: true,
    allowedOrigins: [TEST_ORIGIN],
    sessionIdleMs: 30 * 60_000,
    sessionAbsoluteMs: 8 * 60 * 60_000,
    sessionTouchIntervalMs: 60_000,
    passwordHash: TEST_HASH_PARAMS,
    throttle: { account: DEFAULT_ACCOUNT_THROTTLE, ip: DEFAULT_IP_THROTTLE },
    login: { maxConcurrentHashes: 8, globalMaxFailuresPerMinute: 300, blockedAuditWindowMs: 60_000 },
    ...overrides,
  };
}

/** A clock the test moves by hand. */
export class TestClock {
  #now: number;
  constructor(start: Date = new Date('2026-09-21T12:00:00.000Z')) {
    this.#now = start.getTime();
  }
  readonly fn: Clock = () => new Date(this.#now);
  advance(ms: number): void {
    this.#now += ms;
  }
}

export interface TestAccount {
  readonly id: string;
  readonly username: string;
  readonly role: AccountRole;
}

/** Creates an account through the same service the CLI uses (policy, hashing, audit). */
export async function createTestAccount(
  handle: DbHandle,
  input: { username: string; role: AccountRole; password?: string; displayName?: string },
  clock?: Clock,
): Promise<TestAccount> {
  const { accounts } = createOperatorAccountService(handle, TEST_HASH_PARAMS, clock);
  const id = await accounts.createAccount({
    username: input.username,
    displayName: input.displayName ?? `Test ${input.role}`,
    role: input.role,
    password: input.password ?? TEST_PASSWORD,
  });
  return { id, username: input.username, role: input.role };
}

export function setCookieHeaders(response: Pick<LightMyRequestResponse, 'headers'>): string[] {
  const value = response.headers['set-cookie'];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [String(value)];
}

/** `sf_session=<token>` pair from a login response, ready for a `cookie` request header. */
export function sessionCookieOf(response: Pick<LightMyRequestResponse, 'headers'>): string {
  const header = setCookieHeaders(response).find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (header === undefined) throw new Error('response has no session cookie');
  const [pair = ''] = header.split(';');
  return pair;
}

export function tokenOf(cookiePair: string): string {
  return cookiePair.slice(SESSION_COOKIE_NAME.length + 1);
}
