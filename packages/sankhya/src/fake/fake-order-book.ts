import type { DecimalString } from '@salesforce/domain';
import { SankhyaGatewayError } from '../errors.js';
import type {
  ErpOrderRef,
  IncludeOrderResult,
  OrderWriteRequest,
  WrittenOrder,
  ErpOrderStatusFactsReading,
  ErpOrderStatusReading,
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
    const found = this.orders.find((order) => order.request.originId === originId);
    return found === undefined ? null : { erpOrderNumber: found.erpOrderNumber, confirmed: found.confirmed };
  }

  statusOf(erpOrderNumbers: readonly number[]): ErpOrderStatusReading[] {
    return erpOrderNumbers.map((erpOrderNumber) => {
      const set = this.statusFacts.get(erpOrderNumber);
      if (set !== undefined) return { erpOrderNumber, facts: set, invoiceNumber: this.invoiceNumbers.get(erpOrderNumber) ?? null };
      const stored = this.orders.find((order) => order.erpOrderNumber === erpOrderNumber);
      return {
        erpOrderNumber,
        invoiceNumber: null,
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
    return {
      erpOrderNumber: found.erpOrderNumber,
      confirmed: found.confirmed,
      items: found.request.items.map((item) => ({
        productCode: item.productCode,
        quantity: item.quantity,
        unitPrice: priceOf(item.productCode),
        discountPercent: this.#options.ignoreDiscount === true ? null : item.discountPercent,
      })),
    };
  }
}
