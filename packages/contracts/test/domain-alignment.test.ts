import type {
  AccountRole as DomainAccountRole,
  ConfigurationSourceKind as DomainConfigurationSourceKind,
  ConfirmationBehavior as DomainConfirmationBehavior,
  CustomerWithoutPriceTablePolicy as DomainCustomerWithoutPriceTablePolicy,
  DraftIssueCode as DomainDraftIssueCode,
  FallbackStrategy as DomainFallbackStrategy,
  InstallationConfiguration as DomainInstallationConfiguration,
  ListPriceState as DomainListPriceState,
  NoPriceReason as DomainNoPriceReason,
  OrderItem as DomainOrderItem,
  OrderStatus as DomainOrderStatus,
  OrderTotals as DomainOrderTotals,
  PortfolioOwnershipStrategy as DomainPortfolioOwnershipStrategy,
} from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import type {
  AccountRole,
  ConfigurationSourceKind,
  ConfirmationBehavior,
  CustomerWithoutPriceTablePolicy,
  DraftIssueCode,
  FallbackStrategy,
  InstallationConfiguration,
  ListPriceState,
  NoPriceReason,
  OrderItem,
  OrderStatus,
  OrderTotals,
  PortfolioOwnershipStrategy,
} from '../src/index.js';
import type { Assert, DeepMutable, Equals } from '../src/type-utils.js';
import { InstallationConfigurationSchema } from '../src/index.js';
import { makeConfig } from './fixtures.js';

/*
 * Compile-time checks (they fail `pnpm typecheck`, not the test run): the contracts must describe
 * exactly the domain vocabulary. There is no runtime assertion in this file's type section.
 */
export type Checks = [
  Assert<Equals<OrderStatus, DomainOrderStatus>>,
  Assert<Equals<ListPriceState, DomainListPriceState>>,
  Assert<Equals<NoPriceReason, DomainNoPriceReason>>,
  Assert<Equals<AccountRole, DomainAccountRole>>,
  Assert<Equals<ConfigurationSourceKind, DomainConfigurationSourceKind>>,
  Assert<Equals<ConfirmationBehavior, DomainConfirmationBehavior>>,
  Assert<Equals<PortfolioOwnershipStrategy, DomainPortfolioOwnershipStrategy>>,
  Assert<Equals<CustomerWithoutPriceTablePolicy, DomainCustomerWithoutPriceTablePolicy>>,
  Assert<Equals<FallbackStrategy, DomainFallbackStrategy>>,
  Assert<Equals<DraftIssueCode, DomainDraftIssueCode>>,
  Assert<Equals<DeepMutable<DomainOrderItem>, OrderItem>>,
  Assert<Equals<DeepMutable<DomainOrderTotals>, OrderTotals>>,
];

// The helper really detects differences (negative controls).
type Drifted = DeepMutable<DomainInstallationConfiguration> & { extra: string };
// @ts-expect-error a type with an extra required key is not equal
export type _NegativeExtraKey = Assert<Equals<Drifted, DeepMutable<InstallationConfiguration>>>;
// @ts-expect-error a narrower enum is not equal
export type _NegativeEnum = Assert<Equals<'draft' | 'cancelled', OrderStatus>>;

describe('domain alignment (runtime)', () => {
  it('a parsed configuration is directly usable as the domain type', () => {
    const parsed: DomainInstallationConfiguration =
      InstallationConfigurationSchema.parse(makeConfig());
    expect(parsed.schemaVersion).toBe(1);
  });
});
