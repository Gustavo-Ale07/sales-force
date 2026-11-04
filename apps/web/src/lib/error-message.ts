import { describeDatasetError } from "./dataset-error";
import { errorStatus, isHttpError } from "./http-error";

export interface ErrorDescription {
  title: string;
  description: string;
  correlationId?: string;
}

/**
 * K4: a 409 of POST /orders/:id/submit carries `details.reason`; each reason has its own text. Never the server's
 * dataset or environment identity.
 */
const submitConflictTexts: Record<string, string> = {
  dataset_not_erp: "Este pedido foi criado com dados de teste e não pode ser enviado ao Sankhya. Refaça o pedido com um cliente e produtos reais.",
  environment_unbound: "Este pedido não está ligado a um ambiente do Sankhya. Refaça o pedido.",
  environment_mismatch: "Este pedido foi criado para outro ambiente do Sankhya e não pode ser enviado aqui. Refaça o pedido.",
  edit_before_resubmitting: "O desconto foi reprovado. Edite o pedido antes de enviá-lo novamente.",
  needs_manager_approval: "O desconto deste pedido precisa da aprovação de um gestor antes do envio.",
  invalid_status: "A situação deste pedido não permite o envio.",
  legacy_dataset: "Este pedido é de uma versão antiga dos dados e não pode ser enviado. Refaça o pedido.",
};

export function submitConflictText(error: unknown): string | null {
  const reason = isHttpError(error) && errorStatus(error) === 409 ? (error as { reason?: string }).reason : undefined;
  return reason !== undefined ? (submitConflictTexts[reason] ?? null) : null;
}

/**
 * User-facing pt-BR text for a failed API call. Server messages of the contract are user-safe, so they are shown
 * for client errors that need action (validation, conflicts); server failures get a fixed text.
 */
export function describeApiError(error: unknown, fallbackTitle = "Não foi possível concluir a operação"): ErrorDescription {
  const dataset = describeDatasetError(error);
  if (dataset) return dataset;
  const correlationId = isHttpError(error) ? error.correlationId : undefined;
  const status = errorStatus(error);
  if (status === 0) {
    return { title: "Sem conexão com o servidor", description: "Verifique sua conexão e tente novamente.", correlationId };
  }
  if (status === 401) {
    return { title: "Sessão expirada", description: "Entre novamente para continuar.", correlationId };
  }
  if (status === 403) {
    return { title: "Sem permissão", description: "Seu perfil não tem acesso a esta operação.", correlationId };
  }
  if (status === 404) {
    return { title: "Não encontrado", description: "O registro não existe ou está fora da sua carteira.", correlationId };
  }
  if (status === 429) {
    return { title: "Muitas requisições", description: "Aguarde alguns instantes e tente novamente.", correlationId };
  }
  if (status === 503) {
    return { title: "Serviço indisponível", description: "O serviço está temporariamente fora do ar. Tente novamente em instantes.", correlationId };
  }
  if (status !== undefined && status >= 400 && status < 500 && isHttpError(error) && error.message) {
    return { title: fallbackTitle, description: error.message, correlationId };
  }
  return {
    title: fallbackTitle,
    description: "Ocorreu um erro inesperado. Tente novamente; se persistir, informe o código de correlação ao suporte.",
    correlationId,
  };
}
