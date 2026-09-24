import { ApiRequestError } from "./api";

export type DataErrorKind = "offline" | "unauthenticated" | "forbidden" | "rate_limited" | "unavailable" | "unexpected";

export interface DataErrorInfo {
  readonly kind: DataErrorKind;
  /** pt-BR, user-facing, actionable. Technical detail stays out of the UI. */
  readonly message: string;
  readonly correlationId?: string;
}

/**
 * User-facing description of a failed read. The mobile app is online-only for now, so "no connection" says so
 * explicitly instead of promising offline data that does not exist yet (MOB-2, spike S7 pending).
 */
export function describeDataError(error: unknown): DataErrorInfo {
  if (!(error instanceof ApiRequestError)) {
    return { kind: "unexpected", message: "Ocorreu um erro inesperado. Tente novamente." };
  }
  const correlationId = error.correlationId;
  if (error.isNetwork) {
    return {
      kind: "offline",
      message: "Sem conexão com o servidor. Nesta versão os dados só estão disponíveis online.",
      correlationId,
    };
  }
  switch (error.status) {
    case 401:
      return { kind: "unauthenticated", message: "Sua sessão expirou. Entre novamente para continuar.", correlationId };
    case 403:
      return { kind: "forbidden", message: "Seu perfil não tem acesso a estes dados.", correlationId };
    case 429:
      return {
        kind: "rate_limited",
        message: "Muitas requisições. Aguarde alguns instantes e tente novamente.",
        correlationId,
      };
    case 503:
      return {
        kind: "unavailable",
        message: "O serviço está temporariamente indisponível. Tente novamente em instantes.",
        correlationId,
      };
    default:
      return { kind: "unexpected", message: "Ocorreu um erro inesperado. Tente novamente.", correlationId };
  }
}
