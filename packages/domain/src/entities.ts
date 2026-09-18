import type { DecimalString } from './money.js';

/**
 * Sales Force-shaped entities. No ERP table or column names appear here: the integration
 * package maps ERP data into these shapes (P-02, ARCH-1).
 */

/** ISO-8601 timestamp string, e.g. `2026-01-31T12:00:00.000Z`. Domain code never reads the clock. */
export type IsoTimestamp = string;
/** ISO-8601 calendar date, e.g. `2026-01-31`. */
export type IsoDate = string;

export type AccountRole = 'admin' | 'manager' | 'seller';
export const ACCOUNT_ROLES: readonly AccountRole[] = ['admin', 'manager', 'seller'];

export interface Seller {
  readonly code: number;
  readonly name: string;
  readonly active: boolean;
}

export interface Customer {
  readonly code: number;
  readonly name: string;
  readonly tradeName: string | null;
  readonly document: string | null;
  readonly active: boolean;
  /** Blocked flag as mirrored; its business meaning is configuration/rule territory, not decided here. */
  readonly blocked: boolean;
  /** Seller recorded on the customer, if any. */
  readonly sellerCode: number | null;
  /** `null` means the customer has no price table of its own ("no resolved table" unless a fallback applies). */
  readonly priceTableCode: number | null;
  readonly creditLimit: DecimalString | null;
}

export interface ProductGroup {
  readonly code: number;
  readonly name: string;
}

export interface Product {
  readonly code: number;
  readonly description: string;
  readonly active: boolean;
  /** Raw usage code as mirrored. Whether it makes the product sellable is decided by configuration only. */
  readonly usageCode: string | null;
  readonly groupCode: number | null;
  readonly unit: string;
  readonly brand: string | null;
  readonly reference: string | null;
}

export interface PriceTable {
  readonly code: number;
  readonly name: string;
  readonly active: boolean;
  readonly originTableCode: number | null;
  readonly percent: DecimalString | null;
}

export interface PriceTableVersion {
  readonly versionId: number;
  readonly tableCode: number;
  readonly effectiveFrom: IsoTimestamp;
}

/**
 * Price state of a product in a table version.
 * - `priced`: a row exists with a value above zero.
 * - `zero`: a row exists and is explicitly zero (kept distinct from no price).
 * - `none`: no row / no table / no version. Missing price is never treated as 0.
 */
export type ListPriceState = 'priced' | 'zero' | 'none';
export const LIST_PRICE_STATES: readonly ListPriceState[] = ['priced', 'zero', 'none'];

export interface ListPrice {
  readonly versionId: number;
  readonly productCode: number;
  readonly unitPrice: DecimalString;
}

export type NoPriceReason = 'no_resolved_table' | 'no_effective_version' | 'no_price_row';

export type ResolvedPrice =
  | {
      readonly state: 'priced';
      readonly unitPrice: DecimalString;
      readonly tableCode: number;
      readonly versionId: number;
    }
  | {
      readonly state: 'zero';
      readonly unitPrice: DecimalString;
      readonly tableCode: number;
      readonly versionId: number;
    }
  | {
      readonly state: 'none';
      readonly reason: NoPriceReason;
      readonly tableCode: number | null;
      readonly versionId: number | null;
    };

/** Type only (financial area is out of the slice's rules). Shape is provisional. */
export interface FinancialTitle {
  readonly id: string;
  readonly customerCode: number;
  readonly dueDate: IsoDate;
  readonly openAmount: DecimalString;
}

export interface OrderItem {
  readonly lineNo: number;
  readonly productCode: number;
  readonly productDescription: string;
  readonly unit: string;
  readonly quantity: DecimalString;
  /** `null` when the price state is `none`. */
  readonly unitListPrice: DecimalString | null;
  readonly priceState: ListPriceState;
  readonly priceTableCode: number | null;
  readonly priceVersionId: number | null;
  /** Estimate from list price only; `null` when the price state is `none`. */
  readonly estimatedLineTotal: DecimalString | null;
}
