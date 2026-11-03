import { estimateItemIpi, sumTotals, type DecimalString } from './money.js';

export { estimateItemIpi };

/**
 * An IPI rate mirrored from the ERP. `byTariff` is true when the ERP calculates the IPI by tariff value (pauta:
 * VLRPAUTA > 0 or PAUTACONDIC = 'S'), which the Sales Force does not estimate.
 *
 * The IPI shown by the Sales Force is an ESTIMATE for display (D-D): it never enters validation, authorization or the
 * payload sent to the ERP, which calculates the real value.
 */
export interface IpiRate {
  readonly code: number;
  readonly percentual: DecimalString;
  readonly byTariff: boolean;
  readonly description: string;
}

export type ItemIpi =
  | { readonly status: 'estimated'; readonly amount: DecimalString; readonly percentual: DecimalString }
  /** No IPI code on the product, no rate mirrored for the code, or no priced line: "IPI não disponível". Never zero. */
  | { readonly status: 'unavailable' }
  /** IPI by tariff value: "IPI por pauta — não estimado". */
  | { readonly status: 'tariff' };

/** The IPI reference of a product: what a client needs to estimate the IPI of a line (D-D). */
export type IpiRef =
  | { readonly status: 'rate'; readonly percentual: DecimalString }
  | { readonly status: 'tariff' }
  | { readonly status: 'unavailable' };

export function ipiRefOf(ipiCode: number | null | undefined, rates: ReadonlyMap<number, IpiRate>): IpiRef {
  if (ipiCode === null || ipiCode === undefined) return { status: 'unavailable' };
  const rate = rates.get(ipiCode);
  if (rate === undefined) return { status: 'unavailable' };
  return rate.byTariff ? { status: 'tariff' } : { status: 'rate', percentual: rate.percentual };
}

/** IPI of one line, from its NET total (quantity x unit price - item discount) and the product's IPI code. */
export function classifyItemIpi(
  lineNetTotal: DecimalString | null,
  ipiCode: number | null,
  rates: ReadonlyMap<number, IpiRate>,
): ItemIpi {
  return classifyIpiRef(lineNetTotal, ipiRefOf(ipiCode, rates));
}

/** Same as `classifyItemIpi` for clients that hold the product's `IpiRef` instead of the rate table. */
export function classifyIpiRef(lineNetTotal: DecimalString | null, ref: IpiRef): ItemIpi {
  if (lineNetTotal === null || ref.status === 'unavailable') return { status: 'unavailable' };
  if (ref.status === 'tariff') return { status: 'tariff' };
  return { status: 'estimated', amount: estimateItemIpi(lineNetTotal, ref.percentual), percentual: ref.percentual };
}

export interface IpiLineInput {
  readonly lineNetTotal: DecimalString | null;
  readonly ipiCode: number | null;
}

export interface OrderIpi {
  readonly lines: readonly ItemIpi[];
  readonly ipiEstimated: DecimalString;
  /** Net total + estimated IPI. */
  readonly grandTotalEstimated: DecimalString;
  readonly unavailableLineCount: number;
  readonly tariffLineCount: number;
  /** True when at least one line has no estimated IPI, i.e. the IPI does not cover the whole order. */
  readonly isPartial: boolean;
}

export function computeOrderIpi(
  lines: readonly IpiLineInput[],
  netTotal: DecimalString,
  rates: ReadonlyMap<number, IpiRate>,
): OrderIpi {
  return computeOrderIpiFromRefs(
    lines.map((line) => ({ lineNetTotal: line.lineNetTotal, ref: ipiRefOf(line.ipiCode, rates) })),
    netTotal,
  );
}

export function computeOrderIpiFromRefs(
  lines: readonly { readonly lineNetTotal: DecimalString | null; readonly ref: IpiRef }[],
  netTotal: DecimalString,
): OrderIpi {
  const classified = lines.map((line) => classifyIpiRef(line.lineNetTotal, line.ref));
  const amounts: DecimalString[] = [];
  let unavailable = 0;
  let tariff = 0;
  for (const item of classified) {
    if (item.status === 'estimated') amounts.push(item.amount);
    else if (item.status === 'tariff') tariff += 1;
    else unavailable += 1;
  }
  const ipiEstimated = sumTotals(amounts);
  return {
    lines: classified,
    ipiEstimated,
    grandTotalEstimated: sumTotals([netTotal, ipiEstimated]),
    unavailableLineCount: unavailable,
    tariffLineCount: tariff,
    isPartial: unavailable + tariff > 0,
  };
}
