import { Inject, Injectable } from '@nestjs/common';
import type { CustomerRegistrationsQuery, CustomerRegistrationsResponse, CustomerRegistrationView } from '@salesforce/contracts';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { CustomerRegistrationRepository, type RegistrationWithOutbox } from './customer-registration.repository.js';
import { toRegistrationView } from './customer-registration-view.js';

/** What a given contract `state` filter means in stored statuses. */
const STATUSES_OF_STATE: Readonly<Record<string, readonly string[]>> = {
  awaiting_send: ['pending', 'unknown'],
  sent: ['confirmed'],
  needs_correction: ['rejected'],
};

/**
 * The seller's register (D-AQ): the customers sent from the Force and where each one stands. A seller reads the
 * registrations they started or those of the sellers they own; manager and admin read every one. Outside the scope a
 * registration does not exist (404), never 403.
 */
@Injectable()
export class CustomerRegistrationQueryService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(CustomerRegistrationRepository) private readonly registrations: CustomerRegistrationRepository,
  ) {}

  async list(user: CurrentUser, query: CustomerRegistrationsQuery): Promise<CustomerRegistrationsResponse> {
    const scope = await this.policy.customerScope(user);
    const rows = await this.registrations.listVisible({
      accountId: user.accountId,
      sellerCodes: scope.kind === 'sellers' ? scope.sellerCodes : null,
      statuses: query.state === undefined ? null : (STATUSES_OF_STATE[query.state] ?? []),
      limit: query.limit,
    });
    const items: CustomerRegistrationView[] = [];
    for (const row of rows) {
      // A refusal the seller already replaced by a correction no longer asks for attention.
      if (row.registration.status === 'rejected' && (await this.registrations.hasCorrection(row.registration.id))) continue;
      items.push(this.view(row));
    }
    return { items };
  }

  async get(user: CurrentUser, registrationId: string): Promise<CustomerRegistrationView> {
    const scope = await this.policy.customerScope(user);
    const row = await this.registrations.findViewById(registrationId);
    if (row === null) throw new AppError('not_found');
    const own = row.registration.createdByAccountId === user.accountId;
    const inScope = scope.kind === 'all' || (row.registration.sellerCode !== null && scope.sellerCodes.includes(row.registration.sellerCode));
    if (!own && !inScope) throw new AppError('not_found');
    return this.view(row);
  }

  private view(row: RegistrationWithOutbox) {
    return toRegistrationView(row.registration, row.outbox);
  }
}
