import { createHash } from 'node:crypto';
import {
  classifyIpiRef,
  compareDecimalStrings,
  computeDiscountedLineTotal,
  computeLineDiscountAmount,
  computeLineTotal,
  decimalEquals,
  normalizeDecimalString,
  subtractTotals,
  sumTotals,
  type InstallationConfiguration,
  type IpiRef,
} from '@salesforce/domain';
import {
  buildIncluirNotaBody,
  buildIncluirNotaRequestText,
  type OrderWriteRequest,
  type WrittenOrder,
} from '@salesforce/sankhya';
import { z } from 'zod';

/**
 * Pure part of the order delivery (SNK-7 D-7, D-8). No literal commercial value lives here: every code
 * comes from the order, the mirror snapshot on the order lines or the installation configuration.
 */

/** Time zone of the order date (decisions.md: business dates in America/Sao_Paulo). */
const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

export interface DeliveryOrder {
  readonly id: string;
  readonly customerCode: number;
  readonly sellerCode: number | null;
  readonly negotiationTypeCode: number | null;
  /** The order's own header TOP when it carries one; the configured default otherwise. */
  readonly topCode: number | null;
  readonly carrierCode: number | null;
  /** D-O: the order's own expedição flag (born from configuration, sent as AD_EXPEDICAO). */
  readonly expedicao: boolean;
  readonly notes: string | null;
  readonly createdAt: Date;
}

export interface DeliveryItem {
  readonly productCode: number;
  readonly unit: string | null;
  readonly quantity: string;
  readonly unitListPrice: string | null;
  readonly discountPercent: string;
  readonly priceState: string;
}

/**
 * Values resolved from configuration on the FIRST attempt and kept on the outbox row, so every resend
 * of the same order carries exactly the same header (SNK-4: same origin id, same payload).
 */
export const FrozenHeaderSchema = z.object({
  v: z.literal(1),
  companyCode: z.number().int(),
  topCode: z.number().int(),
  stockLocationCode: z.number().int(),
  carrierCode: z.number().int().nullable(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type FrozenHeader = z.infer<typeof FrozenHeaderSchema>;

export type BuildProblemCode =
  | 'missing_company'
  | 'missing_top'
  | 'top_not_eligible'
  | 'missing_stock_location'
  | 'missing_negotiation_type'
  | 'no_items'
  | 'missing_unit'
  | 'no_price';

export type BuildResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: BuildProblemCode; readonly message: string };

const fail = (code: BuildProblemCode, message: string): { ok: false; code: BuildProblemCode; message: string } => ({ ok: false, code, message });

/** `yyyy-MM-dd` of an instant in the business time zone. */
export function businessDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function resolveHeader(order: DeliveryOrder, config: InstallationConfiguration): BuildResult<FrozenHeader> {
  const companyCode = config.general.defaultCompanyCode ?? null;
  if (companyCode === null) return fail('missing_company', 'general.defaultCompanyCode is not configured.');
  const topCode = order.topCode ?? config.sales.orderTopCode;
  if (topCode === null) return fail('missing_top', 'The order has no TOP and sales.orderTopCode is not configured.');
  const eligible = config.sales.eligibleOrderTopCodes;
  if (eligible !== undefined && !eligible.includes(topCode)) return fail('top_not_eligible', 'The order TOP is not in sales.eligibleOrderTopCodes.');
  const stockLocationCode = config.sales.orderStockLocationCode ?? null;
  if (stockLocationCode === null) return fail('missing_stock_location', 'sales.orderStockLocationCode is not configured.');
  return {
    ok: true,
    value: { v: 1, companyCode, topCode, stockLocationCode, carrierCode: order.carrierCode, orderDate: businessDate(order.createdAt) },
  };
}

export function buildOrderRequest(
  order: DeliveryOrder,
  items: readonly DeliveryItem[],
  header: FrozenHeader,
  originField: string,
): BuildResult<OrderWriteRequest> {
  if (order.negotiationTypeCode === null) return fail('missing_negotiation_type', 'The order has no negotiation type.');
  if (items.length === 0) return fail('no_items', 'The order has no lines.');
  const lines: OrderWriteRequest['items'][number][] = [];
  for (const item of items) {
    if (item.unit === null || item.unit.trim() === '') return fail('missing_unit', `Product ${item.productCode} has no unit of measure.`);
    if (item.priceState !== 'priced' || item.unitListPrice === null) return fail('no_price', `Product ${item.productCode} has no price ("Sem preço").`);
    const discount = normalizeDecimalString(item.discountPercent);
    lines.push({
      productCode: item.productCode,
      quantity: normalizeDecimalString(item.quantity),
      unit: item.unit,
      discountPercent: discount === '0' ? null : discount,
      // D-AK: the same table price D-7 compares; sent as VLRUNIT only when the note has a discount.
      listUnitPrice: normalizeDecimalString(item.unitListPrice),
    });
  }
  return {
    ok: true,
    value: {
      originId: order.id,
      originField,
      customerCode: order.customerCode,
      sellerCode: order.sellerCode,
      companyCode: header.companyCode,
      topCode: header.topCode,
      negotiationTypeCode: order.negotiationTypeCode,
      carrierCode: header.carrierCode,
      expedicao: order.expedicao,
      stockLocationCode: header.stockLocationCode,
      orderDate: header.orderDate,
      notes: order.notes,
      items: lines,
    },
  };
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export interface DryRunRecord {
  /** Exactly what would have been sent, except `OBSERVACAO`, replaced by its hash (D-6). */
  readonly payload: unknown;
  /** SHA-256 of the exact request text. */
  readonly payloadHash: string;
}

/** D-6: only codes, UUIDs, quantities and values; the order note is replaced by its hash; no token, name, CPF/CNPJ. */
export function dryRunRecord(request: OrderWriteRequest): DryRunRecord {
  const body = JSON.parse(JSON.stringify(buildIncluirNotaBody(request))) as {
    nota: { cabecalho: Record<string, { $: string } | Record<string, never>> };
  };
  const note = body.nota.cabecalho['OBSERVACAO'];
  if (note !== undefined && '$' in note && typeof note.$ === 'string') {
    body.nota.cabecalho['OBSERVACAO'] = { $: `sha256:${sha256(note.$)}` };
  }
  return { payload: body, payloadHash: sha256(buildIncluirNotaRequestText(request)) };
}

/** D-AK: R$ tolerance between the ERP's own figures and the Force rule (the ERP rounds on its own; 2492: 82.80 vs 82.78). */
const AMOUNT_TOLERANCE = '0.05';

function absoluteDifference(a: string, b: string): string {
  return compareDecimalStrings(a, b) >= 0 ? subtractTotals(a, b) : subtractTotals(b, a);
}

function withinTolerance(a: string, b: string): boolean {
  return compareDecimalStrings(absoluteDifference(a, b), AMOUNT_TOLERANCE) <= 0;
}

/**
 * The ERP derives VLRDESC from the percentage (never computed by the Force): per unit, rounded to 2 places, times the
 * quantity (Sankhya rule, D-AK). With a discount VLRDESC must match that figure within cents and the effective line
 * (quantity x VLRUNIT - VLRDESC) must match the Force net line; without a discount VLRDESC must be zero. VLRTOT is
 * gross in the ERP and is not compared.
 */
function discountAmountCoherent(item: DeliveryItem, line: WrittenOrder['items'][number]): boolean {
  const amount = line.discountAmount === null ? '0.00' : normalizeDecimalString(line.discountAmount);
  if (decimalEquals(item.discountPercent, '0')) return compareDecimalStrings(amount, AMOUNT_TOLERANCE) <= 0;
  if (compareDecimalStrings(amount, '0') <= 0) return false;
  const gross = computeLineTotal(line.quantity, line.unitPrice);
  if (compareDecimalStrings(amount, gross) > 0) return false;
  const expectedAmount = computeLineDiscountAmount(item.quantity, line.unitPrice, item.discountPercent);
  if (!withinTolerance(amount, expectedAmount)) return false;
  const effective = subtractTotals(gross, amount);
  const expectedNet = computeDiscountedLineTotal(item.quantity, line.unitPrice, item.discountPercent);
  return withinTolerance(effective, expectedNet);
}

export type RereadVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'price_divergence' | 'discount_divergence' | 'item_mismatch' | 'ipi_divergence' | 'total_divergence';
      readonly productCode: number;
    };

/**
 * D-7: after writing, the item prices stored by the ERP must be the table price (`VLRUNIT`), the discount the one sent
 * (`PERCDESC`, with `VLRDESC` by the Sankhya rule) and, when the Force can estimate the IPI of every line, the IPI
 * (`VLRIPI` per line and in the header) and the note total (`VLRNOTA` = net lines + IPIs) must match within cents.
 * Lines are paired by product and quantity; a difference is a validation error.
 */
export function verifyWrittenOrder(
  items: readonly DeliveryItem[],
  written: WrittenOrder,
  ipiRefs: ReadonlyMap<number, IpiRef> = new Map(),
): RereadVerdict {
  const remaining = [...written.items];
  const paired: { item: DeliveryItem; line: WrittenOrder['items'][number] }[] = [];
  for (const item of items) {
    const wantedQuantity = normalizeDecimalString(item.quantity);
    const at = remaining.findIndex((line) => line.productCode === item.productCode && decimalEquals(line.quantity, wantedQuantity));
    if (at < 0) return { ok: false, code: 'item_mismatch', productCode: item.productCode };
    const [line] = remaining.splice(at, 1);
    if (line === undefined) return { ok: false, code: 'item_mismatch', productCode: item.productCode };
    if (item.unitListPrice !== null && !decimalEquals(line.unitPrice, item.unitListPrice)) {
      return { ok: false, code: 'price_divergence', productCode: item.productCode };
    }
    if (!decimalEquals(line.discountPercent ?? '0', item.discountPercent)) {
      return { ok: false, code: 'discount_divergence', productCode: item.productCode };
    }
    if (!discountAmountCoherent(item, line)) return { ok: false, code: 'discount_divergence', productCode: item.productCode };
    paired.push({ item, line });
  }
  if (remaining.length > 0) return { ok: false, code: 'item_mismatch', productCode: remaining[0]?.productCode ?? 0 };
  return verifyIpiAndTotal(paired, written, ipiRefs);
}

/** IPI and note total, compared only when the Force can estimate the IPI of every line (no tariff, no missing rate). */
function verifyIpiAndTotal(
  paired: readonly { item: DeliveryItem; line: WrittenOrder['items'][number] }[],
  written: WrittenOrder,
  ipiRefs: ReadonlyMap<number, IpiRef>,
): RereadVerdict {
  const nets: string[] = [];
  const ipis: string[] = [];
  for (const { item, line } of paired) {
    if (item.unitListPrice === null) return { ok: true };
    const ref = ipiRefs.get(item.productCode);
    if (ref === undefined) return { ok: true };
    const net = computeDiscountedLineTotal(item.quantity, item.unitListPrice, item.discountPercent);
    const ipi = classifyIpiRef(net, ref);
    if (ipi.status !== 'estimated' && ipi.status !== 'exempt') return { ok: true };
    nets.push(net);
    ipis.push(ipi.amount);
    if (line.ipiAmount !== null && !withinTolerance(normalizeDecimalString(line.ipiAmount), ipi.amount)) {
      return { ok: false, code: 'ipi_divergence', productCode: item.productCode };
    }
  }
  const expectedIpi = sumTotals(ipis);
  if (written.ipiAmount !== null && !withinTolerance(normalizeDecimalString(written.ipiAmount), expectedIpi)) {
    return { ok: false, code: 'ipi_divergence', productCode: 0 };
  }
  const expectedTotal = sumTotals([...nets, ...ipis]);
  if (written.totalAmount !== null && !withinTolerance(normalizeDecimalString(written.totalAmount), expectedTotal)) {
    return { ok: false, code: 'total_divergence', productCode: 0 };
  }
  return { ok: true };
}
