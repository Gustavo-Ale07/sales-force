import { z } from 'zod';
import { named } from './primitives.js';

/**
 * Stable machine-readable error codes. Messages are pt-BR and user-facing; technical detail stays
 * in server logs. Adding a code is additive; removing or renaming one is a breaking change.
 */
export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'invalid_credentials',
  'forbidden',
  'not_found',
  'conflict',
  'version_conflict',
  'idempotency_conflict',
  'order_not_editable',
  'installation_not_enabled',
  'erp_submission_disabled',
  'rate_limited',
  'service_unavailable',
  'internal_error',
] as const;

export const ErrorCodeSchema = named('ErrorCode', z.enum(ERROR_CODES));
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** HTTP status each error code is served with. */
export const ERROR_HTTP_STATUS = {
  validation_failed: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  version_conflict: 409,
  idempotency_conflict: 409,
  order_not_editable: 409,
  installation_not_enabled: 409,
  erp_submission_disabled: 409,
  rate_limited: 429,
  service_unavailable: 503,
  internal_error: 500,
} as const satisfies Record<ErrorCode, number>;

export const ErrorIssueSchema = named(
  'ErrorIssue',
  z.object({
    /** Location of the problem, e.g. `items[2].quantity`. */
    path: z.string(),
    /** Stable issue code (for order drafts: the domain draft issue codes). */
    code: z.string(),
    message: z.string().optional(),
  }),
);

export const ErrorDetailsSchema = named(
  'ErrorDetails',
  z.looseObject({ issues: z.array(ErrorIssueSchema).optional() }),
);

/** Error envelope returned by every failing endpoint: `{ code, message, details? }`. */
export const ApiErrorSchema = named(
  'ApiError',
  z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: ErrorDetailsSchema.optional(),
  }),
);
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** `POST /orders/{id}/submit` always fails with this until ERP submission gates close (SNK-4/5). */
export const ErpSubmissionDisabledErrorSchema = named(
  'ErpSubmissionDisabledError',
  z.object({
    code: z.literal('erp_submission_disabled'),
    message: z.string(),
    details: ErrorDetailsSchema.optional(),
  }),
);
export type ErpSubmissionDisabledError = z.infer<typeof ErpSubmissionDisabledErrorSchema>;

/** HTTP statuses the registry may declare as generic error responses (body: `ApiError`). */
export const ERROR_STATUS_DESCRIPTIONS = {
  400: 'Requisição inválida (validation_failed)',
  401: 'Não autenticado',
  403: 'Sem permissão para este recurso',
  404: 'Recurso não encontrado (ou fora do escopo do usuário)',
  409: 'Conflito de estado',
  429: 'Muitas tentativas',
  500: 'Erro interno',
  503: 'Serviço indisponível',
} as const;
export type ErrorStatus = keyof typeof ERROR_STATUS_DESCRIPTIONS;
