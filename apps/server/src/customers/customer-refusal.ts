import { AppError } from '../http/app-error.js';

/**
 * 422 `customer_refused` (CUST-RT): `details.fields` maps a request field (or `_` for none) to the pt-BR text to show; `issues` is kept
 * for clients that read the validation issues. Nothing is stored for a refusal found before the ERP call.
 */
export function customerRefused(
  fields: Record<string, string>,
  issues: readonly { path: string; code: string; message?: string }[] = [],
  extra: Record<string, unknown> = {},
  message?: string,
): AppError {
  return new AppError('customer_refused', {
    ...(message === undefined ? {} : { message }),
    details: { ...extra, fields, issues: [...issues] },
  });
}
