import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { erpCustomer, erpPriceTable, integrationOutbox, type Database } from '@salesforce/db';
import { contactVersionOf } from './contact-version.js';
import type { UpdateCustomerRequest, UpdateCustomerResponse } from '@salesforce/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import type { Executor } from '../orders/orders.repository.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, CUSTOMER_CONFIRM_WAIT, CUSTOMER_EDIT_ENABLED, DATABASE, type Clock, type CustomerConfirmWait } from '../platform/tokens.js';
import { customerRefused } from './customer-refusal.js';
import {
  CUSTOMER_UPDATE_AGGREGATE,
  CUSTOMER_UPDATE_OPERATION,
  DELIVERABLE_CUSTOMER_FIELDS,
  EDITABLE_CUSTOMER_FIELDS,
  toUpdateResponse,
  updateRefusalFields,
  updateRefusalText,
  type UpdateOutboxFacts,
} from './customer-update-state.js';
import { CustomersService } from './customers.service.js';

/** Third advisory-lock namespace (`SFCU`): one lock per customer being edited. */
const UPDATE_LOCK_NAMESPACE = 0x53464355;

export interface CustomerUpdateResult {
  readonly response: UpdateCustomerResponse;
  /** 202 recorded, 200 replay of an earlier request. */
  readonly httpStatus: 200 | 202;
}

/**
 * Edit of an existing customer (D-AP): phone, e-mail and notes (contacts and addresses are accepted by the schema but refused with a
 * 409 until the ERP mapping is validated, S5.2). The request schema is strict, so any other field is a 400 that names it. Same rule
 * for the site and the app.
 *
 * Orchestration only: scope (a customer outside it is a 404), idempotency, one open edit per customer, and one transaction that
 * records the `customer_update` outbox command with its audit row. It never calls the ERP: only the worker holds the Sankhya
 * credential (STACK-2) and delivers the command with the SNK-4 reread-before-resend. While `ERP_CUSTOMER_EDIT_ENABLED` is closed
 * (default) nothing is stored and the answer is a 409.
 */
@Injectable()
export class CustomerUpdateService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CUSTOMER_EDIT_ENABLED) private readonly enabled: boolean,
    @Inject(CUSTOMER_CONFIRM_WAIT) private readonly wait: CustomerConfirmWait,
  ) {}

  private async activePriceTableExists(code: number): Promise<boolean> {
    if (code > 2_147_483_647) return false;
    const rows = await this.db
      .select({ code: erpPriceTable.code })
      .from(erpPriceTable)
      .where(and(eq(erpPriceTable.code, code), eq(erpPriceTable.active, true), isNull(erpPriceTable.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

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

    const { clientRequestId, baseContactVersion, ...changes } = body;
    const changed = EDITABLE_CUSTOMER_FIELDS.filter((field) => changes[field] !== undefined);
    const unsupported = changed.filter((field) => !(DELIVERABLE_CUSTOMER_FIELDS as readonly string[]).includes(field));
    if (unsupported.length > 0) {
      // Field names only: never a value.
      await this.audit.record({
        action: AUDIT_ACTIONS.customerUpdateRefused,
        actorAccountId: user.accountId,
        detail: { customerCode: code, fields: unsupported.join(','), reason: 'field_not_supported' },
      });
      throw new AppError('conflict', {
        message: 'Contatos e endereços ainda não podem ser alterados pelo Force. Altere telefone, e-mail ou observações.',
        details: { reason: 'customer_edit_field_not_supported', fields: unsupported },
      });
    }

    // P-08: a changed price table must be an active table of the mirror (mobility only); a made-up or stale code never reaches the ERP.
    if (changes.priceTableCode !== undefined && !(await this.activePriceTableExists(changes.priceTableCode))) {
      const message = 'Tabela de preço não encontrada ou inativa.';
      await this.audit.record({
        action: AUDIT_ACTIONS.customerUpdateRefused,
        actorAccountId: user.accountId,
        detail: { customerCode: code, fields: 'priceTableCode', reason: 'price_table_not_found' },
      });
      throw customerRefused({ priceTableCode: message }, [{ path: 'priceTableCode', code: 'price_table_not_found', message }]);
    }

    const fingerprint = createHash('sha256').update(JSON.stringify(['v1', code, canonical(changes)])).digest('hex');
    const originId = `force-edit:${clientRequestId}`;

    const existing = await this.findByOrigin(originId);
    if (existing !== null) return this.replay(existing, user, fingerprint);
    // An app edit may have been made offline against an older record: the version it started from is mandatory, so the conflict check cannot be skipped.
    if (user.channel === 'mobile' && baseContactVersion === undefined) {
      throw new AppError('validation_failed', {
        message: 'Atualize o cliente antes de salvar a alteração.',
        details: { reason: 'base_contact_version_required' },
      });
    }
    if (baseContactVersion !== undefined) await this.requireSameContactVersion(code, baseContactVersion);

    const at = this.clock();
    const updateId = uuidv7(at.getTime());
    let fresh = false;
    let result: CustomerUpdateResult;
    try {
      result = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${UPDATE_LOCK_NAMESPACE}::int, ${code}::int)`);
        const winner = await this.findByOrigin(originId, tx);
        if (winner !== null) return this.replay(winner, user, fingerprint);
        if (await this.hasOpenUpdate(code, tx)) {
          throw new AppError('conflict', {
            message: 'Já existe uma alteração deste cliente em andamento. Aguarde a conclusão antes de enviar outra.',
            details: { reason: 'customer_update_in_progress' },
          });
        }
        await tx.insert(integrationOutbox).values({
          id: uuidv7(at.getTime()),
          aggregateType: CUSTOMER_UPDATE_AGGREGATE,
          aggregateId: updateId,
          operation: CUSTOMER_UPDATE_OPERATION,
          payload: { customerCode: code, accountId: user.accountId, requestHash: fingerprint, changes },
          originId,
          status: 'pending',
          nextAttemptAt: at,
          createdAt: at,
          updatedAt: at,
        });
        // Identifiers and the NAMES of the changed fields only: never a value.
        await this.audit.record(
          { action: AUDIT_ACTIONS.customerUpdateRequested, actorAccountId: user.accountId, detail: { updateId, customerCode: code, fields: changed.join(',') } },
          tx,
        );
        const facts: UpdateOutboxFacts = { aggregateId: updateId, payload: null, status: 'pending', nextAttemptAt: at, lastErrorMessage: null, createdAt: at, updatedAt: at };
        fresh = true;
        return { response: toUpdateResponse(facts, code), httpStatus: 202 as const };
      });
    } catch (error) {
      // The origin id is unique across the installation: another account that used the same request id never learns of it.
      if (isOriginCollision(error)) throw new AppError('idempotency_conflict', { cause: error });
      throw error;
    }
    if (!fresh) return result;
    // CUST-RT: wait a bounded time for the worker's delivery (the API never calls the ERP): 200 sent, 422 refused, 202 still pending.
    const settled = await this.awaitDelivery(originId);
    return settled === null ? result : this.replay(settled, user, fingerprint, true);
  }

  /**
   * The edit was made over a copy of the customer the seller saw offline. When the ERP copy of phone or e-mail changed since, nothing is
   * recorded: the 409 carries the current values so the app can show both versions and let the seller choose (the choice is a new edit
   * on the current version). Contact data of a customer already inside the seller's scope: nothing outside it is revealed.
   */
  private async requireSameContactVersion(code: number, base: string): Promise<void> {
    const [row] = await this.db.select({ phone: erpCustomer.phone, email: erpCustomer.email }).from(erpCustomer).where(eq(erpCustomer.code, code)).limit(1);
    if (row === undefined) return;
    const current = contactVersionOf(row.phone, row.email);
    if (current === base) return;
    throw new AppError('conflict', {
      message: 'Este cliente foi alterado no Sankhya depois que você começou a editar. Escolha qual versão manter.',
      details: { reason: 'customer_edit_conflict', contactVersion: current, current: { phone: row.phone, email: row.email } },
    });
  }

  private async awaitDelivery(originId: string): Promise<UpdateOutboxFacts | null> {
    const deadline = this.clock().getTime() + this.wait.timeoutMs;
    let row = await this.findByOrigin(originId);
    while (row !== null && (row.status === 'pending' || row.status === 'processing' || (row.status === 'unknown' && row.nextAttemptAt !== null)) && this.clock().getTime() < deadline) {
      await this.wait.sleep(this.wait.pollMs);
      row = await this.findByOrigin(originId);
    }
    return row;
  }

  private replay(row: UpdateOutboxFacts, user: CurrentUser, fingerprint: string, afterWait = false): CustomerUpdateResult {
    const payload = row.payload as { accountId?: unknown; requestHash?: unknown; customerCode?: unknown };
    // Same id from another account, or same id with other content: unusable, and it says nothing about the original.
    if (payload.accountId !== user.accountId || payload.requestHash !== fingerprint || typeof payload.customerCode !== 'number') {
      throw new AppError('idempotency_conflict');
    }
    if (row.status === 'rejected') {
      const message = updateRefusalText(row.lastErrorMessage);
      throw customerRefused(updateRefusalFields(message), [], { reason: 'customer_update_rejected' }, message);
    }
    const response = toUpdateResponse(row, payload.customerCode);
    // Right after the wait: delivered 200, still pending 202. A plain replay of an earlier request is always 200.
    return { response, httpStatus: afterWait && response.sendState === 'pending' ? 202 : 200 };
  }

  private async findByOrigin(originId: string, db: Executor = this.db): Promise<UpdateOutboxFacts | null> {
    const [row] = await db
      .select({
        aggregateId: integrationOutbox.aggregateId,
        payload: integrationOutbox.payload,
        status: integrationOutbox.status,
        nextAttemptAt: integrationOutbox.nextAttemptAt,
        lastErrorMessage: integrationOutbox.lastErrorMessage,
        createdAt: integrationOutbox.createdAt,
        updatedAt: integrationOutbox.updatedAt,
      })
      .from(integrationOutbox)
      .where(and(eq(integrationOutbox.originId, originId), eq(integrationOutbox.aggregateType, CUSTOMER_UPDATE_AGGREGATE)))
      .limit(1);
    return row ?? null;
  }

  private async hasOpenUpdate(code: number, tx: Executor): Promise<boolean> {
    const [row] = await tx
      .select({ id: integrationOutbox.id })
      .from(integrationOutbox)
      .where(
        and(
          eq(integrationOutbox.aggregateType, CUSTOMER_UPDATE_AGGREGATE),
          sql`${integrationOutbox.status} in ('pending', 'processing', 'unknown')`,
          sql`(${integrationOutbox.payload} ->> 'customerCode')::int = ${code}`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}

/** Key order must not change the fingerprint of the same content. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

function isOriginCollision(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; typeof current === 'object' && current !== null && depth < 4; depth += 1) {
    const { code, constraint, cause } = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (code === '23505' && constraint === 'integration_outbox_origin_id_uq') return true;
    current = cause;
  }
  return false;
}
