import type { OrderDetail, OrderEntryConfiguration } from "../data/ports";

/** Who decides discounts beyond the seller's limit: `force` = the Sales Force approval flow, `erp` = the release happens in Sankhya (D-L). */
export type DiscountAuthorityMode = OrderEntryConfiguration["sales"]["discountAuthorityMode"];

/** Shown in the order editor while the installation releases discounts in Sankhya (`discountAuthorityMode = "erp"`). */
export const ERP_DISCOUNT_NOTICE = "Descontos acima do permitido passam pela liberação no Sankhya depois do envio.";

/**
 * M-14 (DISC-6): the seller sees, read-only, where the order stands in the discount approval and what the approver
 * answered. The app never approves or rejects anything (approval is online and on the web only) and there is no push.
 * These are Sales Force states, never Sankhya states. When the installation releases discounts in Sankhya
 * (`discountAuthorityMode = "erp"`) no approval is requested in Sales Force, so nothing is shown (D-L).
 */
export interface ApprovalView {
  readonly title: string;
  readonly tone: "neutral" | "info" | "ok" | "warning" | "danger";
  readonly lines: readonly string[];
}

const LEVEL_LABEL = { manager: "Gerente", director: "Diretoria" } as const;

/** `null` when the order has nothing to show about approval (an ordinary draft or an order sent on). */
export function approvalViewOf(order: Pick<OrderDetail, "status" | "approval">, mode: DiscountAuthorityMode = "force"): ApprovalView | null {
  if (mode === "erp") return null;
  const { status, approval } = order;
  if (status === "awaiting_approval") {
    return {
      title: "Aguardando aprovação do desconto",
      tone: "warning",
      lines: [
        approval === null ? "Um aprovador precisa decidir sobre o desconto." : `Nível de aprovação: ${LEVEL_LABEL[approval.requestedLevel]}.`,
        "Você não é avisado: abra o pedido de novo para ver a decisão. Editar o pedido cancela a solicitação.",
      ],
    };
  }
  if (status === "approved") {
    return { title: "Desconto aprovado", tone: "ok", lines: decisionLines(approval) };
  }
  if (status === "approval_rejected") {
    return {
      title: "Desconto reprovado",
      tone: "danger",
      lines: [...decisionLines(approval), "Ajuste o pedido na versão web e envie novamente."],
    };
  }
  return null;
}

function decisionLines(approval: OrderDetail["approval"]): string[] {
  if (approval === null) return [];
  const lines: string[] = [];
  if (approval.decidedByName !== null) lines.push(`Decidido por ${approval.decidedByName}.`);
  if (approval.comment !== null && approval.comment !== "") lines.push(`Comentário: ${approval.comment}`);
  return lines;
}
