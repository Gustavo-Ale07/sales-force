import { releaseLineState, releaseStateOf, type ErpReleaseState } from '@salesforce/domain';

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

/** The release reading as stored: when it was read and one entry per release line. The releasing user is never stored. */
export interface StoredReleaseDetail {
  readonly checkedAt: string;
  readonly lines: readonly StoredReleaseLine[];
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
export function encodeReleaseDetail(lines: readonly ReleaseLineFacts[], checkedAt: Date): string | null {
  if (lines.length === 0) return null;
  const ordered = [...lines].sort((a, b) => a.event - b.event);
  return JSON.stringify({
    v: 1,
    at: checkedAt.toISOString(),
    l: ordered.map((line) => ({ c: line.event, s: LINE_CODE[releaseLineState(line)], ...(line.description === null ? {} : { t: line.description }) })),
  });
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
  const record = parsed as { v?: unknown; at?: unknown; l?: unknown };
  if (record.v !== 1 || typeof record.at !== 'string' || !Array.isArray(record.l)) return null;
  const lines: StoredReleaseLine[] = [];
  for (const raw of record.l as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as { c?: unknown; s?: unknown; t?: unknown };
    const state = typeof entry.s === 'string' ? LINE_STATE[entry.s] : undefined;
    if (typeof entry.c !== 'number' || !Number.isInteger(entry.c) || entry.c < 0 || state === undefined) continue;
    lines.push({ code: entry.c, description: typeof entry.t === 'string' ? entry.t : null, state });
  }
  return lines.length === 0 ? null : { checkedAt: record.at, lines };
}

/** The overall release state of a stored detail (denied wins, then awaiting, then released). */
export function storedReleaseState(detail: StoredReleaseDetail): ErpReleaseState {
  return releaseStateOf(detail.lines.map((line) => ({ event: line.code, released: line.state === 'released', denied: line.state === 'denied' }))) ?? 'awaiting';
}
