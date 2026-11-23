import {
  CUSTOMER_BLOCK_MESSAGES,
  CUSTOMER_UNAVAILABLE_MESSAGE,
  LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE,
  DatasetChangedError,
  DatasetUnavailableError,
  DraftNotEditableError,
  PRODUCT_BLOCK_MESSAGES,
  TransportError,
} from "@salesforce/mobile-db";
import { ApiRequestError } from "./api";
import { PriceTableNotDownloadedError } from "./errors";
import { describeIssue } from "./order-draft";

/**
 * The one place that turns any failure into seller language (owner 2026-11-13: every error is a useful popup).
 * Short title, what happened, and ONE action that fixes it. The technical text goes to `details` only.
 */

/** What the popup's primary button does. The screen supplies the handler; without one the popup only offers "Fechar". */
export type ProblemAction = "retry" | "change_customer" | "go_sync" | "sign_in" | "reload" | "remove_item" | "edit_items" | "edit_header" | "none";

export const ACTION_LABELS: Record<Exclude<ProblemAction, "none">, string> = {
  retry: "Tentar de novo",
  change_customer: "Trocar cliente",
  go_sync: "Ir para sincronização",
  sign_in: "Entrar de novo",
  reload: "Recarregar",
  remove_item: "Remover item",
  edit_items: "Revisar itens",
  edit_header: "Revisar condições",
};

export interface ProblemText {
  readonly title: string;
  readonly message: string;
  readonly action: ProblemAction;
}

/** Known codes: server `ErrorCode`s, server `details.reason`s, local engine kinds and issue codes. */
export const ERROR_CATALOG = {
  // Connectivity and session
  offline: { title: "Sem conexão", message: "Não foi possível falar com o servidor. Verifique a internet.", action: "retry" },
  unauthenticated: { title: "Sessão expirada", message: "Entre de novo para continuar. Seus pedidos salvos continuam no aparelho.", action: "sign_in" },
  invalid_credentials: { title: "Usuário ou senha incorretos", message: "Confira os dados e tente de novo.", action: "retry" },
  access_not_configured: { title: "Acesso não liberado", message: "Seu usuário ainda não tem acesso. Fale com o backoffice.", action: "none" },
  forbidden: { title: "Sem permissão", message: "Seu perfil não pode fazer isso.", action: "none" },
  no_seller_scope: { title: "Sem carteira", message: "Seu usuário não tem vendedor vinculado. Fale com o backoffice.", action: "none" },
  rate_limited: { title: "Muitas tentativas", message: "Aguarde um pouco e tente de novo.", action: "retry" },
  service_unavailable: { title: "Servidor indisponível", message: "O serviço está fora do ar por instantes.", action: "retry" },
  sankhya_unavailable: { title: "Sankhya indisponível", message: "Não foi possível ler o Sankhya agora. Mantivemos os dados da última sincronização; tente de novo mais tarde.", action: "retry" },
  sync_failed: { title: "Não foi possível sincronizar", message: "A sincronização não terminou. Os dados anteriores e seus pedidos salvos continuam no aparelho.", action: "retry" },
  internal_error: { title: "Erro no servidor", message: "Algo falhou do nosso lado. Tente de novo.", action: "retry" },
  not_found: { title: "Não encontrado", message: "Este registro não existe mais. Sincronize para atualizar.", action: "go_sync" },
  device_revoked: { title: "Aparelho bloqueado", message: "Este aparelho foi desativado. Fale com o backoffice.", action: "none" },

  // Orders
  validation_failed: { title: "Dados inválidos", message: "Revise o pedido e tente de novo.", action: "edit_items" },
  version_conflict: { title: "Pedido alterado em outro lugar", message: "Recarregue para ver a versão atual. Suas alterações não salvas serão perdidas.", action: "reload" },
  order_not_editable: { title: "Pedido não editável", message: "Ele já não pode ser editado. Recarregue para ver a situação.", action: "reload" },
  not_editable: { title: "Pedido não editável", message: "Ele já não pode ser editado. Recarregue para ver a situação.", action: "reload" },
  idempotency_conflict: { title: "Pedido antigo", message: "Esta solicitação já foi registrada com outros dados. Refaça o pedido.", action: "none" },
  dataset_mismatch: { title: "Dados desatualizados", message: "O servidor mudou desde que você abriu o pedido. Sincronize e abra o pedido de novo.", action: "go_sync" },
  installation_not_enabled: { title: "Pedidos não habilitados", message: "A instalação ainda não aceita pedidos. Fale com o backoffice.", action: "none" },
  erp_submission_disabled: { title: "Envio ao Sankhya desligado", message: "O envio ao Sankhya está desligado por enquanto. O pedido ficou salvo e nada foi enviado.", action: "none" },
  order_queued: { title: "Pedido não enviado ao Sankhya", message: "O pedido ficou salvo neste aparelho e será enviado assim que possível.", action: "none" },
  discount_blocked: { title: "Desconto bloqueado", message: "O desconto passa do limite permitido. Reduza o desconto e confirme de novo.", action: "edit_items" },
  awaiting_approval: { title: "Aguardando aprovação", message: "O desconto precisa da aprovação de um gestor. O pedido segue depois da aprovação.", action: "none" },
  needs_manager_approval: { title: "Precisa de aprovação", message: "O desconto deste pedido precisa da aprovação de um gestor antes do envio.", action: "none" },
  edit_before_resubmitting: { title: "Desconto reprovado", message: "O desconto foi reprovado. Edite o pedido antes de enviá-lo de novo.", action: "none" },
  approval_required_before_resend: { title: "Desconto exige aprovação", message: "O desconto deste pedido agora exige aprovação. Exclua o pedido e faça um novo.", action: "none" },
  header_not_eligible: { title: "Operação indisponível", message: "O tipo de operação ou a condição de negociação deste pedido não está mais disponível. Edite o pedido e confirme de novo.", action: "edit_header" },
  invalid_status: { title: "Pedido não pode ser enviado", message: "A situação deste pedido não permite o envio.", action: "reload" },
  legacy_dataset: { title: "Pedido de versão antiga", message: "Este pedido é de uma versão antiga dos dados e não pode ser enviado. Refaça o pedido.", action: "none" },
  dataset_not_erp: { title: "Pedido de teste", message: "Este pedido foi criado com dados de teste e não pode ser enviado ao Sankhya. Refaça o pedido com cliente e produtos reais.", action: "none" },
  environment_unbound: { title: "Pedido sem ambiente", message: "Este pedido não está ligado a um ambiente do Sankhya. Refaça o pedido.", action: "none" },
  environment_mismatch: { title: "Outro ambiente", message: "Este pedido foi criado para outro ambiente do Sankhya e não pode ser enviado aqui. Refaça o pedido.", action: "none" },
  delivery_diverged: { title: "Nota com valores diferentes", message: "A nota deste pedido já existe no Sankhya com valores diferentes. Peça à TI para conferir; o aplicativo não reenvia.", action: "none" },
  ambiguous_origin: { title: "Mais de uma nota", message: "Há mais de uma nota com este pedido no Sankhya. Peça à TI para conferir.", action: "none" },
  send_refused: { title: "Envio recusado", message: "O servidor recusou o envio deste pedido. Revise os dados e envie de novo.", action: "none" },
  approval_not_pending: { title: "Aprovação já resolvida", message: "Este pedido não espera mais aprovação. Recarregue.", action: "reload" },
  conflict: { title: "Conflito", message: "O registro mudou. Sincronize e tente de novo.", action: "go_sync" },

  // Customer (server `customer_ineligible.reason` and the local guard)
  customer_ineligible: { title: "Cliente indisponível", message: "Este cliente não pode receber pedidos agora.", action: "change_customer" },
  customer_unavailable: { title: "Cliente indisponível", message: "Este cliente não está na sua carteira ou não está disponível.", action: "change_customer" },
  customer_inactive: { title: "Cliente inativo", message: "Este cliente está inativo no ERP.", action: "change_customer" },
  customer_blocked: { title: "Cliente bloqueado", message: "Este cliente está bloqueado no ERP.", action: "change_customer" },
  customer_without_seller: { title: "Cliente sem vendedor", message: "Este cliente não tem vendedor vinculado. Peça ao backoffice para vincular.", action: "change_customer" },
  customer_pending: { title: "Cliente em análise", message: "O cadastro deste cliente ainda não foi aprovado.", action: "change_customer" },
  document_already_registered: { title: "Documento já cadastrado", message: "Já existe um cliente com este CPF/CNPJ.", action: "none" },
  customer_rejected: { title: "Cadastro recusado", message: "O cadastro deste cliente foi recusado. Fale com o backoffice.", action: "none" },
  registration_refused: { title: "Cadastro recusado", message: "O servidor recusou o cadastro deste cliente.", action: "none" },

  // Products (issue codes and local guards)
  product_without_price: { title: "Produto sem preço", message: "Este produto está sem preço. Sincronize para atualizar os preços.", action: "go_sync" },
  product_without_mobility: { title: "Produto sem mobilidade", message: "Este produto não pode ser vendido pelo aplicativo.", action: "remove_item" },
  product_unavailable: { title: "Produto indisponível", message: "Tire o item do pedido ou sincronize para atualizar o catálogo.", action: "go_sync" },
  product_inactive: { title: "Produto inativo", message: "Tire o item do pedido.", action: "remove_item" },
  product_unknown: { title: "Produto não encontrado", message: "Sincronize para atualizar o catálogo.", action: "go_sync" },
  product_not_sellable: { title: "Produto indisponível", message: "Este produto não pode ser vendido. Tire o item do pedido.", action: "remove_item" },
  price_table_missing: { title: "Preços não baixados", message: "Os preços desta tabela ainda não estão no aparelho.", action: "go_sync" },
  dataset_unavailable: { title: "Dados não confirmados", message: "Conecte-se e sincronize para criar pedidos.", action: "go_sync" },
  dataset_changed: { title: "Dados mudaram", message: "Sincronize e abra o pedido de novo.", action: "go_sync" },

  // Order stage following Sankhya (server `erpStage.readError.errorClass`, `erp_stage_<class>`; the last known stage stays on screen)
  erp_stage_unavailable: { title: "Sankhya indisponível", message: "Não foi possível consultar a situação do pedido no Sankhya agora. Mostramos a última situação conhecida.", action: "retry" },
  erp_stage_temporary: { title: "Consulta ao Sankhya falhou", message: "A consulta da situação do pedido falhou por instabilidade. Mostramos a última situação conhecida.", action: "retry" },
  erp_stage_rate_limit: { title: "Muitas consultas", message: "O Sankhya pediu um intervalo. Aguarde um pouco e tente de novo. Mostramos a última situação conhecida.", action: "retry" },
  erp_stage_auth: { title: "Acesso ao Sankhya recusado", message: "O servidor não conseguiu acesso ao Sankhya para consultar o pedido. Avise o suporte.", action: "none" },
  erp_stage_validation: { title: "Consulta recusada", message: "O Sankhya recusou a consulta da situação do pedido. Avise o suporte.", action: "none" },
  erp_stage_permanent: { title: "Situação indisponível", message: "Não foi possível consultar a situação do pedido no Sankhya. Avise o suporte.", action: "none" },
  erp_stage_configuration_unavailable: { title: "Configuração incompleta", message: "A instalação ainda não tem a configuração para acompanhar o pedido no Sankhya. Avise o suporte.", action: "none" },
  erp_stage_read_failed: { title: "Situação não atualizada", message: "Não foi possível atualizar a situação do pedido no Sankhya. Mostramos a última situação conhecida.", action: "retry" },

  // Misc
  pdf_failed: { title: "PDF não gerado", message: "Tente de novo. Não precisa de internet.", action: "retry" },
  unexpected: { title: "Algo deu errado", message: "Tente de novo. Se continuar, avise o suporte.", action: "retry" },
} satisfies Record<string, ProblemText>;

const GENERIC: ProblemText = ERROR_CATALOG.unexpected;

export interface Problem extends ProblemText {
  /** Key into `ERROR_CATALOG` (or `unexpected`). */
  readonly code: string;
  /** Technical text for "Ver detalhes": code, HTTP status, server message, protocol. Never shown by default. */
  readonly details: string;
}

function detailLines(parts: readonly (readonly [string, string | number | undefined | null])[]): string {
  return parts
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `${label}: ${String(value)}`)
    .join("\n");
}

function known(code: string | undefined): ProblemText | null {
  return code !== undefined && Object.hasOwn(ERROR_CATALOG, code) ? (ERROR_CATALOG as Record<string, ProblemText>)[code] ?? null : null;
}

function make(code: string, text: ProblemText, details: string, override?: Partial<Pick<ProblemText, "title" | "message">>): Problem {
  return { code, ...text, ...override, details };
}

/** Maps a sync-engine kind (`TransportError.kind`) to a catalog key. */
function transportKey(error: TransportError): string {
  switch (error.kind) {
    case "network":
      return "offline";
    case "auth":
      return "unauthenticated";
    case "rate_limit":
      return "rate_limited";
    case "server":
      return "service_unavailable";
    case "customer_ineligible":
      return known(error.reason) !== null ? error.reason! : "customer_ineligible";
    case "registration_refused":
      return known(error.reason) !== null ? error.reason! : "registration_refused";
    case "validation":
      return "validation_failed";
    case "send_refused":
      return known(error.reason) !== null ? error.reason! : "send_refused";
    default:
      return error.kind;
  }
}

/**
 * Any thrown value to a `Problem`. Unknown input never reaches the seller as raw text: it gets the generic popup and the
 * technical message goes to `details`.
 */
export function describeProblem(error: unknown): Problem {
  if (error instanceof ApiRequestError) {
    const details = detailLines([
      ["Código", error.code ?? "sem código"],
      ["Status", error.status === 0 ? "sem resposta" : error.status],
      ["Motivo", error.reason],
      ["Mensagem", error.message],
      ...error.issues.map((issue) => ["Item", `${issue.path} ${issue.code}`] as const),
      ["Protocolo", error.correlationId],
    ]);
    if (error.isNetwork) return make("offline", ERROR_CATALOG.offline, details);
    if (error.code === "customer_ineligible" && known(error.reason) !== null) return make(error.reason!, (ERROR_CATALOG as Record<string, ProblemText>)[error.reason!]!, details);
    if (error.code === "conflict" && known(error.reason) !== null) return make(error.reason!, (ERROR_CATALOG as Record<string, ProblemText>)[error.reason!]!, details);
    if (error.issues.length > 0) {
      return make("validation_failed", { ...ERROR_CATALOG.validation_failed, title: "Corrija os itens", message: error.issues.map(describeIssue).join("\n") }, details);
    }
    const byCode = known(error.code);
    if (byCode !== null) return make(error.code!, byCode, details);
    if (error.status === 401) return make("unauthenticated", ERROR_CATALOG.unauthenticated, details);
    if (error.status === 403) return make("forbidden", ERROR_CATALOG.forbidden, details);
    if (error.status === 404) return make("not_found", ERROR_CATALOG.not_found, details);
    if (error.status === 429) {
      const wait = error.retryAfterSeconds === undefined ? "" : ` Espere ${error.retryAfterSeconds} s.`;
      return make("rate_limited", ERROR_CATALOG.rate_limited, details, { message: `${ERROR_CATALOG.rate_limited.message}${wait}` });
    }
    if (error.status === 503) return make("service_unavailable", ERROR_CATALOG.service_unavailable, details);
    if (error.status >= 500) return make("internal_error", ERROR_CATALOG.internal_error, details);
    return make("unexpected", GENERIC, details);
  }
  if (error instanceof TransportError) {
    const key = transportKey(error);
    const details = detailLines([["Código", error.kind], ["Motivo", error.reason], ["Status", error.status === 0 ? undefined : error.status], ["Mensagem", error.message]]);
    return make(key, known(key) ?? GENERIC, details);
  }
  if (error instanceof PriceTableNotDownloadedError) return make("price_table_missing", ERROR_CATALOG.price_table_missing, detailLines([["Código", "price_table_missing"]]));
  if (error instanceof DatasetUnavailableError) return make("dataset_unavailable", ERROR_CATALOG.dataset_unavailable, detailLines([["Código", "dataset_unavailable"], ["Mensagem", error.message]]));
  if (error instanceof DatasetChangedError) return make("dataset_changed", ERROR_CATALOG.dataset_changed, detailLines([["Código", "dataset_changed"], ["Mensagem", error.message]]));
  if (error instanceof DraftNotEditableError) return make("order_not_editable", ERROR_CATALOG.order_not_editable, detailLines([["Código", "draft_not_editable"], ["Mensagem", error.message]]));
  if (error instanceof Error) return make("unexpected", GENERIC, detailLines([["Código", error.name], ["Mensagem", error.message]]));
  return make("unexpected", GENERIC, detailLines([["Código", "desconhecido"]]));
}

/**
 * The catalog key behind the text stored as a held draft's `lastError` (local guard or server refusal), or `null` when the
 * text is not a known marker. Customer and product causes both resolve here.
 */
export function codeOfHeldMessage(lastError: string | null): string | null {
  if (lastError === null) return null;
  if (lastError === CUSTOMER_UNAVAILABLE_MESSAGE || lastError === LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE) return "customer_unavailable";
  const customer = (Object.keys(CUSTOMER_BLOCK_MESSAGES) as (keyof typeof CUSTOMER_BLOCK_MESSAGES)[]).find((key) => CUSTOMER_BLOCK_MESSAGES[key] === lastError);
  if (customer !== undefined) return customer;
  const product = (Object.keys(PRODUCT_BLOCK_MESSAGES) as (keyof typeof PRODUCT_BLOCK_MESSAGES)[]).find((key) => PRODUCT_BLOCK_MESSAGES[key] === lastError);
  return product ?? null;
}

/** A problem known only by its catalog key (a stored `lastError` marker, a local guard); unknown keys get the generic one. */
export function problemForCode(code: string, detail?: string): Problem {
  const text = known(code);
  return make(text === null ? "unexpected" : code, text ?? GENERIC, detailLines([["Código", code], ["Mensagem", detail]]));
}
