/**
 * ERP order status as Vidya Force showed it (SNK-7 P2). Pure and deterministic: it maps FACTS about an ERP
 * order (already read by the integration layer) to a status code and label. It knows no Sankhya table or column.
 *
 * NEEDS VALIDATION (docs/sankhya-spike.md 9.48 item 9): the code list and the NEGADO rule come from the owner's
 * description of Vidya's `GETCODSTATUS_VIDYA`; the order of the other branches is a RECONSTRUCTION, not read from
 * that function. Compare against real orders before relying on a branch other than the ones stated by the owner.
 *
 * Quirk kept on purpose: an order that has an invoice whose electronic status is not "authorised" ('A') is
 * NEGADO even though it is also invoiced; NEGADO overrides FATURADO.
 */
export const ERP_ORDER_STATUS = {
  cancelado: 0,
  naoConfirmado: 1,
  confirmado: 2,
  aguardandoFaturamento: 3,
  faturado: 4,
  negado: 5,
  aguardandoLiberacao: 6,
  desconhecido: -1,
} as const;

export type ErpOrderStatusCode = (typeof ERP_ORDER_STATUS)[keyof typeof ERP_ORDER_STATUS];

export const ERP_ORDER_STATUS_LABELS: Readonly<Record<ErpOrderStatusCode, string>> = {
  0: 'CANCELADO',
  1: 'NÃO CONFIRMADO',
  2: 'CONFIRMADO',
  3: 'AGUARDANDO FATURAMENTO',
  4: 'FATURADO',
  5: 'NEGADO',
  6: 'AGUARDANDO LIBERAÇÃO',
  [-1]: 'DESCONHECIDO',
};

/** Facts about one ERP order. `found` false means the ERP returned nothing for it. */
export interface ErpOrderStatusFacts {
  readonly found: boolean;
  readonly cancelled: boolean;
  readonly confirmed: boolean;
  /** A release (liberação) is pending on the order. */
  readonly awaitingRelease: boolean;
  /** The order is confirmed and billing was requested but no invoice exists yet. */
  readonly awaitingBilling: boolean;
  /** An invoice exists for the order. */
  readonly invoiced: boolean;
  /** Electronic invoice status; 'A' = authorised. null when not applicable or unreadable. */
  readonly invoiceStatus: string | null;
}

export interface ErpOrderStatus {
  readonly code: ErpOrderStatusCode;
  readonly label: string;
}

/** Terminal for polling: nothing more changes (cancelled or invoiced and authorised). */
export const ERP_FINAL_STATUS_CODES: readonly ErpOrderStatusCode[] = [0, 4];

export function isFinalErpStatus(code: ErpOrderStatusCode): boolean {
  return ERP_FINAL_STATUS_CODES.includes(code);
}

function status(code: ErpOrderStatusCode): ErpOrderStatus {
  return { code, label: ERP_ORDER_STATUS_LABELS[code] };
}

/** Precedence, first match wins: unknown, cancelled, invoiced (NEGADO unless authorised), release, billing, confirmed. */
export function mapErpOrderStatus(facts: ErpOrderStatusFacts): ErpOrderStatus {
  if (!facts.found) return status(ERP_ORDER_STATUS.desconhecido);
  if (facts.cancelled) return status(ERP_ORDER_STATUS.cancelado);
  if (facts.invoiced) {
    return status(facts.invoiceStatus === 'A' ? ERP_ORDER_STATUS.faturado : ERP_ORDER_STATUS.negado);
  }
  if (facts.awaitingRelease) return status(ERP_ORDER_STATUS.aguardandoLiberacao);
  if (!facts.confirmed) return status(ERP_ORDER_STATUS.naoConfirmado);
  if (facts.awaitingBilling) return status(ERP_ORDER_STATUS.aguardandoFaturamento);
  return status(ERP_ORDER_STATUS.confirmado);
}
