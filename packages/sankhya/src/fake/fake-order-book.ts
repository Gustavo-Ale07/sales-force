import { computeDiscountedLineTotal, computeLineDiscountAmount, computeLineTotal, estimateItemIpi, sumTotals, type DecimalString } from '@salesforce/domain';
import { usesInformedPrice } from '../write/incluir-nota.js';
import { AmbiguousOriginError, SankhyaGatewayError } from '../errors.js';
import type {
  ErpOrderRef,
  IncludeOrderResult,
  OrderWriteRequest,
  WrittenOrder,
  ErpOrderStatusFactsReading,
  ErpOrderStatusReading,
  ErpOrderReleaseReading,
  ErpReleaseLineReading,
} from '../write/order-contract.js';

/**
 * Scripted outcome of one fake ERP call (consumed in order, default `ok`).
 *
 * `created_then_error` models the dangerous ambiguity: the ERP did create the order but the caller
 * only sees a failure (timeout, 5xx after commit). SNK-4 says the worker must find it by origin and
 * link it instead of sending again.
 */
export type FakeOrderOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'error'; readonly error: SankhyaGatewayError }
  | { readonly kind: 'created_then_error'; readonly error: SankhyaGatewayError };

export type FakeOrderOperation = 'include' | 'confirm' | 'find' | 'read';

export interface FakeStoredOrder {
  readonly erpOrderNumber: number;
  readonly request: OrderWriteRequest;
  confirmed: boolean;
}

export interface FakeOrderCall {
  readonly operation: FakeOrderOperation;
  readonly originId?: string;
  readonly erpOrderNumber?: number;
}

export interface FakeOrderBookOptions {
  readonly firstNumber?: number;
  /** List price per product; default 10. Unit price = list price (INFORMARPRECO False, D-7). */
  readonly priceOf?: (productCode: number) => DecimalString;
  /** Simulates an ERP that ignores PERCDESC (the D-7 fallback case). */
  readonly ignoreDiscount?: boolean;
  /** Simulates an ERP that keeps PERCDESC but stores VLRDESC = 0 (D-AK reread case). */
  readonly zeroDiscountAmount?: boolean;
  /** IPI rate (percent) the fake ERP applies to the NET line of a product; absent = no IPI (VLRIPI 0.00). */
  readonly ipiRateOf?: (productCode: number) => DecimalString | null;
  /** Simulates an ERP whose header total differs from the lines (D-AK reread case). */
  readonly skewTotalBy?: DecimalString;
}

/**
 * In-memory stand-in for the ERP order tables, with NO native idempotency on purpose (F-44 observed
 * none): a second `includeOrder` for the same origin creates a second order, so a test that counts
 * `orders` proves the worker never double-sent.
 */
export class FakeOrderBook {
  readonly orders: FakeStoredOrder[] = [];
  readonly calls: FakeOrderCall[] = [];
  /** Status facts a test sets for an order number (P2); otherwise derived from the stored order. */
  readonly invoiceNumbers = new Map<number, number>();
  readonly statusFacts = new Map<number, ErpOrderStatusFactsReading>();
  /** Release event codes a test sets for an order number (D6b). */
  readonly releaseEventCodes = new Map<number, readonly number[]>();
  /** Release (TSILIB) lines a test sets for an order number; an order without lines has no release state. */
  readonly releaseLines = new Map<number, readonly ErpReleaseLineReading[]>();
  readonly #scripts: Record<FakeOrderOperation, FakeOrderOutcome[]> = { include: [], confirm: [], find: [], read: [] };
  readonly #options: FakeOrderBookOptions;
  #next: number;

  constructor(options: FakeOrderBookOptions = {}) {
    this.#options = options;
    this.#next = options.firstNumber ?? 5000;
  }

  /** Queue outcomes for an operation (consumed first-in first-out). */
  script(operation: FakeOrderOperation, ...outcomes: FakeOrderOutcome[]): void {
    this.#scripts[operation].push(...outcomes);
  }

  count(operation: FakeOrderOperation): number {
    return this.calls.filter((call) => call.operation === operation).length;
  }

  #take(operation: FakeOrderOperation): FakeOrderOutcome {
    return this.#scripts[operation].shift() ?? { kind: 'ok' };
  }

  include(request: OrderWriteRequest): IncludeOrderResult {
    this.calls.push({ operation: 'include', originId: request.originId });
    const outcome = this.#take('include');
    if (outcome.kind === 'error') throw outcome.error;
    const stored: FakeStoredOrder = { erpOrderNumber: this.#next, request, confirmed: false };
    this.#next += 1;
    this.orders.push(stored);
    if (outcome.kind === 'created_then_error') throw outcome.error;
    return { erpOrderNumber: stored.erpOrderNumber };
  }

  confirm(erpOrderNumber: number): void {
    this.calls.push({ operation: 'confirm', erpOrderNumber });
    const outcome = this.#take('confirm');
    if (outcome.kind === 'error') throw outcome.error;
    const stored = this.orders.find((order) => order.erpOrderNumber === erpOrderNumber);
    if (stored === undefined) {
      throw new SankhyaGatewayError('validation', { code: 'order_not_found', message: 'The order to confirm does not exist in the ERP.' });
    }
    stored.confirmed = true;
    if (outcome.kind === 'created_then_error') throw outcome.error;
  }

  find(originId: string): ErpOrderRef | null {
    this.calls.push({ operation: 'find', originId });
    const outcome = this.#take('find');
    if (outcome.kind !== 'ok') throw outcome.error;
    const matches = this.orders.filter((order) => order.request.originId === originId);
    // K2: like the real lookup, more than one note with the same origin id is an error, never "the first one".
    if (matches.length > 1) throw new AmbiguousOriginError(matches.map((order) => order.erpOrderNumber));
    const found = matches[0];
    return found === undefined ? null : { erpOrderNumber: found.erpOrderNumber, confirmed: found.confirmed };
  }

  releaseOf(erpOrderNumbers: readonly number[]): ErpOrderReleaseReading[] {
    return erpOrderNumbers.map((erpOrderNumber) => ({
      erpOrderNumber,
      found: this.orders.some((order) => order.erpOrderNumber === erpOrderNumber) || this.releaseLines.has(erpOrderNumber),
      statusNota: null,
      adStatus: null,
      pending: null,
      lines: [...(this.releaseLines.get(erpOrderNumber) ?? [])],
    }));
  }

  statusOf(erpOrderNumbers: readonly number[]): ErpOrderStatusReading[] {
    return erpOrderNumbers.map((erpOrderNumber) => {
      const events = this.releaseEventCodes.get(erpOrderNumber);
      const eventPart = events === undefined ? {} : { releaseEventCodes: [...events] };
      const set = this.statusFacts.get(erpOrderNumber);
      if (set !== undefined) {
        return { erpOrderNumber, facts: set, invoiceNumber: this.invoiceNumbers.get(erpOrderNumber) ?? null, ...eventPart };
      }
      const stored = this.orders.find((order) => order.erpOrderNumber === erpOrderNumber);
      return {
        erpOrderNumber,
        invoiceNumber: null,
        ...eventPart,
        facts: {
          found: stored !== undefined,
          cancelled: false,
          confirmed: stored?.confirmed ?? false,
          awaitingRelease: false,
          awaitingBilling: false,
          invoiced: false,
          invoiceStatus: null,
        },
      };
    });
  }

  read(erpOrderNumber: number): WrittenOrder | null {
    this.calls.push({ operation: 'read', erpOrderNumber });
    const outcome = this.#take('read');
    if (outcome.kind !== 'ok') throw outcome.error;
    const found = this.orders.find((order) => order.erpOrderNumber === erpOrderNumber);
    if (found === undefined) return null;
    const priceOf = this.#options.priceOf ?? ((): DecimalString => '10');
    // D-AK: like the real ERP seen in the Sandbox, a discount is only stored when the price came with the request
    // (INFORMARPRECO "True" + VLRUNIT); with "False" the ERP resolves price and discount itself and drops PERCDESC.
    const informed = usesInformedPrice(found.request);
    const accepts = informed && this.#options.ignoreDiscount !== true;
    const nets: DecimalString[] = [];
    const ipis: DecimalString[] = [];
    const items = found.request.items.map((item) => {
        const percent = accepts ? item.discountPercent : null;
        const unitPrice = priceOf(item.productCode);
        // The ERP derives VLRDESC per unit, rounded to 2 places, times the quantity (D-AK).
        const amount =
          percent === null || this.#options.zeroDiscountAmount === true
            ? '0'
            : computeLineDiscountAmount(item.quantity, unitPrice, percent);
        const net = percent === null ? computeLineTotal(item.quantity, unitPrice) : computeDiscountedLineTotal(item.quantity, unitPrice, percent);
        const rate = this.#options.ipiRateOf?.(item.productCode) ?? null;
        const ipi = rate === null ? '0.00' : estimateItemIpi(net, rate);
        nets.push(net);
        ipis.push(ipi);
        return { productCode: item.productCode, quantity: item.quantity, unitPrice, discountPercent: percent, discountAmount: amount, ipiAmount: ipi };
    });
    const total = sumTotals([...nets, ...ipis, ...(this.#options.skewTotalBy === undefined ? [] : [this.#options.skewTotalBy])]);
    return { erpOrderNumber: found.erpOrderNumber, confirmed: found.confirmed, totalAmount: total, ipiAmount: sumTotals(ipis), items };
  }
}
