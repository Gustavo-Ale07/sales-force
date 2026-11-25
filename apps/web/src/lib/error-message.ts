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
  approval_required_before_resend: "O desconto deste pedido agora exige aprovação. Exclua o pedido e faça um novo.",
  edit_before_resubmitting: "O desconto foi reprovado. Edite o pedido antes de enviá-lo de novo.",
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
    return { title: "Sem conexão", description: "Não foi possível falar com o servidor. Verifique a internet.", correlationId };
  }
  if (status === 401) {
    return { title: "Sessão expirada", description: "Entre de novo para continuar.", correlationId };
  }
  if (status === 403) {
    return { title: "Sem permissão", description: "Seu perfil não pode fazer isso.", correlationId };
  }
  if (status === 404) {
    return { title: "Não encontrado", description: "Este registro não existe mais.", correlationId };
  }
  if (status === 429) {
    return { title: "Muitas tentativas", description: "Aguarde um pouco e tente de novo.", correlationId };
  }
  if (status === 503) {
    return { title: "Servidor indisponível", description: "O serviço está fora do ar por instantes.", correlationId };
  }
  if (isHttpError(error) && error.code === "no_seller_scope") {
    return { title: "Sem carteira", description: "Seu usuário não tem vendedor vinculado. Fale com o backoffice.", correlationId };
  }
  if (isHttpError(error) && error.code === "sankhya_unavailable") {
    return {
      title: "Sankhya indisponível",
      description: "Não foi possível ler o Sankhya agora. Mantivemos os dados da última sincronização; tente de novo mais tarde.",
      correlationId,
    };
  }
  if (status !== undefined && status >= 500) {
    return { title: fallbackTitle, description: "Algo falhou do nosso lado. Tente de novo.", correlationId };
  }
  if (status !== undefined && status >= 400 && status < 500 && isHttpError(error) && error.message) {
    return { title: fallbackTitle, description: error.message, correlationId };
  }
  return {
    title: fallbackTitle,
    description: "Tente de novo. Se continuar, avise o suporte.",
    correlationId,
  };
}
