import type { Customer } from './entities.js';
import { isValidSellerCode } from './scope.js';

/**
 * Why a customer cannot (any longer) receive an order. Pure and deterministic; the server applies it at
 * creation, replacement and submission, and reads it to flag existing drafts as needing review.
 * Reasons are listed by precedence: not available, inactive, blocked, then no valid seller.
 */
export type CustomerOrderBlock =
  | 'customer_unavailable'
  | 'customer_inactive'
  | 'customer_blocked'
  | 'customer_without_seller';

/** An operational seller is a Sankhya CODVEND >= 1; 0, null, negatives and fractions never are (P-21). */
export function isOperationalSellerCode(code: unknown): code is number {
  return isValidSellerCode(code);
}

type EligibilityInput = Pick<Customer, 'active' | 'blocked' | 'sellerCode'>;

/** `null` customer = absent from (or deleted in) the mirror: never eligible. */
export function customerOrderBlock(customer: EligibilityInput | null): CustomerOrderBlock | null {
  if (customer === null) return 'customer_unavailable';
  if (!customer.active) return 'customer_inactive';
  if (customer.blocked) return 'customer_blocked';
  if (!isOperationalSellerCode(customer.sellerCode)) return 'customer_without_seller';
  return null;
}

export function isCustomerEligibleForOrder(customer: EligibilityInput | null): boolean {
  return customerOrderBlock(customer) === null;
}
