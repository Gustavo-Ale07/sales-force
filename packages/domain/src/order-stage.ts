/**
 * Stage of an order as the seller follows it after it left the Force (docs/implementation/order-status-following-sankhya.md).
 * Pure and deterministic: it classifies FACTS read by the integration layer and knows no Sankhya table.
 *
 * Owner rule (production survey 2026-11-23): an order does not change TOP until invoiced; the stage comes from the release
 * lines, the load order and the invoicing link, never from the customer-specific status, traffic-light or dispatch flags.
 * Which release events mean "order review" is installation configuration (`OrderStageRules`), never a literal here.
 */
export type OrderStageCode =
  | 'sent_to_force'
  | 'send_error'
  | 'quotation'
  | 'received'
  | 'in_review'
  | 'financial_check'
  | 'in_dispatch'
  | 'in_invoicing'
  | 'invoiced';

export const ORDER_STAGE_CODES: readonly OrderStageCode[] = [
  'sent_to_force',
  'send_error',
  'quotation',
  'received',
  'in_review',
  'financial_check',
  'in_dispatch',
  'in_invoicing',
  'invoiced',
];

/** A release event that counts as "order review"; `cascadeSequence` absent = any sequence of that event. */
export interface OrderStageReviewEvent {
  readonly event: number;
  readonly cascadeSequence?: number;
}

export interface OrderStageRules {
  /** Pending release events that mean the order is being reviewed (sector `reviewSector`). Every other pending release is the financial check. */
  readonly reviewEvents: readonly OrderStageReviewEvent[];
  readonly reviewSector: string;
  readonly financialSector: string;
  /** Hours an invoiced order is still read after reaching its final stage; 0 = never read again. */
  readonly finalRereadWindowHours: number;
  /**
   * Release events that the release queue shows in BOTH sectors (PROPOSAL, owner survey: event 13 = "Pedidos e Financeiro").
   * It does not change the stage the seller sees (`classifyOrderStage`): that stays "other pending = financial check".
   */
  readonly bothSectorsEvents: readonly number[];
}

/** Defaults of an installation that configures nothing: the PLAC survey values. Overridable through `erp.orderStage`. */
export const DEFAULT_ORDER_STAGE_RULES: OrderStageRules = {
  reviewEvents: [{ event: 44, cascadeSequence: 1 }, { event: 2 }],
  reviewSector: 'Pedidos',
  financialSector: 'Financeiro',
  finalRereadWindowHours: 24,
  bothSectorsEvents: [13],
};

/** Rules of an installation: configured keys over `DEFAULT_ORDER_STAGE_RULES`. */
export function resolveOrderStageRules(configured?: Partial<OrderStageRules>): OrderStageRules {
  return {
    reviewEvents: configured?.reviewEvents ?? DEFAULT_ORDER_STAGE_RULES.reviewEvents,
    reviewSector: configured?.reviewSector ?? DEFAULT_ORDER_STAGE_RULES.reviewSector,
    financialSector: configured?.financialSector ?? DEFAULT_ORDER_STAGE_RULES.financialSector,
    finalRereadWindowHours: configured?.finalRereadWindowHours ?? DEFAULT_ORDER_STAGE_RULES.finalRereadWindowHours,
    bothSectorsEvents: configured?.bothSectorsEvents ?? DEFAULT_ORDER_STAGE_RULES.bothSectorsEvents,
  };
}

export const ORDER_STAGE_LABELS: Readonly<Record<OrderStageCode, string>> = {
  sent_to_force: 'Enviado ao Force',
  send_error: 'Erro no envio',
  quotation: 'Orçamento no Sankhya',
  received: 'Recebido no Sankhya',
  in_review: 'Em revisão',
  financial_check: 'Conferência financeira',
  in_dispatch: 'Na expedição',
  in_invoicing: 'No faturamento',
  invoiced: 'Faturado',
};

/** The stages a seller follows on the timeline, in order (the quotation and the Force-side states have none). */
export const ORDER_STAGE_TIMELINE: readonly OrderStageCode[] = ['received', 'in_review', 'financial_check', 'in_dispatch', 'in_invoicing', 'invoiced'];

export interface PendingRelease {
  readonly event: number;
  readonly cascadeSequence: number | null;
}

export interface OrderStageFacts {
  /** `null` = the order has no note in Sankhya yet. */
  readonly nunota: number | null;
  readonly codtipoper?: number | null;
  /** Confirmation status of the order note ('L' = confirmed). */
  readonly statusnota: string | null;
  /** Pending flag of the order note (carried, not used by the precedence). */
  readonly pendente?: string | null;
  readonly ordemcarga: number | null;
  /** Release lines of the note that are not released yet. */
  readonly pendingReleases: readonly PendingRelease[];
  /** The order note is linked to a sale note (invoicing link). */
  readonly hasInvoiceLink: boolean;
  /** Number of the sale note, when known. */
  readonly invoiceNumber: number | null;
  /** The note is on a quotation TOP (configuration). */
  readonly isQuotation: boolean;
  /** Delivery state of the Force order's last outbox row, used only while there is no note. */
  readonly outboxState?: 'pending' | 'failed' | null;
}

export interface OrderStage {
  readonly code: OrderStageCode;
  readonly label: string;
  /** Sector holding the order (review or financial check); `null` otherwise. */
  readonly pendingSector: string | null;
  /** The quotation shows its number only, never a timeline. */
  readonly hasTimeline: boolean;
  /** Nothing more changes after this stage (the window then applies). */
  readonly final: boolean;
}

function matchesReview(release: PendingRelease, rules: OrderStageRules): boolean {
  return rules.reviewEvents.some(
    (rule) => rule.event === release.event && (rule.cascadeSequence === undefined || rule.cascadeSequence === release.cascadeSequence),
  );
}

function stage(code: OrderStageCode, pendingSector: string | null = null): OrderStage {
  return { code, label: ORDER_STAGE_LABELS[code], pendingSector, hasTimeline: code !== 'quotation', final: code === 'invoiced' };
}

/**
 * Precedence, first match wins: invoiced (invoicing link) > in invoicing (load order > 0) > in review (pending review event) >
 * financial check (any other pending release) > in dispatch (confirmed note) > received. Before any note: send error, else sent to
 * the Force. A quotation note skips the cascade.
 */
export function classifyOrderStage(facts: OrderStageFacts, rules: OrderStageRules = DEFAULT_ORDER_STAGE_RULES): OrderStage {
  if (facts.nunota === null) return stage(facts.outboxState === 'failed' ? 'send_error' : 'sent_to_force');
  if (facts.isQuotation) return stage('quotation');
  if (facts.hasInvoiceLink) return stage('invoiced');
  if ((facts.ordemcarga ?? 0) > 0) return stage('in_invoicing');
  if (facts.pendingReleases.some((release) => matchesReview(release, rules))) return stage('in_review', rules.reviewSector);
  if (facts.pendingReleases.length > 0) return stage('financial_check', rules.financialSector);
  if (facts.statusnota === 'L') return stage('in_dispatch');
  return stage('received');
}

/**
 * Sectors that must release one pending line (release queue; the Force never releases, Sankhya does). Same split as the stage:
 * a review event (event 44 at cascade level 1, event 2 by default) -> review sector; every other event -> financial sector;
 * an event listed in `bothSectorsEvents` -> both sectors (PROPOSAL, owner survey: event 13 is "Pedidos e Financeiro").
 */
export function sectorsOfPendingRelease(release: PendingRelease, rules: OrderStageRules): readonly string[] {
  if (rules.bothSectorsEvents.includes(release.event)) return rules.reviewSector === rules.financialSector ? [rules.reviewSector] : [rules.reviewSector, rules.financialSector];
  return [matchesReview(release, rules) ? rules.reviewSector : rules.financialSector];
}

/** Whether an order whose last stage was read at `updatedAt` must still be read at `now`. */
export function isOrderStageDue(stageCode: OrderStageCode | null, updatedAt: Date | null, now: Date, rules: OrderStageRules): boolean {
  if (stageCode === null || updatedAt === null) return true;
  if (stageCode !== 'invoiced') return true;
  return now.getTime() - updatedAt.getTime() < rules.finalRereadWindowHours * 3600_000;
}
