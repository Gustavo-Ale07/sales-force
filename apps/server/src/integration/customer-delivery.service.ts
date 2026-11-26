import { CustomerFieldSchemas, IcmsClassificationSchema, MAX_CUSTOMER_ADDRESSES } from '@salesforce/contracts';
import type { Customer } from '@salesforce/domain';
import { isSankhyaGatewayError, type PartnerAddress, type SankhyaPartnerWritePort } from '@salesforce/sankhya';
import { z } from 'zod';
import type { Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import { backoffMs, decideFailure, STALE_PROCESSING_MS, type DeliveryOutcome, type DeliveryPhase } from './order-delivery.policy.js';
import type { CustomerDeliveryStore, ClaimedCustomerCommand, CustomerFailureRecord } from './customer-delivery.store.js';

/**
 * The command as the API wrote it (job payloads are external input: validated, never trusted). M-2: the size and shape
 * of every free field are the contract's own schemas (`CustomerFieldSchemas`, `IcmsClassificationSchema`), so the limits
 * exist once and a payload that does not satisfy them is a permanent rejection, never sent to the ERP.
 */
export const CustomerUpsertCommandSchema = z.object({
  version: z.literal(1),
  originKey: z.string().regex(/^force:[0-9a-f-]{36}$/),
  document: z.string().regex(/^[0-9]{11}$|^[0-9]{14}$/),
  personType: z.enum(['individual', 'company']),
  name: CustomerFieldSchemas.name,
  tradeName: CustomerFieldSchemas.tradeName.nullable(),
  icmsClassification: IcmsClassificationSchema,
  stateRegistration: CustomerFieldSchemas.stateRegistration.nullable(),
  sellerCode: z.number().int().min(1),
  phone: CustomerFieldSchemas.phone.nullable(),
  email: CustomerFieldSchemas.email.nullable(),
  notes: CustomerFieldSchemas.notes.nullable(),
  addresses: z
    .array(
      z.object({
        // Optional only because a command stored before the city became mandatory has none: it is REFUSED at delivery (never guessed).
        cityCode: z.number().int().min(1).optional(),
        streetCode: z.number().int().min(0),
        neighborhoodCode: z.number().int().min(0),
        streetName: CustomerFieldSchemas.addressName.nullable().default(null),
        neighborhoodName: CustomerFieldSchemas.addressName.nullable().default(null),
        number: CustomerFieldSchemas.addressNumber.nullable(),
        complement: CustomerFieldSchemas.addressComplement.nullable(),
        postalCode: CustomerFieldSchemas.postalCode.nullable(),
      }),
    )
    .max(MAX_CUSTOMER_ADDRESSES),
});
export type CustomerUpsertCommand = z.infer<typeof CustomerUpsertCommandSchema>;

export interface CustomerDeliverySettings {
  /** Dedicated origin field of the ERP partner (SNK-5); empty never reaches here. */
  readonly originField: string;
  /** Default price table of the installation, from configuration; `null` = none configured (the ERP default applies). */
  readonly priceTableCode: number | null;
}

export interface CustomerDeliveryDeps {
  readonly store: CustomerDeliveryStore;
  readonly gateway: SankhyaPartnerWritePort;
  readonly settings: CustomerDeliverySettings;
  readonly logger: Logger;
  readonly now: Clock;
}

export interface CustomerRunSummary {
  readonly processed: number;
  readonly recovered: number;
}

const DEFAULT_SWEEP_LIMIT = 10;
/** An attempt number large enough for `backoffMs` to return its ceiling (15 minutes). */
const MAX_BACKOFF_ATTEMPT = 32;

/** The reread partner must be the one that was asked for: same document, same seller; a mismatch is parked, never confirmed. */
export function rereadMatches(command: CustomerUpsertCommand, partner: Customer): boolean {
  const document = (partner.document ?? '').replace(/\D/g, '');
  return document === command.document && partner.sellerCode === command.sellerCode;
}

/**
 * Delivers `customer.upsert` commands to the ERP (D-AR). One attempt = verify, include, reread, confirm:
 *  - SNK-4: before ANY write the ERP is asked, by the dedicated origin field, whether this creation already exists
 *    (then it is adopted, never written again), and by CPF/CNPJ whether the document is taken by someone else
 *    (then the creation is refused: a permanent business rejection, never retried, never matched heuristically).
 *  - The credit limit is never sent; partner type, region and billing-slip type are left to the ERP defaults.
 *  - No network call happens inside a database transaction (the store opens its own, short ones).
 *  - Failures reuse the order policy (`decideFailure`): a refusal is final, a lost answer after the write started is
 *    `unknown` and re-verified by origin on the next attempt, never resent blindly.
 */
export class CustomerDeliveryService {
  constructor(private readonly deps: CustomerDeliveryDeps) {}

  async runDue(options: { readonly signal?: AbortSignal | undefined; readonly limit?: number | undefined } = {}): Promise<CustomerRunSummary> {
    const now = this.deps.now();
    const recovered = await this.deps.store.recoverStale(now, new Date(now.getTime() - STALE_PROCESSING_MS));
    const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
    let processed = 0;
    while (processed < limit && options.signal?.aborted !== true) {
      const claimed = await this.deps.store.claimNext(this.deps.now());
      if (claimed === null) break;
      processed += 1;
      try {
        await this.deliver(claimed, options.signal);
      } catch (error) {
        // A bug or a database failure while recording the outcome: the row stays `processing` and is recovered as
        // `unknown` (verified by origin before any resend). Surface it, keep the sweep alive.
        this.deps.logger.error({ err: error, outboxId: claimed.outboxId }, 'customer delivery attempt failed unexpectedly');
      }
    }
    return { processed, recovered };
  }

  private async deliver(claimed: ClaimedCustomerCommand, signal: AbortSignal | undefined): Promise<void> {
    const { gateway, settings } = this.deps;
    const callOptions = signal === undefined ? {} : { signal };
    const parsed = CustomerUpsertCommandSchema.safeParse(claimed.payload);
    if (!parsed.success) {
      await this.reject(claimed, 'validation', 'invalid_command', 'The stored command is not valid.');
      return;
    }
    const command = parsed.data;
    if (claimed.registrationStatus !== 'pending' && claimed.registrationStatus !== 'unknown') {
      await this.reject(claimed, 'inconsistent', 'registration_not_deliverable', 'The registration is not in a deliverable state.');
      return;
    }

    // Owner rule for commands queued before the city became mandatory: refused with an actionable text, never delivered without a city.
    if (command.addresses.some((address) => address.cityCode === undefined)) {
      await this.reject(claimed, 'validation', 'address_city_required', 'O endereço não tem cidade. Informe a cidade e cadastre o cliente novamente.');
      return;
    }

    let phase: DeliveryPhase = 'verify';
    let erpCode: number | null = claimed.erpReference === null ? null : Number(claimed.erpReference);
    // A send may have happened when an earlier attempt got past the lookups.
    const mayExist = claimed.previousStatus === 'unknown' || erpCode !== null;
    try {
      if (erpCode === null) {
        const byOrigin = await gateway.findPartnerByOrigin(settings.originField, command.originKey, callOptions);
        if (byOrigin !== null) {
          erpCode = byOrigin.code;
        } else {
          const byDocument = await gateway.findPartnerByDocument(command.document, callOptions);
          if (byDocument !== null) {
            await this.reject(claimed, 'validation', 'partner_document_duplicate', 'A partner with this CPF/CNPJ already exists in the ERP.');
            return;
          }
          phase = 'include';
          await this.deps.store.markSending(claimed.outboxId, this.deps.now());
          // Outbox order (owner decision change 2026-11-26): create the neighborhood, then the street, then the partner. Each step
          // looks the name up live first, so a resend after a lost answer finds the row instead of creating it twice (SNK-4).
          const addresses = await this.resolveRegistry(command.addresses, callOptions);
          const written = await gateway.upsertPartner(
            {
              originField: settings.originField,
              originKey: command.originKey,
              document: command.document,
              personType: command.personType,
              name: command.name,
              tradeName: command.tradeName,
              icmsClassification: command.icmsClassification,
              stateRegistration: command.stateRegistration,
              sellerCode: command.sellerCode,
              priceTableCode: settings.priceTableCode,
              phone: command.phone,
              email: command.email,
              notes: command.notes,
              addresses,
            },
            callOptions,
          );
          erpCode = written.code;
        }
      }
      phase = 'reread';
      const partner = await gateway.readWrittenPartner(erpCode, callOptions);
      if (partner === null || !rereadMatches(command, partner)) {
        await this.park(claimed, erpCode, 'reread_mismatch', 'The partner read back from the ERP does not match the request; a person has to check it.');
        return;
      }
      await this.deps.store.confirm({ claimed, erpCode, partner, command, at: this.deps.now() });
      this.deps.logger.info({ outboxId: claimed.outboxId, registrationId: claimed.registrationId, erpCode, attempts: claimed.attemptCount }, 'customer delivered to the ERP');
    } catch (error) {
      const outcome = decideFailure(error, {
        phase,
        attemptCount: claimed.attemptCount,
        mayExist: mayExist || phase === 'include' || phase === 'reread',
        hasErpNumber: erpCode !== null,
      });
      await this.applyOutcome(claimed, erpCode, outcome, outcome.kind === 'reject' ? refusalReason(error) : errorMessage(error), phase);
    }
  }

  /** Creates (idempotently, Sandbox only) the neighborhood and street the mirror did not know; returns the addresses with codes only. */
  private async resolveRegistry(addresses: CustomerUpsertCommand['addresses'], callOptions: { signal?: AbortSignal }): Promise<PartnerAddress[]> {
    const out: PartnerAddress[] = [];
    for (const address of addresses) {
      let { neighborhoodCode, streetCode } = address;
      if (neighborhoodCode === 0 && address.neighborhoodName !== null) {
        neighborhoodCode = (await this.deps.gateway.ensureNeighborhood(address.neighborhoodName, callOptions)).code;
      }
      if (streetCode === 0 && address.streetName !== null) {
        streetCode = (await this.deps.gateway.ensureStreet(address.streetName, callOptions)).code;
      }
      out.push({
        cityCode: address.cityCode ?? 0,
        streetCode,
        neighborhoodCode,
        number: address.number,
        complement: address.complement,
        postalCode: address.postalCode,
      });
    }
    return out;
  }

  private async reject(claimed: ClaimedCustomerCommand, errorClass: string, errorCode: string, message: string): Promise<void> {
    await this.deps.store.fail({ claimed, kind: 'reject', errorClass, errorCode, message, nextAttemptAt: null, status: 'rejected', consumesAttempt: true, at: this.deps.now() });
    this.deps.logger.warn({ outboxId: claimed.outboxId, errorClass, errorCode }, 'customer delivery rejected');
  }

  private async park(claimed: ClaimedCustomerCommand, erpCode: number | null, errorCode: string, message: string): Promise<void> {
    await this.deps.store.fail({
      claimed,
      kind: 'park',
      errorClass: 'permanent',
      errorCode,
      message,
      nextAttemptAt: null,
      status: 'unknown',
      consumesAttempt: true,
      at: this.deps.now(),
      ...(erpCode === null ? {} : { erpCode }),
    });
    this.deps.logger.warn({ outboxId: claimed.outboxId, errorCode }, 'customer delivery parked for a person');
  }

  private async applyOutcome(claimed: ClaimedCustomerCommand, erpCode: number | null, outcome: DeliveryOutcome, message: string, phase: DeliveryPhase): Promise<void> {
    const at = this.deps.now();
    // A customer that only met temporary trouble must never become 'Precisa de correção' (the seller could not fix it, and the ERP may
    // already hold it): after the attempt budget the retries go on at the slowest cadence (SNK-4 re-verifies by origin every time).
    if (outcome.kind === 'reject' && outcome.errorClass === 'exhausted') {
      const status = phase === 'verify' && erpCode === null && claimed.previousStatus !== 'unknown' ? 'pending' : 'unknown';
      await this.deps.store.fail({
        claimed,
        errorClass: 'exhausted',
        errorCode: outcome.errorCode,
        message,
        at,
        ...(erpCode === null ? {} : { erpCode }),
        kind: 'retry',
        status,
        nextAttemptAt: new Date(at.getTime() + backoffMs(MAX_BACKOFF_ATTEMPT)),
        consumesAttempt: true,
      });
      this.deps.logger.warn({ outboxId: claimed.outboxId, errorCode: outcome.errorCode, attempt: claimed.attemptCount }, 'customer delivery keeps retrying after the attempt budget');
      return;
    }
    const base = { claimed, errorClass: outcome.errorClass, errorCode: outcome.errorCode, message, at, ...(erpCode === null ? {} : { erpCode }) };
    let record: CustomerFailureRecord;
    if (outcome.kind === 'reject') record = { ...base, kind: 'reject', status: 'rejected', nextAttemptAt: null, consumesAttempt: true };
    else if (outcome.kind === 'park') record = { ...base, kind: 'park', status: 'unknown', nextAttemptAt: null, consumesAttempt: true };
    else record = { ...base, kind: 'retry', status: outcome.status, nextAttemptAt: new Date(at.getTime() + outcome.delayMs), consumesAttempt: outcome.consumesAttempt };
    await this.deps.store.fail(record);
    this.deps.logger.warn({ outboxId: claimed.outboxId, outcome: outcome.kind, errorClass: outcome.errorClass, errorCode: outcome.errorCode, attempt: claimed.attemptCount }, 'customer delivery attempt did not complete');
  }
}

/**
 * The reason stored with a DEFINITIVE refusal, shown to the seller (pt-BR wrapper in the API). For a gateway error it is the adapter's
 * own sanitized message (documents masked, 300 characters at most); anything else is the generic text. Never the request.
 */
export function refusalReason(error: unknown): string {
  return isSankhyaGatewayError(error) ? error.message : errorMessage(error);
}

/** Short, secret-free text: the class of the error and, for gateway errors, its stable code. Never the request. */
function errorMessage(error: unknown): string {
  if (isSankhyaGatewayError(error)) return `${error.kind}: ${error.code}`;
  return `${error instanceof Error ? error.name : 'Error'}: unclassified failure`;
}
