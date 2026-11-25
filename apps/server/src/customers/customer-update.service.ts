import { Inject, Injectable } from '@nestjs/common';
import type { UpdateCustomerRequest, UpdateCustomerResponse } from '@salesforce/contracts';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { CUSTOMER_EDIT_ENABLED } from '../platform/tokens.js';
import { EDITABLE_CUSTOMER_FIELDS, RefusingCustomerEditDelivery, type CustomerEditDelivery } from './customer-edit-delivery.js';
import { CustomersService } from './customers.service.js';

export interface CustomerUpdateResult {
  readonly response: UpdateCustomerResponse;
  readonly httpStatus: 202;
}

/**
 * Edit of an existing customer (D-AP): phone, e-mail, contacts, addresses and notes only (the request schema is strict, so any other
 * field is a 400 that names it). Same rule for the site and the app.
 *
 * Today the edit is never accepted: delivery to the ERP is not approved (`updatePartner` stays refused), so the request is validated,
 * checked against the actor's customer scope, audited as a refusal (field names only) and answered 409. Nothing is stored (no personal
 * data kept without a delivery to consume it) and neither the outbox nor the gateway is touched.
 */
@Injectable()
export class CustomerUpdateService {
  private readonly delivery: CustomerEditDelivery = new RefusingCustomerEditDelivery();

  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CUSTOMER_EDIT_ENABLED) private readonly enabled: boolean,
  ) {}

  async update(user: CurrentUser, code: number, body: UpdateCustomerRequest): Promise<CustomerUpdateResult> {
    if (!this.enabled) {
      throw new AppError('conflict', {
        message: 'A edição de clientes pelo Force ainda não está habilitada nesta instalação.',
        details: { reason: 'customer_edit_disabled' },
      });
    }
    const scope = await this.policy.customerScope(user);
    // Outside the scope the customer does not exist (404), whatever the body says.
    await this.customers.requireVisible(scope, code);

    const fields = EDITABLE_CUSTOMER_FIELDS.filter((field) => body[field] !== undefined);
    const outcome = await this.delivery.deliver(code, fields);
    // Identifiers and the NAMES of the changed fields only: never a value.
    await this.audit.record({
      action: AUDIT_ACTIONS.customerUpdateRefused,
      actorAccountId: user.accountId,
      detail: { customerCode: code, fields: fields.join(','), reason: outcome.reason },
    });
    throw new AppError('conflict', {
      message: 'A alteração de clientes ainda não pode ser enviada ao Sankhya. Nada foi alterado.',
      details: { reason: 'customer_edit_delivery_not_approved' },
    });
  }
}
