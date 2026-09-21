import { Inject, Injectable } from '@nestjs/common';
import type { CustomerDetail, CustomerListItem, CustomersQuery, CustomersResponse } from '@salesforce/contracts';
import { resolveCustomerPriceTable, type CustomerScope } from '@salesforce/domain';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { isBlockedRaw, MirrorRepository, type CustomerRow } from '../mirror/mirror.repository.js';

function toListItem(row: CustomerRow): CustomerListItem {
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
  ) {}

  async list(user: CurrentUser, query: CustomersQuery): Promise<CustomersResponse> {
    const { scope } = await this.policy.accessContext(user);
    const { rows, total } = await this.mirror.listCustomers(
      {
        scope,
        search: query.search,
        status: query.status,
        sellerCode: query.sellerCode,
        hasPriceTable: query.hasPriceTable,
        sort: query.sort,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return { items: rows.map(toListItem), page: query.page, pageSize: query.pageSize, total };
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
      syncedAt: row.syncedAt.toISOString(),
    };
  }

  /** Customer inside the scope, or 404. Shared with the catalog and orders modules. */
  async requireVisible(scope: CustomerScope, code: number): Promise<CustomerRow> {
    const row = await this.mirror.findCustomer(scope, code);
    if (row === null) throw new AppError('not_found');
    return row;
  }
}
