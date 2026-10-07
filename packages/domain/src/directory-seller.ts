import { isValidSellerCode } from './scope.js';

/**
 * Eligibility of a verified ERP user to get a `seller` Force account from the OFFICIAL user -> seller relation (CFG-2).
 * Deterministic and free of infrastructure (P-14): the caller reads the facts, this function only decides. It never
 * matches by name, e-mail or any other coincidence of codes: the only inputs are the stable ERP user code and what the
 * ERP itself says about that user and its seller.
 */

export type DirectoryRefusal =
  /** The directory identity is not the decimal ERP user code. */
  | 'invalid_identity'
  /** The mirror of the relation was never synchronized, or is older than the accepted age: no link is improvised. */
  | 'directory_stale'
  /** The user is not in the mirror (removed from the ERP, or not yet synchronized). */
  | 'user_missing'
  /** The user has no seller in the ERP. Valid credentials, no commercial access. */
  | 'no_seller'
  /** The seller is missing from the mirror, inactive or deleted in the ERP. */
  | 'seller_inactive'
  /** More than one ERP user claims the same seller: which one is the seller is not provable. */
  | 'seller_ambiguous'
  /** Another Force account already holds a link to that seller (never stolen, never duplicated). */
  | 'seller_claimed'
  /** No current installation configuration to record the link against. */
  | 'no_configuration'
  /** Another account holds this handle or identity (concurrent creation or a local account in the way). */
  | 'conflict';

export interface DirectoryFacts {
  /** `null` = the user is not in the mirror (or soft-deleted). */
  readonly user: { readonly sellerCode: number | null } | null;
  readonly sellerActive: boolean;
  /** Other non-deleted ERP users whose seller is this seller. */
  readonly otherUsersOfSeller: number;
  /** Other Force accounts (not the one being decided for) linked to this seller. */
  readonly otherAccountsOfSeller: number;
  /** Age of the last successful mirror of the relation, or `null` when it never succeeded. */
  readonly mirrorAgeMs: number | null;
}

export type DirectoryDecision =
  | { readonly ok: true; readonly sellerCode: number }
  | { readonly ok: false; readonly refusal: DirectoryRefusal };

/** The ERP user code as the identity carries it: a plain positive decimal that fits a 32-bit integer. */
export function parseDirectoryUserCode(externalUserId: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(externalUserId)) return null;
  const code = Number(externalUserId);
  return code <= 2_147_483_647 ? code : null;
}

export function decideDirectorySeller(facts: DirectoryFacts, maxMirrorAgeMs: number): DirectoryDecision {
  if (facts.mirrorAgeMs === null || facts.mirrorAgeMs > maxMirrorAgeMs) return { ok: false, refusal: 'directory_stale' };
  if (facts.user === null) return { ok: false, refusal: 'user_missing' };
  const sellerCode = facts.user.sellerCode;
  if (!isValidSellerCode(sellerCode)) return { ok: false, refusal: 'no_seller' };
  if (!facts.sellerActive) return { ok: false, refusal: 'seller_inactive' };
  if (facts.otherUsersOfSeller > 0) return { ok: false, refusal: 'seller_ambiguous' };
  if (facts.otherAccountsOfSeller > 0) return { ok: false, refusal: 'seller_claimed' };
  return { ok: true, sellerCode };
}
