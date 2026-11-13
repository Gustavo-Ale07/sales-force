import { Inject, Injectable } from '@nestjs/common';
import type { CreateCustomerRequest, CreateCustomerResponse } from '@salesforce/contracts';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, CUSTOMER_ENQUEUE_ENABLED, CUSTOMER_CONFIRM_WAIT, type Clock, type CustomerConfirmWait } from '../platform/tokens.js';
import { prepareCustomerRegistration } from './customer-registration-request.js';
import { CustomerRegistrationRepository, type CustomerRegistrationRow } from './customer-registration.repository.js';

/** Creations one account may start per hour (abuse and duplicate-flood guard). */
export const MAX_CUSTOMER_CREATIONS_PER_HOUR = 30;
const HOUR_MS = 3_600_000;

export interface CreateCustomerResult {
  readonly response: CreateCustomerResponse;
  /** 201 confirmed in time, 202 still waiting, 200 replay of an earlier request. */
  readonly httpStatus: 200 | 201 | 202;
}

/** Stable rejection codes the worker may record, mapped to the reason the client sees. Anything else is a generic failure. */
const REJECTION_REASONS: Readonly<Record<string, string>> = {
  partner_document_duplicate: 'document_already_registered',
};

/**
 * Customer creation (D-AR). Orchestration only: who may create (route policy plus the seller rules of the
 * request), idempotency, duplicate and rate checks, and the single transaction that records the request and its
 * outbox command. The ERP write belongs to the worker; this service never calls Sankhya. It waits a bounded time
 * for the worker's confirmation and otherwise answers "pending".
 */
@Injectable()
export class CustomerRegistrationService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(CustomerRegistrationRepository) private readonly registrations: CustomerRegistrationRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CUSTOMER_ENQUEUE_ENABLED) private readonly enabled: boolean,
    @Inject(CUSTOMER_CONFIRM_WAIT) private readonly wait: CustomerConfirmWait,
  ) {}

  async create(user: CurrentUser, body: CreateCustomerRequest): Promise<CreateCustomerResult> {
    if (!this.enabled) {
      throw new AppError('conflict', {
        message: 'O cadastro de clientes pelo Force ainda não está habilitado nesta instalação.',
        details: { reason: 'customer_write_disabled' },
      });
    }
    // A seller without a valid link is refused here (no_seller_scope); the technical profile is refused by the route policy.
    await this.policy.customerScope(user);

    const prepared = prepareCustomerRegistration(body, { role: user.role, sellerCodes: user.sellerCodes });
    if (!prepared.ok) throw new AppError('validation_failed', { details: { issues: prepared.issues } });
    const { payload, fingerprint } = prepared.value;

    const existing = await this.registrations.findByRequest(user.accountId, body.clientRequestId);
    if (existing !== null) return { response: this.replayOf(existing, fingerprint), httpStatus: 200 };

    const at = this.clock();
    if ((await this.registrations.countSince(user.accountId, new Date(at.getTime() - HOUR_MS))) >= MAX_CUSTOMER_CREATIONS_PER_HOUR) {
      throw new AppError('rate_limited', { retryAfterSeconds: 600 });
    }

    const created = await this.registrations.transaction(async (tx) => {
      await this.registrations.lockDocument(payload.document, tx);
      // A retry that raced the original request is the same request, not a duplicate.
      const winner = await this.registrations.findByRequest(user.accountId, body.clientRequestId, tx);
      if (winner !== null) return { kind: 'replay' as const, row: winner };
      if ((await this.registrations.mirrorHasDocument(payload.document, tx)) || (await this.registrations.openRegistrationHasDocument(payload.document, tx))) {
        throw this.documentTaken();
      }
      const row = await this.registrations.insert(
        {
          id: uuidv7(at.getTime()),
          clientRequestId: body.clientRequestId,
          requestHash: fingerprint,
          createdByAccountId: user.accountId,
          originKey: payload.originKey,
          status: 'pending',
          taxId: payload.document,
          name: payload.name,
          sellerCode: payload.sellerCode,
          createdAt: at,
          updatedAt: at,
        },
        tx,
      );
      await this.registrations.enqueueUpsert(
        { id: uuidv7(at.getTime()), registrationId: row.id, originKey: payload.originKey, payload: { ...payload }, at },
        tx,
      );
      // Identifiers only: no document, name, e-mail or phone in the audit trail.
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.customerRegistrationRequested,
          actorAccountId: user.accountId,
          detail: { registrationId: row.id, sellerCode: payload.sellerCode, personType: payload.personType },
        },
        tx,
      );
      return { kind: 'created' as const, row };
    });

    if (created.kind === 'replay') return { response: this.replayOf(created.row, fingerprint), httpStatus: 200 };
    const settled = await this.awaitSettled(created.row.id);
    return { response: this.toResponse(settled), httpStatus: settled.status === 'confirmed' ? 201 : 202 };
  }

  /** Same id and same content: the recorded state. Same id, other content: the id is unusable. */
  private replayOf(existing: CustomerRegistrationRow, fingerprint: string): CreateCustomerResponse {
    if (existing.requestHash !== fingerprint) throw new AppError('idempotency_conflict');
    return this.toResponse(existing);
  }

  /** Polls the registration until the worker settles it or the wait is over; the last seen state is returned either way. */
  private async awaitSettled(id: string): Promise<CustomerRegistrationRow> {
    const deadline = this.clock().getTime() + this.wait.timeoutMs;
    let row = await this.registrations.findById(id);
    while (row !== null && row.status === 'pending' && this.clock().getTime() < deadline) {
      await this.wait.sleep(this.wait.pollMs);
      row = await this.registrations.findById(id);
    }
    if (row === null) throw new Error('customer_registration vanished after its own insert');
    return row;
  }

  /** A rejected request answers 409 with its reason, on the first call and on every replay. */
  private toResponse(row: CustomerRegistrationRow): CreateCustomerResponse {
    if (row.status === 'rejected') {
      const reason = REJECTION_REASONS[row.rejectionCode ?? ''];
      if (reason === 'document_already_registered') throw this.documentTaken();
      throw new AppError('conflict', {
        message: 'O Sankhya recusou o cadastro do cliente. Confira os dados e tente novamente.',
        details: { reason: 'customer_rejected' },
      });
    }
    return { registrationId: row.id, status: row.status as CreateCustomerResponse['status'], customerCode: row.erpCustomerCode, originKey: row.originKey };
  }

  private documentTaken(): AppError {
    return new AppError('conflict', {
      message: 'Já existe um cliente com este CPF/CNPJ.',
      details: { reason: 'document_already_registered' },
    });
  }
}
