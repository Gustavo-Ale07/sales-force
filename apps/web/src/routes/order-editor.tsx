import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  DialogClose,
  DialogContent,
  FieldError,
  FieldHint,
  FormField,
  Input,
  Money,
  PageHeader,
  Select,
  SkeletonLines,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { Save, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CustomerPicker, type PickedCustomer } from "../components/customer-picker";
import { DiscardOrderDialog } from "../components/discard-order-dialog";
import { NO_PRICE_TEXT, PriceCell } from "../components/price-cell";
import { ProductPicker } from "../components/product-picker";
import { QueryError } from "../components/query-error";
import { ApiRequestError } from "../lib/api";
import { ERP_SUBMISSION_DISABLED, createOrder, replaceOrder, submitOrder } from "../lib/api-mutations";
import { configurationQueryOptions, customerQueryOptions, orderQueryOptions, queryKeys } from "../lib/api-queries";
import { useApi } from "../lib/app-context";
import { describeApiError } from "../lib/error-message";
import { orderReference, orderStatusLabels } from "../lib/labels";
import {
  describeIssue,
  isLinePriceOrderable,
  lineFromOrderItem,
  lineFromProduct,
  listPriceOfLine,
  previewDraft,
  quantityProblemMessages,
  toRequestItems,
  type EditorLine,
} from "../lib/order-draft";

type OrderDetail = ApiSchema<"OrderDetail">;

export const SUBMIT_DISABLED_MESSAGE =
  "O envio de pedidos ao ERP ainda não está habilitado nesta instalação. O rascunho continua salvo e nada foi enviado.";

function newUuid(): string {
  return globalThis.crypto.randomUUID();
}

interface FailureView {
  title: string;
  messages: string[];
  correlationId?: string;
  reloadable: boolean;
}

/** Turns a failed save into user-facing text. Server `issues` are listed per item; the server stays authoritative. */
function describeSaveFailure(error: unknown): FailureView {
  if (error instanceof ApiRequestError) {
    if (error.code === "version_conflict") {
      return {
        title: "O rascunho foi alterado em outro lugar",
        messages: ["Recarregue para ver a versão atual. Suas alterações não salvas serão descartadas."],
        correlationId: error.correlationId,
        reloadable: true,
      };
    }
    if (error.code === "order_not_editable") {
      return {
        title: "Este pedido não pode mais ser editado",
        messages: ["Ele já não é um rascunho. Recarregue para ver a situação atual."],
        correlationId: error.correlationId,
        reloadable: true,
      };
    }
    if (error.code === "idempotency_conflict") {
      return {
        title: "Não foi possível salvar",
        messages: ["Esta solicitação já foi registrada com outros dados. Tente salvar novamente."],
        correlationId: error.correlationId,
        reloadable: false,
      };
    }
    if (error.issues.length > 0) {
      return {
        title: "Corrija os itens antes de salvar",
        messages: error.issues.map(describeIssue),
        correlationId: error.correlationId,
        reloadable: false,
      };
    }
  }
  const { title, description, correlationId } = describeApiError(error, "Não foi possível salvar o rascunho");
  return { title, messages: [description], correlationId, reloadable: false };
}

function FailureAlert({ failure, onReload }: { failure: FailureView; onReload?: () => void }) {
  return (
    <Alert
      tone="danger"
      title={failure.title}
      action={
        failure.reloadable && onReload ? (
          <Button size="sm" onClick={onReload}>
            Recarregar
          </Button>
        ) : undefined
      }
    >
      {failure.messages.length === 1 ? (
        <span>{failure.messages[0]}</span>
      ) : (
        <ul className="m-0 list-disc pl-4">
          {failure.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {failure.correlationId ? (
        <span className="mt-1 block text-xs">
          Código de correlação: <span className="font-mono">{failure.correlationId}</span>
        </span>
      ) : null}
    </Alert>
  );
}

interface EditorProps {
  order: OrderDetail | null;
  initialCustomer: PickedCustomer | null;
  onCreated: (id: string) => void;
  onClose: () => void;
}

function OrderEditor({ order, initialCustomer, onCreated, onClose }: EditorProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const config = useQuery(configurationQueryOptions(api));

  const readOnly = order !== null && order.status !== "draft";
  const lineCounter = useRef(0);
  const nextKey = () => `line-${(lineCounter.current += 1)}`;

  const [customer, setCustomer] = useState<PickedCustomer | null>(
    order ? { code: order.customerCode, name: order.customerName } : initialCustomer,
  );
  /** `undefined` = the installation default (loaded asynchronously); `null` = explicitly none. */
  const [negotiationChoice, setNegotiationChoice] = useState<number | null | undefined>(order ? order.negotiationTypeCode : undefined);
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<EditorLine[]>(() => (order ? order.items.map((item, index) => lineFromOrderItem(item, `saved-${index}`)) : []));
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const negotiationTypeCode =
    negotiationChoice !== undefined ? negotiationChoice : (config.data?.configuration.sales.defaultNegotiationTypeCode ?? null);

  const snapshot = (state: { customerCode: number | null; negotiation: number | null | undefined; notes: string; lines: readonly EditorLine[] }) =>
    JSON.stringify([state.customerCode, state.negotiation, state.notes, state.lines.map((l) => [l.productCode, l.quantityText])]);
  const [baseline] = useState(() =>
    snapshot({
      customerCode: order ? order.customerCode : (initialCustomer?.code ?? null),
      negotiation: order ? order.negotiationTypeCode : undefined,
      notes: order?.notes ?? "",
      lines: order ? order.items.map((item) => lineFromOrderItem(item, "baseline")) : [],
    }),
  );
  const dirty = !readOnly && snapshot({ customerCode: customer?.code ?? null, negotiation: negotiationChoice, notes, lines }) !== baseline;

  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });
  const leavingRef = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current && !leavingRef.current,
    enableBeforeUnload: () => dirtyRef.current && !leavingRef.current,
    withResolver: true,
  });

  const preview = useMemo(() => previewDraft(lines), [lines]);
  const installationEnabled = config.data?.configuration.general.enabled ?? true;
  const blockedLine = (line: EditorLine) => config.data !== undefined && !isLinePriceOrderable(line.price.state, config.data.configuration);
  const hasBlockedLines = lines.some(blockedLine);

  // One idempotency key per distinct payload: a retry after a lost response resends the same key, an edited payload gets a new one.
  const requestIdRef = useRef<{ payload: string; id: string } | null>(null);

  const body = {
    customerCode: customer?.code ?? 0,
    negotiationTypeCode,
    notes: notes.trim() === "" ? null : notes.trim(),
    items: toRequestItems(lines),
  };

  const save = useMutation({
    mutationFn: async () => {
      if (order) return replaceOrder(api, order.id, { expectedVersion: order.version, ...body });
      const payload = JSON.stringify(body);
      if (requestIdRef.current?.payload !== payload) requestIdRef.current = { payload, id: newUuid() };
      return createOrder(api, { clientRequestId: requestIdRef.current.id, ...body });
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.order(saved.id), saved);
      await queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      toast({ title: "Rascunho salvo", description: orderReference(saved), tone: "success" });
      if (!order) {
        leavingRef.current = true;
        onCreated(saved.id);
      }
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("O rascunho precisa estar salvo antes do envio.");
      return submitOrder(api, order.id);
    },
    onSuccess: () => {
      // Never expected while submission is disabled; refresh instead of claiming a result.
      void queryClient.invalidateQueries({ queryKey: queryKeys.ordersAll });
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === ERP_SUBMISSION_DISABLED) setSubmitMessage(SUBMIT_DISABLED_MESSAGE);
      else setSubmitMessage(null);
    },
  });

  const reload = () => {
    if (order) void queryClient.invalidateQueries({ queryKey: queryKeys.order(order.id) });
  };

  const canSave = !readOnly && customer !== null && preview.valid && installationEnabled && !hasBlockedLines && (order === null || dirty);
  const onSubmitForm = (event: FormEvent) => {
    event.preventDefault();
    if (canSave && !save.isPending) save.mutate();
  };

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const negotiationTypes = config.data?.configuration.sales.negotiationTypes ?? [];
  const submitFailure =
    submit.isError && !(submit.error instanceof ApiRequestError && submit.error.code === ERP_SUBMISSION_DISABLED)
      ? describeApiError(submit.error, "Não foi possível enviar o pedido")
      : null;
  const status = order ? orderStatusLabels[order.status] : null;

  return (
    <>
      <PageHeader
        title={order ? orderReference(order) : "Novo pedido"}
        description={order ? `Cliente: ${order.customerName}` : "Escolha o cliente, adicione produtos e salve como rascunho."}
        badges={status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : <Badge tone="neutral">Novo</Badge>}
      />

      {!installationEnabled ? (
        <Alert tone="warning" title="Pedidos ainda não habilitados">
          A instalação ainda não está habilitada para pedidos. Você pode consultar, mas não salvar rascunhos.
        </Alert>
      ) : null}
      {readOnly ? (
        <Alert tone="info" title="Somente leitura">
          Este pedido está como “{status?.label}” e não pode mais ser editado.
        </Alert>
      ) : null}
      {save.isError ? <FailureAlert failure={describeSaveFailure(save.error)} onReload={order ? reload : undefined} /> : null}
      {submitMessage ? (
        <Alert tone="warning" title="Envio ao ERP indisponível" onDismiss={() => setSubmitMessage(null)}>
          {submitMessage}
        </Alert>
      ) : null}
      {submitFailure ? (
        <Alert tone="danger" title={submitFailure.title}>
          {submitFailure.description}
          {submitFailure.correlationId ? (
            <span className="mt-1 block text-xs">
              Código de correlação: <span className="font-mono">{submitFailure.correlationId}</span>
            </span>
          ) : null}
        </Alert>
      ) : null}

      <form onSubmit={onSubmitForm} noValidate aria-label="Pedido" className="flex flex-col gap-3">
        <Card>
          <CardHeader title="Dados do pedido" />
          <CardBody className="grid gap-3 md:grid-cols-2">
            <FormField label="Cliente" required>
              {(controlProps) => (
                <CustomerPicker {...controlProps} selected={customer} onSelect={(picked) => setCustomer(picked)} disabled={readOnly} />
              )}
            </FormField>
            <FormField
              label="Tipo de negociação"
              hint={config.isError ? "Tipos de negociação indisponíveis no momento." : undefined}
            >
              <Select
                size="md"
                disabled={readOnly || negotiationTypes.length === 0}
                value={negotiationTypeCode ?? ""}
                onChange={(event) => setNegotiationChoice(event.target.value === "" ? null : Number(event.target.value))}
              >
                <option value="">Não informado</option>
                {negotiationTypes.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Observações" className="md:col-span-2" hint="Até 2.000 caracteres.">
              <Textarea value={notes} maxLength={2000} readOnly={readOnly} onChange={(event) => setNotes(event.target.value)} />
            </FormField>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Itens" description="Preços de lista da tabela do cliente. O servidor confirma preços e totais ao salvar." />
          {!readOnly ? (
            <CardBody className="border-b border-line">
              <FormField
                label="Adicionar produto"
                hint={customer ? undefined : "Selecione o cliente para consultar os preços dos produtos."}
              >
                {(controlProps) => (
                  <ProductPicker
                    {...controlProps}
                    customerCode={customer?.code ?? 0}
                    disabled={customer === null}
                    onSelect={(product) => {
                      if (lines.some((line) => line.productCode === product.code)) {
                        toast({ title: "Produto já está no pedido", description: product.description, tone: "warning" });
                        return;
                      }
                      setLines((current) => [...current, lineFromProduct(product, nextKey())]);
                    }}
                  />
                )}
              </FormField>
            </CardBody>
          ) : null}
          {lines.length === 0 ? (
            <CardBody>
              <p className="m-0 text-xs text-fg-muted">Nenhum item. Busque um produto acima para começar.</p>
            </CardBody>
          ) : (
            <Table label="Itens do pedido">
              <TableCaption>Itens do pedido</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead numeric>#</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Un.</TableHead>
                  <TableHead>Quantidade</TableHead>
                  <TableHead numeric>Preço unitário</TableHead>
                  <TableHead numeric>Total estimado</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const linePreview = preview.lines[index];
                  const problem = linePreview?.quantityProblem;
                  const errorId = `qty-error-${line.key}`;
                  const blocked = blockedLine(line);
                  return (
                    <TableRow key={line.key}>
                      <TableCell numeric>{index + 1}</TableCell>
                      <TableCell wrap>
                        <span className="font-medium">{line.description}</span>
                        <span className="block text-fg-muted">Código {line.productCode}</span>
                        {blocked ? <FieldError>Este item não pode ser pedido sem preço nesta instalação.</FieldError> : null}
                      </TableCell>
                      <TableCell>{line.unit}</TableCell>
                      <TableCell>
                        <Input
                          size="sm"
                          inputMode="decimal"
                          autoComplete="off"
                          wrapperClassName="w-[110px]"
                          value={line.quantityText}
                          readOnly={readOnly}
                          aria-label={`Quantidade de ${line.description}`}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={problem ? errorId : undefined}
                          onChange={(event) => updateLine(line.key, { quantityText: event.target.value })}
                        />
                        {problem ? <FieldError id={errorId}>{quantityProblemMessages[problem]}</FieldError> : null}
                      </TableCell>
                      <TableCell numeric>
                        <PriceCell price={listPriceOfLine(line.price)} />
                      </TableCell>
                      <TableCell numeric>
                        <Money value={linePreview?.item?.estimatedLineTotal ?? null} fallback={line.price.state === "none" ? NO_PRICE_TEXT : "—"} />
                      </TableCell>
                      <TableCell>
                        {readOnly ? null : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Remover ${line.description}`}
                            onClick={() => setLines((current) => current.filter((other) => other.key !== line.key))}
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <CardBody className="border-t border-line">
            <dl className="m-0 flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1">
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-muted">{preview.totals.isPartial ? "Total parcial estimado" : "Total estimado"}</dt>
                <dd className="m-0 text-lg font-semibold" data-testid="order-total">
                  <Money value={preview.totals.estimatedTotal} />
                </dd>
              </div>
            </dl>
            {preview.totals.isPartial ? (
              <p className="m-0 mt-1 text-right text-xs text-fg-muted">
                {preview.totals.unpricedLineCount === 1
                  ? "1 item sem preço não entra na soma."
                  : `${preview.totals.unpricedLineCount} itens sem preço não entram na soma.`}
              </p>
            ) : null}
            <FieldHint className="mt-1 text-right">
              Estimativa pelos preços de lista. Desconto, condição de pagamento e análise de crédito ainda não estão disponíveis nesta versão.
            </FieldHint>
          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" leftIcon={<X size={14} aria-hidden="true" />} onClick={onClose}>
            {readOnly ? "Voltar" : "Cancelar"}
          </Button>
          {order && order.status === "draft" ? (
            <Button type="button" variant="danger-outline" leftIcon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setDiscarding(true)}>
              Descartar
            </Button>
          ) : null}
          {order && order.status === "draft" ? (
            <Button
              type="button"
              variant="secondary"
              leftIcon={<Send size={14} aria-hidden="true" />}
              loading={submit.isPending}
              disabled={dirty}
              title={dirty ? "Salve o rascunho antes de enviar" : undefined}
              onClick={() => {
                setSubmitMessage(null);
                submit.mutate();
              }}
            >
              Enviar ao ERP
            </Button>
          ) : null}
          {!readOnly ? (
            <Button type="submit" variant="primary" leftIcon={<Save size={14} aria-hidden="true" />} loading={save.isPending} disabled={!canSave}>
              Salvar rascunho
            </Button>
          ) : null}
        </div>
      </form>

      <DiscardOrderDialog
        order={discarding && order ? { id: order.id, label: orderReference(order) } : null}
        onClose={() => setDiscarding(false)}
        onDiscarded={() => {
          leavingRef.current = true;
          toast({ title: "Rascunho descartado", tone: "success" });
          onClose();
        }}
      />

      <Dialog open={blocker.status === "blocked"} onOpenChange={(open) => !open && blocker.reset?.()}>
        <DialogContent
          title="Sair sem salvar?"
          description="As alterações deste pedido ainda não foram salvas e serão perdidas."
          footer={
            <>
              <DialogClose asChild>
                <Button variant="secondary">Continuar editando</Button>
              </DialogClose>
              <Button variant="danger" onClick={() => blocker.proceed?.()}>
                Sair sem salvar
              </Button>
            </>
          }
        >
          <p className="m-0 text-sm text-fg-muted">Salve o rascunho para não perder o trabalho.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface OrderEditorPageProps {
  /** Existing order to open; omitted for a new order. */
  orderId?: string;
  /** Customer preselected for a new order (e.g. coming from the customer page). */
  initialCustomerCode?: number;
  onCreated: (id: string) => void;
  onClose: () => void;
}

function LoadingHeader({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div aria-busy="true">
        <SkeletonLines lines={6} label="Carregando pedido…" />
      </div>
    </>
  );
}

function ExistingOrder({ orderId, onCreated, onClose }: { orderId: string; onCreated: (id: string) => void; onClose: () => void }) {
  const api = useApi();
  const query = useQuery(orderQueryOptions(api, orderId));
  if (query.isPending) return <LoadingHeader title="Pedido" />;
  if (query.isError) {
    return (
      <>
        <PageHeader title="Pedido" />
        <Card>
          <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} title="Não foi possível carregar o pedido" />
        </Card>
      </>
    );
  }
  // Re-keyed on every server version so a saved or reloaded order always starts from the authoritative data.
  return <OrderEditor key={`${query.data.id}:${query.data.version}`} order={query.data} initialCustomer={null} onCreated={onCreated} onClose={onClose} />;
}

function NewOrder({ initialCustomerCode, onCreated, onClose }: Omit<OrderEditorPageProps, "orderId">) {
  const api = useApi();
  const customer = useQuery({ ...customerQueryOptions(api, initialCustomerCode ?? 0), enabled: initialCustomerCode !== undefined });
  if (initialCustomerCode !== undefined && customer.isPending) return <LoadingHeader title="Novo pedido" />;
  const initial = customer.data ? { code: customer.data.code, name: customer.data.name } : null;
  return <OrderEditor order={null} initialCustomer={initial} onCreated={onCreated} onClose={onClose} />;
}

export function OrderEditorPage({ orderId, initialCustomerCode, onCreated, onClose }: OrderEditorPageProps) {
  if (orderId) return <ExistingOrder orderId={orderId} onCreated={onCreated} onClose={onClose} />;
  return <NewOrder initialCustomerCode={initialCustomerCode} onCreated={onCreated} onClose={onClose} />;
}
