/** D6b storage form of the ERP release event codes (`sales_order.erp_status_detail`): distinct, ascending, comma-separated. */
export function encodeReleaseEventCodes(codes: readonly number[]): string | null {
  const distinct = [...new Set(codes.filter((code) => Number.isInteger(code) && code >= 0))].sort((a, b) => a - b);
  return distinct.length === 0 ? null : distinct.join(',');
}

/** Inverse of `encodeReleaseEventCodes`; unreadable parts are dropped. */
export function decodeReleaseEventCodes(detail: string | null | undefined): number[] {
  if (detail === null || detail === undefined || detail === '') return [];
  return detail
    .split(',')
    .map(Number)
    .filter((code) => Number.isInteger(code) && code >= 0);
}
