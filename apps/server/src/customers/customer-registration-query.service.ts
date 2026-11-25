import { Inject, Injectable } from '@nestjs/common';
import type { CustomerRegistrationsQuery, CustomerRegistrationsResponse, CustomerRegistrationView } from '@salesforce/contracts';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { customerRefused } from './customer-refusal.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { CustomerRegistrationRepository, type RegistrationWithOutbox } from './customer-registration.repository.js';
import { toRegistrationView } from './customer-registration-view.js';

/** What a given contract `state` filter means in stored statuses. */
const STATUSES_OF_STATE: Readonly<Record<string, readonly string[]>> = {
  awaiting_send: ['pending', 'unknown'],
  sent: ['confirmed'],
  // Not produced any more (CUST-RT); an old build that still asks gets an empty list.
  needs_correction: [],
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
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(user: CurrentUser, query: CustomerRegistrationsQuery): Promise<CustomerRegistrationsResponse> {
    const scope = await this.policy.customerScope(user);
    const rows = await this.registrations.listVisible({
      accountId: user.accountId,
      sellerCodes: scope.kind === 'sellers' ? scope.sellerCodes : null,
      // CUST-RT: a refused registration is audit data only; it is never listed (no correction queue).
      statuses: query.state === undefined ? ['pending', 'unknown', 'confirmed'] : (STATUSES_OF_STATE[query.state] ?? []),
      limit: query.limit,
    });
    return { items: rows.map((row) => this.view(row)) };
  }

  async get(user: CurrentUser, registrationId: string): Promise<CustomerRegistrationView> {
    const scope = await this.policy.customerScope(user);
    const row = await this.registrations.findViewById(registrationId);
    if (row === null || row.registration.status === 'rejected') throw new AppError('not_found');
    const own = row.registration.createdByAccountId === user.accountId;
    const inScope = scope.kind === 'all' || (row.registration.sellerCode !== null && scope.sellerCodes.includes(row.registration.sellerCode));
    if (!own && !inScope) throw new AppError('not_found');
    return this.view(row);
  }

  /**
   * CUST-RT, manager/admin (the route policy): sets the seller of a customer not yet delivered and sends it again. The API only
   * records the command; the worker delivers it. A registration outside the actor scope does not exist (404).
   */
  async setSeller(user: CurrentUser, registrationId: string, sellerCode: number): Promise<CustomerRegistrationView> {
    const scope = await this.policy.customerScope(user);
    const current = await this.registrations.findViewById(registrationId);
    if (current === null) throw new AppError('not_found');
    const reg = current.registration;
    const inScope = scope.kind === 'all' || (reg.sellerCode !== null && scope.sellerCodes.includes(reg.sellerCode)) || reg.createdByAccountId === user.accountId;
    if (!inScope) throw new AppError('not_found');
    if (reg.status === 'confirmed' || reg.erpCustomerCode !== null) {
      throw new AppError('conflict', { message: 'Este cliente já está no Sankhya.', details: { reason: 'customer_already_sent' } });
    }
    if (scope.kind === 'sellers' && !scope.sellerCodes.includes(sellerCode)) {
      throw customerRefused({ sellerCode: 'Vendedor fora da sua carteira.' }, [{ path: 'sellerCode', code: 'seller_out_of_scope' }]);
    }
    if (!(await this.registrations.activeSellerExists(sellerCode))) {
      throw customerRefused({ sellerCode: 'Vendedor não encontrado ou inativo.' }, [{ path: 'sellerCode', code: 'seller_not_found' }]);
    }
    const changed = await this.registrations.transaction(async (tx) => {
      const done = await this.registrations.requeueWithSeller({ id: registrationId, sellerCode, at: this.clock() }, tx);
      if (done) {
        await this.audit.record(
          { action: AUDIT_ACTIONS.customerRegistrationRequested, actorAccountId: user.accountId, detail: { registrationId, sellerCode, reason: 'seller_set' } },
          tx,
        );
      }
      return done;
    });
    if (!changed) throw new AppError('conflict', { message: 'O cliente está sendo enviado agora. Tente novamente em instantes.', details: { reason: 'customer_in_delivery' } });
    const updated = await this.registrations.findViewById(registrationId);
    if (updated === null) throw new AppError('not_found');
    return this.view(updated);
  }

  private view(row: RegistrationWithOutbox) {
    return toRegistrationView(row.registration, row.outbox);
  }
}
