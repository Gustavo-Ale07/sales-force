import { describe, expect, it } from 'vitest';
import {
  canActorSeeCustomer,
  defaultUnconfiguredConfiguration,
  isCustomerInScope,
  resolveCustomerScope,
  resolveCustomerScopeOutcome,
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
    it.each([manager, admin])('$role (administrative/managerial) sees everyone', (actor) => {
      expect(resolveCustomerScope(actor, config)).toEqual({ kind: 'all' });
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: null }), config)).toBe(true);
    });
    it('a linked operational seller is NEVER global: scope comes from the link only', () => {
      const actor = seller([900]);
      expect(resolveCustomerScope(actor, config)).toEqual({ kind: 'sellers', sellerCodes: [900] });
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 900 }), config)).toBe(true);
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 901 }), config)).toBe(false);
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: null }), config)).toBe(false);
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 0 }), config)).toBe(false);
    });
    it('a seller linked through configuration only is still a seller scope', () => {
      const withLink = configWith('all_visible', [{ accountEmail: 'vend@example.test', sellerCode: 905 }]);
      expect(resolveCustomerScope(seller([]), withLink)).toEqual({ kind: 'sellers', sellerCodes: [905] });
    });
    it('never widens a seller without a valid seller link (F1)', () => {
      for (const actor of [seller([]), seller([0]), seller([-3, 1.5])]) {
        expect(resolveCustomerScope(actor, config)).toEqual({ kind: 'sellers', sellerCodes: [] });
        expect(resolveCustomerScopeOutcome(actor, config)).toEqual({ ok: false, reason: 'no_seller_scope' });
        expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 900 }), config)).toBe(false);
      }
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

  describe('outcome (F1/F2)', () => {
    it.each(['all_visible', 'customer_seller_field', 'explicit_account_links'] as const)(
      'seller without a valid link is no_seller_scope under %s',
      (strategy) => {
        const config = configWith(strategy, [{ accountEmail: 'vend@example.test', sellerCode: 0 }]);
        expect(resolveCustomerScopeOutcome(seller([0]), config)).toEqual({ ok: false, reason: 'no_seller_scope' });
        expect(resolveCustomerScopeOutcome(seller([]), config)).toEqual({ ok: false, reason: 'no_seller_scope' });
      },
    );
    it('seller with a valid link gets sellers (invalid codes dropped)', () => {
      expect(resolveCustomerScopeOutcome(seller([0, 900]), configWith('customer_seller_field'))).toEqual({
        ok: true,
        scope: { kind: 'sellers', sellerCodes: [900] },
      });
    });
    it('admin and manager are all', () => {
      expect(resolveCustomerScopeOutcome(manager, configWith('customer_seller_field'))).toEqual({
        ok: true,
        scope: { kind: 'all' },
      });
      expect(resolveCustomerScopeOutcome(admin, configWith('explicit_account_links'))).toEqual({
        ok: true,
        scope: { kind: 'all' },
      });
    });
    it('technical (ROLE-1) gets no portfolio scope, whatever the strategy or links', () => {
      for (const strategy of ['all_visible', 'customer_seller_field', 'explicit_account_links'] as const) {
        const tech: ScopeActor = { role: 'technical', accountEmail: 'x@example.test', linkedSellerCodes: [900] };
        expect(resolveCustomerScopeOutcome(tech, configWith(strategy))).toEqual({ ok: false, reason: 'role_not_permitted' });
      }
    });
    it('any other role is denied, never all', () => {
      const rogue = { role: 'representative', accountEmail: 'x@example.test', linkedSellerCodes: [900] } as unknown as ScopeActor;
      expect(resolveCustomerScopeOutcome(rogue, configWith('all_visible'))).toEqual({ ok: false, reason: 'role_not_permitted' });
      expect(resolveCustomerScope(rogue, configWith('all_visible'))).toEqual({ kind: 'sellers', sellerCodes: [] });
    });
    it('a customer whose seller is 0 is invisible to a seller linked to 0 (F2)', () => {
      const scope = { kind: 'sellers', sellerCodes: [0] } as const;
      expect(isCustomerInScope({ sellerCode: 0 }, scope)).toBe(false);
      expect(isCustomerInScope({ sellerCode: null }, scope)).toBe(false);
    });
  });

  describe('profile x strategy matrix: only admin/manager are global, whatever the strategy', () => {
    const strategies = ['all_visible', 'customer_seller_field', 'explicit_account_links'] as const;
    const linkCfg = [{ accountEmail: 'vend@example.test', sellerCode: 900 }];
    const roles = ['seller', 'manager', 'admin'] as const;
    it.each(strategies.flatMap((s) => roles.map((r) => [s, r] as const)))('%s / %s', (strategy, role) => {
      const config = configWith(strategy, linkCfg);
      const actor: ScopeActor = { role, accountEmail: 'vend@example.test', linkedSellerCodes: [900] };
      const outcome = resolveCustomerScopeOutcome(actor, config);
      if (role === 'seller') {
        expect(outcome).toEqual({ ok: true, scope: { kind: 'sellers', sellerCodes: [900] } });
        expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 901 }), config)).toBe(false);
      } else {
        expect(outcome).toEqual({ ok: true, scope: { kind: 'all' } });
      }
    });
    it.each(strategies)('a seller with only the seller code 0 / null customers never gets a global portfolio (%s)', (strategy) => {
      const config = configWith(strategy, linkCfg);
      const actor = seller([900]);
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: 0 }), config)).toBe(false);
      expect(canActorSeeCustomer(actor, makeCustomer({ sellerCode: null }), config)).toBe(false);
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
