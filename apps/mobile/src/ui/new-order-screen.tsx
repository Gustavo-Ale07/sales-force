import { useEffect, useMemo, useRef, useState } from "react";
import { DatasetChangedError, DatasetUnavailableError, type DraftRecord } from "@salesforce/mobile-db";
import { ORDER_HEADER_ISSUE_LABEL, orderHeaderIssues, type OrderHeaderIssueCode } from "@salesforce/domain";
import { datasetIdentityOf } from "../offline/reference-source";
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiRequestError } from "../data/api";
import { describeDataError, type DataErrorInfo } from "../data/errors";
import {
  decrementLineQuantity,
  incrementLineQuantity,
  isLinePriceOrderable,
  lineAmountsOf,
  lineFromOrderItem,
  lineFromProduct,
  orderSignature,
  previewDraft,
  toRequestItems,
  describeIssue,
  type EditorLine,
} from "../data/order-draft";
import type { Carrier, CustomerListItem, OrderDetail, OrderEntryConfiguration, OrderRepository, ProductListItem, Repositories } from "../data/ports";
import { formatBrl } from "../lib/money";
import { ERP_DISCOUNT_NOTICE } from "../offline/approval-status";
import { describeDraftStatus, type LocalOrdersPort } from "../offline/local-orders";
import { newClientRequestId } from "../lib/uuid";
import { OrderHeaderOptions } from "./order-header-options";
import { NOTES_MAX, NotesField, SummaryBlock, SummaryRow, WIZARD_STEPS, WizardFooter, WizardProgress, type WizardStep } from "./order-wizard-parts";
import { topLabel } from "../data/order-header";
import { describeListPrice } from "../lib/money";
import { colors, spacing } from "../theme";
import { CartView, OrderTotals } from "./cart-view";
import { CustomerPicker } from "./customer-picker";
import { DiscountSheet } from "./discount-sheet";
import { GroupDiscountSheet } from "./group-discount-sheet";
import { ProductPicker } from "./product-picker";
import type { ProductOrderActions } from "./product-views";

/** The order is a 4-step wizard: Cliente → Negociação → Produtos → Resumo. Step 3 also has its own cart view. */
type Step = WizardStep;

/** Enough of a customer to display and to send as `customerCode`; a saved/reopened draft never carries the full catalog row. */
type PickedCustomer = Pick<CustomerListItem, "code" | "name"> & Partial<Pick<CustomerListItem, "document" | "tradeName" | "overdue">>;

interface SaveFailure {
  readonly title: string;
  readonly messages: readonly string[];
  readonly correlationId?: string;
  /** `version_conflict` / `order_not_editable`: another save happened elsewhere — offer to reload, never silently overwrite it. */
  readonly reloadable: boolean;
}

/** Turns a failed save into user-facing text. Per-item issues are listed; the server stays authoritative. Mirrors `apps/web`'s `describeSaveFailure`. */
function describeSaveFailure(error: unknown): SaveFailure {
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
    if (error.code === "dataset_mismatch") {
      return {
        title: "Os dados do servidor mudaram",
        messages: ["Este pedido foi aberto com outro conjunto de dados e não foi salvo. Volte e abra o pedido novamente para continuar."],
        correlationId: error.correlationId,
        reloadable: false,
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
  if (error instanceof DatasetUnavailableError) {
    return { title: "Não foi possível salvar o rascunho", messages: [error.message], reloadable: false };
  }
  const info: DataErrorInfo = describeDataError(error);
  return { title: "Não foi possível salvar o rascunho", messages: [info.message], correlationId: info.correlationId, reloadable: false };
}

export interface NewOrderScreenProps {
  readonly repositories: Pick<Repositories, "customers" | "products" | "orders">;
  readonly onUnauthenticated: () => void;
  /**
   * When present, "Salvar" writes the draft to this device (encrypted DB + outbox) and the sync manager delivers it,
   * online or not. Without it the screen keeps its online-only behavior (POST/PUT straight to the API).
   */
  readonly localOrders?: LocalOrdersPort;
  /** A local draft chosen in the "Pedidos" tab; loaded once, then `onResumeConsumed` clears it. */
  readonly resumeLocalId?: string | null;
  readonly onResumeConsumed?: () => void;
  /** "Novo pedido" from a customer sheet: start (or continue) an order for this customer. Handled once per `nonce`. */
  /** With `lines` (a duplicated sale) the cart opens pre-filled as a brand-new order; an order in progress is never replaced silently. */
  readonly startRequest?: { readonly nonce: number; readonly customer: PickedCustomer; readonly lines?: readonly EditorLine[] } | null;
  readonly onStartConsumed?: () => void;
  /** Leaves the wizard back to the sales list. The order in progress stays on this screen (it is only hidden), so nothing is lost. */
  readonly onExit?: () => void;
}

/**
 * Online-only new-order flow (MOB-4): pick the customer, browse the catalog, edit the cart and save the draft
 * through the same `POST /orders` / `PUT /orders/{id}` the web editor uses. There is no local outbox here
 * (MOB-2/V-09 pending) — a save always needs the server, and every price/total shown is an estimate from
 * `packages/domain`, the server response on save being authoritative (P-09). Negotiation type, notes and bulk
 * entry are out of this slice; reopening an existing draft is only reachable from this screen's own success
 * step (there is no order-list screen yet — see the mobile-engineer report).
 */
export function NewOrderScreen({
  repositories,
  onUnauthenticated,
  localOrders,
  resumeLocalId = null,
  onResumeConsumed,
  startRequest = null,
  onStartConsumed,
  onExit,
}: NewOrderScreenProps) {
  const [step, setStep] = useState<Step>("customer");
  /** Step 3 shows either the catalog or the cart as its own view (never both, never a permanent panel). */
  const [productsView, setProductsView] = useState<"catalog" | "cart">("catalog");
  /** Why the seller cannot advance yet; cleared on any step change or edit. */
  const [stepError, setStepError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [lines, setLines] = useState<readonly EditorLine[]>([]);

  function requestExit() {
    if (onExit === undefined) return;
    if (customer === null && lines.length === 0) {
      onExit();
      return;
    }
    Alert.alert("Sair do pedido?", "O pedido em andamento fica guardado. Para continuar, toque em Novo pedido.", [
      { text: "Continuar editando", style: "cancel" },
      { text: "Sair", onPress: onExit },
    ]);
  }
  const lineCounter = useRef(0);
  const nextKey = () => `line-${(lineCounter.current += 1)}`;
  // One idempotency key per distinct payload: a retry after a lost response resends the same key, an edited payload gets a new one.
  // Only `create` uses this: `replace` is optimistic-concurrency based (`expectedVersion`), not idempotency-key based (mirrors web).
  const requestIdRef = useRef<{ payload: string; id: string } | null>(null);
  /** `null` while creating a fresh draft; the loaded order (its id, version, negotiation type and notes) while editing one. */
  const [editingOrder, setEditingOrder] = useState<OrderDetail | null>(null);
  /** Phone-appropriate stand-in for the desktop's checkboxes + toolbar (DISC-1/MOB-4): long-press or this toggle. */
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [massDiscountOpen, setMassDiscountOpen] = useState(false);
  /** Manual ad-hoc subset apply (not "group discount" — MOB-4a superseded that label; see `GroupDiscountSheet` below for the real catalog-group feature). */
  const [selectedDiscountOpen, setSelectedDiscountOpen] = useState(false);
  /** Automatic catalog-group discount (MOB-4a): buckets the cart by product `groupCode`/`groupName`. */
  const [groupDiscountOpen, setGroupDiscountOpen] = useState(false);

  const [config, setConfig] = useState<
    { status: "loading" } | { status: "error"; error: DataErrorInfo } | { status: "ready"; value: OrderEntryConfiguration }
  >({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const [savedOrder, setSavedOrder] = useState<OrderDetail | null>(null);
  /** The device-local draft being edited (offline-first path); `null` for a fresh order. */
  const [localDraft, setLocalDraft] = useState<DraftRecord | null>(null);
  const [savedLocal, setSavedLocal] = useState<DraftRecord | null>(null);

  // What the editor held when it was last loaded or saved; an order that differs from it has unsaved edits to protect.
  const baselineRef = useRef(orderSignature(null, []));
  /** Header options the seller changed in this session (`undefined` = untouched, the saved or default value stands). */
  const [choice, setChoice] = useState<{ top?: number; negotiation?: number; carrier?: number | null; freight?: "CIF" | "FOB" | "SEM_FRETE" | null; notes?: string }>({});
  const [carriers, setCarriers] = useState<readonly Carrier[] | null>(null);
  const choiceHeader = { ...(choice.top === undefined ? {} : { top: choice.top }), ...(choice.negotiation === undefined ? {} : { negotiation: choice.negotiation }), ...(choice.carrier === undefined ? {} : { carrier: choice.carrier }), ...(choice.freight === undefined ? {} : { freight: choice.freight }), ...(choice.notes === undefined ? {} : { notes: choice.notes }) };
  const finished = savedLocal !== null || savedOrder !== null;
  const dirty =
    !finished &&
    orderSignature(customer?.code ?? null, lines, choiceHeader) !== baselineRef.current &&
    (lines.length > 0 || localDraft !== null || editingOrder !== null);

  // Latest cart state for the start-request handler, which must react only to a new request, not to every edit.
  const inProgress = useRef({ customer, lines, finished, dirty });
  useEffect(() => {
    inProgress.current = { customer, lines, finished, dirty };
  });
  const startNonce = startRequest?.nonce ?? null;
  const startCustomer = startRequest?.customer ?? null;
  const startLines = startRequest?.lines;
  useEffect(() => {
    if (startNonce === null || startCustomer === null) return;
    onStartConsumed?.();
    const current = inProgress.current;
    const begin = () => {
      resetOrder();
      setCustomer(startCustomer);
      // The customer is already chosen: the wizard opens on the first step that still needs the seller (Negociação).
      if (startLines === undefined) {
        goToStep("negotiation");
        return;
      }
      setLines(startLines.map((line) => ({ ...line, key: nextKey() })));
      goToStep("summary");
    };
    // Nothing at risk: an empty cart, or an order already saved (its success screen is showing).
    if (current.lines.length === 0 || current.finished) {
      begin();
      return;
    }
    if (startLines === undefined && current.customer?.code === startCustomer.code) {
      goToStep("products");
      return;
    }
    // An order with items is in progress for another customer: never replace it silently.
    Alert.alert(
      "Você já possui um pedido em andamento",
      `Pedido de ${current.customer?.name ?? "outro cliente"} com ${current.lines.length} ${current.lines.length === 1 ? "item" : "itens"}. Iniciar um novo pedido descarta os itens que ainda não foram salvos.`,
      [
        { text: "Continuar pedido atual", onPress: () => goToStep("products") },
        { text: "Iniciar novo pedido", style: "destructive", onPress: begin },
        { text: "Cancelar", style: "cancel" },
      ],
    );
    // Only a new request (nonce) triggers this; the handlers above read the latest state through refs/closures of this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNonce]);

  useEffect(() => {
    if (resumeLocalId === null || localOrders === undefined) return undefined;
    let active = true;
    localOrders
      .open(resumeLocalId)
      .then((opened) => {
        if (!active) return;
        onResumeConsumed?.();
        if (opened === null) return;
        const open = () => {
          baselineRef.current = orderSignature(opened.draft.customerCode, opened.lines);
          setChoice({});
          setLocalDraft(opened.draft);
          setCustomer({ code: opened.draft.customerCode, name: opened.draft.customerName });
          setLines(opened.lines);
          setSavedLocal(null);
          setSavedOrder(null);
          setEditingOrder(null);
          setSaveFailure(null);
          goToStep("summary");
        };
        // Opening another order over unsaved edits would silently throw them away: ask first.
        if (!inProgress.current.dirty) {
          open();
          return;
        }
        Alert.alert(
          "Há alterações não salvas",
          "Abrir outro pedido descarta as alterações do pedido que você está editando.",
          [
            { text: "Continuar editando", style: "cancel" },
            { text: "Descartar e abrir", style: "destructive", onPress: open },
          ],
        );
      })
      .catch(() => {
        if (!active) return;
        onResumeConsumed?.();
        setSaveFailure({ title: "Não foi possível abrir o pedido", messages: ["Tente novamente."], reloadable: false });
      });
    return () => {
      active = false;
    };
  }, [resumeLocalId, localOrders, onResumeConsumed]);

  useEffect(() => {
    let active = true;
    void loadConfiguration(repositories.orders);
    return () => {
      active = false;
    };

    async function loadConfiguration(orders: OrderRepository) {
      try {
        const value = await orders.getEntryConfiguration();
        if (active) setConfig({ status: "ready", value });
      } catch (error) {
        if (!active) return;
        const info = describeDataError(error);
        if (info.kind === "unauthenticated") {
          onUnauthenticated();
          return;
        }
        setConfig({ status: "error", error: info });
      }
    }
  }, [repositories.orders, onUnauthenticated]);

  const savedTopCode = localDraft?.topCode ?? editingOrder?.topCode ?? null;
  const topCode = choice.top !== undefined ? choice.top : savedTopCode;
  const savedNegotiation =
    localDraft !== null
      ? localDraft.negotiationTypeCode
      : editingOrder !== null
        ? editingOrder.negotiationTypeCode
        : null; // mandatory and chosen by the seller: a new order starts with no negotiation type (owner ruling 2026-11-12)
  const negotiationTypeCode = choice.negotiation !== undefined ? choice.negotiation : savedNegotiation;
  const savedCarrier = localDraft?.carrierCode ?? editingOrder?.carrierCode ?? null;
  const carrierCode = choice.carrier !== undefined ? choice.carrier : savedCarrier;
  const savedFreight = localDraft?.freightType ?? editingOrder?.freightType ?? null;
  const freightType = choice.freight !== undefined ? choice.freight : savedFreight;
  // Shared rule (site, app and server): TOP, negotiation, freight and carrier are mandatory; only the notes are optional.
  const missingHeader = orderHeaderIssues({
    topCode: topCode ?? (config.status === "ready" ? config.value.sales.orderTops.defaultTopCode : null),
    negotiationTypeCode,
    freightType,
    carrierCode,
  });
  const fieldOffsets = useRef<Partial<Record<OrderHeaderIssueCode, number>>>({});
  const negotiationScrollRef = useRef<ScrollView>(null);
  const savedNotes = localDraft !== null ? localDraft.notes : (editingOrder?.notes ?? null);
  const notesText = choice.notes !== undefined ? choice.notes : (savedNotes ?? "");
  /** Empty text is "no notes" (`null`), as before the field existed. */
  const notesValue = notesText.trim() === "" ? null : notesText;

  // Optional list; offline-first adapters answer from what the device stored, and a failure just leaves the choice empty.
  useEffect(() => {
    let active = true;
    repositories.orders
      .listCarriers()
      .then((items) => active && setCarriers(items))
      .catch(() => active && setCarriers([]));
    return () => {
      active = false;
    };
  }, [repositories.orders]);

  const preview = useMemo(() => previewDraft(lines), [lines]);
  const productActions = useMemo<ProductOrderActions>(() => {
    const quantities = new Map(lines.map((line) => [line.productCode, line.quantityText]));
    return { quantityOf: (code) => quantities.get(code), onAdd: addProduct, onDecrement: decrementProduct };
    // addProduct/decrementProduct only use functional state updates, so they are safe to capture per `lines` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);
  const blockedLineCount = useMemo(() => {
    if (config.status !== "ready") return 0;
    return preview.lines.filter((linePreview, index) => {
      const state = lines[index]?.price.state;
      return state !== undefined && state === "none" && !isLinePriceOrderable(state, config.value);
    }).length;
  }, [config, preview.lines, lines]);

  function resetOrder() {
    baselineRef.current = orderSignature(null, []);
    setChoice({});
    requestIdRef.current = null;
    setCustomer(null);
    setLines([]);
    setSavedOrder(null);
    setSavedLocal(null);
    setLocalDraft(null);
    setSaveFailure(null);
    setEditingOrder(null);
    setSelectionMode(false);
    setSelected(new Set());
    goToStep("customer");
  }

  function goToStep(next: Step, view: "catalog" | "cart" = "catalog") {
    setStep(next);
    setProductsView(view);
    setStepError(null);
  }

  function setNotes(text: string) {
    setStepError(null);
    setChoice((current) => {
      const { notes: _previous, ...rest } = current;
      return text === (savedNotes ?? "") ? rest : { ...rest, notes: text };
    });
  }

  /** Reopens the just-saved draft for editing (the only entry point this slice has — there is no order-list screen yet). */
  function editSavedOrder(order: OrderDetail) {
    baselineRef.current = orderSignature(order.customerCode, order.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
    setChoice({});
    setEditingOrder(order);
    setCustomer({ code: order.customerCode, name: order.customerName });
    setLines(order.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
    setSavedOrder(null);
    setSaveFailure(null);
    setSelectionMode(false);
    setSelected(new Set());
    goToStep("summary");
  }

  /** Discards local edits and reloads the authoritative order after a `version_conflict` / `order_not_editable`. */
  async function reload() {
    if (editingOrder === null) return;
    try {
      const fresh = await repositories.orders.get(editingOrder.id);
      baselineRef.current = orderSignature(fresh.customerCode, fresh.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
      setChoice({});
      setEditingOrder(fresh);
      setCustomer({ code: fresh.customerCode, name: fresh.customerName });
      setLines(fresh.items.map((item, index) => lineFromOrderItem(item, `edit-${index}`)));
      setSaveFailure(null);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      setSaveFailure(describeSaveFailure(error));
    }
  }

  /** Throws away the order being edited (never a saved draft: that one stays on the device). Always asks first. */
  function confirmDiscard() {
    Alert.alert(
      localDraft !== null || editingOrder !== null ? "Descartar alterações?" : "Descartar pedido?",
      localDraft !== null || editingOrder !== null
        ? "As alterações feitas desde o último salvamento serão perdidas. O pedido salvo continua como estava."
        : "Os itens do carrinho serão removidos e o pedido não será salvo. Esta ação não pode ser desfeita.",
      [
        { text: "Continuar editando", style: "cancel" },
        { text: "Descartar", style: "destructive", onPress: resetOrder },
      ],
    );
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => !current);
    setSelected(new Set());
  }

  function cancelSelection() {
    setSelectionMode(false);
    setSelected(new Set());
  }

  function toggleSelect(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Long-pressing a line enters selection mode and selects it in one gesture. */
  function enterSelectionWith(key: string) {
    setSelectionMode(true);
    setSelected(new Set([key]));
  }

  /** Picking in step 1. Choosing another customer over a filled cart asks first, because the cart is emptied. */
  function selectCustomer(picked: PickedCustomer) {
    setStepError(null);
    if (customer === null || customer.code === picked.code || lines.length === 0) {
      setCustomer(picked);
      return;
    }
    Alert.alert("Trocar cliente", "O carrinho atual será esvaziado. Deseja continuar?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Continuar",
        style: "destructive",
        onPress: () => {
          setLines([]);
          setCustomer(picked);
        },
      },
    ]);
  }

  /** Message for the first thing missing in `from`, or `null` when the seller may advance. Presentation only: the server still revalidates everything. */
  function validateStep(from: Step): string | null {
    if (from === "customer") return customer === null ? "Selecione um cliente para continuar." : null;
    if (from === "negotiation") {
      if (missingHeader.length > 0) {
        const first = missingHeader[0];
        const offset = first === undefined ? undefined : fieldOffsets.current[first];
        if (offset !== undefined) negotiationScrollRef.current?.scrollTo({ y: Math.max(0, offset - 8), animated: true });
        return `Preencha para continuar: ${missingHeader.map((code) => ORDER_HEADER_ISSUE_LABEL[code]).join(", ")}.`;
      }
      return notesText.length > NOTES_MAX ? `As observações aceitam até ${NOTES_MAX} caracteres.` : null;
    }
    if (from === "products") {
      if (lines.length === 0) return "Adicione ao menos um produto para continuar.";
      if (!preview.valid) return "Corrija a quantidade ou o desconto dos itens do carrinho para continuar.";
      if (blockedLineCount > 0) return `${blockedLineCount} item(ns) sem preço não podem ser salvos nesta instalação. Remova-os ou aguarde a atualização de preços.`;
    }
    return null;
  }

  function goNext() {
    const message = validateStep(step);
    if (message !== null) {
      setStepError(message);
      return;
    }
    const next = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1];
    if (next === undefined) return;
    void autoSave();
    goToStep(next);
  }

  function goBack() {
    const previous = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) - 1];
    if (previous === undefined) return;
    void autoSave();
    goToStep(previous);
  }

  function addProduct(product: ProductListItem) {
    setLines((current) => {
      const existing = current.find((line) => line.productCode === product.code);
      if (existing) return current.map((line) => (line.key === existing.key ? incrementLineQuantity(line) : line));
      return [...current, lineFromProduct(product, nextKey())];
    });
  }

  function decrementProduct(product: ProductListItem) {
    setLines((current) => {
      const existing = current.find((line) => line.productCode === product.code);
      if (!existing) return current;
      const step = decrementLineQuantity(existing);
      if (step === null) return current;
      if (step.kind === "remove") return current.filter((line) => line.key !== existing.key);
      return current.map((line) => (line.key === existing.key ? { ...line, quantityText: step.quantityText } : line));
    });
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((line) => line.key !== key));
    setSelected((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function setQuantityText(key: string, text: string) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, quantityText: text } : line)));
  }

  function setDiscountText(key: string, text: string) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, discountText: text } : line)));
  }

  /** Writes the order to this device (same path as "Salvar"); returns the stored draft. */
  async function persistLocal(port: LocalOrdersPort, picked: PickedCustomer): Promise<DraftRecord> {
    const saved = await port.save({
      localId: localDraft?.localId ?? null,
      customer: picked,
      negotiationTypeCode,
      topCode,
      carrierCode,
      freightType,
      notes: notesValue,
      lines,
      loadedDataset: config.status === "ready" ? datasetIdentityOf(config.value) : null,
    });
    baselineRef.current = orderSignature(picked.code, lines);
    setChoice({});
    setLocalDraft(saved);
    return saved;
  }

  /**
   * Silent draft save between steps and when the app goes to the background (offline path only; online there is
   * no local draft and nothing is created on the server behind the seller's back). Only a complete, valid cart is
   * stored, exactly what "Salvar rascunho" accepts; a failure here stays silent and the final save reports it.
   */
  async function autoSave() {
    if (localOrders === undefined || customer === null || saving || finished || !dirty) return;
    if (lines.length === 0 || !preview.valid || blockedLineCount > 0) return;
    try {
      await persistLocal(localOrders, customer);
    } catch {
      // The explicit save reports the problem.
    }
  }

  // The app-state listener must call the latest closure (current lines/choice), never a stale one.
  const autoSaveRef = useRef(autoSave);
  useEffect(() => {
    autoSaveRef.current = autoSave;
  });
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void autoSaveRef.current();
    });
    return () => subscription.remove();
  }, []);

  async function save() {
    if (customer === null || saving) return;
    setSaving(true);
    setSaveFailure(null);
    if (localOrders !== undefined) {
      try {
        const saved = await persistLocal(localOrders, customer);
        setSavedLocal(saved);
      } catch (error) {
        setSaveFailure({
          title: "Não foi possível salvar o pedido neste aparelho",
          messages: [
            error instanceof DatasetUnavailableError || error instanceof DatasetChangedError
              ? error.message
              : "Este pedido não pode mais ser alterado aqui. Abra-o em Pedidos para ver a situação.",
          ],
          reloadable: false,
        });
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      // The server compares this with its own dataset before any write: it states the dataset this editor loaded under.
      // Without it nothing is sent (never "whatever is current at POST time").
      const expectedDataset = config.status === "ready" ? datasetIdentityOf(config.value) : null;
      if (expectedDataset === null) throw new DatasetUnavailableError();
      const body = {
        expectedDataset,
        customerCode: customer.code,
        // Editing an existing draft keeps its negotiation type and notes as loaded (not editable in this slice);
        // a fresh draft uses the installation default.
        negotiationTypeCode,
        ...(topCode === null ? {} : { topCode }),
        ...(carrierCode === null && (editingOrder?.carrierCode ?? null) === null ? {} : { carrierCode }),
        ...(freightType === null ? {} : { freightType }),
        notes: notesValue,
        items: toRequestItems(lines),
      };
      if (editingOrder !== null) {
        const updated = await repositories.orders.replace(editingOrder.id, { expectedVersion: editingOrder.version, ...body });
        setEditingOrder(updated);
        setSavedOrder(updated);
      } else {
        const payload = JSON.stringify(body);
        if (requestIdRef.current?.payload !== payload) {
          requestIdRef.current = { payload, id: newClientRequestId() };
        }
        const created = await repositories.orders.create({ clientRequestId: requestIdRef.current.id, ...body });
        setSavedOrder(created);
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      setSaveFailure(describeSaveFailure(error));
    } finally {
      setSaving(false);
    }
  }

  if (savedLocal !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.successTitle}>Pedido salvo neste aparelho</Text>
        <Text style={styles.successMeta}>{savedLocal.customerName}</Text>
        <Text style={styles.successMeta}>{describeDraftStatus(savedLocal.status)}</Text>
        <Pressable style={styles.primaryButton} onPress={resetOrder} accessibilityRole="button" accessibilityLabel="Novo pedido">
          <Text style={styles.primaryButtonText}>Novo pedido</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => setSavedLocal(null)} accessibilityRole="button" accessibilityLabel="Editar pedido">
          <Text style={styles.secondaryButtonText}>Editar pedido</Text>
        </Pressable>
      </View>
    );
  }

  if (savedOrder !== null) {
    return (
      <View style={styles.center}>
        <Text style={styles.successTitle}>{editingOrder !== null ? "Alterações salvas" : "Rascunho salvo"}</Text>
        <Text style={styles.successMeta}>{`Pedido nº ${savedOrder.draftNumber} · ${savedOrder.customerName}`}</Text>
        <Text style={styles.successTotal}>{formatBrl(savedOrder.estimatedTotal) ?? "—"}</Text>
        {savedOrder.isPartial && <Text style={styles.partialNotice}>Total parcial: há itens sem preço neste rascunho.</Text>}
        <Pressable style={styles.primaryButton} onPress={resetOrder} accessibilityRole="button" accessibilityLabel="Novo pedido">
          <Text style={styles.primaryButtonText}>Novo pedido</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => editSavedOrder(savedOrder)}
          accessibilityRole="button"
          accessibilityLabel="Editar pedido"
        >
          <Text style={styles.secondaryButtonText}>Editar pedido</Text>
        </Pressable>
      </View>
    );
  }

  const orderable = lines.length > 0 && preview.valid && blockedLineCount === 0;
  const total = formatBrl(preview.ipi.grandTotalEstimated) ?? "—";
  const itemsInfo = `${lines.length} ${lines.length === 1 ? "item" : "itens"} · ${total}`;
  const saveLabel = editingOrder !== null || localDraft !== null ? "Salvar alterações" : "Salvar rascunho";

  function renderCustomerStep() {
    return (
      <View style={styles.flex}>
        {customer !== null && (
          <View style={styles.selectedCustomer} accessibilityLabel={`Cliente selecionado: ${customer.name}`}>
            <Text style={styles.selectedCaption}>Cliente selecionado</Text>
            <Text style={styles.selectedName}>{customer.name}</Text>
            <Text style={styles.selectedMeta}>{`Código ${customer.code}${customer.document != null ? ` · ${customer.document}` : ""}`}</Text>
            {customer.overdue === true && <Text style={styles.selectedWarn}>Possui títulos vencidos (informativo)</Text>}
          </View>
        )}
        {editingOrder !== null ? (
          <Text style={styles.lockedNote}>O cliente de um pedido já salvo não pode ser trocado. Para outro cliente, inicie um novo pedido.</Text>
        ) : (
          <>
            <Text style={styles.stepTitle}>{customer === null ? "Selecione o cliente" : "Trocar de cliente"}</Text>
            <CustomerPicker customers={repositories.customers} onSelect={selectCustomer} onUnauthenticated={onUnauthenticated} />
          </>
        )}
      </View>
    );
  }

  function renderNegotiationStep() {
    return (
      <ScrollView ref={negotiationScrollRef} style={styles.flex} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {config.status === "loading" && <Text style={styles.lockedNote}>Carregando as opções do pedido…</Text>}
        {config.status === "error" && <Text style={styles.footerNotice}>{config.error.message}</Text>}
        {config.status === "ready" && (
          <OrderHeaderOptions
            sales={config.value.sales}
            topCode={topCode}
            negotiationTypeCode={negotiationTypeCode}
            onTopChange={(code) => setChoice((current) => ({ ...current, top: code }))}
            onNegotiationChange={(code) => setChoice((current) => ({ ...current, negotiation: code }))}
            carriers={carriers}
            carrierCode={carrierCode}
            onCarrierChange={(code) => setChoice((current) => ({ ...current, carrier: code }))}
            freightType={freightType}
            onFreightChange={(value) => setChoice((current) => ({ ...current, freight: value }))}
            missing={missingHeader}
            showMissing={stepError !== null || localDraft !== null || editingOrder !== null}
            onFieldOffset={(code, y) => {
              fieldOffsets.current[code] = y;
            }}
          />
        )}
        <NotesField value={notesText} onChange={setNotes} />
      </ScrollView>
    );
  }

  function renderProductsStep() {
    return (
      <View style={styles.flex}>
        <View style={styles.pills} accessibilityRole="tablist">
          <Pressable
            style={[styles.pill, productsView === "catalog" && styles.pillActive]}
            onPress={() => setProductsView("catalog")}
            accessibilityRole="tab"
            accessibilityState={{ selected: productsView === "catalog" }}
          >
            <Text style={[styles.pillText, productsView === "catalog" && styles.pillTextActive]}>Produtos</Text>
          </Pressable>
          <Pressable
            style={[styles.pill, productsView === "cart" && styles.pillActive]}
            onPress={() => setProductsView("cart")}
            accessibilityRole="tab"
            accessibilityState={{ selected: productsView === "cart" }}
          >
            <Text style={[styles.pillText, productsView === "cart" && styles.pillTextActive]}>{`Carrinho${lines.length > 0 ? ` (${lines.length})` : ""}`}</Text>
          </Pressable>
        </View>
        {/* Kept mounted (only hidden) in the cart view, so the catalog search, filters and Grade/Lista survive the round trip. */}
        <View style={productsView === "catalog" ? styles.flex : styles.hidden}>
          <ProductPicker products={repositories.products} actions={productActions} onUnauthenticated={onUnauthenticated} />
        </View>
        {productsView === "cart" && (
          <View style={styles.flex}>
            {lines.length > 0 && (
              <View style={styles.cartToolbar}>
                <Pressable
                  style={styles.toolbarButton}
                  onPress={toggleSelectionMode}
                  accessibilityRole="button"
                  accessibilityLabel={selectionMode ? "Cancelar seleção" : "Selecionar itens"}
                >
                  <Text style={styles.toolbarIcon}>{selectionMode ? "✕" : "☑"}</Text>
                  <Text style={styles.toolbarButtonText} numberOfLines={1}>{selectionMode ? "Cancelar" : "Selecionar"}</Text>
                </Pressable>
                {selectionMode ? (
                  <Pressable
                    style={[styles.toolbarButton, selected.size === 0 && styles.toolbarButtonDisabled]}
                    onPress={() => setSelectedDiscountOpen(true)}
                    disabled={selected.size === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Aplicar desconto aos selecionados"
                  >
                    <Text style={styles.toolbarIcon}>%</Text>
                    <Text style={styles.toolbarButtonText} numberOfLines={1}>{`Desconto (${selected.size})`}</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable style={styles.toolbarButton} onPress={() => setMassDiscountOpen(true)} accessibilityRole="button" accessibilityLabel="Desconto no pedido todo">
                      <Text style={styles.toolbarIcon}>%</Text>
                      <Text style={styles.toolbarButtonText} numberOfLines={1}>Desc. geral</Text>
                    </Pressable>
                    <Pressable style={styles.toolbarButton} onPress={() => setGroupDiscountOpen(true)} accessibilityRole="button" accessibilityLabel="Desconto por grupo">
                      <Text style={styles.toolbarIcon}>▦</Text>
                      <Text style={styles.toolbarButtonText} numberOfLines={1}>Por grupo</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
            <CartView
              lines={lines}
              preview={preview}
              onQuantityChange={setQuantityText}
              onDiscountChange={setDiscountText}
              onRemove={removeLine}
              selectionMode={selectionMode}
              selected={selected}
              onToggleSelect={toggleSelect}
              onLongPressLine={enterSelectionWith}
            />
          </View>
        )}
      </View>
    );
  }

  function renderSummaryStep() {
    const sales = config.status === "ready" ? config.value.sales : null;
    const effectiveTop = topCode ?? sales?.orderTops.defaultTopCode ?? null;
    const negotiationName = negotiationTypeCode === null ? null : (sales?.negotiationTypes.find((type) => type.code === negotiationTypeCode)?.label ?? `Código ${negotiationTypeCode}`);
    const carrierName = carrierCode === null ? null : (carriers?.find((carrier) => carrier.code === carrierCode)?.name ?? `Transportadora ${carrierCode}`);
    const freightLabel = freightType === null ? null : freightType === "SEM_FRETE" ? "Sem frete" : freightType;
    const hasDiscount = (text: string) => text.trim() !== "" && Number(text.replace(",", ".")) > 0;
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <SummaryBlock title="Cliente" editLabel="Editar cliente" onEdit={editingOrder === null ? () => goToStep("customer") : undefined}>
          <Text style={styles.summaryStrong}>{customer?.name}</Text>
          {customer !== null && <Text style={styles.summaryMeta}>{`Código ${customer.code}${customer.document != null ? ` · ${customer.document}` : ""}`}</Text>}
        </SummaryBlock>

        <SummaryBlock title="Negociação" editLabel="Editar negociação" onEdit={() => goToStep("negotiation")}>
          {sales !== null && effectiveTop !== null && <SummaryRow label="Operação" value={topLabel(effectiveTop, sales.orderTops)} />}
          <SummaryRow label="Negociação" value={negotiationName ?? "Não informada"} />
          <SummaryRow label="Frete" value={freightLabel ?? "Não informado"} />
          <SummaryRow label="Transportadora" value={carrierName ?? "Não informada"} />
          {missingHeader.length > 0 && (
            <Text style={styles.footerNotice}>{`Falta preencher para enviar: ${missingHeader.map((code) => ORDER_HEADER_ISSUE_LABEL[code]).join(", ")}. Toque em Editar negociação.`}</Text>
          )}
          <SummaryRow label="Observações" value={notesValue ?? "—"} />
        </SummaryBlock>

        <SummaryBlock title={`Produtos (${lines.length})`} editLabel="Editar produtos" onEdit={() => goToStep("products", "cart")}>
          {lines.length === 0 && <Text style={styles.summaryMeta}>Nenhum item no carrinho.</Text>}
          {lines.map((line, index) => {
            const amounts = lineAmountsOf(preview.lines[index] ?? { key: line.key, item: null });
            return (
              <View key={line.key} style={styles.summaryLine}>
                <View style={styles.flex}>
                  <Text style={styles.summaryStrong} numberOfLines={2}>{line.description}</Text>
                  <Text style={styles.summaryMeta}>{`${line.quantityText.trim()} ${line.unit} × ${describeListPrice(line.price)}`}</Text>
                  {hasDiscount(line.discountText) && (
                    <Text style={styles.summaryDiscount}>
                      {`Desconto ${line.discountText.trim().replace(/\s*%$/, "")}%${amounts.discountAmount !== null && amounts.discountAmount !== "0" && amounts.discountAmount !== "0.00" ? ` · − ${formatBrl(amounts.discountAmount) ?? "—"}` : ""}`}
                    </Text>
                  )}
                </View>
                <Text style={styles.summaryStrong}>{amounts.lineTotal === null ? "—" : (formatBrl(amounts.lineTotal) ?? "—")}</Text>
              </View>
            );
          })}
        </SummaryBlock>

        <OrderTotals preview={preview} />

        {lines.length > 0 && sales?.discountAuthorityMode === "erp" && (
          <Text style={styles.footerInfo} accessibilityLabel="Liberação de descontos no Sankhya">
            {ERP_DISCOUNT_NOTICE}
          </Text>
        )}
        {config.status === "error" && <Text style={styles.footerNotice}>{config.error.message}</Text>}
        {lines.length > 0 && !preview.valid && <Text style={styles.footerNotice}>Há quantidade ou desconto inválido no carrinho. Corrija em Produtos.</Text>}
        {blockedLineCount > 0 && (
          <Text style={styles.footerNotice}>{`${blockedLineCount} item(ns) sem preço não podem ser salvos nesta instalação. Remova-os ou aguarde a atualização de preços.`}</Text>
        )}
        {saveFailure !== null && (
          <View style={styles.failureBox} accessibilityRole="alert">
            <Text style={styles.failureTitle}>{saveFailure.title}</Text>
            {saveFailure.messages.map((message) => (
              <Text key={message} style={styles.failureMessage}>
                {message}
              </Text>
            ))}
            {saveFailure.reloadable && (
              <Pressable onPress={() => void reload()} accessibilityRole="button" accessibilityLabel="Recarregar pedido">
                <Text style={styles.reloadLink}>Recarregar</Text>
              </Pressable>
            )}
          </View>
        )}
        {dirty && !saving && (
          <Pressable style={styles.discardButton} onPress={confirmDiscard} accessibilityRole="button" accessibilityLabel="Descartar">
            <Text style={styles.discardButtonText}>{localDraft !== null || editingOrder !== null ? "Descartar alterações" : "Descartar pedido"}</Text>
          </Pressable>
        )}
      </ScrollView>
    );
  }

  return (
    <View style={styles.flex}>
      <WizardProgress step={step} customerName={step === "customer" ? undefined : customer?.name} onExit={onExit === undefined ? undefined : requestExit} />
      {stepError !== null && (
        <Text style={styles.stepError} accessibilityRole="alert">
          {stepError}
        </Text>
      )}
      {step === "customer" && renderCustomerStep()}
      {step === "negotiation" && renderNegotiationStep()}
      {step === "products" && renderProductsStep()}
      {step === "summary" && renderSummaryStep()}

      {step === "summary" ? (
        <WizardFooter onBack={goBack} onNext={() => void save()} nextLabel={saveLabel} nextDisabled={!orderable || saving} busy={saving} />
      ) : (
        <WizardFooter onBack={step === "customer" ? null : goBack} onNext={goNext} nextLabel="Avançar" info={step === "products" ? itemsInfo : undefined} />
      )}

      <DiscountSheet
        visible={massDiscountOpen}
        title="Desconto no pedido todo"
        description="Aplica um desconto percentual a todos os itens do carrinho."
        lines={lines}
        match={() => true}
        onApply={(nextLines) => {
          setLines(nextLines);
          setMassDiscountOpen(false);
        }}
        onClose={() => setMassDiscountOpen(false)}
      />
      <DiscountSheet
        visible={selectedDiscountOpen}
        title="Desconto nos itens selecionados"
        description="Aplica um desconto percentual apenas aos itens marcados abaixo."
        lines={lines}
        match={(line) => selected.has(line.key)}
        onApply={(nextLines) => {
          setLines(nextLines);
          setSelectedDiscountOpen(false);
          cancelSelection();
        }}
        onClose={() => setSelectedDiscountOpen(false)}
      />
      <GroupDiscountSheet
        visible={groupDiscountOpen}
        lines={lines}
        products={repositories.products}
        onApply={(nextLines) => {
          setLines(nextLines);
          setGroupDiscountOpen(false);
        }}
        onClose={() => setGroupDiscountOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  stepError: { fontSize: 13, fontWeight: "600", color: colors.text, backgroundColor: colors.errorBackground, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  selectedCustomer: { margin: spacing.md, marginBottom: 0, padding: spacing.md, borderRadius: 8, borderWidth: 2, borderColor: colors.navy, backgroundColor: colors.surface, gap: 2 },
  selectedCaption: { fontSize: 11, color: colors.textMuted },
  selectedName: { fontSize: 16, fontWeight: "800", color: colors.text },
  selectedMeta: { fontSize: 13, color: colors.textMuted },
  selectedWarn: { fontSize: 12, fontWeight: "700", color: colors.warning },
  lockedNote: { fontSize: 13, color: colors.textMuted, padding: spacing.lg },
  summaryStrong: { fontSize: 14, fontWeight: "700", color: colors.text },
  summaryMeta: { fontSize: 12, color: colors.textMuted },
  summaryDiscount: { fontSize: 12, color: colors.red, fontWeight: "600" },
  summaryLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.xs },
  hidden: { display: "none" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  stepTitle: { fontSize: 16, fontWeight: "700", color: colors.text, padding: spacing.lg, paddingBottom: 0 },
  pills: { flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  pill: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: 20, backgroundColor: colors.background },
  pillActive: { backgroundColor: colors.navy },
  pillText: { fontSize: 14, fontWeight: "600", color: colors.textMuted },
  pillTextActive: { color: colors.onNavy },
  cartToolbar: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  // One row of equal buttons (icon + short label), each at least 44 high: the full wording lives in accessibilityLabel.
  toolbarButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  toolbarButtonDisabled: { opacity: 0.5 },
  toolbarIcon: { color: colors.navy, fontWeight: "800", fontSize: 15 },
  toolbarButtonText: { color: colors.navy, fontWeight: "700", fontSize: 13, flexShrink: 1 },
  footerNotice: { fontSize: 12, color: colors.warning },
  footerInfo: { fontSize: 12, color: colors.textMuted },
  discardButton: { alignItems: "center", paddingVertical: spacing.sm },
  discardButtonText: { color: colors.red, fontWeight: "700", fontSize: 13 },
  failureBox: { backgroundColor: colors.errorBackground, borderRadius: 8, padding: spacing.md, gap: 2 },
  failureTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  failureMessage: { fontSize: 13, color: colors.text },
  reloadLink: { color: colors.navy, fontWeight: "700", fontSize: 13, marginTop: spacing.xs },
  primaryButton: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: colors.onNavy, fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.navy,
    minHeight: 48,
  },
  secondaryButtonText: { color: colors.navy, fontSize: 15, fontWeight: "700" },
  successTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  successMeta: { fontSize: 14, color: colors.textMuted },
  successTotal: { fontSize: 28, fontWeight: "800", color: colors.navy },
  partialNotice: { fontSize: 13, color: colors.warning, textAlign: "center" },
});
