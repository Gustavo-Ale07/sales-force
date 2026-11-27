import { Inject, Injectable } from '@nestjs/common';
import type { GoalsResponse } from '@salesforce/contracts';
import { buildGoalsOverview } from '@salesforce/domain';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { MirrorRepository } from '../mirror/mirror.repository.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { SalesHistoryRepository } from '../sales-history/sales-history.repository.js';
import { GoalsRepository } from './goals.repository.js';

/** Business month (`YYYY-MM`) in America/Sao_Paulo. */
export function businessMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

/**
 * Goals, realized and positivation of the current month (RF-GOL-1/2). The scope comes from the central policy: a seller sees only their
 * own seller codes, manager and admin see the team inside the customer scope. Every figure is computed by the domain over mirrored data
 * (goal mirror, sales-history mirror for revenue, billed-order mirror for positivation, portfolio); there is no cost, margin or commission here (P-20). The sales-history and billed-order reads are not
 * narrowed by seller on purpose: a portfolio customer is positivated by an order of any seller, and the domain only reports the scope's rows.
 */
@Injectable()
export class GoalsService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(GoalsRepository) private readonly goals: GoalsRepository,
    @Inject(SalesHistoryRepository) private readonly history: SalesHistoryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(user: CurrentUser): Promise<GoalsResponse> {
    const { scope } = await this.policy.accessContext(user);
    const month = businessMonth(this.clock());
    const showTeam = user.role === 'admin' || user.role === 'manager';

    const [goals, goalsSyncedAt, salesSyncedAt, positivationSyncedAt, portfolio, sellers] = await Promise.all([
      this.goals.monthGoals(scope, month),
      this.goals.syncedAt(),
      this.history.monthlySyncedAt(),
      this.goals.positivationSyncedAt(),
      this.mirror.portfolioCustomers(scope),
      showTeam ? this.mirror.listSellers({ scope }) : Promise.resolve([]),
    ]);
    const buckets = salesSyncedAt === null ? null : await this.history.monthlyBuckets({ scope: { kind: 'all' }, fromMonth: month, toMonth: month });

    const positivationOrders = positivationSyncedAt === null ? null : await this.goals.monthPositivationOrders(month);

    const overview = buildGoalsOverview({
      month,
      sellerCodes: scope.kind === 'all' ? null : scope.sellerCodes,
      goals,
      buckets,
      portfolio,
      positivationOrders,
    });
    const names = new Map(sellers.map((seller) => [seller.code, seller.name]));
    return {
      month,
      goalsSyncedAt: goalsSyncedAt?.toISOString() ?? null,
      salesSyncedAt: salesSyncedAt?.toISOString() ?? null,
      total: overview.total,
      bySeller: showTeam
        ? overview.bySeller.map((row) => ({ ...row, sellerName: names.get(row.sellerCode) ?? null }))
        : [],
    };
  }
}
