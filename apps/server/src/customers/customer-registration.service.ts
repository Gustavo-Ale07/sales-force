import { Inject, Injectable } from '@nestjs/common';
import type { CreateCustomerRequest, CreateCustomerResponse } from '@salesforce/contracts';
import type { CustomerScope } from '@salesforce/domain';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, CUSTOMER_ENQUEUE_ENABLED, CUSTOMER_CONFIRM_WAIT, type Clock, type CustomerConfirmWait } from '../platform/tokens.js';
import { prepareCustomerRegistration } from './customer-registration-request.js';
import { CustomerRegistrationRepository, type CustomerRegistrationRow, type DocumentHolder } from './customer-registration.repository.js';

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
    const scope = await this.policy.customerScope(user);

    const prepared = prepareCustomerRegistration(body, {
      role: user.role,
      sellerCodes: user.sellerCodes,
      allowedSellerCodes: scope.kind === 'sellers' ? scope.sellerCodes : null,
    });
    if (!prepared.ok) throw new AppError('validation_failed', { details: { issues: prepared.issues } });
    const { payload, fingerprint } = prepared.value;

    // The owner must be a real, active seller of the ERP mirror: a typo or a made-up code never reaches the ERP.
    if (!(await this.registrations.activeSellerExists(payload.sellerCode))) {
      throw new AppError('validation_failed', {
        details: { issues: [{ path: 'sellerCode', code: 'seller_not_found', message: 'Vendedor não encontrado ou inativo.' }] },
      });
    }

    const existing = await this.registrations.findByRequest(user.accountId, body.clientRequestId);
    if (existing !== null) return { response: this.replayOf(existing, fingerprint), httpStatus: 200 };

    const at = this.clock();
    if ((await this.registrations.countSince(user.accountId, new Date(at.getTime() - HOUR_MS))) >= MAX_CUSTOMER_CREATIONS_PER_HOUR) {
      throw new AppError('rate_limited', { retryAfterSeconds: 600 });
    }

    const created = await this.attempt(async (tx) => {
      // The pre-check above is only a fast path: the authoritative count runs under a per-account lock, so parallel
      // requests of one account cannot all pass it.
      await this.registrations.lockAccount(user.accountId, tx);
      if ((await this.registrations.countSince(user.accountId, new Date(at.getTime() - HOUR_MS), tx)) >= MAX_CUSTOMER_CREATIONS_PER_HOUR) {
        throw new AppError('rate_limited', { retryAfterSeconds: 600 });
      }
      await this.registrations.lockDocument(payload.document, tx);
      // A retry that raced the original request is the same request, not a duplicate.
      const winner = await this.registrations.findByRequest(user.accountId, body.clientRequestId, tx);
      if (winner !== null) return { kind: 'replay' as const, row: winner };
      const holder = await this.registrations.findDocumentHolder(payload.document, tx);
      if (holder !== null) {
        // I-1: the refused attempt is recorded (it counts toward the hourly limit) and audited with identifiers only.
        // The refusal commits; the error is raised after the transaction so the record is not rolled back with it.
        const refusalId = uuidv7(at.getTime());
        await this.registrations.recordRefusal({ id: refusalId, accountId: user.accountId, reason: 'document_already_registered', at }, tx);
        await this.audit.record(
          { action: AUDIT_ACTIONS.customerRegistrationRefused, actorAccountId: user.accountId, detail: { refusalId, reason: 'document_already_registered' } },
          tx,
        );
        return { kind: 'refused' as const, holder };
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

    if (created.kind === 'refused') throw this.documentTaken(created.holder, scope);
    if (created.kind === 'replay') return { response: this.replayOf(created.row, fingerprint), httpStatus: 200 };
    const settled = await this.awaitSettled(created.row.id);
    return { response: this.toResponse(settled), httpStatus: settled.status === 'confirmed' ? 201 : 202 };
  }

  /**
   * Runs the recording transaction. M-1: a request id already used (by this or ANOTHER account) hits a unique index of
   * the registration; that is an idempotency conflict (409), never a 500, and it says nothing about the other account.
   */
  private async attempt<T>(work: (tx: Parameters<Parameters<CustomerRegistrationRepository['transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    try {
      return await this.registrations.transaction(work);
    } catch (error) {
      if (isRequestIdCollision(error)) throw new AppError('idempotency_conflict', { cause: error });
      throw error;
    }
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
      // The ERP found the document; whose it is was never looked up against this asker's portfolio: generic text.
      if (reason === 'document_already_registered') throw this.documentTaken(null, null);
      throw new AppError('conflict', {
        message: 'O Sankhya recusou o cadastro do cliente. Confira os dados e tente novamente.',
        details: { reason: 'customer_rejected' },
      });
    }
    return { registrationId: row.id, status: row.status as CreateCustomerResponse['status'], customerCode: row.erpCustomerCode, originKey: row.originKey };
  }

  /**
   * I-1: one status, one code and one `details` for every duplicate; only the text differs. Who holds the document is
   * said only when the holder is an active customer (or a registration in progress) in the asker's portfolio; for anyone
   * else the answer is the generic one, with no name and no seller, so a refusal never reveals data outside the scope.
   */
  private documentTaken(holder: DocumentHolder | null, scope: CustomerScope | null): AppError {
    return new AppError('conflict', {
      message: holder !== null && scope !== null && inPortfolio(holder, scope) ? describeHolder(holder) : GENERIC_DUPLICATE_MESSAGE,
      details: { reason: 'document_already_registered' },
    });
  }
}

export const GENERIC_DUPLICATE_MESSAGE = 'Não foi possível cadastrar este documento. Procure o backoffice.';

/** Active (or in progress) and owned by a seller the asker's scope reaches; scope `all` reaches every seller. */
function inPortfolio(holder: DocumentHolder, scope: CustomerScope): boolean {
  if (holder.source === 'mirror' && !holder.usable) return false;
  if (scope.kind === 'all') return true;
  return holder.sellerCode !== null && scope.sellerCodes.includes(holder.sellerCode);
}

function describeHolder(holder: DocumentHolder): string {
  return holder.code === null
    ? `Já existe um cadastro em andamento para este CPF/CNPJ: ${holder.name}.`
    : `Já existe um cliente com este CPF/CNPJ na sua carteira: ${holder.name} (código ${holder.code}).`;
}

/** PostgreSQL unique violation on one of the indexes that make a request id single-use. */
const REQUEST_ID_INDEXES: ReadonlySet<string> = new Set(['customer_registration_origin_key_uq', 'customer_registration_account_request_uq']);

function isRequestIdCollision(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; typeof current === 'object' && current !== null && depth < 4; depth += 1) {
    const { code, constraint, cause } = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (code === '23505' && typeof constraint === 'string' && REQUEST_ID_INDEXES.has(constraint)) return true;
    current = cause;
  }
  return false;
}
