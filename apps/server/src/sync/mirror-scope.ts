import type { InstallationConfiguration } from '@salesforce/domain';
import { installationConfigurationVersion, type Database } from '@salesforce/db';
import type { ReadScope } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { validateInstallationConfiguration } from '../configuration/validate.js';

/** The only mobility flag that exists for products: `TGFPRO.AD_MOBILIDADE = 'S'` (owner ruling 2026-11-13). */
export const PRODUCT_MOBILITY_FIELD = 'AD_MOBILIDADE';
export const PRODUCT_MOBILITY_ALLOWED: readonly string[] = ['S'];

/**
 * What the mirror reads is decided by the CURRENT installation configuration (CFG-1…6), never by
 * literals in the gateway or here: sellable usage codes, whether inactive products are mirrored, and
 * the price tables to mirror. The mobility gate (AD_MOBILIDADE = S) is always applied: products outside it are not mirrored at all (a product that leaves it is deactivated by the normal missing-row rule).
 */
export function deriveReadScope(config: InstallationConfiguration): ReadScope {
  const tables = config.pricing.mobilePriceTableCodes;
  const eligibility = config.customers.eligibility;
  return {
    products: {
      usageValues: [...config.products.sellableUsageValues],
      activeOnly: !config.products.showInactive,
      // Owner ruling 2026-11-13 (security review MEDIUM-1): the gate is unconditional, like the TOP and negotiation-type
      // ones; no configuration block can switch it off or widen it.
      mobilitySourceField: PRODUCT_MOBILITY_FIELD,
      mobilityAllowedValues: [...PRODUCT_MOBILITY_ALLOWED],
    },
    ...(eligibility === undefined
      ? {}
      : {
          customers: {
            activeOnly: eligibility.activeOnly,
            requiredFlags: [...eligibility.requiredFlags],
            columnIn: eligibility.columnIn.map((r) => ({ column: r.column, values: [...r.values] })),
          },
        }),
    ...(tables === undefined ? {} : { priceTableCodes: [...tables] }),
  };
}

/** Thrown when the stored current configuration cannot be used to scope a mirror run. */
export class MirrorScopeUnavailableError extends Error {}

/**
 * Loads the current stored configuration and derives the read scope. Fails closed: with no current
 * version, or a payload that no longer validates, the run must not fall back to an unscoped read.
 */
export async function loadCurrentReadScope(db: Database): Promise<ReadScope> {
  const [row] = await db
    .select({ payload: installationConfigurationVersion.payload })
    .from(installationConfigurationVersion)
    .where(eq(installationConfigurationVersion.isCurrent, true));
  if (row === undefined) {
    throw new MirrorScopeUnavailableError('No current installation configuration: the mirror scope cannot be derived.');
  }
  const result = validateInstallationConfiguration(row.payload);
  if (!result.ok) {
    throw new MirrorScopeUnavailableError('The current installation configuration is invalid: the mirror scope cannot be derived.');
  }
  return deriveReadScope(result.value);
}
