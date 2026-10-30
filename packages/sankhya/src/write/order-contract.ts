import type { DecimalString } from '@salesforce/domain';

/**
 * Order delivery contract (SNK-7). Everything the worker hands to the gateway is already resolved from
 * configuration and the ERP mirror (D-8): the gateway adapter holds NO commercial literal.
 *
 * SNK-4: `originId` is the Sales Force order UUID (U-07); the adapter writes it to the dedicated origin
 * field `originField` (SNK-5), and `findOrderByOrigin` is how the worker proves, before ANY send or
 * resend, that the order does not already exist. There is no heuristic matching.
 */
export interface OrderWriteItem {
  readonly productCode: number;
  /** Decimal quantity (QTDNEG), canonical decimal string. */
  readonly quantity: DecimalString;
  /** Unit of measure of the product in the mirror (CODVOL). */
  readonly unit: string;
  /** Negotiated discount in percent (PERCDESC, D-7); `null`/zero = none. */
  readonly discountPercent: DecimalString | null;
}

export interface OrderWriteRequest {
  /** Sales Force order UUID: origin id AND idempotency key, identical on every resend. */
  readonly originId: string;
  /** Dedicated origin field (SNK-5), validated by `isValidOriginField`. */
  readonly originField: string;
  readonly customerCode: number;
  readonly sellerCode: number | null;
  /** CODEMP, from `general.defaultCompanyCode`. */
  readonly companyCode: number;
  /** CODTIPOPER, the order header TOP. */
  readonly topCode: number;
  /** CODTIPVENDA, the chosen negotiation type. */
  readonly negotiationTypeCode: number;
  /** CODPARCTRANSP, only when the header carries one. */
  readonly carrierCode: number | null;
  /** CODLOCALORIG, from `sales.orderStockLocationCode`. */
  readonly stockLocationCode: number;
  /** Order date, `yyyy-MM-dd` (DTNEG is sent as dd/MM/yyyy). */
  readonly orderDate: string;
  readonly notes: string | null;
  readonly items: readonly OrderWriteItem[];
}

export interface IncludeOrderResult {
  /** NUNOTA assigned by the ERP (`responseBody.pk.NUNOTA`, F-44). */
  readonly erpOrderNumber: number;
}

/** An order found in the ERP by its origin id. */
export interface ErpOrderRef {
  readonly erpOrderNumber: number;
  /** `STATUSNOTA = 'L'`; a freshly written order is pending ('A'), F-46. */
  readonly confirmed: boolean;
}

/** What the worker rereads after writing (D-7). */
export interface WrittenOrderItem {
  readonly productCode: number;
  readonly quantity: DecimalString;
  /** VLRUNIT as stored by the ERP. */
  readonly unitPrice: DecimalString;
  readonly discountPercent: DecimalString | null;
}

export interface WrittenOrder extends ErpOrderRef {
  readonly items: readonly WrittenOrderItem[];
}

export interface OrderCallOptions {
  readonly signal?: AbortSignal;
}

export interface SankhyaWritePort {
  /**
   * First step of delivery (CACSP.incluirNota): the order is born pending. NEVER called before
   * `findOrderByOrigin` returned null for the same `originId` (SNK-4).
   */
  includeOrder(request: OrderWriteRequest, options?: OrderCallOptions): Promise<IncludeOrderResult>;
  /** Second step (D-4). Redoing it for an already confirmed order must be harmless. */
  confirmOrder(erpOrderNumber: number, options?: OrderCallOptions): Promise<void>;
}

/**
 * Facts about one ERP order that the domain maps to a status (SNK-7 P2). Same shape as the domain's
 * `ErpOrderStatusFacts`; how each fact is read from the ERP is NEEDS VALIDATION (spike 9.48 item 9).
 */
export interface ErpOrderStatusFactsReading {
  readonly found: boolean;
  readonly cancelled: boolean;
  readonly confirmed: boolean;
  readonly awaitingRelease: boolean;
  readonly awaitingBilling: boolean;
  readonly invoiced: boolean;
  readonly invoiceStatus: string | null;
}

export interface ErpOrderStatusReading {
  readonly erpOrderNumber: number;
  readonly facts: ErpOrderStatusFactsReading;
  /** Invoice number when one exists. */
  readonly invoiceNumber: number | null;
  /**
   * Codes of the release (TSILIB) events seen for the order (D6b). Absent when the source did not provide them.
   * Reading them from the ERP is NEEDS VALIDATION together with the rest of the status source (spike 9.48 item 9).
   */
  readonly releaseEventCodes?: readonly number[];
}

export interface SankhyaOrderReadPort {
  /** Status facts of already sent orders (P2); one entry per requested number, `found` false when the ERP has none. */
  readOrderStatusFacts(erpOrderNumbers: readonly number[], options?: OrderCallOptions): Promise<readonly ErpOrderStatusReading[]>;
  /** SNK-4 origin check: exact match on the dedicated origin field, `null` when absent. */
  findOrderByOrigin(originField: string, originId: string, options?: OrderCallOptions): Promise<ErpOrderRef | null>;
  /** D-7 post-write reread of header state and item prices/discounts; `null` when the order is gone. */
  readWrittenOrder(erpOrderNumber: number, options?: OrderCallOptions): Promise<WrittenOrder | null>;
}
