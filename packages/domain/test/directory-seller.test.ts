import { describe, expect, it } from 'vitest';
import { decideDirectorySeller, parseDirectoryUserCode, type DirectoryFacts } from '../src/index.js';

const MAX = 2 * 60 * 60 * 1000;
const good: DirectoryFacts = { user: { sellerCode: 5 }, sellerActive: true, otherUsersOfSeller: 0, otherAccountsOfSeller: 0, mirrorAgeMs: 1000 };

describe('parseDirectoryUserCode', () => {
  it('accepts only a plain positive decimal that fits 32 bits', () => {
    expect(parseDirectoryUserCode('7')).toBe(7);
    expect(parseDirectoryUserCode('2147483647')).toBe(2_147_483_647);
    for (const bad of ['', '0', '07', '-1', '1.5', '1e3', ' 7', '7 ', 'abc', '2147483648', '99999999999']) {
      expect(parseDirectoryUserCode(bad)).toBeNull();
    }
  });
});

describe('decideDirectorySeller', () => {
  it('accepts an active, unambiguous, unclaimed seller from a fresh mirror', () => {
    expect(decideDirectorySeller(good, MAX)).toEqual({ ok: true, sellerCode: 5 });
  });

  it('refuses a never-synchronized or stale mirror first (fail closed)', () => {
    expect(decideDirectorySeller({ ...good, mirrorAgeMs: null }, MAX)).toEqual({ ok: false, refusal: 'directory_stale' });
    expect(decideDirectorySeller({ ...good, mirrorAgeMs: MAX + 1 }, MAX)).toEqual({ ok: false, refusal: 'directory_stale' });
    expect(decideDirectorySeller({ ...good, mirrorAgeMs: MAX }, MAX).ok).toBe(true);
  });

  it.each([
    ['user_missing', { user: null }],
    ['no_seller', { user: { sellerCode: null } }],
    ['no_seller', { user: { sellerCode: 0 } }],
    ['seller_inactive', { sellerActive: false }],
    ['seller_ambiguous', { otherUsersOfSeller: 1 }],
    ['seller_claimed', { otherAccountsOfSeller: 1 }],
  ] as const)('refuses with %s', (refusal, patch) => {
    expect(decideDirectorySeller({ ...good, ...patch }, MAX)).toEqual({ ok: false, refusal });
  });

  it('reports ambiguity before a claim by another account', () => {
    expect(decideDirectorySeller({ ...good, otherUsersOfSeller: 2, otherAccountsOfSeller: 1 }, MAX)).toEqual({ ok: false, refusal: 'seller_ambiguous' });
  });
});
