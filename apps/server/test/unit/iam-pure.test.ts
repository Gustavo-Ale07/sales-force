import { SESSION_COOKIE_NAME, routes } from '@salesforce/contracts';
import { describe, expect, it } from 'vitest';
import { checkCsrf } from '../../src/iam/csrf.js';
import {
  readCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from '../../src/iam/cookies.js';
import { Argon2idPasswordHasher } from '../../src/iam/password-hasher.js';
import {
  PASSWORD_MAX_LENGTH,
  checkPasswordPolicy,
  describePasswordViolations,
} from '../../src/iam/password-policy.js';
import { authorizeRoute, isChannelAllowed, ROUTE_POLICY } from '../../src/iam/policy.js';
import {
  activeLockUntil,
  applyFailure,
  lockDurationMs,
  type ThrottleRule,
  type ThrottleState,
} from '../../src/iam/throttle-policy.js';
import { TEST_HASH_PARAMS } from '../helpers/auth.js';

const RULE: ThrottleRule = { maxFailures: 3, windowMs: 60_000, baseLockMs: 10_000, maxLockMs: 40_000 };
const T0 = new Date('2026-09-21T12:00:00.000Z');
const at = (ms: number): Date => new Date(T0.getTime() + ms);

describe('throttle policy', () => {
  it('counts failures inside the window and locks on the limit', () => {
    let outcome = applyFailure(null, T0, RULE);
    expect(outcome).toMatchObject({ lockedNow: false, state: { failures: 1, lockoutCount: 0 } });
    outcome = applyFailure(outcome.state, at(1_000), RULE);
    expect(outcome.state.failures).toBe(2);
    outcome = applyFailure(outcome.state, at(2_000), RULE);
    expect(outcome.lockedNow).toBe(true);
    expect(outcome.state).toMatchObject({ failures: 0, lockoutCount: 1 });
    expect(outcome.state.lockedUntil?.getTime()).toBe(at(2_000 + 10_000).getTime());
  });

  it('forgets failures older than the window', () => {
    const first = applyFailure(null, T0, RULE);
    const later = applyFailure(first.state, at(RULE.windowMs), RULE);
    expect(later.state.failures).toBe(1);
    expect(later.state.windowStartedAt.getTime()).toBe(at(RULE.windowMs).getTime());
  });

  it('doubles the lockout each time and caps it', () => {
    expect([0, 1, 2, 3, 50].map((count) => lockDurationMs(count, RULE))).toEqual([10_000, 20_000, 40_000, 40_000, 40_000]);
  });

  it('does not extend or reset a lock that is still active', () => {
    const locked: ThrottleState = { failures: 0, windowStartedAt: T0, lockedUntil: at(10_000), lockoutCount: 1 };
    const outcome = applyFailure(locked, at(5_000), RULE);
    expect(outcome).toEqual({ state: locked, lockedNow: false });
  });

  it('reports the active lock only until it ends', () => {
    const locked: ThrottleState = { failures: 0, windowStartedAt: T0, lockedUntil: at(10_000), lockoutCount: 1 };
    expect(activeLockUntil(locked, at(9_999))?.getTime()).toBe(at(10_000).getTime());
    expect(activeLockUntil(locked, at(10_000))).toBeNull();
    expect(activeLockUntil(null, T0)).toBeNull();
  });

  it('escalates the next lockout after an expired one', () => {
    const locked: ThrottleState = { failures: 0, windowStartedAt: T0, lockedUntil: at(10_000), lockoutCount: 1 };
    let outcome = applyFailure(locked, at(11_000), RULE);
    outcome = applyFailure(outcome.state, at(12_000), RULE);
    outcome = applyFailure(outcome.state, at(13_000), RULE);
    expect(outcome.lockedNow).toBe(true);
    expect(outcome.state.lockedUntil?.getTime()).toBe(at(13_000 + 20_000).getTime());
    expect(outcome.state.lockoutCount).toBe(2);
  });
});

describe('password policy', () => {
  it('accepts a long passphrase', () => {
    expect(checkPasswordPolicy('Sturdy-Test-Passphrase-42')).toEqual([]);
  });

  it('rejects short, repetitive, common and over-long passwords', () => {
    expect(checkPasswordPolicy('short')).toEqual(['too_short']);
    expect(checkPasswordPolicy('aaaaaaaaaaaaaaaa')).toEqual(['too_repetitive']);
    expect(checkPasswordPolicy('Password 123456')).toContain('too_common');
    expect(checkPasswordPolicy('x1'.repeat(PASSWORD_MAX_LENGTH))).toContain('too_long');
  });

  it('counts characters, not UTF-16 units, and describes violations in pt-BR', () => {
    expect(checkPasswordPolicy('😀😁😂🤣😃😄😅😆😉😊😋😎')).toEqual([]);
    expect(describePasswordViolations(['too_short'])).toMatch(/pelo menos 12/);
  });
});

describe('CSRF check', () => {
  const allowed = ['https://app.example.com'];
  const check = (input: { method?: string; origin?: string; secFetchSite?: string }) =>
    checkCsrf({ method: input.method ?? 'POST', origin: input.origin, secFetchSite: input.secFetchSite }, allowed);

  it('never blocks safe methods', () => {
    expect(check({ method: 'GET', origin: 'https://evil.example.com' })).toEqual({ ok: true });
    expect(check({ method: 'head', origin: 'https://evil.example.com' })).toEqual({ ok: true });
  });

  it('requires an allowed Origin on state-changing requests', () => {
    expect(check({ origin: 'https://app.example.com' })).toEqual({ ok: true });
    expect(check({ origin: 'https://evil.example.com' })).toEqual({ ok: false, reason: 'origin_not_allowed' });
    expect(check({ origin: 'null' })).toEqual({ ok: false, reason: 'origin_not_allowed' });
    expect(check({ origin: 'https://app.example.com.evil.example.com' })).toEqual({ ok: false, reason: 'origin_not_allowed' });
  });

  it('Origin wins over Sec-Fetch-Site', () => {
    expect(check({ origin: 'https://evil.example.com', secFetchSite: 'same-origin' }).ok).toBe(false);
  });

  it('falls back to Sec-Fetch-Site and accepts header-less non-browser clients', () => {
    expect(check({ secFetchSite: 'same-origin' })).toEqual({ ok: true });
    expect(check({ secFetchSite: 'cross-site' })).toEqual({ ok: false, reason: 'cross_site_fetch' });
    expect(check({ secFetchSite: 'same-site' })).toEqual({ ok: false, reason: 'cross_site_fetch' });
    expect(check({})).toEqual({ ok: true });
  });
});

describe('central policy', () => {
  it('grants only explicit rows and denies everything else', () => {
    expect(authorizeRoute({ role: 'admin', channel: 'web' }, 'getConfiguration')).toEqual({ allowed: true });
    expect(authorizeRoute({ role: 'manager', channel: 'web' }, 'getConfiguration')).toEqual({
      allowed: false,
      reason: 'role_not_permitted',
    });
    expect(authorizeRoute({ role: 'admin', channel: 'web' }, 'someUnlistedOperation')).toEqual({
      allowed: false,
      reason: 'no_policy',
    });
  });

  it('is not fooled by inherited object keys', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(authorizeRoute({ role: 'admin', channel: 'web' }, name)).toEqual({ allowed: false, reason: 'no_policy' });
    }
  });

  it('fails closed for an unknown role and for inherited role keys', () => {
    for (const role of ['external_representative', 'root', 'constructor', '__proto__', '']) {
      expect(isChannelAllowed(role, 'web')).toBe(false);
      expect(authorizeRoute({ role, channel: 'web' }, 'logout')).toEqual({ allowed: false, reason: 'channel_not_permitted' });
    }
  });

  it('lets every known role end its own session', () => {
    for (const role of ['admin', 'manager', 'seller']) {
      expect(authorizeRoute({ role, channel: 'web' }, 'logout')).toEqual({ allowed: true });
    }
  });

  it('keeps the grant table free of cost/margin or export operations', () => {
    const granted = Object.keys(ROUTE_POLICY);
    // Every grant is a route of the registry (nothing invented), and none is a cost, margin or export operation.
    const known = new Set<string>(Object.values(routes).map((route) => route.operationId));
    for (const operationId of granted) expect(known.has(operationId), operationId).toBe(true);
    expect(granted.filter((operationId) => /export|cost|margin|commission/i.test(operationId))).toEqual([]);
  });
});

describe('session cookie', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');

  it('carries HttpOnly, SameSite=Lax, Path and the remaining lifetime', () => {
    const cookie = serializeSessionCookie('tok', new Date(now.getTime() + 90_500), now, { secure: true });
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=tok`);
    expect(cookie).toContain('Max-Age=90');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1');
    expect(cookie).toContain('Secure');
    expect(serializeSessionCookie('tok', now, now, { secure: false })).not.toContain('Secure');
  });

  it('never yields a negative Max-Age', () => {
    expect(serializeSessionCookie('tok', new Date(now.getTime() - 5_000), now, { secure: true })).toContain('Max-Age=0');
  });

  it('clears with the same scoping attributes', () => {
    const cleared = serializeClearedSessionCookie({ secure: true });
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Path=/api/v1');
    expect(cleared).toContain('HttpOnly');
  });

  it('reads one cookie by exact name', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE_NAME}=abc; b=2`, SESSION_COOKIE_NAME)).toBe('abc');
    expect(readCookie(`x${SESSION_COOKIE_NAME}=abc`, SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie([`a=1`, `${SESSION_COOKIE_NAME}=z`], SESSION_COOKIE_NAME)).toBe('z');
  });
});

describe('Argon2id password hasher', () => {
  const hasher = new Argon2idPasswordHasher(TEST_HASH_PARAMS);

  it('hashes to a salted PHC string that verifies only the right password', async () => {
    const first = await hasher.hash('Correct-Horse-Battery-1');
    const second = await hasher.hash('Correct-Horse-Battery-1');
    expect(first).toMatch(/^\$argon2id\$v=19\$m=64,t=1,p=1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('Correct-Horse');
    await expect(hasher.verify(first, 'Correct-Horse-Battery-1')).resolves.toBe(true);
    await expect(hasher.verify(first, 'Correct-Horse-Battery-2')).resolves.toBe(false);
  });

  it('never verifies an unknown account or a malformed hash, and does not throw', async () => {
    await expect(hasher.verify(null, 'anything-at-all-123')).resolves.toBe(false);
    await expect(hasher.verify('not-a-hash', 'anything-at-all-123')).resolves.toBe(false);
    await expect(hasher.verify('$argon2id$v=19$m=64,t=1,p=1$bad$bad', 'x')).resolves.toBe(false);
  });

  it('asks for a rehash when the stored parameters are weaker', async () => {
    const stored = await hasher.hash('Correct-Horse-Battery-1');
    expect(hasher.needsRehash(stored)).toBe(false);
    expect(new Argon2idPasswordHasher({ memoryKib: 128, timeCost: 1, parallelism: 1 }).needsRehash(stored)).toBe(true);
    expect(new Argon2idPasswordHasher({ memoryKib: 64, timeCost: 2, parallelism: 1 }).needsRehash(stored)).toBe(true);
    expect(hasher.needsRehash('$2b$10$legacybcrypthash')).toBe(true);
  });
});
