import { ERROR_HTTP_STATUS, type ErrorCode } from '@salesforce/contracts';
import type { z } from 'zod';

/** pt-BR user-facing message per code. Technical detail never goes here: it stays in the logs. */
export const DEFAULT_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  validation_failed: 'Os dados enviados são inválidos. Verifique os campos e tente novamente.',
  unauthenticated: 'Sessão ausente ou expirada. Entre novamente para continuar.',
  invalid_credentials: 'Usuário ou senha inválidos.',
  forbidden: 'Você não tem permissão para acessar este recurso.',
  not_found: 'Recurso não encontrado.',
  conflict: 'A operação conflita com o estado atual do recurso.',
  version_conflict: 'O registro foi alterado por outra pessoa. Recarregue e tente novamente.',
  idempotency_conflict: 'Este identificador de requisição já foi usado com outro conteúdo.',
  order_not_editable: 'Este pedido não pode mais ser editado.',
  installation_not_enabled: 'A instalação ainda não foi habilitada. Contate o administrador.',
  erp_submission_disabled: 'O envio de pedidos ao ERP ainda não está habilitado.',
  dataset_mismatch:
    'Este pedido foi iniciado com outro conjunto de dados e não pode ser salvo aqui. Atualize o aplicativo, confira o pedido e refaça-o.',
  no_seller_scope:
    'Sua conta ainda não está vinculada a um vendedor. Peça ao administrador para vincular um código de vendedor.',
  customer_without_seller:
    'Este cliente não tem vendedor definido e não pode receber pedidos. Peça ao administrador para ajustar o cadastro no ERP.',
  customer_ineligible:
    'Este cliente está inativo ou bloqueado e não pode receber pedidos. Confira o cadastro no ERP antes de continuar.',
  link_reconciliation_required:
    'Não foi possível concluir o acesso: o vínculo da sua conta com o vendedor precisa ser conferido. Peça ao administrador para reconciliar o vínculo.',
  rate_limited: 'Muitas tentativas. Aguarde um momento e tente novamente.',
  service_unavailable: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
  internal_error: 'Erro interno. Informe o código da requisição ao suporte.',
};

export interface AppErrorIssue {
  readonly path: string;
  readonly code: string;
  readonly message?: string;
}

/** Details allowed in an error body: the validation issues plus small, non-sensitive facts. */
export interface AppErrorDetails {
  readonly issues?: AppErrorIssue[];
  readonly [key: string]: unknown;
}

export interface AppErrorOptions {
  /** Overrides the default pt-BR message. Must be safe to show to the user. */
  readonly message?: string;
  readonly details?: AppErrorDetails;
  /** Internal cause, logged and never sent to the client. */
  readonly cause?: unknown;
  /** Served as the `Retry-After` header (and `details.retryAfterSeconds`); used by `rate_limited`. */
  readonly retryAfterSeconds?: number;
}

/**
 * The typed application error. Anything that reaches the HTTP boundary as an `AppError` is served
 * with the status of its code (`ERROR_HTTP_STATUS`) and the `ApiError` envelope.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: AppErrorDetails | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? DEFAULT_ERROR_MESSAGES[code], options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details =
      options.retryAfterSeconds === undefined
        ? options.details
        : { ...options.details, retryAfterSeconds: options.retryAfterSeconds };
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

/* ---------- Zod issues -> error details ---------- */

const ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  invalid_type: 'Tipo de valor inválido.',
  invalid_format: 'Formato inválido.',
  invalid_value: 'Valor não permitido.',
  too_small: 'Valor abaixo do mínimo permitido.',
  too_big: 'Valor acima do máximo permitido.',
  unrecognized_keys: 'Campo não reconhecido.',
  not_multiple_of: 'Valor inválido.',
  invalid_union: 'Valor inválido.',
  invalid_key: 'Chave inválida.',
  invalid_element: 'Elemento inválido.',
  custom: 'Valor inválido.',
};

export function formatIssuePath(path: readonly PropertyKey[]): string {
  let result = '';
  for (const segment of path) {
    if (typeof segment === 'number') result += `[${segment}]`;
    else result += result === '' ? String(segment) : `.${String(segment)}`;
  }
  return result === '' ? '(root)' : result;
}

/**
 * Zod issues as contract `issues`. The Zod message is deliberately not forwarded (it can echo the
 * submitted value); the message is a fixed pt-BR sentence chosen by the issue code.
 */
export function issuesFromZod(error: z.ZodError): AppErrorIssue[] {
  return error.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    code: issue.code,
    message: ISSUE_MESSAGES[issue.code] ?? 'Valor inválido.',
  }));
}

export function validationError(error: z.ZodError): AppError {
  return new AppError('validation_failed', {
    details: { issues: issuesFromZod(error) },
    cause: error,
  });
}
