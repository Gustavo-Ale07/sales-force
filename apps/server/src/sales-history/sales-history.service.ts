import { Inject, Injectable } from '@nestjs/common';
import {
  positivatedCustomerCodes,
  rankCustomersByNet,
  subtractTotals,
  sumQuantities,
  sumTotals,
  summarizeSalesBySellerMonth,
  type SalesHistoryCustomerRank,
  type SalesHistorySellerMonth,
} from '@salesforce/domain';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { MirrorRepository } from '../mirror/mirror.repository.js';
import { SalesHistoryRepository } from './sales-history.repository.js';

/** Widest period a single read accepts, in months (the mirror window is configuration, 12 by default). */
export const MAX_PERIOD_MONTHS = 36;
export const DEFAULT_RANKING_LIMIT = 50;
export const MAX_RANKING_LIMIT = 500;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface SalesHistoryPeriod {
  /** `YYYY-MM`, inclusive. */
  readonly fromMonth: string;
  /** `YYYY-MM`, inclusive. */
  readonly toMonth: string;
  /** Optional filter inside the caller's scope; never widens it. */
  readonly sellerCode?: number | undefined;
}

export interface SellerMonthSummary {
  readonly period: { readonly fromMonth: string; readonly toMonth: string };
  readonly syncedAt: string | null;
  readonly rows: readonly SalesHistorySellerMonth[];
}

export interface PositivationResult {
  readonly period: { readonly fromMonth: string; readonly toMonth: string };
  readonly syncedAt: string | null;
  /** Distinct customers with at least one sale-TOP note in the period. */
  readonly positivatedCustomers: number;
}

export interface CustomerRankingResult {
  readonly period: { readonly fromMonth: string; readonly toMonth: string };
  readonly syncedAt: string | null;
  readonly rows: readonly SalesHistoryCustomerRank[];
}

export interface CustomerProductLine {
  readonly productCode: number;
  readonly soldQuantity: string;
  readonly returnedQuantity: string;
  readonly soldAmount: string;
  readonly returnedAmount: string;
  /** Sold minus returned; may be negative. */
  readonly netAmount: string;
  readonly saleNoteCount: number;
  readonly lastSaleDate: string | null;
}

export interface CustomerProductHistory {
  readonly customerCode: number;
  readonly syncedAt: string | null;
  readonly products: readonly CustomerProductLine[];
}

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function invalidPeriod(field: string, message: string): AppError {
  return new AppError('validation_failed', { details: { issues: [{ path: field, code: 'invalid_value', message }] } });
}

function checkPeriod(period: SalesHistoryPeriod): void {
  if (!MONTH.test(period.fromMonth)) throw invalidPeriod('fromMonth', 'Informe o mês inicial no formato AAAA-MM.');
  if (!MONTH.test(period.toMonth)) throw invalidPeriod('toMonth', 'Informe o mês final no formato AAAA-MM.');
  const span = monthIndex(period.toMonth) - monthIndex(period.fromMonth);
  if (span < 0) throw invalidPeriod('toMonth', 'O mês final não pode ser anterior ao inicial.');
  if (span + 1 > MAX_PERIOD_MONTHS) throw invalidPeriod('toMonth', `O período máximo é de ${MAX_PERIOD_MONTHS} meses.`);
}

/**
 * Sales history read service (stage D). The caller's scope comes from the central policy and is pushed into every query on the note's
 * seller; a seller without a seller link is refused by the policy (`no_seller_scope`). The per-customer history requires the customer to
 * be visible in the scope and otherwise answers exactly like a missing customer (404), revealing nothing (P-21). Money is returned as
 * decimal strings computed by the domain; there is no cost or margin anywhere in the mirror (P-20).
 */
@Injectable()
export class SalesHistoryService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(SalesHistoryRepository) private readonly history: SalesHistoryRepository,
  ) {}

  async sellerMonthSummary(user: CurrentUser, period: SalesHistoryPeriod): Promise<SellerMonthSummary> {
    const { buckets, syncedAt } = await this.load(user, period);
    return { period: periodOf(period), syncedAt, rows: summarizeSalesBySellerMonth(buckets) };
  }

  async positivation(user: CurrentUser, period: SalesHistoryPeriod): Promise<PositivationResult> {
    const { buckets, syncedAt } = await this.load(user, period);
    return { period: periodOf(period), syncedAt, positivatedCustomers: positivatedCustomerCodes(buckets).size };
  }

  async customerRanking(user: CurrentUser, period: SalesHistoryPeriod, limit = DEFAULT_RANKING_LIMIT): Promise<CustomerRankingResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RANKING_LIMIT) {
      throw invalidPeriod('limit', `O limite deve estar entre 1 e ${MAX_RANKING_LIMIT}.`);
    }
    const { buckets, syncedAt } = await this.load(user, period);
    return { period: periodOf(period), syncedAt, rows: rankCustomersByNet(buckets, limit) };
  }

  async customerProductHistory(user: CurrentUser, customerCode: number): Promise<CustomerProductHistory> {
    const { scope } = await this.policy.accessContext(user);
    const customer = await this.mirror.findCustomer(scope, customerCode);
    if (customer === null) throw new AppError('not_found');
    const [rows, syncedAt] = await Promise.all([this.history.customerProducts(customer.code), this.history.monthlySyncedAt()]);
    const byProduct = new Map<number, typeof rows>();
    for (const row of rows) byProduct.set(row.productCode, [...(byProduct.get(row.productCode) ?? []), row]);
    const products = [...byProduct.entries()]
      .sort(([a], [b]) => a - b)
      .map(([productCode, lines]): CustomerProductLine => {
        const sold = lines.filter((line) => line.topKind === 'sale');
        const returned = lines.filter((line) => line.topKind === 'return');
        const soldAmount = sumTotals(sold.map((line) => line.netAmount));
        const returnedAmount = sumTotals(returned.map((line) => line.netAmount));
        const dates = sold.map((line) => line.lastSaleDate).sort();
        return {
          productCode,
          soldQuantity: sumQuantities(sold.map((line) => line.quantity)),
          returnedQuantity: sumQuantities(returned.map((line) => line.quantity)),
          soldAmount,
          returnedAmount,
          netAmount: subtractTotals(soldAmount, returnedAmount),
          saleNoteCount: sold.reduce((total, line) => total + line.noteCount, 0),
          lastSaleDate: dates.length === 0 ? null : (dates[dates.length - 1] ?? null),
        };
      });
    return { customerCode: customer.code, syncedAt: syncedAt?.toISOString() ?? null, products };
  }

  private async load(user: CurrentUser, period: SalesHistoryPeriod) {
    checkPeriod(period);
    const { scope } = await this.policy.accessContext(user);
    const [buckets, syncedAt] = await Promise.all([
      this.history.monthlyBuckets({ scope, fromMonth: period.fromMonth, toMonth: period.toMonth, sellerCode: period.sellerCode }),
      this.history.monthlySyncedAt(),
    ]);
    return { buckets, syncedAt: syncedAt?.toISOString() ?? null };
  }
}

function periodOf(period: SalesHistoryPeriod): { fromMonth: string; toMonth: string } {
  return { fromMonth: period.fromMonth, toMonth: period.toMonth };
}
