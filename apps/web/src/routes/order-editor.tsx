import type { ApiSchema } from "@salesforce/contracts/client";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
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
  formatQuantity,
  toast,
  titleCase,
} from "@salesforce/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { BookmarkPlus, Save, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { BulkEntryDialog, type BulkEntryItem } from "../components/bulk-entry-dialog";
import { CustomerContextBar } from "../components/customer-context-bar";
import { CustomerFichaDialog } from "../components/customer-ficha";
import { CustomerPicker, type PickedCustomer } from "../components/customer-picker";
import { DiscardOrderDialog } from "../components/discard-order-dialog";
import { NO_PRICE_TEXT, PriceCell } from "../components/price-cell";
import { INITIAL_PRODUCT_FILTERS, ProductBrowser, type ProductFilters } from "../components/product-browser";
import { QueryError } from "../components/query-error";
import { SaveTemplateDialog } from "../components/save-template-dialog";
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
  parseQuantityInput,
  previewDraft,
  quantityProblemMessages,
  summarizeCart,
  toRequestItems,
  type EditorLine,
} from "../lib/order-draft";

type OrderDetail = ApiSchema<"OrderDetail">;

export const SUBMIT_DISABLED_MESSAGE =
  "O envio de pedidos ao ERP ainda não está habilitado nesta instalação. O rascunho continua salvo e nada foi enviado.";

const PRODUCT_SEARCH_ID = "order-product-search";
const CART_VIEW_ID = "order-view-cart";

type ItemsView = "produtos" | "carrinho";

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

/** One half of the Produtos | Carrinho switch (pill style, `aria-pressed` so the state reaches assistive technology). */
function ViewPill({ id, active, onClick, children }: { id?: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      id={id}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="rounded-full px-3 py-[7px] text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent aria-pressed:text-on-accent aria-pressed:hover:text-on-accent"
    >
      {children}
    </button>
  );
}

interface EditorProps {
  order: OrderDetail | null;
  initialCustomer: PickedCustomer | null;
  onCreated: (id: string) => void;
  onClose: () => void;
  /** Page-level notice shown under the header (e.g. template lines left out of a draft created from a template). */
  notice?: ReactNode;
}

function OrderEditor({ order, initialCustomer, onCreated, onClose, notice }: EditorProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const config = useQuery(configurationQueryOptions(api));

  const readOnly = order !== null && order.status !== "draft";
  const lineCounter = useRef(0);
  const nextKey = () => `line-${(lineCounter.current += 1)}`;

  const [customer, setCustomer] = useState<PickedCustomer | null>(
    order ? { code: order.customerCode, name: order.customerName } : initialCustomer,
  );
  const [fichaOpen, setFichaOpen] = useState(false);
  /** `undefined` = the installation default (loaded asynchronously); `null` = explicitly none. */
  const [negotiationChoice, setNegotiationChoice] = useState<number | null | undefined>(order ? order.negotiationTypeCode : undefined);
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<EditorLine[]>(() =>
    order ? order.items.map((item, index) => lineFromOrderItem(item, `saved-${index}`)) : [],
  );
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  /** A different customer picked while items exist: waits for the seller's confirmation (prices depend on the customer). */
  // `picked: null` is the customer being cleared; the lines are priced for the current customer either way.
  const [pendingCustomer, setPendingCustomer] = useState<{ picked: PickedCustomer | null } | null>(null);
  /** Line keys ticked for a bulk action; keys of lines that no longer exist are ignored (see `selectedLines`). */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkEntryOpen, setBulkEntryOpen] = useState(false);
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [bulkProblem, setBulkProblem] = useState<string | null>(null);
  /** The last bulk removal, kept in memory so it can be undone; cleared by the next removal or when dismissed. */
  const [removed, setRemoved] = useState<{ line: EditorLine; index: number }[] | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const focusAfterRemoval = useRef(false);
  // The bar with the focused "Remover selecionados" unmounts on click: move focus to the undo button that replaces it.
  useEffect(() => {
    if (focusAfterRemoval.current && removed !== null) {
      focusAfterRemoval.current = false;
      undoButton.current?.focus();
    }
  }, [removed]);
  const quantityInputs = useRef(new Map<string, HTMLInputElement>());
  /** "Produtos" (catalog table) or "Carrinho" (the order lines); a saved order with items opens on the cart. */
  const [view, setView] = useState<ItemsView>(order && order.items.length > 0 ? "carrinho" : "produtos");
  const cartQuantities = useMemo(() => new Map(lines.map((line) => [line.productCode, line.quantityText])), [lines]);
  const [productFilters, setProductFilters] = useState<ProductFilters>(INITIAL_PRODUCT_FILTERS);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  // The product search lives in the "Produtos" view: switch to it first, then focus once it is on screen.
  const focusProductSearch = () => {
    setView("produtos");
    setSearchFocusRequest((count) => count + 1);
  };
  useEffect(() => {
    if (searchFocusRequest > 0) document.getElementById(PRODUCT_SEARCH_ID)?.focus();
  }, [searchFocusRequest]);

  const negotiationTypeCode =
    negotiationChoice !== undefined ? negotiationChoice : (config.data?.configuration.sales.defaultNegotiationTypeCode ?? null);

  const snapshot = (state: {
    customerCode: number | null;
    negotiation: number | null | undefined;
    notes: string;
    lines: readonly EditorLine[];
  }) => JSON.stringify([state.customerCode, state.negotiation, state.notes, state.lines.map((l) => [l.productCode, l.quantityText])]);
  const [baseline] = useState(() =>
    snapshot({
      customerCode: order ? order.customerCode : (initialCustomer?.code ?? null),
      negotiation: order ? order.negotiationTypeCode : undefined,
      notes: order?.notes ?? "",
      lines: order ? order.items.map((item) => lineFromOrderItem(item, "baseline")) : [],
    }),
  );
  const dirty =
    !readOnly &&
    snapshot({
      customerCode: customer?.code ?? null,
      negotiation: negotiationChoice,
      notes,
      lines,
    }) !== baseline;

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
  const cartSummary = useMemo(() => summarizeCart(lines, preview.lines), [lines, preview]);
  /** Bulk removals of more than one line (and "Limpar carrinho") ask first; a single line goes away at once and can be undone. */
  const [confirmRemoval, setConfirmRemoval] = useState<"selected" | "all" | null>(null);
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

  const canSaveTemplate = customer !== null && lines.length > 0 && preview.valid;
  const canSave = !readOnly && customer !== null && preview.valid && installationEnabled && !hasBlockedLines && (order === null || dirty);
  const onSubmitForm = (event: FormEvent) => {
    event.preventDefault();
    if (canSave && !save.isPending) save.mutate();
  };

  const requestCustomer = (picked: PickedCustomer | null) => {
    if (picked?.code === customer?.code) return;
    // The prices on the lines were looked up for the current customer: never keep them under another one.
    // Clearing the customer counts: picking another one afterwards must not keep those lines.
    if (lines.length > 0) setPendingCustomer({ picked });
    else setCustomer(picked);
  };
  const confirmCustomerChange = () => {
    if (pendingCustomer === null) return;
    setCustomer(pendingCustomer.picked);
    setLines([]);
    // Nothing removed or selected before the change may come back under the new customer's prices.
    setRemoved(null);
    setSelected(new Set());
    setPendingCustomer(null);
  };

  const addBulkEntry = (items: BulkEntryItem[]) => {
    setLines((current) => [
      ...current,
      ...items.map((item) => ({ ...lineFromProduct(item.product, nextKey()), quantityText: item.quantityText })),
    ]);
    // The seller wants to see what the paste produced.
    setView("carrinho");
  };
  const planContext = {
    existingCodes: new Set(lines.map((line) => line.productCode)),
    // Until the configuration loads nothing is blocked here; the server revalidates every line on save.
    isPriceOrderable: (state: "priced" | "zero" | "none") =>
      config.data === undefined || isLinePriceOrderable(state, config.data.configuration),
  };

  const selectedLines = lines.filter((line) => selected.has(line.key));
  const allSelected = lines.length > 0 && selectedLines.length === lines.length;
  const toggleLine = (key: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(lines.map((line) => line.key)) : new Set());

  const removeKeys = (keys: ReadonlySet<string>) => {
    setRemoved(lines.flatMap((line, index) => (keys.has(line.key) ? [{ line, index }] : [])));
    setLines((current) => current.filter((line) => !keys.has(line.key)));
    setSelected(new Set());
    focusAfterRemoval.current = true;
  };
  const removeSelected = () => {
    if (selectedLines.length > 1) setConfirmRemoval("selected");
    else removeKeys(selected);
  };
  const confirmRemove = () => {
    if (confirmRemoval === "all") removeKeys(new Set(lines.map((line) => line.key)));
    else if (confirmRemoval === "selected") removeKeys(selected);
    setConfirmRemoval(null);
  };
  const undoRemoval = () => {
    if (removed === null) return;
    setLines((current) => {
      const next = [...current];
      // Ascending original positions restore the original order; a product added again meanwhile is not duplicated.
      for (const { line, index } of removed) {
        if (next.some((other) => other.productCode === line.productCode)) continue;
        next.splice(Math.min(index, next.length), 0, line);
      }
      return next;
    });
    setRemoved(null);
    document.getElementById(CART_VIEW_ID)?.focus();
  };
  const applyBulkQuantity = () => {
    const parsed = parseQuantityInput(bulkQuantity);
    if (!parsed.ok) {
      setBulkProblem(quantityProblemMessages[parsed.problem]);
      return;
    }
    setBulkProblem(null);
    const text = bulkQuantity.trim();
    setLines((current) => current.map((line) => (selected.has(line.key) ? { ...line, quantityText: text } : line)));
    setBulkQuantity("");
  };

  /** Enter in a quantity never submits the form: it moves to the next line's quantity, then to the product search. */
  const onQuantityKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const next = lines[index + 1];
    if (next) quantityInputs.current.get(next.key)?.focus();
    else focusProductSearch();
  };

  const updateLine = (key: string, patch: Partial<EditorLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const removedBar =
    removed !== null && removed.length > 0 ? (
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs" role="status">
        <span>{removed.length === 1 ? "1 item removido." : `${removed.length} itens removidos.`}</span>
        <Button ref={undoButton} type="button" size="sm" variant="secondary" onClick={undoRemoval}>
          Desfazer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Dispensar aviso"
          onClick={() => {
            setRemoved(null);
            document.getElementById(CART_VIEW_ID)?.focus();
          }}
        >
          <X size={13} aria-hidden="true" />
        </Button>
      </div>
    ) : null;

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
        badges={status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : undefined}
      />

      {customer ? <CustomerContextBar customerCode={customer.code} customerName={customer.name} onOpenFicha={() => setFichaOpen(true)} /> : null}

      {notice}
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
                <CustomerPicker {...controlProps} selected={customer} onSelect={(picked) => requestCustomer(picked)} disabled={readOnly} />
              )}
            </FormField>
            <FormField label="Tipo de negociação" hint={config.isError ? "Tipos de negociação indisponíveis no momento." : undefined}>
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
            <>
              <CardBody className="flex flex-wrap items-center gap-2 border-b border-line">
                <div role="group" aria-label="Visualização dos itens" className="inline-flex rounded-full border border-line-strong bg-surface-2 p-0.5">
                  <ViewPill active={view === "produtos"} onClick={() => setView("produtos")}>
                    Produtos
                  </ViewPill>
                  <ViewPill id={CART_VIEW_ID} active={view === "carrinho"} onClick={() => setView("carrinho")}>
                    Carrinho ({lines.length})
                  </ViewPill>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-full"
                  disabled={customer === null}
                  onClick={() => setBulkEntryOpen(true)}
                >
                  Lançamento múltiplo
                </Button>
                {lines.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto rounded-full"
                    leftIcon={<Trash2 size={13} aria-hidden="true" />}
                    onClick={() => setConfirmRemoval("all")}
                  >
                    Limpar carrinho
                  </Button>
                ) : null}
              </CardBody>
              {view === "produtos" ? (
                <ProductBrowser
                  filters={productFilters}
                  onFiltersChange={setProductFilters}
                  customerCode={customer?.code ?? null}
                  cartQuantities={cartQuantities}
                  searchId={PRODUCT_SEARCH_ID}
                  onAdd={(product, quantityText) => {
                    if (lines.some((line) => line.productCode === product.code)) {
                      toast({ title: "Produto já está no pedido", description: product.description, tone: "warning" });
                      return;
                    }
                    setLines((current) => [...current, { ...lineFromProduct(product, nextKey()), quantityText }]);
                  }}
                />
              ) : null}
            </>
          ) : null}
          {readOnly || view === "carrinho" ? (
            lines.length === 0 ? (
              <>
                {removedBar}
                <CardBody>
                  <p className="m-0 text-xs text-fg-muted">Nenhum item no carrinho. Adicione produtos na visualização Produtos.</p>
                </CardBody>
              </>
            ) : (
            <>
              {!readOnly && selectedLines.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-line bg-accent-weak px-3 py-2">
                  <span className="text-xs font-medium" aria-live="polite">
                    {selectedLines.length === 1 ? "1 item selecionado" : `${selectedLines.length} itens selecionados`}
                  </span>
                  <Input
                    size="sm"
                    inputMode="decimal"
                    autoComplete="off"
                    wrapperClassName="w-[110px]"
                    placeholder="Quantidade"
                    value={bulkQuantity}
                    aria-label="Quantidade para os selecionados"
                    aria-invalid={bulkProblem ? true : undefined}
                    onChange={(event) => {
                      setBulkQuantity(event.target.value);
                      setBulkProblem(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      applyBulkQuantity();
                    }}
                  />
                  <Button type="button" size="sm" variant="secondary" onClick={applyBulkQuantity}>
                    Aplicar quantidade
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger-outline"
                    leftIcon={<Trash2 size={13} aria-hidden="true" />}
                    onClick={removeSelected}
                  >
                    Remover selecionados
                  </Button>
                  {bulkProblem ? <FieldError>{bulkProblem}</FieldError> : null}
                </div>
              ) : null}
              {removedBar}
              <Table label="Itens do pedido">
                <TableCaption>Itens do pedido</TableCaption>
                <TableHeader>
                  <TableRow>
                    {readOnly ? null : (
                      <TableHead>
                        <Checkbox
                          aria-label="Selecionar todos os itens"
                          checked={allSelected ? true : selectedLines.length > 0 ? "indeterminate" : false}
                          onCheckedChange={(value) => toggleAll(value === true)}
                        />
                      </TableHead>
                    )}
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
                        {readOnly ? null : (
                          <TableCell>
                            <Checkbox
                              aria-label={`Selecionar ${line.description}`}
                              checked={selected.has(line.key)}
                              onCheckedChange={(value) => toggleLine(line.key, value === true)}
                            />
                          </TableCell>
                        )}
                        <TableCell numeric>{index + 1}</TableCell>
                        <TableCell wrap>
                          <span className="font-medium">{titleCase(line.description)}</span>
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
                            onKeyDown={(event) => onQuantityKeyDown(event, index)}
                            ref={(element) => {
                              if (element) quantityInputs.current.set(line.key, element);
                              else quantityInputs.current.delete(line.key);
                            }}
                          />
                          {problem ? <FieldError id={errorId}>{quantityProblemMessages[problem]}</FieldError> : null}
                        </TableCell>
                        <TableCell numeric>
                          <PriceCell price={listPriceOfLine(line.price)} />
                        </TableCell>
                        <TableCell numeric>
                          <Money
                            value={linePreview?.item?.estimatedLineTotal ?? null}
                            fallback={line.price.state === "none" ? NO_PRICE_TEXT : "—"}
                          />
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
            </>
            )
          ) : null}
          <CardBody className="border-t border-line">
            <dl aria-label="Resumo do pedido" className="m-0 flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1">
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-muted">Itens</dt>
                <dd className="m-0 font-medium" data-testid="order-line-count">
                  {cartSummary.lineCount}
                </dd>
              </div>
              {cartSummary.quantities.length > 0 ? (
                <div className="flex items-baseline gap-2">
                  <dt className="text-fg-muted">Quantidade</dt>
                  <dd className="m-0 font-medium" data-testid="order-quantity">
                    {cartSummary.quantities.map(({ unit, quantity }) => `${formatQuantity(quantity)} ${unit}`).join(" · ")}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-baseline gap-2">
                <dt className="text-fg-muted">{preview.totals.isPartial ? "Total parcial estimado" : "Total estimado"}</dt>
                <dd className="m-0 text-lg font-semibold" data-testid="order-total">
                  <Money value={preview.totals.estimatedTotal} />
                </dd>
              </div>
            </dl>
            {cartSummary.invalidLineCount > 0 ? (
              <p className="m-0 mt-1 text-right text-xs text-danger">
                {cartSummary.invalidLineCount === 1
                  ? "1 item com quantidade inválida não entra na soma."
                  : `${cartSummary.invalidLineCount} itens com quantidade inválida não entram na soma.`}
              </p>
            ) : null}
            {preview.totals.isPartial ? (
              <p className="m-0 mt-1 text-right text-xs text-fg-muted">
                {preview.totals.unpricedLineCount === 1
                  ? "1 item sem preço não entra na soma."
                  : `${preview.totals.unpricedLineCount} itens sem preço não entram na soma.`}
              </p>
            ) : null}
            <FieldHint className="mt-1 text-right">
              Estimativa pelos preços de lista. Desconto, condição de pagamento e análise de crédito ainda não estão disponíveis nesta
              versão.
            </FieldHint>
          </CardBody>
        </Card>

        <div className="sticky bottom-0 z-20 -mx-3 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-3 py-2 shadow-[0_-2px_6px_rgba(0,0,0,0.06)] md:-mx-6 md:px-6">
          <p className="m-0 w-full text-sm text-fg-muted sm:mr-auto sm:w-auto">
            Total: <strong className="text-base text-ok">
              <Money value={preview.totals.estimatedTotal} />
            </strong>
          </p>
          {!readOnly && hasBlockedLines ? (
            <p className="m-0 w-full text-xs text-danger sm:w-auto" role="status" data-testid="save-blocked-reason">
              Remova os itens sem preço para salvar.
            </p>
          ) : null}
          <Button type="button" variant="ghost" className="flex-1 sm:flex-none" leftIcon={<X size={14} aria-hidden="true" />} onClick={onClose}>
            {readOnly ? "Voltar" : "Cancelar"}
          </Button>
          <Button
              className="flex-1 sm:flex-none"
            type="button"
            variant="secondary"
            leftIcon={<BookmarkPlus size={14} aria-hidden="true" />}
            disabled={customer === null || lines.length === 0 || !preview.valid}
            title={canSaveTemplate ? undefined : "Escolha o cliente e informe quantidades válidas para salvar como recorrente"}
            onClick={() => setSavingTemplate(true)}
          >
            Salvar como recorrente
          </Button>
          {order && order.status === "draft" ? (
            <Button
              className="flex-1 sm:flex-none"
              type="button"
              variant="danger-outline"
              leftIcon={<Trash2 size={14} aria-hidden="true" />}
              onClick={() => setDiscarding(true)}
            >
              Descartar
            </Button>
          ) : null}
          {order && order.status === "draft" ? (
            <Button
              className="flex-1 sm:flex-none"
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
            <Button
              className="flex-1 sm:flex-none"
              type="submit"
              variant="primary"
              leftIcon={<Save size={14} aria-hidden="true" />}
              loading={save.isPending}
              disabled={!canSave}
            >
              Salvar rascunho
            </Button>
          ) : null}
        </div>
      </form>

      {customer ? (
        <SaveTemplateDialog open={savingTemplate} onOpenChange={setSavingTemplate} customer={customer} items={toRequestItems(lines)} />
      ) : null}

      <Dialog open={pendingCustomer !== null} onOpenChange={(open) => !open && setPendingCustomer(null)}>
        <DialogContent
          title="Trocar o cliente do pedido?"
          description={`Os preços dos produtos dependem do cliente. Ao ${pendingCustomer?.picked ? `trocar para ${pendingCustomer.picked.name}` : "remover o cliente"}, os itens já adicionados serão removidos e você escolhe os produtos de novo, com os preços do cliente escolhido.`}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="secondary">Manter o cliente atual</Button>
              </DialogClose>
              <Button variant="danger" onClick={confirmCustomerChange}>
                Trocar e remover itens
              </Button>
            </>
          }
        >
          <p className="m-0 text-sm text-fg-muted">A troca ainda não é salva: ela só vale quando você salvar o rascunho.</p>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemoval !== null} onOpenChange={(open) => !open && setConfirmRemoval(null)}>
        <DialogContent
          title={confirmRemoval === "all" ? "Limpar o carrinho?" : "Remover os itens selecionados?"}
          description={
            confirmRemoval === "all"
              ? `${lines.length === 1 ? "O item será removido" : `Os ${lines.length} itens serão removidos`} do carrinho.`
              : `${selectedLines.length} itens serão removidos do carrinho.`
          }
          footer={
            <>
              <DialogClose asChild>
                <Button variant="secondary">Manter itens</Button>
              </DialogClose>
              <Button variant="danger" onClick={confirmRemove}>
                {confirmRemoval === "all" ? "Limpar carrinho" : "Remover itens"}
              </Button>
            </>
          }
        >
          <p className="m-0 text-sm text-fg-muted">Depois de remover, você ainda pode desfazer enquanto não fizer outra remoção.</p>
        </DialogContent>
      </Dialog>

      {customer ? (
        <BulkEntryDialog
          open={bulkEntryOpen}
          onOpenChange={setBulkEntryOpen}
          customerCode={customer.code}
          existingCount={lines.length}
          planContext={planContext}
          onAdd={addBulkEntry}
        />
      ) : null}

      {customer ? <CustomerFichaDialog customerCode={customer.code} open={fichaOpen} onOpenChange={setFichaOpen} /> : null}

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
  /** Notice rendered under the header of an existing order. */
  notice?: ReactNode;
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

function ExistingOrder({ orderId, onCreated, onClose, notice }: { orderId: string; onCreated: (id: string) => void; onClose: () => void; notice?: ReactNode }) {
  const api = useApi();
  const query = useQuery(orderQueryOptions(api, orderId));
  if (query.isPending) return <LoadingHeader title="Pedido" />;
  if (query.isError) {
    return (
      <>
        <PageHeader title="Pedido" />
        <Card>
          <QueryError
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isRefetching}
            title="Não foi possível carregar o pedido"
          />
        </Card>
      </>
    );
  }
  // Re-keyed on every server version so a saved or reloaded order always starts from the authoritative data.
  return (
    <OrderEditor
      key={`${query.data.id}:${query.data.version}`}
      order={query.data}
      initialCustomer={null}
      onCreated={onCreated}
      onClose={onClose}
      notice={notice}
    />
  );
}

function NewOrder({ initialCustomerCode, onCreated, onClose }: Omit<OrderEditorPageProps, "orderId" | "notice">) {
  const api = useApi();
  const customer = useQuery({
    ...customerQueryOptions(api, initialCustomerCode ?? 0),
    enabled: initialCustomerCode !== undefined,
  });
  if (initialCustomerCode !== undefined && customer.isPending) return <LoadingHeader title="Novo pedido" />;
  const initial = customer.data ? { code: customer.data.code, name: customer.data.name } : null;
  return (
    <>
      {customer.isError ? (
        <Alert tone="warning" title="Não foi possível carregar o cliente indicado">
          Escolha o cliente abaixo para continuar. Se o problema persistir, o cliente pode estar fora da sua carteira.
        </Alert>
      ) : null}
      <OrderEditor order={null} initialCustomer={initial} onCreated={onCreated} onClose={onClose} />
    </>
  );
}

export function OrderEditorPage({ orderId, initialCustomerCode, onCreated, onClose, notice }: OrderEditorPageProps) {
  if (orderId) return <ExistingOrder orderId={orderId} onCreated={onCreated} onClose={onClose} notice={notice} />;
  return <NewOrder initialCustomerCode={initialCustomerCode} onCreated={onCreated} onClose={onClose} />;
}
