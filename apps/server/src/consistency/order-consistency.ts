import { installationConfigurationVersion, salesOrder, salesOrderErpStage, salesOrderReleasePending, type DbHandle } from '@salesforce/db';
import { classifyOrderStage, resolveOrderStageRules, sectorsOfPendingRelease, type OrderStageRules } from '@salesforce/domain';
import type { ErpOrderReleaseReading, ErpOrderStageReading, SankhyaOrderReadPort } from '@salesforce/sankhya';
import { and, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { validateInstallationConfiguration } from '../configuration/validate.js';
import { ERP_STATUS_BATCH, ERP_STATUS_MAX_AGE_DAYS } from '../integration/order-erp-status.service.js';
import { describeSyncFailure } from '../sync/failure.js';
import { diffKeyed, type MirrorRowState } from './compare.js';
import { noComparison, type TypeOutcome } from './types.js';

export type OrderConsistencyType = 'orders' | 'orderStatus' | 'releases';

export interface OrderConsistencyDeps {
  readonly db: DbHandle;
  /** Read port only (`findOrderByOrigin` and the three SELECT-only fact reads); the write port is not reachable from here. */
  readonly gateway: Pick<SankhyaOrderReadPort, 'readOrderStageFacts' | 'readOrderReleaseFacts' | 'findOrderByOrigin'>;
  /** Dedicated origin field (SNK-5). Absent = the "exists in Sankhya but not linked in the Force" check is skipped. */
  readonly originField?: string;
  readonly now: () => Date;
  readonly signal?: AbortSignal;
}

/** Orders sent without a recorded answer that are looked up by origin id per pass (one ERP request each). */
const ORIGIN_LOOKUP_LIMIT = 25;

type OrderOutcomes = Record<OrderConsistencyType, TypeOutcome>;

async function loadRules(db: DbHandle): Promise<{ rules: OrderStageRules; quotationTopCode: number | null } | null> {
  const [current] = await db.db
    .select({ payload: installationConfigurationVersion.payload })
    .from(installationConfigurationVersion)
    .where(eq(installationConfigurationVersion.isCurrent, true));
  if (current === undefined) return null;
  const validated = validateInstallationConfiguration(current.payload);
  if (!validated.ok) return null;
  return { rules: resolveOrderStageRules(validated.value.erp?.orderStage), quotationTopCode: validated.value.sales.quotationTopCode };
}

function failed(error: unknown): TypeOutcome {
  const failure = describeSyncFailure(error);
  return noComparison('read_failed', `${failure.errorClass}:${failure.errorCode ?? 'unknown'}`);
}

type OrderPresence = 'found' | 'absent' | 'unknown';

/**
 * Anti-mass-delete guard (same thresholds as the removal cycle, RT-1): a partial batch, or one where 90 % or more of at least 3
 * orders is absent, proves nothing and reports no "extra".
 */
function isSuspectBatch(presences: readonly OrderPresence[], expected: number): boolean {
  if (presences.length < expected) return true;
  const absent = presences.filter((p) => p === 'absent').length;
  return presences.length >= 3 && absent * 100 >= presences.length * 90;
}

/** Same reading of "present / confirmed absent / unknown" the removal cycle applies (`runReleaseOnce`). */
function presenceOf(reading: ErpOrderReleaseReading): OrderPresence {
  return reading.found ? 'found' : reading.billing?.cancelled === true || reading.billingErrorCode !== undefined ? 'unknown' : 'absent';
}

interface Candidate {
  readonly id: string;
  readonly erpNumber: number;
  readonly removed: boolean;
  /** Identifier used in samples and logs: NUNOTA and the order id, nothing else. */
  readonly label: string;
}

/**
 * Orders sent to the ERP, their stage and their release queue, compared with what Sankhya says now. Same candidate window the
 * stage cycle follows (sent, with an ERP number, created in the last 90 days; the newest batch). The facts come from the gateway's
 * own SELECT-only batch reads and the stage is classified by the domain function the cycle uses, with the stored configuration rules.
 * Read-only toward the ERP and toward the Force.
 *
 * - `orders`: extra = the Force has a sent order whose note the ERP confirms ABSENT (not cancelled, billing read healthy) and the
 *   Force did not mark it removed; divergent = marked removed in the Force but the note exists; missing = an order the Force holds
 *   as unknown/rejected without ERP number that the ERP already has under OUR origin id (exact match on the dedicated field).
 * - `orderStatus`: the stored stage (code, label, sector, invoice) against the classification of the facts read now.
 * - `releases`: the pending release lines (event, cascade, sector) of orders held for release, against `sales_order_release_pending`.
 */
export async function verifyOrderTypes(deps: OrderConsistencyDeps, types: readonly OrderConsistencyType[]): Promise<OrderOutcomes> {
  const { db, gateway } = deps;
  const wanted = new Set(types);
  const now = deps.now();
  const since = new Date(now.getTime() - ERP_STATUS_MAX_AGE_DAYS * 24 * 3600_000);

  const rows = await db.db
    .select({ id: salesOrder.id, erpNumber: salesOrder.erpNumber, removedAt: salesOrder.erpRemovedAt })
    .from(salesOrder)
    .where(and(eq(salesOrder.status, 'sent'), isNotNull(salesOrder.erpNumber), gte(salesOrder.createdAt, since)))
    .orderBy(desc(salesOrder.createdAt))
    .limit(ERP_STATUS_BATCH);
  const candidates: Candidate[] = rows.flatMap((row) =>
    row.erpNumber === null ? [] : [{ id: row.id, erpNumber: row.erpNumber, removed: row.removedAt !== null, label: `${row.erpNumber}:${row.id}` }],
  );

  const result: OrderOutcomes = {
    orders: noComparison('not_configured', 'no_sent_orders'),
    orderStatus: noComparison('not_configured', 'no_sent_orders'),
    releases: noComparison('not_configured', 'no_sent_orders'),
  };
  const options = deps.signal === undefined ? {} : { signal: deps.signal };

  // ---- orders: existence ------------------------------------------------------------------------
  if (wanted.has('orders')) {
    const missing: string[] = [];
    const extra: string[] = [];
    const divergent: string[] = [];
    let detail: string | undefined;
    let outcome: TypeOutcome | null = null;
    if (candidates.length > 0) {
      try {
        const readings = await gateway.readOrderReleaseFacts(candidates.map((c) => c.erpNumber), options);
        const byNumber = new Map(readings.map((reading) => [reading.erpOrderNumber, reading]));
        const presences = candidates.flatMap((c) => {
          const reading = byNumber.get(c.erpNumber);
          return reading === undefined ? [] : [presenceOf(reading)];
        });
        // Anti-mass-delete guard of the removal cycle: a partial or mostly-absent batch proves nothing.
        const suspect = isSuspectBatch(presences, candidates.length);
        for (const c of candidates) {
          const reading = byNumber.get(c.erpNumber);
          if (reading === undefined) continue;
          const presence = presenceOf(reading);
          if (presence === 'found' && c.removed) divergent.push(c.label);
          else if (presence === 'absent' && !c.removed && !suspect) extra.push(c.label);
        }
        if (suspect) {
          outcome = { ...noComparison('suspect_empty_source', 'suspect_batch'), sourceCount: presences.length, mirrorCount: candidates.length };
        }
      } catch (error) {
        outcome = failed(error);
      }
    }
    if (outcome === null && deps.originField !== undefined && deps.originField !== '') {
      const unlinked = await db.db
        .select({ id: salesOrder.id })
        .from(salesOrder)
        .where(and(inArray(salesOrder.status, ['unknown', 'rejected']), isNull(salesOrder.erpNumber), gte(salesOrder.createdAt, since)))
        .orderBy(desc(salesOrder.updatedAt))
        .limit(ORIGIN_LOOKUP_LIMIT);
      for (const order of unlinked) {
        try {
          const found = await gateway.findOrderByOrigin(deps.originField, order.id, options);
          if (found !== null) missing.push(`${found.erpOrderNumber}:${order.id}`);
        } catch (error) {
          // One failed lookup says nothing about the others, and nothing about this order: it is simply not reported.
          detail = `origin_lookup_failed:${describeSyncFailure(error).errorCode ?? 'unknown'}`;
        }
      }
    }
    if (outcome !== null) result.orders = outcome;
    else if (candidates.length > 0 || missing.length > 0 || detail !== undefined) {
      result.orders = {
        status: 'checked',
        sourceCount: candidates.length,
        mirrorCount: candidates.length,
        differences: { missing: missing.sort(), extra: extra.sort(), divergent: divergent.sort() },
        ...(detail === undefined ? {} : { detail }),
      };
    }
  }

  // ---- stage and release queue: one batched read serves both --------------------------------------
  if ((wanted.has('orderStatus') || wanted.has('releases')) && candidates.length > 0) {
    const configured = await loadRules(db);
    if (configured === null) {
      const outcome = noComparison('read_failed', 'configuration_unavailable');
      if (wanted.has('orderStatus')) result.orderStatus = outcome;
      if (wanted.has('releases')) result.releases = outcome;
      return result;
    }
    let readings: readonly ErpOrderStageReading[];
    try {
      readings = await gateway.readOrderStageFacts(candidates.map((c) => c.erpNumber), options);
    } catch (error) {
      const outcome = failed(error);
      if (wanted.has('orderStatus')) result.orderStatus = outcome;
      if (wanted.has('releases')) result.releases = outcome;
      return result;
    }
    const byNumber = new Map(readings.map((reading) => [reading.erpOrderNumber, reading]));
    // A note the ERP cannot find keeps what was stored (the stage cycle's rule): it is not part of this comparison.
    const present = candidates.filter((c) => byNumber.get(c.erpNumber)?.found === true);
    const ids = present.map((c) => c.id);
    const label = new Map(present.map((c) => [c.id, c.label]));

    if (wanted.has('orderStatus')) {
      const source = new Map<string, string>();
      const stages = new Map<string, { stage: string; lines: readonly string[] }>();
      for (const c of present) {
        const reading = byNumber.get(c.erpNumber);
        if (reading === undefined) continue;
        const stage = classifyOrderStage(
          {
            nunota: c.erpNumber,
            codtipoper: reading.codtipoper,
            statusnota: reading.statusNota,
            pendente: reading.pending,
            ordemcarga: reading.orderCargo,
            pendingReleases: reading.pendingReleases,
            hasReprovedRelease: reading.hasReprovedRelease === true,
            hasInvoiceLink: reading.hasInvoiceLink,
            invoiceNumber: reading.invoiceNumber,
            isQuotation: configured.quotationTopCode !== null && reading.codtipoper === configured.quotationTopCode,
          },
          configured.rules,
        );
        stages.set(c.id, { stage: stage.code, lines: reading.pendingReleases.map(String) });
        source.set(c.label, JSON.stringify([stage.code, stage.label, stage.pendingSector, stage.code === 'invoiced' ? reading.invoiceNumber : null]));
      }
      const stored = ids.length === 0 ? [] : await db.db.select().from(salesOrderErpStage).where(inArray(salesOrderErpStage.orderId, ids));
      const mirror = new Map<string, MirrorRowState>();
      for (const row of stored) {
        const key = label.get(row.orderId);
        if (key !== undefined) mirror.set(key, { hash: JSON.stringify([row.stage, row.label, row.pendingSector, row.stage === 'invoiced' ? row.invoiceNumber : null]), deleted: false });
      }
      result.orderStatus = { status: 'checked', sourceCount: source.size, mirrorCount: mirror.size, differences: diffKeyed(source, mirror) };
    }

    if (wanted.has('releases')) {
      const source = new Map<string, string>();
      const holding = new Set<string>();
      const ignoreAssignee = new Set<string>();
      for (const c of present) {
        const reading = byNumber.get(c.erpNumber);
        if (reading === undefined) continue;
        // The release queue only holds the lines of an order held by the review or financial sector (the stage cycle's rule).
        const stage = classifyOrderStage(
          {
            nunota: c.erpNumber,
            codtipoper: reading.codtipoper,
            statusnota: reading.statusNota,
            pendente: reading.pending,
            ordemcarga: reading.orderCargo,
            pendingReleases: reading.pendingReleases,
            hasReprovedRelease: reading.hasReprovedRelease === true,
            hasInvoiceLink: reading.hasInvoiceLink,
            invoiceNumber: reading.invoiceNumber,
            isQuotation: configured.quotationTopCode !== null && reading.codtipoper === configured.quotationTopCode,
          },
          configured.rules,
        );
        holding.add(c.id);
        // The releaser is compared only when its soft read worked: a failed assignee read must not look like a divergence.
        if (reading.assigneeReadErrorCode !== undefined) ignoreAssignee.add(c.id);
        if (stage.code !== 'in_review' && stage.code !== 'financial_check') continue;
        for (const line of reading.pendingReleases) {
          for (const sector of sectorsOfPendingRelease({ event: line.event, cascadeSequence: line.cascadeSequence }, configured.rules)) {
            const key = `${c.label}|${line.event}|${line.cascadeSequence ?? ''}|${sector}`;
            if (!source.has(key)) source.set(key, ignoreAssignee.has(c.id) ? '' : String(line.assignedUserCode ?? ''));
          }
        }
      }
      const stored = ids.length === 0 ? [] : await db.db.select().from(salesOrderReleasePending).where(inArray(salesOrderReleasePending.orderId, ids));
      const mirror = new Map<string, MirrorRowState>();
      for (const row of stored) {
        const order = label.get(row.orderId);
        if (order === undefined || !holding.has(row.orderId)) continue;
        mirror.set(`${order}|${row.event}|${row.cascadeSequence ?? ''}|${row.sector}`, {
          hash: ignoreAssignee.has(row.orderId) ? '' : String(row.assignedUserCode ?? ''),
          deleted: false,
        });
      }
      result.releases = { status: 'checked', sourceCount: source.size, mirrorCount: mirror.size, differences: diffKeyed(source, mirror) };
    }
  }
  return result;
}
