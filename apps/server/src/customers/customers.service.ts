import { Inject, Injectable } from '@nestjs/common';
import { contactVersionOf } from './contact-version.js';
import type {
  CustomerDetail,
  CustomerFinancial,
  CustomerListItem,
  CustomersQuery,
  CustomerLettersQuery,
  CustomerLettersResponse,
  CustomersResponse,
} from '@salesforce/contracts';
import { resolveCustomerPriceTable, summarizeOpenTitles, titleBalance, type CustomerScope } from '@salesforce/domain';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { businessDate } from '../integration/order-request.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { isBlockedRaw, MirrorRepository, type CustomerRow } from '../mirror/mirror.repository.js';
import { CustomerRegistrationRepository } from './customer-registration.repository.js';

function toListItem(row: CustomerRow, overdue = false): CustomerListItem {
  return {
    code: row.code,
    name: row.name,
    tradeName: row.tradeName,
    document: row.taxId,
    active: row.active,
    blocked: isBlockedRaw(row.blockedRaw),
    sellerCode: row.sellerCode,
    sellerName: row.sellerName,
    priceTableCode: row.priceTableCode,
    ...(overdue ? { overdue: true } : {}),
    registry: {
      postalCode: row.postalCode ?? null,
      street: row.street ?? null,
      number: row.addressNumber ?? null,
      complement: row.complement ?? null,
      neighborhood: row.neighborhood ?? null,
      city: row.city ?? null,
      state: row.state ?? null,
      // No validated ERP column for a mobile phone or a default carrier (spike §9.70): never invented.
      mobile: null,
      phone: row.phone ?? null,
      email: row.email ?? null,
    },
    defaultCarrierCode: null,
    ...(row.phone !== undefined || row.email !== undefined ? { contactVersion: contactVersionOf(row.phone, row.email) } : {}),
  };
}

/**
 * Customer portfolio (RF-CLI read side). Every read goes through the actor's scope from the central
 * policy and pushes it into the query; a customer outside the scope is reported exactly like a
 * missing one (404), so existence is never revealed (P-21).
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CustomerRegistrationRepository) private readonly registrations: CustomerRegistrationRepository,
  ) {}

  /**
   * A customer the Force sent to the ERP (the registration carries its code) that the mirror has not read back yet:
   * it is the asker's own or inside their scope, it has no recurring orders and is not an error.
   */
  async isRegisteredNotYetMirrored(user: CurrentUser, scope: CustomerScope, code: number): Promise<boolean> {
    return this.registrations.existsVisibleWithCode({ code, accountId: user.accountId, sellerCodes: scope.kind === 'sellers' ? scope.sellerCodes : null });
  }

  async list(user: CurrentUser, query: CustomersQuery): Promise<CustomersResponse> {
    const { scope, configuration } = await this.policy.accessContext(user);
    const { rows, total } = await this.mirror.listCustomers(
      {
        scope,
        search: query.search,
        sellerCode: query.sellerCode,
        hasPriceTable: query.hasPriceTable,
        initial: query.initial,
        sort: query.sort,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    // Read-only "overdue" hint (D-I): only when the installation shows the financial area and overdue titles.
    const hint = configuration.financial.showFinancialArea && configuration.financial.overdueTitles;
    const overdue = hint
      ? await this.mirror.overdueCustomerCodes(
          rows.map((r) => r.code),
          businessDate(this.clock()),
        )
      : new Set<number>();
    return {
      items: rows.map((row) => toListItem(row, overdue.has(row.code))),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Count per initial letter inside the caller's scope (same visibility and filters as the list). */
  async letters(user: CurrentUser, query: CustomerLettersQuery): Promise<CustomerLettersResponse> {
    const { scope } = await this.policy.accessContext(user);
    const letters = await this.mirror.customerLetters({ scope, search: query.search, sellerCode: query.sellerCode, hasPriceTable: query.hasPriceTable });
    return { letters };
  }

  async get(user: CurrentUser, code: number): Promise<CustomerDetail> {
    const { scope, configuration } = await this.policy.accessContext(user);
    const row = await this.mirror.findCustomer(scope, code);
    if (row === null) throw new AppError('not_found');
    const resolved = resolveCustomerPriceTable({ priceTableCode: row.priceTableCode }, configuration);
    return {
      ...toListItem(row),
      priceTableName: row.priceTableName,
      resolvedPriceTable:
        resolved.kind === 'table' ? { code: resolved.code, source: resolved.source } : null,
      // Credit is only shown when the installation configuration enables it (CFG-3...6).
      creditLimit: configuration.customers.creditFeatures.showCreditLimit ? row.creditLimit : null,
      monthlyCreditLimit: configuration.customers.creditFeatures.showCreditLimit ? row.monthlyCreditLimit : null,
      syncedAt: row.syncedAt.toISOString(),
    };
  }

  /**
   * Read-only financial information of one customer (D-I). Same scope rule as `get`; an installation that does not show the
   * financial area answers 404 (the area does not exist for it). Limits only with `showCreditLimit`; overdue only with `overdueTitles`.
   */
  async financial(user: CurrentUser, code: number): Promise<CustomerFinancial> {
    const { scope, configuration } = await this.policy.accessContext(user);
    if (!configuration.financial.showFinancialArea) throw new AppError('not_found');
    const row = await this.mirror.findCustomer(scope, code);
    if (row === null) throw new AppError('not_found');
    const { titles, syncedAt } = await this.mirror.openTitlesOf(row.code);
    const today = businessDate(this.clock());
    const showOverdue = configuration.financial.overdueTitles;
    const showLimit = configuration.customers.creditFeatures.showCreditLimit;
    const summary = summarizeOpenTitles(titles, today);
    return {
      customerCode: row.code,
      creditLimit: showLimit ? row.creditLimit : null,
      monthlyCreditLimit: showLimit ? row.monthlyCreditLimit : null,
      blocked: isBlockedRaw(row.blockedRaw),
      blockReason: row.blockReason,
      situation: row.situation,
      summary: {
        openCount: summary.openCount,
        openAmount: summary.openAmount,
        overdueCount: showOverdue ? summary.overdueCount : null,
        overdueAmount: showOverdue ? summary.overdueAmount : null,
        oldestOverdueDueDate: showOverdue ? summary.oldestOverdueDueDate : null,
      },
      titles: titles.map((t) => ({
        nufin: t.nufin,
        documentNumber: t.documentNumber,
        dueDate: t.dueDate,
        amount: t.amount,
        balance: titleBalance(t),
        overdue: showOverdue && t.dueDate < today,
      })),
      checkedAt: (syncedAt ?? row.syncedAt).toISOString(),
    };
  }

  /** Customer inside the scope, or 404. Shared with the catalog and orders modules. */
  async requireVisible(scope: CustomerScope, code: number): Promise<CustomerRow> {
    const row = await this.mirror.findCustomer(scope, code);
    if (row === null) throw new AppError('not_found');
    return row;
  }

  /** Like `requireVisible`, but also returns an inactive/blocked customer so order writes refuse it with its reason (409), not 404. */
  async requireForOrder(scope: CustomerScope, code: number): Promise<CustomerRow> {
    const row = await this.mirror.findCustomer(scope, code, { includeHidden: true });
    if (row === null) throw new AppError('not_found');
    return row;
  }
}
