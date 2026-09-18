import { describe, expect, it } from 'vitest';
import {
  canActorSeeCustomer,
  defaultUnconfiguredConfiguration,
  isCustomerInScope,
  resolveCustomerScope,
  type InstallationConfiguration,
  type PortfolioOwnershipStrategy,
  type ScopeActor,
} from '../src/index.js';
import { makeConfig, makeCustomer } from './fixtures.js';

const configWith = (
  strategy: PortfolioOwnershipStrategy,
  links: InstallationConfiguration['customers']['accountSellerLinks'] = [],
): InstallationConfiguration =>
  makeConfig((c) => ({
    ...c,
    customers: { ...c.customers, portfolioOwnership: { strategy }, accountSellerLinks: links },
  }));

const seller = (linked: number[] = [], email = 'vend@example.test'): ScopeActor => ({
  role: 'seller',
  accountEmail: email,
  linkedSellerCodes: linked,
});
const manager: ScopeActor = { role: 'manager', accountEmail: 'ger@example.test', linkedSellerCodes: [] };
const admin: ScopeActor = { role: 'admin', accountEmail: 'adm@example.test', linkedSellerCodes: [] };

describe('customer scope by portfolioOwnership strategy', () => {
  describe('all_visible', () => {
    const config = configWith('all_visible');
    it.each([seller(), manager, admin])('$role sees everyone', (actor) => {
      expect(resolveCustomerScope(actor, config)).toEqual({ kind: 'all' });
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: null }), config)).toBe(true);
    });
  });

  describe('customer_seller_field', () => {
    const config = configWith('customer_seller_field');
    it('seller sees customers of linked sellers only', () => {
      const actor = seller([900, 901]);
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 900 }), config)).toBe(true);
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 901 }), config)).toBe(true);
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 902 }), config)).toBe(false);
    });
    it('customer without a seller is invisible to a seller', () => {
      expect(canActorSeeCustomer(seller([900]), makeCustomer({ sellerCode: null }), config)).toBe(false);
    });
    it('seller without links sees nothing', () => {
      expect(resolveCustomerScope(seller([]), config)).toEqual({ kind: 'sellers', sellerCodes: [] });
      expect(canActorSeeCustomer(seller([]), makeCustomer(), config)).toBe(false);
    });
    it('ignores the configuration links (identity links are the source)', () => {
      const withCfgLinks = configWith('customer_seller_field', [
        { accountEmail: 'vend@example.test', sellerCode: 900 },
      ]);
      expect(canActorSeeCustomer(seller([]), makeCustomer({ sellerCode: 900 }), withCfgLinks)).toBe(false);
    });
    it('manager and admin see everything', () => {
      for (const actor of [manager, admin]) {
        expect(resolveCustomerScope(actor, config)).toEqual({ kind: 'all' });
      }
    });
    it('de-duplicates codes', () => {
      expect(resolveCustomerScope(seller([900, 900]), config)).toEqual({ kind: 'sellers', sellerCodes: [900] });
    });
  });

  describe('explicit_account_links', () => {
    const config = configWith('explicit_account_links', [
      { accountEmail: 'Vend@Example.test', sellerCode: 900 },
      { accountEmail: 'vend@example.test', sellerCode: 905 },
      { accountEmail: 'outro@example.test', sellerCode: 910 },
    ]);
    it('matches the account e-mail case-insensitively and lists its sellers', () => {
      expect(resolveCustomerScope(seller([], ' VEND@example.test '), config)).toEqual({
        kind: 'sellers',
        sellerCodes: [900, 905],
      });
    });
    it('sees only customers of linked sellers', () => {
      const actor = seller([], 'vend@example.test');
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 905 }), config)).toBe(true);
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 910 }), config)).toBe(false);
    });
    it('ignores identity links; an unlinked account sees nothing', () => {
      expect(canActorSeeCustomer(seller([900], 'ninguem@example.test'), makeCustomer({ sellerCode: 900 }), config)).toBe(false);
    });
    it('manager and admin see everything', () => {
      expect(canActorSeeCustomer(manager, makeCustomer({ sellerCode: 999 }), config)).toBe(true);
      expect(canActorSeeCustomer(admin, makeCustomer({ sellerCode: null }), config)).toBe(true);
    });
  });

  it('isCustomerInScope works on a precomputed scope', () => {
    expect(isCustomerInScope({ sellerCode: 1 }, { kind: 'sellers', sellerCodes: [1] })).toBe(true);
    expect(isCustomerInScope({ sellerCode: 2 }, { kind: 'sellers', sellerCodes: [1] })).toBe(false);
    expect(isCustomerInScope({ sellerCode: null }, { kind: 'all' })).toBe(true);
  });

  it('the unconfigured default is restrictive for sellers', () => {
    const unconfigured = defaultUnconfiguredConfiguration();
    expect(canActorSeeCustomer(seller([900]), makeCustomer({ sellerCode: 900 }), unconfigured)).toBe(false);
    expect(canActorSeeCustomer(manager, makeCustomer({ sellerCode: 900 }), unconfigured)).toBe(true);
  });
});
