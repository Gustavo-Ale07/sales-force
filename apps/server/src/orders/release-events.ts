import { ERP_BILLING_STATES, releaseLineState, releaseStateOf, type ErpBillingState, type ErpReleaseState } from '@salesforce/domain';

/** D6b storage form of the ERP release event codes (`sales_order.erp_status_detail`): distinct, ascending, comma-separated. */
export function encodeReleaseEventCodes(codes: readonly number[]): string | null {
  const distinct = [...new Set(codes.filter((code) => Number.isInteger(code) && code >= 0))].sort((a, b) => a - b);
  return distinct.length === 0 ? null : distinct.join(',');
}

/** Inverse of `encodeReleaseEventCodes` (the legacy form); the versioned form decodes to its event codes; unreadable parts are dropped. */
export function decodeReleaseEventCodes(detail: string | null | undefined): number[] {
  if (detail === null || detail === undefined || detail === '') return [];
  const versioned = decodeReleaseDetail(detail);
  if (versioned !== null) return versioned.lines.map((line) => line.code);
  if (detail.startsWith('{')) return [];
  return detail
    .split(',')
    .map(Number)
    .filter((code) => Number.isInteger(code) && code >= 0);
}

/** One release line as stored: the event, its ERP description (a label only) and its state. */
export interface StoredReleaseLine {
  readonly code: number;
  readonly description: string | null;
  readonly state: ErpReleaseState;
}

/** One item as billed: invoiced = QTDENTREGUE, cut = QTDNEG − QTDENTREGUE when no longer pending (decimal strings). */
export interface StoredBillingItem {
  readonly sequence: number;
  readonly productCode: number;
  readonly invoiced: string;
  readonly cut: string;
}

/** Billing (faturamento) reading as stored in the versioned detail (v2). */
export interface StoredBilling {
  readonly state: ErpBillingState | null;
  /** `YYYY-MM-DD` of the earliest invoicing date. */
  readonly invoicedAt: string | null;
  readonly nfeAuthorized: boolean;
  readonly items: readonly StoredBillingItem[];
}

/** The release reading as stored: when it was read and one entry per release line. The releasing user is never stored. */
export interface StoredReleaseDetail {
  readonly checkedAt: string;
  readonly lines: readonly StoredReleaseLine[];
  /** Absent in the v1 form and before the first billing reading. */
  readonly billing?: StoredBilling;
}

const LINE_CODE: Readonly<Record<ErpReleaseState, string>> = { awaiting: 'a', released: 'l', denied: 'd' };
const LINE_STATE: Readonly<Record<string, ErpReleaseState>> = { a: 'awaiting', l: 'released', d: 'denied' };

export interface ReleaseLineFacts {
  readonly event: number;
  readonly description: string | null;
  readonly released: boolean;
  readonly denied: boolean;
}

/** The release state of a set of lines (domain rule); `null` without lines. */
export function releaseStateOfFacts(lines: readonly ReleaseLineFacts[]): ErpReleaseState | null {
  return releaseStateOf(lines);
}

/** Versioned JSON of the release lines for `erp_status_detail`; `null` when there are no lines (no release state). */
export function encodeReleaseDetail(lines: readonly ReleaseLineFacts[], checkedAt: Date, billing?: StoredBilling): string | null {
  if (lines.length === 0 && billing === undefined) return null;
  const ordered = [...lines].sort((a, b) => a.event - b.event);
  return JSON.stringify({
    v: billing === undefined ? 1 : 2,
    at: checkedAt.toISOString(),
    l: ordered.map((line) => ({ c: line.event, s: LINE_CODE[releaseLineState(line)], ...(line.description === null ? {} : { t: line.description }) })),
    ...(billing === undefined
      ? {}
      : {
          b: {
            s: billing.state,
            ...(billing.invoicedAt === null ? {} : { d: billing.invoicedAt }),
            ...(billing.nfeAuthorized ? { n: 1 } : {}),
            i: billing.items.map((item) => [item.sequence, item.productCode, item.invoiced, item.cut]),
          },
        }),
  });
}

function decodeBilling(raw: unknown): StoredBilling | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entry = raw as { s?: unknown; d?: unknown; n?: unknown; i?: unknown };
  const state = typeof entry.s === 'string' && (ERP_BILLING_STATES as readonly string[]).includes(entry.s) ? (entry.s as ErpBillingState) : null;
  const items: StoredBillingItem[] = [];
  if (Array.isArray(entry.i)) {
    for (const row of entry.i as unknown[]) {
      if (!Array.isArray(row) || row.length < 4) continue;
      const [sequence, productCode, invoiced, cut] = row as unknown[];
      if (typeof sequence !== 'number' || typeof productCode !== 'number' || typeof invoiced !== 'string' || typeof cut !== 'string') continue;
      items.push({ sequence, productCode, invoiced, cut });
    }
  }
  return { state, invoicedAt: typeof entry.d === 'string' ? entry.d : null, nfeAuthorized: entry.n === 1, items };
}

/** Inverse of `encodeReleaseDetail`; anything that is not the versioned form (legacy codes, garbage) is `null`. */
export function decodeReleaseDetail(detail: string | null | undefined): StoredReleaseDetail | null {
  if (detail === null || detail === undefined || !detail.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { v?: unknown; at?: unknown; l?: unknown; b?: unknown };
  if ((record.v !== 1 && record.v !== 2) || typeof record.at !== 'string' || !Array.isArray(record.l)) return null;
  const lines: StoredReleaseLine[] = [];
  for (const raw of record.l as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as { c?: unknown; s?: unknown; t?: unknown };
    const state = typeof entry.s === 'string' ? LINE_STATE[entry.s] : undefined;
    if (typeof entry.c !== 'number' || !Number.isInteger(entry.c) || entry.c < 0 || state === undefined) continue;
    lines.push({ code: entry.c, description: typeof entry.t === 'string' ? entry.t : null, state });
  }
  const billing = record.v === 2 ? decodeBilling(record.b) : undefined;
  if (lines.length === 0 && billing === undefined) return null;
  return billing === undefined ? { checkedAt: record.at, lines } : { checkedAt: record.at, lines, billing };
}

/** The ERP billing state of a stored detail; `null` before any billing reading or when no state applies. */
export function storedBillingState(detail: StoredReleaseDetail | null): ErpBillingState | null {
  return detail?.billing?.state ?? null;
}

/** The overall release state of a stored detail (denied wins, then awaiting, then released). */
export function storedReleaseState(detail: StoredReleaseDetail): ErpReleaseState {
  return releaseStateOf(detail.lines.map((line) => ({ event: line.code, released: line.state === 'released', denied: line.state === 'denied' }))) ?? 'awaiting';
}
