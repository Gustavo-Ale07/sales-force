import {
  countDraftsByGroup,
  getDraftItems,
  queryDrafts,
  type DraftFilter,
  type DraftRecord,
  type DraftStatus,
  type SalesGroup,
  type SqlDatabase,
} from "@salesforce/mobile-db";
import { sumTotals } from "@salesforce/domain";
import { previewDraft, type EditorLine } from "../data/order-draft";
import type { Page } from "../data/ports";
import { linesFromDraftItems } from "./local-orders";

/** Period presets. The date is the LOCAL creation date of the order on this device — never the sync timestamp. */
export type SalesPeriod = "all" | "today" | "7d" | "30d" | "custom";

export interface SalesFilters {
  readonly group: SalesGroup;
  readonly statuses: readonly DraftStatus[];
  readonly customer: { readonly code: number; readonly name: string } | null;
  readonly period: SalesPeriod;
  /** Inclusive `YYYY-MM-DD` bounds, only read when `period` is `custom`. */
  readonly customFrom: string | null;
  readonly customTo: string | null;
}

export const EMPTY_SALES_FILTERS: Omit<SalesFilters, "group"> = { statuses: [], customer: null, period: "all", customFrom: null, customTo: null };

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** `YYYY-MM-DD` → local midnight; `null` when it is not a real calendar date. */
export function parseLocalDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** Inclusive-start / exclusive-end ISO bounds of a period, in the device's local days. */
export function periodRange(filters: Pick<SalesFilters, "period" | "customFrom" | "customTo">, now: Date): { from?: string; before?: string } {
  const today = startOfLocalDay(now);
  switch (filters.period) {
    case "all":
      return {};
    case "today":
      return { from: today.toISOString(), before: addDays(today, 1).toISOString() };
    case "7d":
      return { from: addDays(today, -6).toISOString(), before: addDays(today, 1).toISOString() };
    case "30d":
      return { from: addDays(today, -29).toISOString(), before: addDays(today, 1).toISOString() };
    case "custom": {
      const from = filters.customFrom === null ? null : parseLocalDate(filters.customFrom);
      const to = filters.customTo === null ? null : parseLocalDate(filters.customTo);
      return { ...(from === null ? {} : { from: from.toISOString() }), ...(to === null ? {} : { before: addDays(to, 1).toISOString() }) };
    }
  }
}

/** The order value shown on a row: a synced order shows the server estimate; everything else is estimated locally by the domain. */
export interface SalesValue {
  readonly amount: string | null;
  /** True when at least one line has no price, so the amount does not cover the whole order. */
  readonly partial: boolean;
}

export interface SalesRow {
  readonly draft: DraftRecord;
  readonly value: SalesValue;
}

export interface SalesSummary {
  readonly count: number;
  /** Sum of the orders that have a value; `null` when none has. */
  readonly amount: string | null;
  /** Some order in the filter has no value or only a partial one, so the sum is a lower bound. */
  readonly partial: boolean;
  readonly lastUpdatedAt: string | null;
  readonly counts: Record<SalesGroup, number>;
}

/** Pure: the value of an order from its stored lines. A synced order shows the estimate the Force backend returned. */
export function saleValue(draft: Pick<DraftRecord, "status" | "estimatedTotal">, lines: readonly EditorLine[]): SalesValue {
  if (draft.status === "synced" && draft.estimatedTotal !== null) return { amount: draft.estimatedTotal, partial: false };
  if (lines.length === 0) return { amount: null, partial: true };
  const totals = previewDraft(lines).totals;
  return { amount: totals.unpricedLineCount === lines.length ? null : totals.estimatedTotal, partial: totals.isPartial };
}

async function valueOf(db: SqlDatabase, draft: DraftRecord): Promise<SalesValue> {
  return saleValue(draft, linesFromDraftItems(await getDraftItems(db, draft.localId)));
}

function filterOf(ownerAccountId: string, filters: SalesFilters, text: string, now: Date): DraftFilter {
  const { from, before } = periodRange(filters, now);
  return {
    ownerAccountId,
    group: filters.group,
    ...(filters.statuses.length > 0 ? { statuses: filters.statuses } : {}),
    ...(filters.customer === null ? {} : { customerCode: filters.customer.code }),
    ...(from === undefined ? {} : { createdFrom: from }),
    ...(before === undefined ? {} : { createdBefore: before }),
    ...(text.trim() === "" ? {} : { text }),
  };
}

export async function listSales(
  db: SqlDatabase,
  ownerAccountId: string,
  filters: SalesFilters,
  request: { search: string; page: number; pageSize: number },
  now: Date,
): Promise<Page<SalesRow>> {
  const offset = (request.page - 1) * request.pageSize;
  const { rows, total } = await queryDrafts(db, filterOf(ownerAccountId, filters, request.search, now), { limit: request.pageSize, offset });
  const items: SalesRow[] = [];
  for (const draft of rows) items.push({ draft, value: await valueOf(db, draft) });
  return { items, page: request.page, pageSize: request.pageSize, total };
}

export async function summarizeSales(db: SqlDatabase, ownerAccountId: string, filters: SalesFilters, search: string, now: Date): Promise<SalesSummary> {
  const filter = filterOf(ownerAccountId, filters, search, now);
  const { group: _group, ...withoutGroup } = filter;
  const counts = await countDraftsByGroup(db, withoutGroup);
  const amounts: string[] = [];
  let partial = false;
  let lastUpdatedAt: string | null = null;
  let count = 0;
  // The filter's own rows are read in page-sized chunks so a long history never loads at once.
  for (let offset = 0; offset === 0 || offset < count; offset += 100) {
    const { rows, total } = await queryDrafts(db, filter, { limit: 100, offset });
    count = total;
    for (const draft of rows) {
      const value = await valueOf(db, draft);
      if (value.amount === null || value.partial) partial = true;
      if (value.amount !== null) amounts.push(value.amount);
      if (lastUpdatedAt === null || draft.updatedAt > lastUpdatedAt) lastUpdatedAt = draft.updatedAt;
    }
  }
  return { count, amount: amounts.length === 0 ? null : sumTotals(amounts), partial, lastUpdatedAt, counts };
}

/** `DD/MM/AAAA` (what the seller types) to `YYYY-MM-DD`; `null` when it is not a real calendar date. */
export function brDateToIso(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (match === null) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return parseLocalDate(iso) === null ? null : iso;
}

export function isoToBrDate(iso: string | null): string {
  const match = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match === null ? "" : `${match[3]}/${match[2]}/${match[1]}`;
}
