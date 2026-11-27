import { Inject, Injectable } from '@nestjs/common';
import type { MyDiscountLimitsResponse } from '@salesforce/contracts';
import { discountExceedsLimit, indexSellerDiscountRules, normalizeDecimalString, resolveSellerDiscountLimit } from '@salesforce/domain';
import type { CurrentUser } from '../iam/current-user.js';
import { ForceConfigRepository } from '../force-config/force-config.repository.js';
import { MirrorRepository } from '../mirror/mirror.repository.js';

export interface DiscountLimitCheckItem {
  readonly lineNo: number;
  readonly productCode: number;
  readonly discountPercent: string;
}

/**
 * Per-seller discount limits: rules kept in the Force database and edited on the site (owner ruling 2026-11-27). The seller reads only its OWN
 * rules (offline sync); the resolution is the shared domain function.
 */
@Injectable()
export class SellerDiscountLimitsService {
  constructor(
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(ForceConfigRepository) private readonly config: ForceConfigRepository,
  ) {}

  /** Only the caller's own seller rules; a caller without a seller link has none. */
  async mine(user: CurrentUser): Promise<MyDiscountLimitsResponse> {
    const sellerCode = user.role === 'seller' ? (user.sellerCodes[0] ?? null) : null;
    if (sellerCode === null) return { sellerCode: null, rules: [] };
    const rules = await this.config.rulesOfSeller(sellerCode);
    return { sellerCode, rules: rules.map((rule) => ({ kind: rule.kind === 'none' ? 'general' : rule.kind, code: rule.code, percent: normalizeDecimalString(rule.percent) })) };
  }

  /**
   * Revalidation on send (P-08, P-10): the lines whose discount is strictly above the limit the seller has TODAY
   * (product > subgroup/group nearest > general > product DESCMAX). Empty when none exceeds or none is configured.
   */
  async exceededLines(sellerCode: number | null, items: readonly DiscountLimitCheckItem[]): Promise<number[]> {
    const discounted = items.filter((item) => item.discountPercent !== '0' && item.discountPercent !== '0.00');
    if (discounted.length === 0) return [];
    const [ruleRows, parents, facts] = await Promise.all([
      sellerCode === null ? Promise.resolve([]) : this.config.rulesOfSeller(sellerCode),
      this.mirror.groupParentMap(),
      this.mirror.productDiscountFacts(discounted.map((item) => item.productCode)),
    ]);
    const rules = indexSellerDiscountRules(ruleRows.map((r) => ({ kind: r.kind === 'none' ? ('general' as const) : r.kind, code: r.code, percent: r.percent })));
    return discounted
      .filter((item) => {
        const fact = facts.get(item.productCode);
        const resolved = resolveSellerDiscountLimit({
          productCode: item.productCode,
          groupCode: fact?.groupCode ?? null,
          erpMaxPercent: fact?.maxDiscountPercent ?? null,
          rules,
          parentOf: (code) => parents.get(code) ?? null,
        });
        return discountExceedsLimit(item.discountPercent, resolved.limit);
      })
      .map((item) => item.lineNo);
  }
}
